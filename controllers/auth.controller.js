"use strict";
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const College = require("../models/College");
const RefreshToken = require("../models/RefreshToken");
const { success, error } = require("../utils/apiResponse");
const { isCollegeEmail, detectCollege } = require("../utils/collegeDetect");
const { sendOTPEmail, sendResetEmail, sendVerificationRequestEmail } = require("../utils/email");
const logger = require("../utils/logger");
const { buildCookieOptions } = require("../utils/cookieOptions");
const { isSuperAdminEmail } = require("../utils/adminEmails");
const Notification = require("../models/Notification");
const cloudinary = require("../config/cloudinary");

const uploadToCloudinary = (buffer, options) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};

const normalizeEmail = (email) =>
  String(email || "")
    .toLowerCase()
    .trim();

const isEmailDeliveryError = (err) =>
  /Email service|Invalid login|Authentication failed|Connection timeout|timed out|timeout|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ESOCKET|EAUTH|ETLS/i.test(
    err.message || "",
  ) ||
  [
    "EAUTH",
    "ESOCKET",
    "ECONNECTION",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ENOTFOUND",
  ].includes(err.code) ||
  err.responseCode;

const handleDuplicateKey = (err, res) => {
  if (err?.code === 11000) {
    if (err?.keyPattern?.email) {
      return error(res, 'An account with this email already exists', 409);
    }
    if (err?.keyPattern?.rollNumber) {
      return error(res, 'This roll number is already registered at this college', 409);
    }
  }
  return null;
};

// ─── Token helpers ────────────────────────────────────────────────────────────
const cookieBase = () => buildCookieOptions({ httpOnly: true });

const issueTokens = async (user, res) => {
  const payload = {
    id: user._id,
    tv: user.tokenVersion ?? 0,
    jti: crypto.randomUUID(),
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
  });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  });

  const tokenHash = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await RefreshToken.create({ userId: user._id, tokenHash, expiresAt });

  res.cookie("cirql_access", accessToken, {
    ...cookieBase(),
    maxAge: 15 * 60 * 1000, // 15 min
  });
  res.cookie("cirql_refresh", refreshToken, {
    ...cookieBase(),
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  return { accessToken, refreshToken };
};

// ─── Register ─────────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, password, agreedToTerms } = req.body;
    const emailLower = normalizeEmail(email);

    logger.debug(`[${req.requestId}] Register attempt for ${emailLower}`);
    const domain = emailLower.split('@')[1];
    const dbCollege = await College.findOne({ domain, isActive: true });

    let isAllowed = isCollegeEmail(emailLower);
    if (dbCollege) isAllowed = true;

    if (!isAllowed) {
      return error(
        res,
        "Only college email addresses are allowed (.edu / .ac.in)",
        400,
      );
    }

    if (!agreedToTerms) {
      return error(
        res,
        "You must agree to the Terms & Conditions and Privacy Policy to create an account",
        400,
      );
    }

    let user = await User.findOne({ email: emailLower }).select(
      "+verifyOTPHash +verifyOTPExpiry +otpAttempts",
    );

    if (user) {
      if (user.isVerified) {
        return error(res, "An account with this email already exists", 409);
      }
      user.name = name.trim();
      user.password = password; // pre-save hook re-hashes
      user.agreedToTermsAt = new Date();
      if (isSuperAdminEmail(emailLower)) user.role = "super_admin";
    } else {
      let info = detectCollege(emailLower);
      if (!info && dbCollege) {
        info = { college: dbCollege.name, domain: dbCollege.domain };
      }
      user = new User({
        name: name.trim(),
        email: emailLower,
        password,
        college: info?.college || "University Campus",
        collegeDomain: info?.domain || domain,
        role: isSuperAdminEmail(emailLower) ? "super_admin" : "user",
        agreedToTermsAt: new Date(),
      });
    }

    const otp = user.createOTP(); // sets hash + expiry
    await user.save();

    const otpDelivery = await sendOTPEmail(emailLower, name.trim(), otp);

    const message = otpDelivery?.skipped
      ? "OTP generated. Check the backend console for the development OTP."
      : "OTP sent to your college email";

    return success(res, { userId: user._id }, message, 201);
  } catch (err) {
    const duplicateResponse = handleDuplicateKey(err, res);
    if (duplicateResponse) return duplicateResponse;
    if (isEmailDeliveryError(err)) {
      logger.warn(
        `[${req.requestId}] OTP email delivery failed: ${err.response || err.message}`,
      );
      return error(
        res,
        "Could not send OTP email. Please check email configuration and try again.",
        503,
      );
    }
    throw err;
  }
};

