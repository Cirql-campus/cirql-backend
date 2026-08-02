'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { spawnSync } = require('child_process');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../utils/email', () => ({
  sendOTPEmail: jest.fn().mockResolvedValue({ skipped: false }),
  sendResetEmail: jest.fn().mockResolvedValue(undefined),
  sendVerificationRequestEmail: jest.fn().mockResolvedValue({ skipped: false }),
  sendVerificationApprovedEmail: jest.fn().mockResolvedValue({ skipped: false }),
  sendVerificationRejectedEmail: jest.fn().mockResolvedValue({ skipped: false }),
}));

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn().mockImplementation((options, callback) => {
        return {
          write: jest.fn(),
          end: jest.fn().mockImplementation(() => {
            callback(null, { secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v12345/cirql/id-verifications/mock-id.jpg' });
          }),
        };
      }),
      destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
    },
  },
}));

const {
  sendOTPEmail,
  sendVerificationRequestEmail,
  sendVerificationApprovedEmail,
  sendVerificationRejectedEmail,
} = require('../utils/email');
const Listing = require('../models/Listing');

jest.setTimeout(300_000);

const TEST_PASSWORD = 'Password1!';

let mongo;
let app;
let server;
let buyer;
let seller;
let otherCollegeUser;
let adminUser;
let listing;
let conversationId;
let usingExternalMongo = false;

const applyTestEnv = (mongoUri) => {
  process.env.NODE_ENV = 'test';
  process.env.DISABLE_CLUSTER = 'true';
  process.env.PORT = '5199';
  process.env.MONGODB_URI = mongoUri;
  process.env.JWT_SECRET = 'test_jwt_secret_64_byte_value_for_integration_suite';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_64_byte_value_for_integration_suite';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '30d';
  process.env.FIELD_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
  process.env.EMAIL_HOST = 'smtp.test.local';
  process.env.EMAIL_USER = 'test-user';
  process.env.EMAIL_PASS = 'test-pass';
  process.env.EMAIL_FROM_NAME = 'CirQl Test';
  process.env.EMAIL_FROM_ADDRESS = 'noreply@test.cirql';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.FRONTEND_ORIGINS = 'http://localhost:5173';
  process.env.ALLOWED_COLLEGE_DOMAINS = 'kiet.edu,akgec.ac.in';
  process.env.ADMIN_EMAILS = 'admin@kiet.edu';
  process.env.BCRYPT_ROUNDS = '4';
};

const waitForDatabase = async () => {
  const Category = require('../models/Category');
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (mongoose.connection.readyState === 1) {
      const categoryCount = await Category.countDocuments();
      if (categoryCount >= 6) return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error('Timed out waiting for test database connection and seed categories');
};

const closeServer = () => new Promise((resolve, reject) => {
  if (!server?.listening) return resolve();
  server.close((err) => (err ? reject(err) : resolve()));
});

const registerVerifiedUser = async ({ name, email }) => {
  const agent = request.agent(app);

  const registerRes = await agent
    .post('/api/v1/auth/register')
    .send({ name, email, password: TEST_PASSWORD, agreedToTerms: true })
    .expect(201);

  expect(registerRes.body.success).toBe(true);

  const otpCall = sendOTPEmail.mock.calls.find(call => call[0] === email);
  expect(otpCall).toBeTruthy();
  const otp = otpCall[2];

  const verifyRes = await agent
    .post('/api/v1/auth/verify-otp')
    .send({ email, otp })
    .expect(200);

  expect(verifyRes.body.success).toBe(true);
  expect(verifyRes.body.accessToken).toEqual(expect.any(String));

  return {
    agent,
    user: verifyRes.body.user,
    accessToken: verifyRes.body.accessToken,
  };
};

const attachListingImage = (req) => req.attach(
  'images',
  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]),
  { filename: 'arduino-kit.jpg', contentType: 'image/jpeg' }
);

