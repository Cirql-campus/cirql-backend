'use strict';
const mongoose = require('mongoose');
const Listing  = require('../models/Listing');
const User     = require('../models/User');
const Report   = require('../models/Report');
const Notification    = require('../models/Notification');
const { getIO } = require('../config/socket');
const { success, error } = require('../utils/apiResponse');
const { awardPoints } = require('../utils/points.util');
const logger   = require('../utils/logger');
const {
  listingCache,
  suggestionCache,
  categoryCache,
  getCacheValue,
  setCacheValue,
  flushCacheNamespace,
} = require('../utils/cache');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const APPROVED_MODERATION_FILTER = { $in: ['approved', null] };
const idToString = (value) => (value?._id || value)?.toString?.();

const getCampusScope = (req) => {
  if (!req.user) return null;
  if (req.user.role === 'super_admin' || req.user.role === 'college_admin') return { isAdmin: true };
  return {
    isAdmin: false,
    college: String(req.user.college || '').trim(),
  };
};

const isPublicListingVisibleToUser = (listing, user) => {
  if (!listing || !user) return false;
  if (user.role === 'super_admin' || user.role === 'college_admin') return true;
  if (idToString(listing.seller) === idToString(user)) return true;
  return Boolean(
    listing.isActive &&
    ['approved', null, undefined].includes(listing.moderationStatus) &&
    !['hidden', 'expired'].includes(listing.status) &&
    listing.college &&
    listing.college === user.college
  );
};

const ALLOWED_UPDATE_FIELDS = [
  'title', 'description', 'price', 'category',
  'type', 'condition', 'location', 'pickupLocation', 'isActive',
  'isNegotiable', 'originalPrice', 'quantity', 'rentDuration', 'brand',
  'model', 'tags', 'deposit', 'availableFrom', 'availability', 'deliveryMode',
];