// ─── Verify OTP ───────────────────────────────────────────────────────────────
exports.verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  const user = await User.findOne({ email: normalizeEmail(email) }).select(
    "+verifyOTPHash +verifyOTPExpiry +otpAttempts +tokenVersion",
  );

  if (!user) return error(res, "No account found for this email", 404);
  if (user.isVerified)
    return error(res, "Email already verified — please log in", 400);

  if ((user.otpAttempts || 0) >= 5) {
    return error(
      res,
      "Too many failed attempts. Please request a new OTP.",
      429,
    );
  }

  if (!user.verifyOTP(otp)) {
    user.otpAttempts = (user.otpAttempts || 0) + 1;
    await User.updateOne(
      { _id: user._id },
      { $set: { otpAttempts: user.otpAttempts } },
    );
    const left = 5 - user.otpAttempts;
    return error(
      res,
      `Invalid or expired OTP. ${left} attempt(s) remaining.`,
      400,
    );
  }

  const isManual = user.registrationMethod === 'manual_verification';
  const isVerifiedVal = isManual ? false : true;

  user.isVerified = isVerifiedVal;
  user.otpAttempts = 0;

  await User.updateOne(
    { _id: user._id },
    {
      $set: { isVerified: isVerifiedVal, otpAttempts: 0 },
      $unset: { verifyOTPHash: 1, verifyOTPExpiry: 1 },
    },
  );

  const { accessToken } = await issueTokens(user, res);
  return success(
    res,
    { user: user.toPublicJSON(), accessToken },
    "Email verified — welcome to CirQl!",
  );
};

// ─── Login ────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  const { email, password } = req.body;

  const emailLower = normalizeEmail(email);
  const user = await User.findOne({ email: emailLower }).select(
    "+password +tokenVersion +failedLoginAttempts +lockUntil",
  );

  if (!user) {
    await bcrypt.compare(
      password,
      "$2a$10$zWLJlFUv2vFd/UXGYLFb9u/72aOl3iIYXArI9Zi4VILwWUTzNWwd.",
    );
    return error(res, "Invalid email or password", 401);
  }

  if (user.lockUntil && user.lockUntil > Date.now()) {
    return error(
      res,
      "Account temporarily locked. Please try again later.",
      401,
    );
  }

  if (!user.isVerified) {
    // Manual verification users: give a specific, accurate message
    if (user.registrationMethod === 'manual_verification') {
      if (user.verificationStatus === 'pending') {
        return error(
          res,
          'Your account is under review. You will receive an email once your ID is verified by your college admin. Questions? Email cirqlofficial1@gmail.com',
          403
        );
      }
      if (user.verificationStatus === 'rejected') {
        return error(
          res,
          'Your ID verification was not approved. Please check your email for the reason and resubmit your ID photo.',
          403
        );
      }
    }
    // College email users: standard OTP verification message
    return error(res, 'Please verify your email before logging in', 401);
  }

  const match = await user.comparePassword(password);
  if (!match) {
    const attempts = (user.failedLoginAttempts || 0) + 1;
    const update = { $inc: { failedLoginAttempts: 1 } };
    if (attempts >= 5) {
      update.$set = { lockUntil: new Date(Date.now() + 15 * 60 * 1000) };
    }
    await User.updateOne({ _id: user._id }, update);
    return error(res, "Invalid email or password", 401);
  }

  if (isSuperAdminEmail(emailLower) && user.role !== "super_admin") {
    user.role = "super_admin";
    try {
      await User.updateOne({ _id: user._id }, { $set: { role: "super_admin" } });
    } catch (saveErr) {
      logger.error("Failed to persist super_admin role:", saveErr.message);
    }
  }

  await User.updateOne(
    { _id: user._id },
    { $set: { failedLoginAttempts: 0 }, $unset: { lockUntil: 1 } },
  );

  const { accessToken } = await issueTokens(user, res);
  return success(
    res,
    { user: user.toPublicJSON(), accessToken },
    "Logged in successfully",
  );
};

// ─── Logout ───────────────────────────────────────────────────────────────────
exports.logout = async (req, res) => {
  const refreshToken = req.cookies?.cirql_refresh;
  if (refreshToken) {
    const tokenHash = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");
    await RefreshToken.deleteOne({ tokenHash });
  }
  res.clearCookie("cirql_access", cookieBase());
  res.clearCookie("cirql_refresh", cookieBase());
  return success(res, null, "Logged out successfully");
};

