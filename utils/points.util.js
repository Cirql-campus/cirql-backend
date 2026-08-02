'use strict';
const PointTransaction = require('../models/PointTransaction');
const User = require('../models/User');
const { POINT_VALUES, getTier, MAX_DAILY_EARN, EARN_EXPIRY_DAYS } = require('../config/points');
const logger = require('./logger');

/**
 * Award points to a user for a specific action.
 * Safe to call without await — errors are logged but never crash the caller.
 * Does NOT throw. Always wrap in try/catch internally.
 */
const awardPoints = async (userId, action, { refModel = null, refId = null, note = '' } = {}) => {
  try {
    const points = POINT_VALUES[action];
    if (!points || points <= 0) {
      logger.warn(`[POINTS] awardPoints called with invalid action: ${action}`);
      return;
    }

    // Anti-abuse: check total points earned today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const earnedToday = await PointTransaction.aggregate([
      {
        $match: {
          user: userId,
          points: { $gt: 0 },
          createdAt: { $gte: todayStart },
        },
      },
      { $group: { _id: null, total: { $sum: '$points' } } },
    ]);

    const todayTotal = earnedToday[0]?.total || 0;
    if (todayTotal >= MAX_DAILY_EARN) {
      logger.debug(`[POINTS] Daily cap reached for user ${userId} — skipping ${action}`);
      return;
    }

    // Cap this award if it would exceed daily limit
    const cappedPoints = Math.min(points, MAX_DAILY_EARN - todayTotal);
    if (cappedPoints <= 0) return;

    // Prevent duplicate one-time awards
    const oneTimeActions = ['profile_completed', 'account_30days', 'account_90days'];
    if (oneTimeActions.includes(action)) {
      const alreadyAwarded = await PointTransaction.exists({ user: userId, action });
      if (alreadyAwarded) {
        logger.debug(`[POINTS] One-time action ${action} already awarded to ${userId}`);
        return;
      }
    }

    // Prevent duplicate deal/review points for same reference
    if (refId && ['deal_completed_seller', 'deal_completed_buyer', 'review_received_5star', 'review_received_4star'].includes(action)) {
      const alreadyAwarded = await PointTransaction.exists({ user: userId, action, refId });
      if (alreadyAwarded) {
        logger.debug(`[POINTS] Points for ${action} ref ${refId} already awarded`);
        return;
      }
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + EARN_EXPIRY_DAYS);

    await PointTransaction.create({
      user: userId,
      action,
      points: cappedPoints,
      refModel,
      refId,
      note,
      expiresAt,
    });

    // Update User's totalPoints and lifetimePoints atomically
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          totalPoints: cappedPoints,
          lifetimePoints: cappedPoints,
        },
      },
      { new: true, select: 'totalPoints lifetimePoints tier' }
    );

    // Update tier if it changed
    if (updatedUser) {
      const newTier = getTier(updatedUser.lifetimePoints);
      if (updatedUser.tier !== newTier.name) {
        await User.findByIdAndUpdate(userId, { $set: { tier: newTier.name } });
      }
    }

    logger.debug(`[POINTS] +${cappedPoints} awarded to ${userId} for ${action}`);
  } catch (err) {
    // Never crash the caller — points are a nice-to-have, not critical path
    logger.error(`[POINTS] awardPoints failed for user ${userId} action ${action}: ${err.message}`);
  }
};

/**
 * Spend points for a user. Returns { ok: true } or { ok: false, message }.
 * This one DOES throw / return errors — spending must be intentional and verified.
 */
const spendPoints = async (userId, action, { refModel = null, refId = null, note = '' } = {}) => {
  const cost = Math.abs(POINT_VALUES[action]);
  if (!cost) return { ok: false, message: 'Invalid spend action' };

  const user = await User.findById(userId).select('totalPoints');
  if (!user) return { ok: false, message: 'User not found' };
  if (user.totalPoints < cost) {
    return { ok: false, message: `Not enough points. You need ${cost} points but have ${user.totalPoints}.` };
  }

  await PointTransaction.create({
    user: userId,
    action,
    points: -cost, // negative = spend
    refModel,
    refId,
    note,
    expiresAt: null, // spend transactions never expire
  });

  await User.findByIdAndUpdate(userId, { $inc: { totalPoints: -cost } });

  logger.debug(`[POINTS] -${cost} spent by ${userId} for ${action}`);
  return { ok: true };
};

/**
 * Get a user's point balance and recent transaction history.
 */
const getPointSummary = async (userId) => {
  const [user, transactions] = await Promise.all([
    User.findById(userId).select('totalPoints lifetimePoints tier').lean(),
    PointTransaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);

  return {
    totalPoints: user?.totalPoints || 0,
    lifetimePoints: user?.lifetimePoints || 0,
    tier: user?.tier || 'new',
    transactions: transactions.map(t => ({
      action: t.action,
      points: t.points,
      note: t.note,
      createdAt: t.createdAt,
    })),
  };
};

module.exports = { awardPoints, spendPoints, getPointSummary };