const normalizeTags = (value) => {
  if (value === undefined || value === null || value === '') return [];
  const rawTags = Array.isArray(value)
    ? value
    : String(value).split(',');
  return [...new Set(rawTags
    .map(tag => String(tag || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10))];
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  return Boolean(value);
};

const flushPublicListingCaches = async () => Promise.all([
  flushCacheNamespace(listingCache, 'listings'),
  flushCacheNamespace(suggestionCache, 'suggestions'),
  flushCacheNamespace(categoryCache, 'categories'),
]);

const getUploadPublicId = (file) => {
  if (file.public_id || file.filename) return file.public_id || file.filename;
  if (file._cirqlPublicId) return file._cirqlPublicId;
  if (process.env.NODE_ENV !== 'test') return undefined;

  const safeName = String(file.originalname || 'image')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .toLowerCase()
    .slice(0, 60);
  file._cirqlPublicId = `test/listings/${Date.now()}-${safeName || 'image'}`;
  return file._cirqlPublicId;
};

const getUploadUrl = (file) => {
  if (file.secure_url || file.path || file.url) {
    return file.secure_url || file.path || file.url;
  }
  const publicId = getUploadPublicId(file);
  if (process.env.NODE_ENV === 'test' && publicId) {
    return `https://res.cloudinary.com/test/image/upload/${publicId}.jpg`;
  }
  return undefined;
};

const parseCoverImageIndex = (value, imageCount, fallback = 0) => {
  if (value === undefined || value === null || value === '') {
    return Math.min(Math.max(fallback, 0), Math.max(imageCount - 1, 0));
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= imageCount) {
    return null;
  }

  return parsed;
};

const mapUploadToImageMetadata = (file) => ({
  url:          getUploadUrl(file),
  secureUrl:    file.secure_url || getUploadUrl(file),
  publicId:     getUploadPublicId(file),
  format:       file.format,
  resourceType: file.resource_type,
  bytes:        file.bytes,
  width:        file.width,
  height:       file.height,
  originalName: file.originalname,
});

const getPublicIdFromUrl = (url) => {
  if (typeof url !== 'string') return null;
  const match = url.match(/\/v\d+\/(cirql\/.+?)(?:\.\w+)?$/);
  return match ? match[1] : null;
};

const getImagePublicIds = (listingOrFiles) => {
  const publicIds = new Set();

  for (const image of listingOrFiles?.imageMetadata || []) {
    if (image?.publicId) publicIds.add(image.publicId);
  }

  for (const image of listingOrFiles?.images || []) {
    const publicId = typeof image === 'string'
      ? getPublicIdFromUrl(image)
      : image?.publicId;
    if (publicId) publicIds.add(publicId);
  }

  for (const file of listingOrFiles?.files || []) {
    const publicId = file?.public_id || file?.filename;
    if (publicId) publicIds.add(publicId);
  }

  return [...publicIds];
};

const destroyCloudinaryImages = (listingOrFiles, requestId) => {
  const publicIds = getImagePublicIds(listingOrFiles);
  if (publicIds.length === 0) return;

  const cloudinary = require('../config/cloudinary');
  Promise.all(publicIds.map(publicId =>
    cloudinary.uploader.destroy(publicId, { invalidate: true })
  )).catch(e =>
    logger.warn(`[${requestId || 'system'}] Cloudinary cleanup failed: ${e.message}`)
  );
};

const findImageIndex = (listing, { publicId, url }) => {
  const targetPublicId = String(publicId || '').trim();
  const targetUrl = String(url || '').trim();

  if (!targetPublicId && !targetUrl) return -1;

  const metadataIndex = (listing.imageMetadata || []).findIndex(image =>
    (targetPublicId && image.publicId === targetPublicId) ||
    (targetUrl && (image.url === targetUrl || image.secureUrl === targetUrl))
  );
  if (metadataIndex >= 0) return metadataIndex;

  return (listing.images || []).findIndex(imageUrl =>
    (targetUrl && imageUrl === targetUrl) ||
    (targetPublicId && getPublicIdFromUrl(imageUrl) === targetPublicId)
  );
};

const getCloudinaryVariantUrl = (url, transformation) => {
  if (typeof url !== 'string' || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) {
    return url;
  }
  return url.replace('/upload/', `/upload/${transformation}/`);
};

const decorateListingImages = (listing) => {
  if (!listing) return listing;

  const output = typeof listing.toObject === 'function'
    ? listing.toObject()
    : { ...listing };
  delete output.imageMetadata;

  const images = Array.isArray(output.images) ? output.images : [];
  const coverImageIndex = Number.isInteger(output.coverImageIndex)
    && output.coverImageIndex >= 0
    && output.coverImageIndex < images.length
    ? output.coverImageIndex
    : 0;

  output.coverImageIndex = coverImageIndex;
  output.coverImage = images[coverImageIndex] || images[0] || '';
  output.imageVariants = images.map((url, index) => ({
    url,
    isCover: index === coverImageIndex,
    thumbnail: getCloudinaryVariantUrl(url, 'f_auto,q_auto,c_fill,w_400,h_400'),
    detail: getCloudinaryVariantUrl(url, 'f_auto,q_auto,c_limit,w_1200,h_1200'),
  }));

  return output;
};

const savedSearchMatchesListing = (savedSearch, listing) => {
  if (savedSearch.user.toString() === listing.seller.toString()) return false;
  if (savedSearch.category && savedSearch.category !== listing.category) return false;
  if (savedSearch.type && savedSearch.type !== listing.type) return false;
  if (savedSearch.condition && savedSearch.condition !== listing.condition) return false;
  if (savedSearch.minPrice !== undefined && savedSearch.minPrice !== null && listing.price < savedSearch.minPrice) return false;
  if (savedSearch.maxPrice !== undefined && savedSearch.maxPrice !== null && listing.price > savedSearch.maxPrice) return false;
  if (savedSearch.location && !String(listing.location || '').toLowerCase().includes(savedSearch.location.toLowerCase())) return false;
  if (savedSearch.tags?.length && !savedSearch.tags.every(tag => (listing.tags || []).includes(tag))) return false;
  if (savedSearch.query) {
    const haystack = [
      listing.title,
      listing.description,
      listing.category,
      listing.brand,
      listing.model,
      ...(listing.tags || []),
    ].join(' ').toLowerCase();
    if (!haystack.includes(savedSearch.query.toLowerCase())) return false;
  }
  return true;
};

const notifyMatchingSavedSearches = async (listing, requestId) => {
  const SavedSearch = require('../models/SavedSearch');
  try {
    const candidates = await SavedSearch.find({
      alertsEnabled: true,
      $or: [
        { category: '' },
        { category: listing.category },
      ],
    }).limit(200).lean();

    const users = await User.find({
      _id: { $in: candidates.map(savedSearch => savedSearch.user) },
      college: listing.college,
    }).select('_id').lean();
    const sameCampusUserIds = new Set(users.map(user => user._id.toString()));
    const matches = candidates.filter(savedSearch =>
      sameCampusUserIds.has(savedSearch.user.toString()) &&
      savedSearchMatchesListing(savedSearch, listing)
    );
    if (matches.length === 0) return;

    const notifications = await Notification.insertMany(matches.map(savedSearch => ({
      user: savedSearch.user,
      type: 'system',
      text: `New listing matches your saved search${savedSearch.name ? `: ${savedSearch.name}` : ''}`,
      link: `/listings/${listing._id}`,
    })));

    await SavedSearch.updateMany(
      { _id: { $in: matches.map(savedSearch => savedSearch._id) } },
      { $set: { lastNotifiedAt: new Date() } }
    );

    try {
      const io = getIO();
      notifications.forEach(notification => {
        io.to(`user_${notification.user}`).emit('new_notification', { notification });
      });
    } catch (socketErr) {
      logger.warn(`[${requestId || 'system'}] Saved search socket emit failed: ${socketErr.message}`);
    }
  } catch (err) {
    logger.warn(`[${requestId || 'system'}] Saved search notification failed: ${err.message}`);
  }
};

// ─── GET /api/v1/listings/:id ─────────────────────────────────────────────────
exports.getListingById = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);
  if (!req.user) return error(res, 'Please log in to view campus listings', 401);

  const cacheKey = `user:${req.userId || req.user._id}:${req.originalUrl}`;
  const cachedListing = await getCacheValue(listingCache, 'listings', cacheKey);
  if (cachedListing) {
    res.setHeader('X-Cache', 'HIT');
    return success(res, cachedListing);
  }
  res.setHeader('X-Cache', 'MISS');

  const listing = await Listing.findById(req.params.id)
    .populate('seller', 'name avatar initials college rating reviewCount isVerified createdAt')
    .lean();

  if (!isPublicListingVisibleToUser(listing, req.user)) {
    return error(res, 'Listing not found', 404);
  }

  if (idToString(listing.seller) !== req.userId) {
    listing.views = (listing.views || 0) + 1;
    await Listing.updateOne({ _id: listing._id }, { $inc: { views: 1 } });
  }

  const payload = { listing: decorateListingImages(listing) };
  await setCacheValue(listingCache, 'listings', cacheKey, payload, 60);
  return success(res, payload);
};