// ─── Refresh access token ─────────────────────────────────────────────────────
exports.refresh = async (req, res) => {
  const refreshToken = req.cookies?.cirql_refresh;
  if (!refreshToken)
    return error(res, "No refresh token — please log in", 401);

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    res.clearCookie("cirql_refresh", cookieBase());
    return error(
      res,
      "Invalid or expired refresh token — please log in",
      401,
    );
  }

  const user = await User.findById(decoded.id).select("+tokenVersion");
  if (!user) return error(res, "Account no longer exists", 401);

  if (user.tokenVersion !== (decoded.tv ?? 0)) {
    res.clearCookie("cirql_refresh", cookieBase());
    return error(res, "Session invalidated — please log in again", 401);
  }

  const tokenHash = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");
  const tokenRecord = await RefreshToken.findOne({
    userId: user._id,
    tokenHash,
  });

  if (!tokenRecord) {
    res.clearCookie("cirql_refresh", cookieBase());
    return error(res, "Invalid refresh token", 401);
  }

  if (tokenRecord.used) {
    await RefreshToken.deleteMany({ userId: user._id });
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    res.clearCookie("cirql_refresh", cookieBase());
    return error(
      res,
      "Security alert: Token reuse detected. All sessions invalidated.",
      401,
    );
  }

  tokenRecord.used = true;
  await tokenRecord.save();

  const { accessToken } = await issueTokens(user, res);
  return success(res, { user: user.toPublicJSON(), accessToken });
};

// ─── Resend OTP ───────────────────────────────────────────────────────────────
exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const emailLower = normalizeEmail(email);
    const user = await User.findOne({ email: emailLower }).select(
      "+verifyOTPExpiry +otpAttempts +verifyOTPHash",
    );

    if (!user) return error(res, "No account found for this email", 404);
    if (user.isVerified) return error(res, "Email already verified", 400);

    if (
      user.verifyOTPExpiry &&
      user.verifyOTPExpiry - Date.now() > 9 * 60 * 1000
    ) {
      return error(res, "Please wait before requesting a new OTP", 429);
    }

    const otp = user.createOTP();
    await user.save();

    await sendOTPEmail(emailLower, user.name, otp);
    return success(res, {}, "New OTP sent successfully");
  } catch (err) {
    if (isEmailDeliveryError(err)) {
      logger.warn(
        `[${req.requestId}] OTP resend email delivery failed: ${err.response || err.message}`,
      );
      return error(
        res,
        "Could not send OTP email. Please check email configuration and try again.",
        503,
      );
    }
    throw err;
  }
};

// ─── Forgot Password ──────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  const emailLower = normalizeEmail(email);
  const user = await User.findOne({ email: emailLower });

  if (!user)
    return success(
      res,
      {},
      "If an account with that email exists, we sent a password reset link.",
    );

  const resetToken = crypto.randomBytes(64).toString("hex");
  user.resetPasswordHash = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");
  user.resetPasswordExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
  await user.save();

  await sendResetEmail(emailLower, user.name, resetToken);
  return success(
    res,
    {},
    "If an account with that email exists, we sent a password reset link.",
  );
};

// ─── Reset Password ───────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;
  const resetPasswordHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const user = await User.findOne({
    resetPasswordHash,
    resetPasswordExpiry: { $gt: new Date() },
  }).select("+resetPasswordHash +resetPasswordExpiry +tokenVersion");

  if (!user)
    return error(res, "Invalid or expired password reset token", 400);

  user.password = newPassword; // Pre-save hook hashes it automatically
  user.resetPasswordHash = undefined;
  user.resetPasswordExpiry = undefined;
  user.tokenVersion = (user.tokenVersion || 0) + 1; // Log them out from everywhere

  await RefreshToken.deleteMany({ userId: user._id });
  await user.save();

  return success(res, {}, "Password successfully reset. Please log in.");
};

// ─── Change Password (Authenticated) ──────────────────────────────────────────
exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.userId).select(
    "+password +tokenVersion",
  );

  if (!user) return error(res, "Account not found", 404);

  const match = await user.comparePassword(currentPassword);
  if (!match) return error(res, "Current password is incorrect", 401);

  user.password = newPassword;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await RefreshToken.deleteMany({ userId: user._id });

  await user.save();

  return success(
    res,
    {},
    "Password successfully changed. Please log in again.",
  );
};

// POST /api/v1/auth/register/manual
// Path B: personal email + roll number + ID photo
const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

