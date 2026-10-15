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

  let sortOpt = { isBoosted: -1, _id: -1 };
  if (sort === 'price_asc')  sortOpt = { isBoosted: -1, price:  1, _id:  1 };
  if (sort === 'price_desc') sortOpt = { isBoosted: -1, price: -1, _id: -1 };
  if (sort === 'views')      sortOpt = { isBoosted: -1, views: -1, _id: -1 };
  if (search && sort === 'newest') sortOpt = { isBoosted: -1, score: { $meta: 'textScore' } };

  const pipeline = [
    { $match: filter },
    {
      $addFields: {
        isBoosted: {
          $cond: [
            { $and: [
                { $ne: ['$boostedUntil', null] },
                { $gt: ['$boostedUntil', new Date()] },
            ]},
            1,
            0,
          ],
        },
      },
    },
  ];

  if (search && sort === 'newest') {
    pipeline.push({
      $addFields: {
        score: { $meta: 'textScore' }
      }
    });
  }

  pipeline.push({ $sort: sortOpt });
  pipeline.push({ $limit: parsedLimit + 1 });
  pipeline.push({
    $project: {
      title: 1,
      price: 1,
      originalPrice: 1,
      isNegotiable: 1,
      quantity: 1,
      category: 1,
      type: 1,
      status: 1,
      condition: 1,
      images: 1,
      coverImageIndex: 1,
      seller: 1,
      college: 1,
      location: 1,
      pickupLocation: 1,
      tags: 1,
      brand: 1,
      model: 1,
      views: 1,
      isActive: 1,
      isSold: 1,
      createdAt: 1,
    }
  });

  let listings = await Listing.aggregate(pipeline);
  listings = await Listing.populate(listings, {
    path: 'seller',
    select: 'name avatar initials college rating isVerified',
  });

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

// ═════════════════════════════════════════════════════════════════════════════
// OTHER CAMPUSES
// Read-only browsing of live listings from every campus EXCEPT the viewer's own.
// The regular /listings feed stays strictly campus-scoped; these endpoints are
// the only place where cross-campus listings are exposed, and they only return
// approved, active, not-hidden/expired listings.
// ═════════════════════════════════════════════════════════════════════════════
const OTHER_CAMPUS_SORTS = {
  newest:     { createdAt: -1, _id: -1 },
  price_asc:  { price: 1,  _id: -1 },
  price_desc: { price: -1, _id: -1 },
};
const OTHER_CAMPUS_STATUSES = ['available', 'reserved', null];
const OTHER_CAMPUS_MAX_PAGE = 100;
const OTHER_CAMPUS_SELLER_FIELDS = 'name avatar initials college rating reviewCount isVerified';
const OTHER_CAMPUS_LISTING_FIELDS = [
  'title', 'price', 'originalPrice', 'isNegotiable', 'quantity', 'category', 'type',
  'status', 'condition', 'images', 'coverImageIndex', 'seller', 'college', 'location',
  'pickupLocation', 'tags', 'brand', 'model', 'views', 'isActive', 'isSold', 'createdAt',
].join(' ');

// Query-string values can arrive as arrays/objects (?college[$ne]=x). Only ever
// accept plain strings so they can't be smuggled into a Mongo operator.
const asPlainString = (value) => (typeof value === 'string' ? value.trim() : '');
const ownCollegeOf = (req) => String(req.user?.college || '').trim();

// ─── GET /api/v1/listings/other-campuses/colleges ─────────────────────────────
exports.getOtherCampusColleges = async (req, res) => {
  const ownCollege = ownCollegeOf(req);
  const cacheKey = `other-campuses:colleges:${ownCollege}`;
  const cached = await getCacheValue(listingCache, 'listings', cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return success(res, cached);
  }
  res.setHeader('X-Cache', 'MISS');

  const rows = await Listing.aggregate([
    {
      $match: {
        isActive: true,
        moderationStatus: APPROVED_MODERATION_FILTER,
        status: { $in: OTHER_CAMPUS_STATUSES },
        college: { $nin: [ownCollege, '', null] },
      },
    },
    { $group: { _id: '$college', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 100 },
  ]);

  const payload = {
    colleges: rows.map(row => ({ name: row._id, count: row.count })),
  };
  await setCacheValue(listingCache, 'listings', cacheKey, payload, 60);
  return success(res, payload);
};

// ─── GET /api/v1/listings/other-campuses ──────────────────────────────────────
exports.getOtherCampusListings = async (req, res) => {
  const ownCollege = ownCollegeOf(req);

  const college   = asPlainString(req.query.college);
  const search    = asPlainString(req.query.search).slice(0, 100);
  const category  = asPlainString(req.query.category).toLowerCase();
  const type      = asPlainString(req.query.type);
  const sortParam = asPlainString(req.query.sort);
  const sort      = Object.prototype.hasOwnProperty.call(OTHER_CAMPUS_SORTS, sortParam)
    ? sortParam
    : 'newest';
  const page      = Math.min(OTHER_CAMPUS_MAX_PAGE, Math.max(1, parseInt(req.query.page, 10) || 1));
  const limit     = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 12));

  const emptyPayload = { listings: [], pagination: { page, limit, hasMore: false } };

  // Asking for your own campus here is meaningless — that's the normal feed.
  if (college && college === ownCollege) return success(res, emptyPayload);

  const cacheKey = `other-campuses:list:${ownCollege}:${req.originalUrl}`;
  const cached = await getCacheValue(listingCache, 'listings', cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return success(res, cached);
  }
  res.setHeader('X-Cache', 'MISS');

  const filter = {
    isActive: true,
    moderationStatus: APPROVED_MODERATION_FILTER,
    status: { $in: OTHER_CAMPUS_STATUSES },
    college: college ? college : { $nin: [ownCollege, '', null] },
  };
  if (category && category !== 'all') filter.category = category;
  if (type) filter.type = type;

  const priceFilter = {};
  const minPrice = Number(req.query.minPrice);
  const maxPrice = Number(req.query.maxPrice);
  if (req.query.minPrice !== undefined && Number.isFinite(minPrice)) priceFilter.$gte = minPrice;
  if (req.query.maxPrice !== undefined && Number.isFinite(maxPrice)) priceFilter.$lte = maxPrice;
  if (Object.keys(priceFilter).length > 0) filter.price = priceFilter;

  let projection = OTHER_CAMPUS_LISTING_FIELDS;
  let sortOpt = OTHER_CAMPUS_SORTS[sort];
  if (search.length >= 2) {
    filter.$text = { $search: search };
    if (sort === 'newest') {
      // Most relevant first when the user is searching with the default sort.
      projection = { score: { $meta: 'textScore' } };
      OTHER_CAMPUS_LISTING_FIELDS.split(' ').forEach(field => { projection[field] = 1; });
      sortOpt = { score: { $meta: 'textScore' }, _id: -1 };
    }
  }

  // Offset pagination: sorts like price aren't monotonic in _id, so a cursor on
  // _id (as the campus feed uses) would skip or repeat rows.
  const rows = await Listing.find(filter, projection)
    .sort(sortOpt)
    .skip((page - 1) * limit)
    .limit(limit + 1)
    .populate('seller', OTHER_CAMPUS_SELLER_FIELDS)
    .lean();

  const hasMore = rows.length > limit;
  const payload = {
    listings: (hasMore ? rows.slice(0, limit) : rows).map(row => {
      delete row.score; // text-search relevance is internal
      return decorateListingImages(row);
    }),
    pagination: { page, limit, hasMore },
  };

  await setCacheValue(listingCache, 'listings', cacheKey, payload, 30);
  return success(res, payload);
};
