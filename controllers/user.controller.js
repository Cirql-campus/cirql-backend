'use strict';
const mongoose = require('mongoose');
const User     = require('../models/User');
const Review   = require('../models/Review');
const UserBlock = require('../models/UserBlock');
const UserReport = require('../models/UserReport');
const Listing = require('../models/Listing');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Deal = require('../models/Deal');
const { success, error } = require('../utils/apiResponse');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const NOTIFICATION_PREFERENCE_KEYS = new Set([
  'pushEnabled',
  'messages',
  'deals',
  'wanted',
  'moderation',
  'messagePreview',
]);

const isValidPushSubscription = (subscription) => Boolean(
  subscription
  && typeof subscription.endpoint === 'string'
  && subscription.endpoint.length <= 500
  && subscription.keys
  && typeof subscription.keys.p256dh === 'string'
  && typeof subscription.keys.auth === 'string'
);

const findReviewEligibleListing = async ({ reviewerId, sellerId, listingId }) => {
  const dealFilter = {
    buyer: reviewerId,
    seller: sellerId,
    status: 'completed',
  };
  if (listingId) dealFilter.listing = listingId;

  const completedDeal = await Deal.findOne(dealFilter)
    .sort({ completedAt: -1, updatedAt: -1 })
    .populate('listing', 'title')
    .lean();
  if (completedDeal) {
    return {
      listing: completedDeal.listing,
      deal: completedDeal,
    };
  }

  const listingFilter = {
    seller: sellerId,
    status: 'sold',
  };
  if (listingId) listingFilter._id = listingId;

  const soldListings = await Listing.find(listingFilter)
    .select('_id title')
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();
  if (soldListings.length === 0) return null;

  const listingIds = soldListings.map(listing => listing._id);
  const conversations = await Conversation.find({
    participants: { $all: [reviewerId, sellerId], $size: 2 },
    listing: { $in: listingIds },
  }).select('_id listing').lean();
  if (conversations.length === 0) return null;

  const conversationIds = conversations.map(conversation => conversation._id);
  const messageActivity = await Message.aggregate([
    {
      $match: {
        conversation: { $in: conversationIds },
        sender: {
          $in: [
            new mongoose.Types.ObjectId(reviewerId),
            new mongoose.Types.ObjectId(sellerId),
          ],
        },
      },
    },
    { $group: { _id: { conversation: '$conversation', sender: '$sender' } } },
    {
      $group: {
        _id: '$_id.conversation',
        senders: { $addToSet: '$_id.sender' },
      },
    },
  ]);

  const eligibleConversationIds = new Set(
    messageActivity
      .filter(activity => activity.senders.length >= 2)
      .map(activity => activity._id.toString())
  );
  const eligibleConversation = conversations.find(conversation =>
    eligibleConversationIds.has(conversation._id.toString())
  );
  if (!eligibleConversation) return null;

  const listing = soldListings.find(listing =>
    listing._id.toString() === eligibleConversation.listing.toString()
  ) || null;

  return listing ? { listing, deal: null } : null;
};

const buildTrustSummary = (user) => {
  const reviewCount = user.reviewCount || 0;
  const rating = user.rating || 0;
  const soldCount = user.soldCount || 0;
  const accountAgeDays = user.createdAt
    ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000)
    : 0;

  const badges = [];
  if (user.isVerified) badges.push('verified_college_email');
  if (reviewCount >= 3 && rating >= 4) badges.push('well_rated');
  if (soldCount >= 1) badges.push('completed_deals');
  if (accountAgeDays >= 30) badges.push('established_member');

  const score = Math.min(100, Math.round(
    (user.isVerified ? 35 : 0) +
    Math.min(25, reviewCount * 5) +
    Math.min(20, Math.max(0, rating) * 4) +
    Math.min(10, soldCount * 2) +
    Math.min(10, accountAgeDays / 9)
  ));

  return { score, badges, accountAgeDays };
};

// ─── GET /api/v1/users/me ─────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  return success(res, { user: req.user.toPublicJSON() });
};

// ─── PUT /api/v1/users/me ─────────────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    const allowed = ['name', 'avatar'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.name) updates.name = updates.name.trim();

    if (!Object.keys(updates).length) {
      return error(res, 'No valid fields to update', 400);
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!user) return error(res, 'User not found', 404);

    return success(res, { user: user.toPublicJSON() }, 'Profile updated');
  } catch (err) {
    if (err.name === 'ValidationError') {
      return error(res, Object.values(err.errors)[0].message, 422);
    }
    throw err;
  }
};

// ─── GET /api/v1/users/:id ────────────────────────────────────────────────────
exports.getUserProfile = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid user ID', 400);

  const user = await User.findById(req.params.id)
    .select('name initials avatar college rating reviewCount listingCount soldCount createdAt isVerified')
    .lean();

  if (!user) return error(res, 'User not found', 404);
  return success(res, { user: { ...user, trust: buildTrustSummary(user) } });
};

exports.blockUser = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid user ID', 400);
  if (req.params.id === req.userId) return error(res, 'You cannot block yourself', 400);

  const blockedUser = await User.exists({ _id: req.params.id });
  if (!blockedUser) return error(res, 'User not found', 404);

  await UserBlock.updateOne(
    { blocker: req.userId, blocked: req.params.id },
    { $set: { reason: (req.body.reason || '').trim() } },
    { upsert: true }
  );

  return success(res, { blocked: true }, 'User blocked');
};

