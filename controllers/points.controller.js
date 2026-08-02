'use strict';
const { success, error } = require('../utils/apiResponse');
const { getPointSummary, spendPoints } = require('../utils/points.util');
const { getTier, TIERS, SPEND_COSTS } = require('../config/points');
const Listing = require('../models/Listing');

// GET /api/v1/points/me — get current user's points and history
exports.getMyPoints = async (req, res) => {
  const summary = await getPointSummary(req.userId);
  const tierInfo = getTier(summary.lifetimePoints);
  const nextTier = TIERS[TIERS.findIndex(t => t.name === tierInfo.name) + 1] || null;

  return success(res, {
    ...summary,
    tierInfo,
    nextTier,
    pointsToNextTier: nextTier ? nextTier.minPoints - summary.lifetimePoints : 0,
  });
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
