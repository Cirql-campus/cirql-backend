'use strict';
const mongoose = require('mongoose');
const Listing = require('../models/Listing');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const {
  listingCache,
  suggestionCache,
  getCacheValue,
  setCacheValue,
} = require('../utils/cache');
const {
  getCampusScope,
  isValidId,
  normalizeTags,
  decorateListingImages,
  APPROVED_MODERATION_FILTER,
} = require('./listing.controller');

// ─── GET /api/v1/listings ─────────────────────────────────────────────────────
exports.getListings = async (req, res) => {
  const campusScope = getCampusScope(req);
  if (!campusScope) return error(res, 'Please log in to view campus listings', 401);
  if (!campusScope.isAdmin && !campusScope.college) {
    return error(res, 'Your account is missing a campus. Please contact support.', 403);
  }

  const cacheScope = campusScope.isAdmin ? 'admin' : `college:${campusScope.college}`;
  const cacheKey = `${cacheScope}:${req.originalUrl}`;
  const cachedListings = await getCacheValue(listingCache, 'listings', cacheKey);
  if (cachedListings) {
    res.setHeader('X-Cache', 'HIT');
    return success(res, cachedListings);
  }
  res.setHeader('X-Cache', 'MISS');

  const {
    category, type, college, search, cursor,
    minPrice, maxPrice, condition, status, location, tags,
    sort  = 'newest',
    limit = 20,
  } = req.query;

  const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const filter = { isActive: true, moderationStatus: APPROVED_MODERATION_FILTER };

  if (category && !['All', 'all'].includes(category)) filter.category = String(category).toLowerCase();
  if (type)    filter.type    = type;
  if (condition) filter.condition = condition;
  if (status) filter.status = status;
  else filter.status = { $in: ['available', 'reserved', null] };
  if (campusScope.isAdmin) {
    if (college) filter.college = college;
  } else {
    filter.college = campusScope.college;
  }
  if (location) filter.location = new RegExp(location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60), 'i');
  const normalizedTags = normalizeTags(tags);
  if (normalizedTags.length > 0) filter.tags = { $all: normalizedTags };
  const priceFilter = {};
  if (minPrice !== undefined) priceFilter.$gte = Number(minPrice);
  if (maxPrice !== undefined) priceFilter.$lte = Number(maxPrice);
  if (Object.keys(priceFilter).length > 0) filter.price = priceFilter;

  if (search) {
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
    filter.$text = { $search: safe };
  }

  if (cursor && isValidId(cursor)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  let sortOpt = { _id: -1 };
  if (sort === 'price_asc')  sortOpt = { price:  1, _id:  1 };
  if (sort === 'price_desc') sortOpt = { price: -1, _id: -1 };
  if (sort === 'views')      sortOpt = { views: -1, _id: -1 };
  if (search && sort === 'newest') sortOpt = { score: { $meta: 'textScore' } };

  const listings = await Listing.find(filter)
    .sort(sortOpt)
    .limit(parsedLimit + 1)
    .select('title price originalPrice isNegotiable quantity category type status condition images coverImageIndex seller college location pickupLocation tags brand model views isActive isSold createdAt')
    .populate('seller', 'name avatar initials college rating isVerified')
    .lean();

  const hasMore   = listings.length > parsedLimit;
  const finalData = hasMore ? listings.slice(0, parsedLimit) : listings;
  const nextCursor = hasMore ? finalData[finalData.length - 1]._id : null;

  const payload = {
    listings: finalData.map(decorateListingImages),
    pagination: { limit: parsedLimit, hasMore, nextCursor },
  };

  await setCacheValue(listingCache, 'listings', cacheKey, payload, 30);
  return success(res, payload);
};

// ─── GET /api/v1/listings/search/suggestions ──────────────────────────────────
exports.getSearchSuggestions = async (req, res) => {
  const campusScope = getCampusScope(req);
  if (!campusScope) return error(res, 'Please log in to view campus listings', 401);
  if (!campusScope.isAdmin && !campusScope.college) {
    return error(res, 'Your account is missing a campus. Please contact support.', 403);
  }

  const { q } = req.query;
  if (!q || q.trim().length < 2) return success(res, { suggestions: [] });

  const normalizedQuery = q.toLowerCase().trim();
  const cacheScope = campusScope.isAdmin ? 'admin' : `college:${campusScope.college}`;
  const cacheKey = `${cacheScope}:${normalizedQuery}`;
  const cached = await getCacheValue(suggestionCache, 'suggestions', cacheKey);
  if (cached) return success(res, { suggestions: cached });

  const safe   = normalizedQuery.replace(/[.*+?^$()|[\]\\]/g, '\\$&').slice(0, 50);
  const match = {
    title: new RegExp(safe, 'i'),
    isActive: true,
    moderationStatus: APPROVED_MODERATION_FILTER,
  };
  if (!campusScope.isAdmin) match.college = campusScope.college;
  const result = await Listing.aggregate([
    { $match: match },
    { $group: { _id: '$title' } },
    { $limit: 8 },
  ]);

  const suggestions = result.map(r => r._id);
  await setCacheValue(suggestionCache, 'suggestions', cacheKey, suggestions, 30);

  return success(res, { suggestions });
};