// ─── POST /api/v1/listings ────────────────────────────────────────────────────
exports.createListing = async (req, res) => {
  try {
    const {
      title, description, price, category, type, condition, location,
      pickupLocation, isNegotiable, originalPrice, quantity, rentDuration,
      brand, model, deposit, availableFrom, availability, deliveryMode,
    } = req.body;
    const imageMetadata = (req.files || [])
      .map(mapUploadToImageMetadata)
      .filter(image => image.url && image.publicId);
    const images = imageMetadata.map(image => image.secureUrl || image.url);
    if (images.length === 0) {
      destroyCloudinaryImages({ files: req.files }, req.requestId);
      return error(res, 'At least one listing image is required', 422);
    }

    const coverImageIndex = parseCoverImageIndex(req.body.coverImageIndex, images.length);
    if (coverImageIndex === null) {
      destroyCloudinaryImages({ files: req.files }, req.requestId);
      return error(res, 'Cover image index is invalid', 422);
    }

    const listing = await Listing.create({
      title:       title.trim(),
      description: (description || '').trim(),
      price:       Number(price),
      category,
      type:        type || 'sell',
      condition:   condition || 'Good',
      location:    (location || req.user.college || '').trim(),
      pickupLocation: (pickupLocation || '').trim(),
      college:     req.user.college,
      seller:      req.userId,
      isNegotiable: parseBoolean(isNegotiable),
      originalPrice: originalPrice === undefined || originalPrice === '' ? undefined : Number(originalPrice),
      quantity: quantity === undefined || quantity === '' ? 1 : Number(quantity),
      rentDuration: type === 'rent' ? rentDuration : undefined,
      deposit: type === 'rent' && deposit !== undefined && deposit !== ''
        ? Number(deposit) : undefined,
      availableFrom: type === 'rent' && availableFrom
        ? new Date(availableFrom) : undefined,
      availability: type === 'service' && availability
        ? availability : undefined,
      deliveryMode: type === 'service' && deliveryMode
        ? deliveryMode : undefined,
      brand: (brand || '').trim(),
      model: (model || '').trim(),
      tags: normalizeTags(req.body.tags),
      images,
      coverImageIndex,
      imageMetadata,
    });

    await User.findByIdAndUpdate(req.userId, { $inc: { listingCount: 1 } });
    await flushPublicListingCaches();
    notifyMatchingSavedSearches(listing, req.requestId);
    
    // Broadcast live listing alert to all online users
    try {
      getIO().emit('new_listing', {
        title: listing.title,
        id: listing._id,
        college: listing.college
      });
    } catch (socketErr) {
      // ignore
    }

    // Award points for posting a listing — background, never crashes request
    awardPoints(req.userId, 'listing_created', {
      refModel: 'Listing',
      refId: listing._id,
      note: `Listed: "${listing.title}"`,
    });

    return success(res, { listing: decorateListingImages(listing) }, 'Listing created successfully', 201);
  } catch (err) {
    destroyCloudinaryImages({ files: req.files }, req.requestId);
    if (err.name === 'ValidationError') {
      return error(res, Object.values(err.errors)[0].message, 422);
    }
    throw err;
  }
};

