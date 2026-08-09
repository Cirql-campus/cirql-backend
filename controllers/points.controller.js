'use strict';
const { success, error } = require('../utils/apiResponse');
const { getPointSummary, spendPoints, awardPoints } = require('../utils/points.util');
const { getTier, TIERS, SPEND_COSTS } = require('../config/points');
const Listing = require('../models/Listing');
const User = require('../models/User');

// GET /api/v1/points/me — get current user's points and history
exports.getMyPoints = async (req, res) => {
  const [summary, user] = await Promise.all([
    getPointSummary(req.userId),
    User.findById(req.userId).select('lastCheckIn checkInStreak').lean()
  ]);
  const tierInfo = getTier(summary.lifetimePoints);
  const nextTier = TIERS[TIERS.findIndex(t => t.name === tierInfo.name) + 1] || null;

  return success(res, {
    ...summary,
    checkInStreak: user?.checkInStreak || 0,
    lastCheckIn: user?.lastCheckIn || null,
    tierInfo,
    nextTier,
    pointsToNextTier: nextTier ? nextTier.minPoints - summary.lifetimePoints : 0,
  });
};

// POST /api/v1/points/check-in — claim daily check-in points
exports.checkIn = async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return error(res, 'User not found', 404);

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  if (user.lastCheckIn) {
    const lastStr = user.lastCheckIn.toISOString().split('T')[0];
    if (lastStr === todayStr) {
      return error(res, 'You have already checked in today', 400);
    }

    const lastDate = new Date(user.lastCheckIn);
    lastDate.setUTCHours(0, 0, 0, 0);
    const todayDate = new Date();
    todayDate.setUTCHours(0, 0, 0, 0);
    const diffTime = todayDate.getTime() - lastDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      user.checkInStreak += 1;
    } else {
      user.checkInStreak = 1;
    }
  } else {
    user.checkInStreak = 1;
  }

  user.lastCheckIn = now;
  await user.save();

  await awardPoints(user._id, 'daily_check_in', {
    note: `Daily check-in (Day ${user.checkInStreak})`,
  });

  let hasBonus = false;
  if (user.checkInStreak > 0 && user.checkInStreak % 7 === 0) {
    hasBonus = true;
    await awardPoints(user._id, 'check_in_streak_7day', {
      note: `7-day check-in streak bonus!`,
    });
  }

  const summary = await getPointSummary(user._id);
  const tierInfo = getTier(summary.lifetimePoints);
  const nextTier = TIERS[TIERS.findIndex(t => t.name === tierInfo.name) + 1] || null;

  return success(res, {
    ...summary,
    checkInStreak: user.checkInStreak,
    lastCheckIn: user.lastCheckIn,
    tierInfo,
    nextTier,
    pointsToNextTier: nextTier ? nextTier.minPoints - summary.lifetimePoints : 0,
  }, hasBonus ? 'Checked in! Streak bonus awarded!' : 'Checked in successfully!');
};

// POST /api/v1/points/boost-listing/:listingId — spend 50 pts to boost a listing
exports.boostListing = async (req, res) => {
  const { listingId } = req.params;

  const listing = await Listing.findOne({ _id: listingId, seller: req.userId, isActive: true });
  if (!listing) return error(res, 'Listing not found or not yours', 404);

  // Check not already boosted
  if (listing.boostedUntil && listing.boostedUntil > new Date()) {
    return error(res, 'This listing is already boosted', 400);
  }

  const result = await spendPoints(req.userId, 'spend_boost_listing', {
    refModel: 'Listing',
    refId: listing._id,
    note: `Boosted listing: "${listing.title}"`,
  });

  if (!result.ok) return error(res, result.message, 400);

  // Set boost expiry on the listing (48 hours)
  listing.boostedUntil = new Date(Date.now() + 48 * 60 * 60 * 1000);
  await listing.save();

  return success(res, { boostedUntil: listing.boostedUntil }, 'Listing boosted to top for 48 hours!');
};