beforeAll(async () => {
  if (process.env.TEST_MONGODB_URI) {
    usingExternalMongo = true;
    if (!/test|ci/i.test(process.env.TEST_MONGODB_URI) && process.env.ALLOW_TEST_DB_DROP !== 'true') {
      throw new Error('TEST_MONGODB_URI must point to a disposable test database, or set ALLOW_TEST_DB_DROP=true.');
    }
    applyTestEnv(process.env.TEST_MONGODB_URI);
  } else {
    try {
      mongo = await MongoMemoryServer.create();
      applyTestEnv(mongo.getUri());
    } catch (err) {
      if (err?.code === 'EPERM') {
        throw new Error(
          'MongoMemoryServer could not spawn mongod on this machine. ' +
          'Set TEST_MONGODB_URI to a disposable MongoDB database for integration tests.'
        );
      }
      throw err;
    }
  }

  ({ app, server } = require('../server'));
  await waitForDatabase();

  buyer = await registerVerifiedUser({
    name: 'Buyer Student',
    email: 'buyer@kiet.edu',
  });

  seller = await registerVerifiedUser({
    name: 'Seller Student',
    email: 'seller@kiet.edu',
  });

  otherCollegeUser = await registerVerifiedUser({
    name: 'Other College Student',
    email: 'other@akgec.ac.in',
  });

  adminUser = await registerVerifiedUser({
    name: 'Admin Student',
    email: 'admin@kiet.edu',
  });

  const createListingReq = seller.agent
    .post('/api/v1/listings')
    .field('title', 'Arduino Uno Starter Kit')
    .field('description', 'Complete kit with breadboard, jumpers, sensors, and cable.')
    .field('price', '899')
    .field('category', 'tech')
    .field('type', 'sell')
    .field('condition', 'Good')
    .field('location', 'Main canteen');

  const createListingRes = await attachListingImage(createListingReq)
    .expect(201);

  listing = createListingRes.body.listing;
});

afterAll(async () => {
  await closeServer();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
  if (mongo && !usingExternalMongo) await mongo.stop();
});