// ─── PUT /api/v1/listings/:id ─────────────────────────────────────────────────
exports.updateListing = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);

    const listing = await Listing.findById(req.params.id).select('+imageMetadata');
    if (!listing)                                  return error(res, 'Listing not found', 404);
    if (listing.seller.toString() !== req.userId)  return error(res, 'Not authorised', 403);

    const updates = {};
    for (const key of ALLOWED_UPDATE_FIELDS) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.tags !== undefined) updates.tags = normalizeTags(updates.tags);
    if (updates.isNegotiable !== undefined) updates.isNegotiable = parseBoolean(updates.isNegotiable);
    if (updates.price !== undefined) updates.price = Number(updates.price);
    if (updates.originalPrice !== undefined && updates.originalPrice !== '') updates.originalPrice = Number(updates.originalPrice);
    if (updates.originalPrice === '') updates.originalPrice = undefined;
    if (updates.quantity !== undefined) updates.quantity = Number(updates.quantity);
    if (updates.deposit !== undefined && updates.deposit !== '') updates.deposit = Number(updates.deposit);
    if (updates.deposit === '') updates.deposit = undefined;
    if (updates.availableFrom !== undefined && updates.availableFrom !== '') updates.availableFrom = new Date(updates.availableFrom);
    if (updates.availableFrom === '') updates.availableFrom = undefined;
    const unsets = {};
    if (updates.type && updates.type !== 'rent') {
      unsets.rentDuration = 1;
      unsets.deposit = 1;
      unsets.availableFrom = 1;
      delete updates.rentDuration;
      delete updates.deposit;
      delete updates.availableFrom;
    }
    if (updates.type && updates.type !== 'service') {
      unsets.availability = 1;
      unsets.deliveryMode = 1;
      delete updates.availability;
      delete updates.deliveryMode;
    }
    if (req.files && req.files.length > 0) {
      const imageMetadata = req.files
        .map(mapUploadToImageMetadata)
        .filter(image => image.url && image.publicId);
      if (imageMetadata.length === 0) {
        destroyCloudinaryImages({ files: req.files }, req.requestId);
        return error(res, 'Uploaded images could not be processed', 422);
      }
      updates.images = imageMetadata.map(image => image.secureUrl || image.url);
      updates.imageMetadata = imageMetadata;
    }
    if (req.body.coverImageIndex !== undefined || updates.images) {
      const imageCount = updates.images ? updates.images.length : listing.images.length;
      const fallback = updates.images ? 0 : listing.coverImageIndex;
      const coverImageIndex = parseCoverImageIndex(req.body.coverImageIndex, imageCount, fallback);
      if (coverImageIndex === null) {
        destroyCloudinaryImages({ files: req.files }, req.requestId);
        return error(res, 'Cover image index is invalid', 422);
      }
      updates.coverImageIndex = coverImageIndex;
    }

    const updateQuery = { $set: updates };
    if (Object.keys(unsets).length > 0) {
      updateQuery.$unset = unsets;
    }

    const updated = await Listing.findByIdAndUpdate(
      req.params.id,
      updateQuery,
      { new: true, runValidators: true }
    );

    await flushPublicListingCaches();
    if (req.files && req.files.length > 0) {
      destroyCloudinaryImages(listing, req.requestId);
    }
    return success(res, { listing: decorateListingImages(updated) }, 'Listing updated successfully');
  } catch (err) {
    destroyCloudinaryImages({ files: req.files }, req.requestId);
    if (err.name === 'ValidationError') {
      return error(res, Object.values(err.errors)[0].message, 422);
    }
    throw err;
  }
};