exports.unblockUser = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid user ID', 400);

  await UserBlock.deleteOne({ blocker: req.userId, blocked: req.params.id });
  return success(res, { blocked: false }, 'User unblocked');
};

exports.getBlockedUsers = async (req, res) => {
  const blocks = await UserBlock.find({ blocker: req.userId })
    .sort({ createdAt: -1 })
    .populate('blocked', 'name initials avatar college isVerified rating reviewCount')
    .lean();

  return success(res, { blocks });
};

exports.reportUser = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid user ID', 400);
    if (req.params.id === req.userId) return error(res, 'You cannot report yourself', 400);

    const reportedUser = await User.exists({ _id: req.params.id });
    if (!reportedUser) return error(res, 'User not found', 404);

    await UserReport.create({
      reportedUser: req.params.id,
      reporter: req.userId,
      reason: req.body.reason,
      details: (req.body.details || '').trim(),
    });

    return success(res, null, 'User reported successfully', 201);
  } catch (err) {
    if (err.code === 11000) return error(res, 'You have already reported this user', 409);
    throw err;
  }
};

// ─── POST /api/v1/users/:id/review ───────────────────────────────────────────
exports.reviewUser = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid seller ID', 400);

  const sellerId = req.params.id;
  if (sellerId === req.userId) return error(res, 'You cannot review yourself', 400);

  const { rating, comment, listingId } = req.body;
  if (listingId && !isValidId(listingId)) return error(res, 'Invalid listing ID', 400);

  const [seller, existingReview, eligibleListing] = await Promise.all([
    User.findById(sellerId),
    Review.findOne({ reviewer: req.userId, seller: sellerId }).lean(),
    findReviewEligibleListing({ reviewerId: req.userId, sellerId, listingId }),
  ]);

  if (!seller)         return error(res, 'Seller not found', 404);
  if (existingReview)  return error(res, 'You have already reviewed this seller', 409);
  if (!eligibleListing) {
    return error(
      res,
      'Reviews are only allowed after a sold listing with chat activity from both users',
      403
    );
  }

  await Review.create({
    seller:   sellerId,
    reviewer: req.userId,
    listing: eligibleListing.listing._id,
    deal: eligibleListing.deal?._id,
    rating,
    comment:  (comment || '').trim(),
  });

  const [aggregate] = await Review.aggregate([
    { $match: { seller: new mongoose.Types.ObjectId(sellerId) } },
    { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  const avgRating    = aggregate ? Number(aggregate.avgRating.toFixed(1)) : 5;
  const reviewCount  = aggregate ? aggregate.count : 0;

  seller.rating      = Math.min(5, Math.max(1, avgRating));
  seller.reviewCount = reviewCount;
  await seller.save();

  return success(res, null, 'Review submitted successfully', 201);
};

// ─── GET /api/v1/users/:id/reviews ───────────────────────────────────────────
exports.getReviews = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid seller ID', 400);

  const page        = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit       = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
  const skip        = (page - 1) * limit;

  const [reviews, total] = await Promise.all([
    Review.find({ seller: req.params.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('reviewer', 'name initials avatar isVerified')
      .lean(),
    Review.countDocuments({ seller: req.params.id }),
  ]);

  return success(res, {
    reviews,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore:    page * limit < total,
    },
  });
};

// ─── POST /api/v1/users/push/subscribe ─────────────────────────────────────────
exports.subscribeToPush = async (req, res) => {
  const { subscription } = req.body;
  if (!isValidPushSubscription(subscription)) {
    return error(res, 'Invalid subscription object', 400);
  }

  const user = await User.findById(req.userId);
  if (!user) return error(res, 'User not found', 404);

  const exists = user.pushSubscriptions.some(sub => sub.endpoint === subscription.endpoint);
  
  if (!exists) {
    user.pushSubscriptions.push(subscription);
  }

  user.set('notificationPreferences.pushEnabled', true);
  await user.save();

  return success(res, {
    pushSubscriptionCount: user.pushSubscriptions.length,
    notificationPreferences: user.toPublicJSON().notificationPreferences,
  }, 'Push subscription saved successfully', 201);
};

exports.unsubscribeFromPush = async (req, res) => {
  const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint;
  if (!endpoint || typeof endpoint !== 'string') {
    return error(res, 'Subscription endpoint is required', 400);
  }

  const user = await User.findById(req.userId);
  if (!user) return error(res, 'User not found', 404);

  user.pushSubscriptions = user.pushSubscriptions.filter(sub => sub.endpoint !== endpoint);
  if (user.pushSubscriptions.length === 0) {
    user.set('notificationPreferences.pushEnabled', false);
  }
  await user.save();

  return success(res, {
    pushSubscriptionCount: user.pushSubscriptions.length,
    notificationPreferences: user.toPublicJSON().notificationPreferences,
  }, 'Push subscription removed');
};

exports.updateNotificationPreferences = async (req, res) => {
  const updates = {};
  Object.entries(req.body || {}).forEach(([key, value]) => {
    if (NOTIFICATION_PREFERENCE_KEYS.has(key) && typeof value === 'boolean') {
      updates[`notificationPreferences.${key}`] = value;
    }
  });

  if (Object.keys(updates).length === 0) {
    return error(res, 'No valid notification preferences provided', 400);
  }

  const user = await User.findByIdAndUpdate(
    req.userId,
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!user) return error(res, 'User not found', 404);

  return success(res, {
    notificationPreferences: user.toPublicJSON().notificationPreferences,
  }, 'Notification preferences updated');
};