describe('CirQl production integration flows', () => {
  test('auth keeps a verified user session and exposes profile data', async () => {
    const meRes = await buyer.agent
      .get('/api/v1/users/me')
      .expect(200);

    expect(meRes.body).toMatchObject({
      success: true,
      user: {
        _id: buyer.user._id,
        name: 'Buyer Student',
        email: 'buyer@kiet.edu',
        isVerified: true,
      },
    });
    expect(meRes.body.user.college).toEqual('KIET Group of Institutions');

    const authMeRes = await buyer.agent
      .get('/api/v1/auth/me')
      .expect(200);

    expect(authMeRes.body).toMatchObject({
      success: true,
      user: {
        _id: buyer.user._id,
        email: 'buyer@kiet.edu',
        isVerified: true,
      },
    });

    const logoutUser = await registerVerifiedUser({
      name: 'Logout Student',
      email: 'logout@kiet.edu',
    });
    await logoutUser.agent
      .post('/api/v1/auth/logout')
      .expect(200);
    await logoutUser.agent
      .post('/api/v1/auth/refresh')
      .expect(401);
  });

  test('browser cookie writes are origin-protected and support CSRF tokens', async () => {
    const csrfUser = await registerVerifiedUser({
      name: 'Csrf Student',
      email: 'csrf@kiet.edu',
    });

    await csrfUser.agent
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    const csrfUserWithToken = await registerVerifiedUser({
      name: 'Csrf Token Student',
      email: 'csrf-token@kiet.edu',
    });

    const csrfRes = await csrfUserWithToken.agent
      .get('/api/v1/auth/csrf-token')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    await csrfUserWithToken.agent
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://localhost:5173')
      .set('X-CSRF-Token', csrfRes.body.csrfToken)
      .expect(200);

    const blockedUser = await registerVerifiedUser({
      name: 'Blocked Origin Student',
      email: 'blocked-origin@kiet.edu',
    });

    await blockedUser.agent
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  test('auth cookies can be configured for cross-site frontend deployments', async () => {
    const previousSameSite = process.env.COOKIE_SAME_SITE;
    const previousSecure = process.env.COOKIE_SECURE;
    process.env.COOKIE_SAME_SITE = 'none';
    process.env.COOKIE_SECURE = 'true';

    try {
      const email = 'cross-site-cookie@kiet.edu';
      const registerRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Cross Site Cookie Student',
          email,
          password: TEST_PASSWORD,
          agreedToTerms: true,
        })
        .expect(201);

      expect(registerRes.body.success).toBe(true);

      const otpCall = sendOTPEmail.mock.calls.find(call => call[0] === email);
      expect(otpCall).toBeTruthy();

      const verifyRes = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ email, otp: otpCall[2] })
        .expect(200);

      const authCookies = verifyRes.headers['set-cookie'] || [];
      expect(authCookies.find(cookie => cookie.startsWith('cirql_access='))).toEqual(
        expect.stringContaining('SameSite=None')
      );
      expect(authCookies.find(cookie => cookie.startsWith('cirql_refresh='))).toEqual(
        expect.stringContaining('SameSite=None')
      );
      expect(authCookies.find(cookie => cookie.startsWith('cirql_access='))).toEqual(
        expect.stringContaining('Secure')
      );
    } finally {
      if (previousSameSite === undefined) delete process.env.COOKIE_SAME_SITE;
      else process.env.COOKIE_SAME_SITE = previousSameSite;

      if (previousSecure === undefined) delete process.env.COOKIE_SECURE;
      else process.env.COOKIE_SECURE = previousSecure;
    }
  });

  test('register fails if agreedToTerms is missing or false', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Consent Fail Student',
        email: 'consent-fail@kiet.edu',
        password: TEST_PASSWORD,
      })
      .expect(400);

    expect(res.body).toMatchObject({
      success: false,
      message: 'You must agree to the Terms & Conditions and Privacy Policy to create an account',
    });
  });

  test('register reports OTP email delivery failure instead of silently succeeding', async () => {
    sendOTPEmail.mockRejectedValueOnce(new Error('ENOTFOUND smtp.example'));

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Mail Failure Student',
        email: 'mail-failure@kiet.edu',
        password: TEST_PASSWORD,
        agreedToTerms: true,
      })
      .expect(503);

    expect(res.body).toMatchObject({
      success: false,
      message: 'Could not send OTP email. Please check email configuration and try again.',
    });
  });

  test('signup OTP verification persists database state and then permits login', async () => {
    const email = 'db-verify@kiet.edu';

    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Database Verify Student',
        email,
        password: TEST_PASSWORD,
        agreedToTerms: true,
      })
      .expect(201);

    expect(registerRes.body.success).toBe(true);

    const User = require('../models/User');
    const registeredUser = await User.findOne({ email }).select('+verifyOTPHash +verifyOTPExpiry +otpAttempts');
    expect(registeredUser).toBeTruthy();
    expect(registeredUser.isVerified).toBe(false);
    expect(registeredUser.verifyOTPHash).toEqual(expect.any(String));
    expect(registeredUser.verifyOTPExpiry).toBeInstanceOf(Date);
    expect(registeredUser.otpAttempts).toBe(0);

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(401);

    const otpCall = sendOTPEmail.mock.calls.find(call => call[0] === email);
    expect(otpCall).toBeTruthy();

    const verifyRes = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ email, otp: otpCall[2] })
      .expect(200);

    expect(verifyRes.body).toMatchObject({
      success: true,
      user: { email, isVerified: true },
    });

    const verifiedUser = await User.findOne({ email }).select('+verifyOTPHash +verifyOTPExpiry +otpAttempts');
    expect(verifiedUser.isVerified).toBe(true);
    expect(verifiedUser.verifyOTPHash).toBeUndefined();
    expect(verifiedUser.verifyOTPExpiry).toBeUndefined();
    expect(verifiedUser.otpAttempts).toBe(0);

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
  });

  test('refresh-token reuse detection invalidates the reused session', async () => {
    const refreshUser = await registerVerifiedUser({
      name: 'Refresh Student',
      email: 'refresh@kiet.edu',
    });

    const loginRes = await refreshUser.agent
      .post('/api/v1/auth/login')
      .send({ email: 'refresh@kiet.edu', password: TEST_PASSWORD })
      .expect(200);
    const oldRefreshCookie = (loginRes.headers['set-cookie'] || [])
      .find(cookie => cookie.startsWith('cirql_refresh='));
    expect(oldRefreshCookie).toBeTruthy();

    await refreshUser.agent
      .post('/api/v1/auth/refresh')
      .expect(200);

    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldRefreshCookie)
      .expect(401);
  });

  test('listings are authenticated, campus scoped, and fetched by detail id', async () => {
    expect(listing).toMatchObject({
      title: 'Arduino Uno Starter Kit',
      category: 'tech',
      price: 899,
      type: 'sell',
      seller: seller.user._id,
    });

    await request(app)
      .get('/api/v1/listings?category=tech&limit=10')
      .expect(401);

    const listRes = await buyer.agent
      .get('/api/v1/listings?category=tech&limit=10')
      .expect(200);

    expect(listRes.body.success).toBe(true);
    expect(listRes.body.listings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: listing._id,
          title: 'Arduino Uno Starter Kit',
        }),
      ])
    );

    const otherCampusRes = await otherCollegeUser.agent
      .get('/api/v1/listings?category=tech&limit=10&college=KIET%20Group%20of%20Institutions')
      .expect(200);
    expect(otherCampusRes.body.listings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: listing._id }),
      ])
    );

    const detailRes = await buyer.agent
      .get(`/api/v1/listings/${listing._id}`)
      .expect(200);

    expect(detailRes.body).toMatchObject({
      success: true,
      listing: {
        _id: listing._id,
        title: 'Arduino Uno Starter Kit',
        category: 'tech',
        seller: {
          _id: seller.user._id,
          name: 'Seller Student',
        },
      },
    });

    await otherCollegeUser.agent
      .get(`/api/v1/listings/${listing._id}`)
      .expect(404);

    await Listing.updateOne({ _id: listing._id }, { $set: { moderationStatus: 'pending' } });

    await buyer.agent
      .get(`/api/v1/listings/${listing._id}?moderation=pending`)
      .expect(404);

    await seller.agent
      .get(`/api/v1/listings/${listing._id}?owner=1`)
      .expect(200);

    await Listing.updateOne({ _id: listing._id }, { $set: { moderationStatus: 'approved' } });
  });

  test('category detail is authenticated, campus scoped, and moderation aware', async () => {
    await request(app)
      .get('/api/v1/categories/tech')
      .expect(401);

    const campusCategoryRes = await buyer.agent
      .get('/api/v1/categories/tech')
      .expect(200);
    expect(campusCategoryRes.body.featuredListings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: listing._id, title: 'Arduino Uno Starter Kit' }),
      ])
    );

    const otherCampusCategoryRes = await otherCollegeUser.agent
      .get('/api/v1/categories/tech')
      .expect(200);
    expect(otherCampusCategoryRes.body.featuredListings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: listing._id }),
      ])
    );

    await adminUser.agent
      .patch(`/api/v1/admin/listings/${listing._id}/moderation`)
      .send({ moderationStatus: 'rejected', moderationReason: 'Regression test hide' })
      .expect(200);

    const hiddenCategoryRes = await buyer.agent
      .get('/api/v1/categories/tech')
      .expect(200);
    expect(hiddenCategoryRes.body.featuredListings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: listing._id }),
      ])
    );

    const hiddenListingsRes = await buyer.agent
      .get('/api/v1/listings?category=tech&limit=10')
      .expect(200);
    expect(hiddenListingsRes.body.listings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: listing._id }),
      ])
    );

    await adminUser.agent
      .patch(`/api/v1/admin/listings/${listing._id}/moderation`)
      .send({ moderationStatus: 'approved' })
      .expect(200);

    const restoredCategoryRes = await buyer.agent
      .get('/api/v1/categories/tech')
      .expect(200);
    expect(restoredCategoryRes.body.featuredListings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: listing._id }),
      ])
    );
  });

  test('invalid image uploads fail before listing creation', async () => {
    await seller.agent
      .post('/api/v1/listings')
      .field('title', 'Bad Upload Listing')
      .field('description', 'This should never be created.')
      .field('price', '100')
      .field('category', 'tech')
      .field('type', 'sell')
      .attach('images', Buffer.from('not-an-image'), { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(400);

    await seller.agent
      .post('/api/v1/listings')
      .field('title', 'Spoofed Upload Listing')
      .field('description', 'This should also never be created.')
      .field('price', '100')
      .field('category', 'tech')
      .field('type', 'sell')
      .attach('images', Buffer.from('not-an-image'), { filename: 'spoof.jpg', contentType: 'image/jpeg' })
      .expect(400);
  });

  test('profile listing endpoint returns the seller owned listing', async () => {
    const profileListingsRes = await seller.agent
      .get('/api/v1/listings/mine/me')
      .expect(200);

    expect(profileListingsRes.body.success).toBe(true);
    expect(profileListingsRes.body.listings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: listing._id,
          title: 'Arduino Uno Starter Kit',
          daysUntilExpiry: expect.any(Number),
        }),
      ])
    );
  });

  test('chat creates a conversation and persists messages through REST', async () => {
    await otherCollegeUser.agent
      .post('/api/v1/chat/conversations')
      .send({ listingId: listing._id, sellerId: seller.user._id })
      .expect(403);

    const conversationRes = await buyer.agent
      .post('/api/v1/chat/conversations')
      .send({ listingId: listing._id, sellerId: seller.user._id })
      .expect(200);

    expect(conversationRes.body.success).toBe(true);
    conversationId = conversationRes.body.conversation._id;

    const messageText = 'Hi, is the Arduino kit still available?';
    const sendRes = await buyer.agent
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .send({ text: messageText })
      .expect(201);

    expect(sendRes.body).toMatchObject({
      success: true,
      message: {
        text: messageText,
      },
    });

    const messagesRes = await seller.agent
      .get(`/api/v1/chat/conversations/${conversationId}/messages`)
      .expect(200);

    expect(messagesRes.body.success).toBe(true);
    expect(messagesRes.body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: messageText,
        }),
      ])
    );
  });

  test('blocked users cannot continue chat until unblocked', async () => {
    if (!conversationId) {
      const conversationRes = await buyer.agent
        .post('/api/v1/chat/conversations')
        .send({ listingId: listing._id, sellerId: seller.user._id })
        .expect(200);
      conversationId = conversationRes.body.conversation._id;
    }

    await buyer.agent
      .post(`/api/v1/users/${seller.user._id}/block`)
      .send({ reason: 'Regression test block' })
      .expect(200);

    await buyer.agent
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .send({ text: 'This should be blocked.' })
      .expect(403);

    await buyer.agent
      .delete(`/api/v1/users/${seller.user._id}/block`)
      .expect(200);

    await buyer.agent
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .send({ text: 'Unblocked chat works again.' })
      .expect(201);
  });

  test('wanted items are college scoped, manageable by owner, and can start chat responses', async () => {
    const createWantedRes = await buyer.agent
      .post('/api/v1/wanted')
      .send({
        title: 'Scientific calculator',
        description: 'Need a Casio or similar calculator this week.',
        category: 'academia',
        minBudget: 200,
        maxBudget: 500,
        urgency: 'this_week',
      })
      .expect(201);

    expect(createWantedRes.body).toMatchObject({
      success: true,
      wanted: {
        title: 'Scientific calculator',
        category: 'academia',
        college: 'KIET Group of Institutions',
        status: 'open',
      },
    });
    const wantedId = createWantedRes.body.wanted._id;

    const campusWantedRes = await seller.agent
      .get('/api/v1/wanted?limit=10')
      .expect(200);
    expect(campusWantedRes.body.wanted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: wantedId, title: 'Scientific calculator' }),
      ])
    );

    const otherCollegeWantedRes = await otherCollegeUser.agent
      .get('/api/v1/wanted?limit=10')
      .expect(200);
    expect(otherCollegeWantedRes.body.wanted).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: wantedId }),
      ])
    );

    await seller.agent
      .patch(`/api/v1/wanted/${wantedId}/status`)
      .send({ status: 'fulfilled' })
      .expect(403);

    const responseRes = await seller.agent
      .post(`/api/v1/wanted/${wantedId}/respond`)
      .send({ message: 'I have a calculator available.' })
      .expect(201);
    expect(responseRes.body).toMatchObject({
      success: true,
      conversation: {
        _id: expect.any(String),
      },
      message: {
        text: 'I have a calculator available.',
      },
    });

    await buyer.agent
      .patch(`/api/v1/wanted/${wantedId}/status`)
      .send({ status: 'fulfilled' })
      .expect(200);

    const mineRes = await buyer.agent
      .get('/api/v1/wanted/mine?status=all')
      .expect(200);
    expect(mineRes.body.wanted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: wantedId, status: 'fulfilled' }),
      ])
    );

    await buyer.agent
      .delete(`/api/v1/wanted/${wantedId}`)
      .expect(200);
  });

  test('non-payment deal flow completes and unlocks seller review', async () => {
    const requestRes = await buyer.agent
      .post('/api/v1/deals')
      .send({
        listingId: listing._id,
        message: 'I can meet near the library.',
        meetupLocation: 'Library gate',
      })
      .expect(201);

    expect(requestRes.body.success).toBe(true);
    const dealId = requestRes.body.deal._id;

    await seller.agent
      .patch(`/api/v1/deals/${dealId}/status`)
      .send({ action: 'accept' })
      .expect(200);

    await buyer.agent
      .patch(`/api/v1/deals/${dealId}/status`)
      .send({ action: 'complete' })
      .expect(200);

    const completeRes = await seller.agent
      .patch(`/api/v1/deals/${dealId}/status`)
      .send({ action: 'complete' })
      .expect(200);

    expect(completeRes.body.deal.status).toBe('completed');

    const reviewRes = await buyer.agent
      .post(`/api/v1/users/${seller.user._id}/review`)
      .send({
        rating: 5,
        comment: 'Smooth campus handoff.',
        listingId: listing._id,
      })
      .expect(201);

    expect(reviewRes.body.success).toBe(true);
  });

  test('protected endpoints reject anonymous requests', async () => {
    await request(app)
      .get('/api/v1/users/me')
      .expect(401);

    await request(app)
      .post('/api/v1/listings')
      .field('title', 'Unauthorized Listing')
      .field('price', '100')
      .field('category', 'tech')
      .expect(401);
  });

  test('production environment validation accepts a complete deploy config', () => {
    const productionEnv = {
      ...process.env,
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/cirql?retryWrites=true&w=majority',
      JWT_SECRET: 'a'.repeat(64),
      JWT_REFRESH_SECRET: 'b'.repeat(64),
      FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
      CLOUDINARY_CLOUD_NAME: 'cirql-test-cloud',
      CLOUDINARY_API_KEY: '1234567890',
      CLOUDINARY_API_SECRET: 'cloudinary-secret',
      EMAIL_HOST: 'smtp.test.local',
      EMAIL_USER: 'mailer',
      EMAIL_PASS: 'mailer-secret',
      EMAIL_FROM_NAME: 'CirQl Test',
      EMAIL_FROM_ADDRESS: 'noreply@cirql.test',
      FRONTEND_URL: 'https://cirql.test',
      FRONTEND_ORIGINS: 'https://cirql.test,https://www.cirql.test',
      ALLOWED_COLLEGE_DOMAINS: 'kiet.edu,akgec.ac.in',
      ADMIN_EMAILS: 'admin@kiet.edu',
      SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
    };

    const result = spawnSync(
      process.execPath,
      ['-e', "require('./utils/validateEnv')(); console.log('production env validation passed')"],
      {
        cwd: process.cwd(),
        env: productionEnv,
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('production env validation passed');
  });

  describe('Manual ID Verification Registration Flow (Path B)', () => {
    const studentEmail = 'manual-student@gmail.com';
    const rollNumber = '2100140100099';
    const collegeName = 'GLA University';
    let studentId;
    let studentToken;
    let plaintextOtp;

    test('registerManual creates pending manual verification user', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register/manual')
        .send({
          name: 'Manual Student',
          email: studentEmail,
          password: TEST_PASSWORD,
          college: collegeName,
          rollNumber,
          agreedToTerms: 'true',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('userId');
      studentId = res.body.userId;

      const otpCall = sendOTPEmail.mock.calls.find(call => call[0] === studentEmail);
      expect(otpCall).toBeTruthy();
      plaintextOtp = otpCall[2];

      const User = require('../models/User');
      const u = await User.findById(studentId);
      expect(u).toBeTruthy();
      expect(u.registrationMethod).toBe('manual_verification');
      expect(u.verificationStatus).toBe('pending');
      expect(u.rollNumber).toBe(rollNumber);
      expect(u.college).toBe(collegeName);
      expect(u.isVerified).toBe(false);
    });

    test('verifyOTP for manual user keeps account isVerified = false but issues token', async () => {
      expect(plaintextOtp).toBeTruthy();

      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ email: studentEmail, otp: plaintextOtp })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user.isVerified).toBe(false);
      expect(res.body).toHaveProperty('accessToken');
      studentToken = res.body.accessToken;

      const User = require('../models/User');
      const u = await User.findById(studentId);
      expect(u.isVerified).toBe(false);
    });

    test('submitIDPhoto uploads fake photo buffer and transitions status', async () => {
      expect(studentToken).toBeTruthy();
      const fakeBuffer = Buffer.from('fake-image-binary-content');
      
      const res = await request(app)
        .post('/api/v1/auth/register/submit-id')
        .set('Authorization', `Bearer ${studentToken}`)
        .attach('idPhoto', fakeBuffer, 'student_id.jpg')
        .expect(200);

      expect(res.body.success).toBe(true);

      const User = require('../models/User');
      const u = await User.findById(studentId);
      expect(u.idPhotoUrl).toContain('cloudinary.com');
      expect(u.verificationStatus).toBe('pending');
    });

    test('login is blocked for pending manual verification user', async () => {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: studentEmail, password: TEST_PASSWORD })
        .expect(401);
    });

    test('adminController.getPendingVerifications lists pending requests', async () => {
      const res = await adminUser.agent
        .get('/api/v1/admin/verifications')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('verifications');
    });

    test('adminController.approveVerification approves user and enables login', async () => {
      const res = await adminUser.agent
        .post(`/api/v1/admin/verifications/${studentId}/approve`)
        .expect(200);

      expect(res.body.success).toBe(true);

      const User = require('../models/User');
      const u = await User.findById(studentId);
      expect(u.verificationStatus).toBe('approved');
      expect(u.isVerified).toBe(true);

      // Welcome email sent
      expect(sendVerificationApprovedEmail).toHaveBeenCalled();

      // Can now log in
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: studentEmail, password: TEST_PASSWORD })
        .expect(200);
    });

    test('adminController.rejectVerification rejects user and sets reason', async () => {
      // Register a second student for rejection testing
      const email2 = 'manual-student2@gmail.com';
      const roll2 = '2100140100098';
      
      const regRes = await request(app)
        .post('/api/v1/auth/register/manual')
        .send({
          name: 'Manual Student 2',
          email: email2,
          password: TEST_PASSWORD,
          college: collegeName,
          rollNumber: roll2,
          agreedToTerms: 'true',
        });
      
      const studentId2 = regRes.body.userId;

      await adminUser.agent
        .post(`/api/v1/admin/verifications/${studentId2}/reject`)
        .send({ reason: 'ID card blurry' })
        .expect(200);

      const User = require('../models/User');
      const u2 = await User.findById(studentId2);
      expect(u2.verificationStatus).toBe('rejected');
      expect(u2.verificationNote).toBe('ID card blurry');
      expect(u2.isVerified).toBe(false);

      expect(sendVerificationRejectedEmail).toHaveBeenCalled();
    });

    describe('Type-specific listing fields (Rent, Sell, Free, Service)', () => {
      test('should save rent-specific fields when type is rent', async () => {
        const createListingReq = seller.agent
          .post('/api/v1/listings')
          .field('title', 'Rentable Lab Coat')
          .field('description', 'White lab coat for chemistry labs.')
          .field('price', '50')
          .field('category', 'attire')
          .field('type', 'rent')
          .field('rentDuration', 'weekly')
          .field('deposit', '200')
          .field('availableFrom', '2026-09-01')
          .field('location', 'Hostel 3');

        const createRes = await attachListingImage(createListingReq).expect(201);
        const lId = createRes.body.listing._id;

        const dbListing = await Listing.findById(lId);
        expect(dbListing).toMatchObject({
          type: 'rent',
          rentDuration: 'weekly',
          deposit: 200,
        });
        expect(dbListing.availableFrom).toBeInstanceOf(Date);
        expect(dbListing.availableFrom.toISOString().substring(0, 10)).toBe('2026-09-01');
      });

      test('should save service-specific fields when type is service', async () => {
        const createListingReq = seller.agent
          .post('/api/v1/listings')
          .field('title', 'Maths Tutoring')
          .field('description', 'Engineering mathematics coaching.')
          .field('price', '150')
          .field('category', 'tech')
          .field('type', 'service')
          .field('availability', 'weekends')
          .field('deliveryMode', 'remote')
          .field('location', 'Library');

        const createRes = await attachListingImage(createListingReq).expect(201);
        const lId = createRes.body.listing._id;

        const dbListing = await Listing.findById(lId);
        expect(dbListing).toMatchObject({
          type: 'service',
          availability: 'weekends',
          deliveryMode: 'remote',
        });
      });

      test('should ignore rent/service fields if type is sell', async () => {
        const createListingReq = seller.agent
          .post('/api/v1/listings')
          .field('title', 'Physics Book')
          .field('description', 'NCERT Physics Class 12th.')
          .field('price', '200')
          .field('category', 'academia')
          .field('type', 'sell')
          .field('deposit', '500')
          .field('availableFrom', '2026-09-01')
          .field('availability', 'anytime')
          .field('deliveryMode', 'in_person')
          .field('location', 'Library gate');

        const createRes = await attachListingImage(createListingReq).expect(201);
        const lId = createRes.body.listing._id;

        const dbListing = await Listing.findById(lId);
        expect(dbListing.deposit).toBeUndefined();
        expect(dbListing.availableFrom).toBeUndefined();
        expect(dbListing.availability).toBeUndefined();
        expect(dbListing.deliveryMode).toBeUndefined();
      });

      test('updating listing type from rent to sell should clear deposit and availableFrom', async () => {
        const createListingReq = seller.agent
          .post('/api/v1/listings')
          .field('title', 'Rentable Lab Coat 2')
          .field('description', 'White lab coat for chemistry labs.')
          .field('price', '50')
          .field('category', 'attire')
          .field('type', 'rent')
          .field('rentDuration', 'weekly')
          .field('deposit', '200')
          .field('availableFrom', '2026-09-01')
          .field('location', 'Hostel 3');

        const createRes = await attachListingImage(createListingReq).expect(201);
        const lId = createRes.body.listing._id;

        await seller.agent
          .put(`/api/v1/listings/${lId}`)
          .send({ type: 'sell' })
          .expect(200);

        const dbListing = await Listing.findById(lId);
        expect(dbListing.type).toBe('sell');
        expect(dbListing.rentDuration).toBeUndefined();
        expect(dbListing.deposit).toBeUndefined();
        expect(dbListing.availableFrom).toBeUndefined();
      });
    });
  });
});