// ─── DELETE /api/v1/listings/:id ──────────────────────────────────────────────
exports.deleteListing = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);

  const listing = await Listing.findById(req.params.id).select('+imageMetadata');
  if (!listing)                                                               return error(res, 'Listing not found', 404);
  const isAdmin = req.user?.role === 'super_admin' || (req.user?.role === 'college_admin' && req.user.adminCollege === listing.college);
  if (listing.seller.toString() !== req.userId && !isAdmin) return error(res, 'Not authorised', 403);

  await Promise.all([
    listing.deleteOne(),
    User.findByIdAndUpdate(listing.seller, { $inc: { listingCount: -1 } }),
  ]);

  destroyCloudinaryImages(listing, req.requestId);

  await flushPublicListingCaches();
  return success(res, null, 'Listing deleted successfully');
};

exports.updateListingStatus = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);

  const listing = await Listing.findById(req.params.id);
  if (!listing) return error(res, 'Listing not found', 404);
  const isAdmin = req.user?.role === 'super_admin' || (req.user?.role === 'college_admin' && req.user.adminCollege === listing.college);
  if (listing.seller.toString() !== req.userId && !isAdmin) {
    return error(res, 'Not authorised', 403);
  }

  listing.status = req.body.status;
  listing.isSold = req.body.status === 'sold';
  listing.isActive = !['hidden', 'expired'].includes(req.body.status);
  await listing.save();

  if (req.body.status === 'sold') {
    await User.findByIdAndUpdate(listing.seller, { $inc: { soldCount: 1 } });
  }

  await flushPublicListingCaches();
  return success(res, { listing: decorateListingImages(listing) }, 'Listing status updated');
};

exports.renewListing = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);

  const listing = await Listing.findById(req.params.id);
  if (!listing) return error(res, 'Listing not found', 404);
  const isAdmin = req.user?.role === 'super_admin' || (req.user?.role === 'college_admin' && req.user.adminCollege === listing.college);
  if (listing.seller.toString() !== req.userId && !isAdmin) {
    return error(res, 'Not authorised', 403);
  }
  if (listing.status === 'sold') return error(res, 'Sold listings cannot be renewed', 400);

  listing.expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  listing.status = 'available';
  listing.isActive = true;
  await listing.save();

  await flushPublicListingCaches();
  return success(res, { listing: decorateListingImages(listing) }, 'Listing renewed');
};

exports.toggleSaveListing = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);
  const listingId = req.params.id;

  const [exists, user] = await Promise.all([
    Listing.exists({ _id: listingId, isActive: true }),
    User.findById(req.userId).select('wishlist').lean(),
  ]);
  if (!exists) return error(res, 'Listing not found', 404);

  const isSaved = user.wishlist.some(id => id.toString() === listingId);

  if (isSaved) {
    await Promise.all([
      User.findByIdAndUpdate(req.userId,    { $pull:    { wishlist: listingId } }),
      Listing.findByIdAndUpdate(listingId,  { $pull:    { savedBy: req.userId } }),
    ]);
    return success(res, { saved: false }, 'Removed from wishlist');
  } else {
    await Promise.all([
      User.findByIdAndUpdate(req.userId,    { $addToSet: { wishlist: listingId } }),
      Listing.findByIdAndUpdate(listingId,  { $addToSet: { savedBy: req.userId } }),
    ]);
    return success(res, { saved: true }, 'Saved to wishlist');
  }
};

