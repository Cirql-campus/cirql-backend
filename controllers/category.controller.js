'use strict';
const Category = require('../models/Category');
const Listing  = require('../models/Listing');
const { success, error } = require('../utils/apiResponse');
const { categoryCache } = require('../utils/cache');

const CACHE_KEY_ALL       = 'categories:all';
const CACHE_TTL_SECONDS   = 300; // 5 minutes
const APPROVED_MODERATION_FILTER = { $in: ['approved', null] };

// ─── GET /api/v1/categories ───────────────────────────────────────────────────
exports.getCategories = async (req, res) => {
  const cached = categoryCache.get(CACHE_KEY_ALL);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return success(res, { categories: cached });
  }
  res.setHeader('X-Cache', 'MISS');

  const categories = await Category.find({ isActive: true })
    .sort({ sortOrder: 1 })
    .lean();

  categoryCache.set(CACHE_KEY_ALL, categories, CACHE_TTL_SECONDS);
  return success(res, { categories });
};

// ─── GET /api/v1/categories/:slug ─────────────────────────────────────────────
exports.getCategoryBySlug = async (req, res) => {
  const { slug } = req.params;
  if (!req.user?.college && req.user?.role !== 'super_admin' && req.user?.role !== 'college_admin') {
    return error(res, 'Your account is missing a campus. Please contact support.', 403);
  }

  const isGlobalAdmin = req.user.role === 'super_admin';
  const campusScope = isGlobalAdmin ? 'admin' : `college:${req.user.college}`;
  const cacheKey = `categories:slug:${slug}:${campusScope}`;

  const cached = categoryCache.get(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return success(res, cached);
  }
  res.setHeader('X-Cache', 'MISS');

  const category = await Category.findOne({ slug: slug.toLowerCase(), isActive: true }).lean();
  if (!category) return error(res, 'Category not found', 404);

  const listingFilter = {
    category: slug.toLowerCase(),
    isActive: true,
    moderationStatus: APPROVED_MODERATION_FILTER,
    status: { $in: ['available', 'reserved', null] },
  };
  if (!isGlobalAdmin) listingFilter.college = req.user.college;

  const featuredListings = await Listing.find(listingFilter)
    .sort({ views: -1, createdAt: -1 })
    .limit(8)
    .select('title price category type condition images seller college location views createdAt')
    .populate('seller', 'name avatar initials college rating isVerified')
    .lean();

  const payload = { category, featuredListings };
  categoryCache.set(cacheKey, payload, CACHE_TTL_SECONDS);
  return success(res, payload);
};