exports.registerManual = async (req, res) => {
  try {
    const { name, email, password, college, rollNumber, agreedToTerms } = req.body;
    const emailLower = normalizeEmail(email);

    if (!agreedToTerms || agreedToTerms === 'false') {
      return error(res, 'You must agree to the Terms & Conditions and Privacy Policy', 400);
    }
    if (!college || !rollNumber) {
      return error(res, 'College name and roll number are required', 400);
    }

    const collegeInput = college.trim().replace(/\s+/g, ' ');
    const matchedCollege = await College.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(collegeInput)}$`, 'i') }
    });
    const resolvedCollege = matchedCollege ? matchedCollege.name : collegeInput;

    // Check if roll number already exists at this college
    const existingRoll = await User.findOne({
      rollNumber: rollNumber.trim().toUpperCase(),
      college: resolvedCollege,
    });
    if (existingRoll) {
      if (existingRoll.isVerified) {
        return error(res, 'This roll number is already registered at this college', 409);
      } else {
        // If the old account with this roll number was never verified, delete it to free up the roll number
        logger.info(`[AUTH] Deleting unverified user ${existingRoll._id} with conflicting roll number ${rollNumber} to allow re-registration`);
        await User.deleteOne({ _id: existingRoll._id });
      }
    }

    // Check email not already used
    let user = await User.findOne({ email: emailLower }).select('+verifyOTPHash +verifyOTPExpiry +otpAttempts');
    if (user && user.isVerified) {
      return error(res, 'An account with this email already exists', 409);
    }

    if (user) {
      user.name = name.trim();
      user.password = password;
      user.agreedToTermsAt = new Date();
      user.college = resolvedCollege;
      user.rollNumber = rollNumber.trim().toUpperCase();
      user.registrationMethod = 'manual_verification';
      user.verificationStatus = 'pending';
    } else {
      user = new User({
        name: name.trim(),
        email: emailLower,
        password,
        college: resolvedCollege,
        collegeDomain: '',
        rollNumber: rollNumber.trim().toUpperCase(),
        registrationMethod: 'manual_verification',
        verificationStatus: 'pending',
        agreedToTermsAt: new Date(),
      });
    }

    const otp = user.createOTP();
    await user.save();

    const otpDelivery = await sendOTPEmail(emailLower, name.trim(), otp);
    const message = otpDelivery?.skipped
      ? 'OTP generated. Check the backend console.'
      : 'OTP sent to your email. Verify to continue.';

    return success(res, { userId: user._id }, message, 201);
  } catch (err) {
    const duplicateResponse = handleDuplicateKey(err, res);
    if (duplicateResponse) return duplicateResponse;
    if (isEmailDeliveryError(err)) {
      logger.warn(`OTP email delivery failed: ${err.response || err.message}`);
      return error(res, 'Could not send OTP email. Please check email configuration and try again.', 503);
    }
    throw err;
  }
};

// POST /api/v1/auth/register/submit-id
// Called after OTP verification for Path B users
// Expects multipart/form-data with 'idPhoto' file
exports.submitIDPhoto = async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return error(res, 'User not found', 404);
  if (user.registrationMethod !== 'manual_verification') {
    return error(res, 'This step is not required for your registration type', 400);
  }
  if (!req.file) return error(res, 'ID photo is required', 400);

  // Upload to Cloudinary
  const uploadResult = await uploadToCloudinary(req.file.buffer, {
    folder: 'cirql/id-verifications',
    resource_type: 'image',
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
  });

  user.idPhotoUrl = uploadResult.secure_url;
  user.verificationStatus = 'pending';
  await user.save();

  // Notify college admin immediately
  const collegeAdmin = await User.findOne({
    role: 'college_admin',
    adminCollege: user.college,
  });

  if (collegeAdmin) {
    // Email notification
    await sendVerificationRequestEmail(collegeAdmin.email, {
      studentName: user.name,
      studentEmail: user.email,
      rollNumber: user.rollNumber,
      college: user.college,
      idPhotoUrl: user.idPhotoUrl,
      adminPanelUrl: 'https://cirql.store/admin',
    });

    // In-app notification
    await Notification.create({
      user: collegeAdmin._id,
      type: 'message',
      text: `New verification request from ${user.name} (Roll: ${user.rollNumber})`,
      link: '/admin?tab=verifications',
    });

    // Socket notification to admin if online
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${collegeAdmin._id}`).emit('new_notification', {
        notification: {
          text: `New verification request from ${user.name}`,
          link: '/admin?tab=verifications',
        },
      });
    }
  }

  // Also notify super admin if no college admin assigned
  if (!collegeAdmin) {
    const superAdmins = await User.find({ role: 'super_admin' }).select('_id email');
    for (const sa of superAdmins) {
      await Notification.create({
        user: sa._id,
        type: 'message',
        text: `New unassigned verification request from ${user.name} at ${user.college}`,
        link: '/admin?tab=verifications',
      });
    }
  }

  return success(res, {}, 'ID photo submitted. A college admin will review your request. You will receive an email once verified.');
};