exports.getSavedListings = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const user = await User.findById(req.userId)
    .select('wishlist')
    .lean();

  const wishlistIds = user?.wishlist || [];
  const [rawListings, total] = await Promise.all([
    Listing.find({ _id: { $in: wishlistIds }, isActive: true })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('title price type category condition images coverImageIndex seller college location createdAt')
      .populate('seller', 'name avatar initials college rating isVerified')
      .lean(),
    Listing.countDocuments({ _id: { $in: wishlistIds }, isActive: true }),
  ]);

  return success(res, {
    listings: rawListings.map(decorateListingImages),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
};

exports.getMyListings = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const [rawListings, total] = await Promise.all([
    Listing.find({ seller: req.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Listing.countDocuments({ seller: req.userId }),
  ]);

  const now = Date.now();
  const listings = rawListings.map(l => decorateListingImages({
    ...l,
    daysUntilExpiry: l.expiresAt
      ? Math.max(0, Math.ceil((new Date(l.expiresAt).getTime() - now) / 86400000))
      : 0,
  }));

  return success(res, {
    listings,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
};

exports.reportListing = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);
  const { reason, details } = req.body;

  const listing = await Listing.findById(req.params.id);
  if (!listing) return error(res, 'Listing not found', 404);
  if (listing.seller.toString() === req.userId) {
    return error(res, 'You cannot report your own listing', 400);
  }

  const existingReport = await Report.findOne({
    listing: listing._id,
    reporter: req.userId,
  }).lean();
  if (existingReport) return error(res, 'You have already reported this listing', 409);

  const [reportCount] = await Promise.all([
    Report.countDocuments({ listing: listing._id }),
    Report.create({
      listing: listing._id,
      reporter: req.userId,
      reason,
      details: (details || '').trim(),
    }),
  ]);

  const admins = await User.find({ role: { $in: ['super_admin', 'college_admin'] } }).select('_id').lean();
  if (admins.length > 0) {
    const adminNotifications = await Notification.insertMany(
      admins.map(a => ({
        user: a._id,
        type: 'report',
        text: `Listing "${listing.title}" was reported for ${reason}.`,
        link: `/admin/listing-reports?listing=${listing._id}`,
      }))
    );
    try {
      const io = getIO();
      adminNotifications.forEach(notification => {
        io.to(`user_${notification.user}`).emit('new_notification', { notification });
      });
    } catch (socketErr) {
      logger.warn(`[${req.requestId}] Admin report socket emit failed: ${socketErr.message}`);
    }
  }

  // Auto-flag after 3 unique reports
  if (reportCount >= 2 && !listing.flagged) {
    listing.flagged = true;
    await listing.save();

    if (admins.length > 0) {
      const autoFlagNotifications = await Notification.insertMany(
        admins.map(a => ({
          user: a._id,
          type: 'system',
          text: `Listing "${listing.title}" has been auto-flagged after 3 reports.`,
          link: `/admin/listings/${listing._id}`,
        }))
      );
      try {
        const io = getIO();
        autoFlagNotifications.forEach(notification => {
          io.to(`user_${notification.user}`).emit('new_notification', { notification });
        });
      } catch (socketErr) {
        logger.warn(`[${req.requestId}] Auto-flag socket emit failed: ${socketErr.message}`);
      }
    }
  }

  return success(res, null, 'Listing reported successfully');
};

// Exports for split controllers
exports.isValidId = isValidId;
exports.normalizeTags = normalizeTags;
exports.parseBoolean = parseBoolean;
exports.destroyCloudinaryImages = destroyCloudinaryImages;
exports.flushPublicListingCaches = flushPublicListingCaches;
exports.decorateListingImages = decorateListingImages;
exports.getCampusScope = getCampusScope;
exports.APPROVED_MODERATION_FILTER = APPROVED_MODERATION_FILTER;
exports.parseCoverImageIndex = parseCoverImageIndex;
exports.findImageIndex = findImageIndex;
