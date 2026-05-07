'use strict';
const express = require('express');
const { body, param, query } = require('express-validator');
const listingController = require('../controllers/listing.controller');
const { protect, optionalAuth } = require('../middleware/auth.middleware');
const {
  upload,
  handleUploadError,
  requireCloudinaryConfig,
  validateFileMagicBytes,
} = require('../middleware/upload.middleware');
const { createLimiter, reportLimiter } = require('../middleware/rateLimit.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = express.Router();

// ── Public routes ─────────────────────────────────────────────────────────────
// IMPORTANT: specific paths MUST come before /:id
router.get('/search/suggestions', listingController.getSearchSuggestions);
router.get('/saved-searches/me',
  protect,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50'),
  ],
  validate,
  listingController.getSavedSearches
);
router.get('/saved/me',
  protect,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50'),
  ],
  validate,
  listingController.getSavedListings
);
router.get('/mine/me',
  protect,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50'),
  ],
  validate,
  listingController.getMyListings
);

router.post('/saved-searches',
  protect,
  [
    body('name').optional().trim().isLength({ max: 80 }),
    body('query').optional().trim().isLength({ max: 100 }),
    body('category').optional().isIn(['academia', 'tech', 'rides', 'living', 'attire', 'gifts', 'misc', '']),
    body('type').optional().isIn(['sell', 'rent', 'free', '']),
    body('minPrice').optional().isFloat({ min: 0 }),
    body('maxPrice').optional().isFloat({ min: 0 }),
    body('condition').optional().isIn(['Brand New', 'Like New', 'Good', 'Fair', '']),
    body('location').optional().trim().isLength({ max: 60 }),
    body('tags').optional(),
    body('alertsEnabled').optional().isBoolean(),
  ],
  validate,
  listingController.createSavedSearch
);

router.delete('/saved-searches/:id',
  protect,
  [param('id').isMongoId().withMessage('Invalid saved search ID')],
  validate,
  listingController.deleteSavedSearch
);

router.get('/',
  optionalAuth,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1–50'),
    query('sort').optional().isIn(['newest', 'price_asc', 'price_desc', 'views']),
    query('category').optional().isIn(['All', 'all', 'Academia', 'Tech', 'Rides', 'Living', 'Attire', 'Gifts', 'Misc', 'academia', 'tech', 'rides', 'living', 'attire', 'gifts', 'misc']),
    query('type').optional().isIn(['sell', 'rent', 'free']),
    query('status').optional().isIn(['available', 'reserved', 'sold', 'hidden', 'expired']),
    query('condition').optional().isIn(['Brand New', 'Like New', 'Good', 'Fair']),
    query('minPrice').optional().isFloat({ min: 0 }),
    query('maxPrice').optional().isFloat({ min: 0 }),
    query('location').optional().trim().isLength({ max: 60 }),
    query('college').optional().trim().isLength({ max: 100 }),
    query('tags').optional(),
  ],
  validate,
  listingController.getListings
);

router.get('/:id', optionalAuth, listingController.getListingById);

// ── Protected routes ──────────────────────────────────────────────────────────
router.post('/',
  protect,
  createLimiter,
  requireCloudinaryConfig,
  upload.array('images', 3),
  handleUploadError,
  validateFileMagicBytes,
  [
    body('title').trim().notEmpty().withMessage('Title is required').isLength({ min: 3, max: 100 }),
    body('price').isFloat({ min: 0, max: 500000 }).withMessage('Price must be 0–500000'),
    body('category').isIn(['academia', 'tech', 'rides', 'living', 'attire', 'gifts', 'misc']).withMessage('Invalid category'),
    body('type').optional().isIn(['sell', 'rent', 'free']),
    body('condition').optional().isIn(['Brand New', 'Like New', 'Good', 'Fair']),
    body('description').optional().trim().isLength({ max: 2000 }),
    body('location').optional().trim().isLength({ max: 100 }),
    body('pickupLocation').optional().trim().isLength({ max: 120 }),
    body('isNegotiable').optional().isBoolean().withMessage('isNegotiable must be true or false'),
    body('originalPrice').optional().isFloat({ min: 0, max: 500000 }),
    body('quantity').optional().isInt({ min: 1, max: 99 }),
    body('rentDuration').optional().isIn(['hourly', 'daily', 'weekly', 'monthly', 'semester']),
    body('brand').optional().trim().isLength({ max: 80 }),
    body('model').optional().trim().isLength({ max: 80 }),
    body('tags').optional(),
    body('coverImageIndex').optional().isInt({ min: 0, max: 2 }).withMessage('Cover image index must be 0-2'),
  ],
  validate,
  listingController.createListing
);

router.put('/:id',
  protect,
  requireCloudinaryConfig,
  upload.array('images', 3),
  handleUploadError,
  validateFileMagicBytes,
  [
    body('title').optional().trim().isLength({ min: 3, max: 100 }),
    body('description').optional().trim().isLength({ max: 2000 }),
    body('location').optional().trim().isLength({ max: 100 }),
    body('pickupLocation').optional().trim().isLength({ max: 120 }),
    body('price').optional().isFloat({ min: 0, max: 500000 }),
    body('isNegotiable').optional().isBoolean().withMessage('isNegotiable must be true or false'),
    body('originalPrice').optional().isFloat({ min: 0, max: 500000 }),
    body('quantity').optional().isInt({ min: 1, max: 99 }),
    body('rentDuration').optional().isIn(['hourly', 'daily', 'weekly', 'monthly', 'semester']),
    body('brand').optional().trim().isLength({ max: 80 }),
    body('model').optional().trim().isLength({ max: 80 }),
    body('tags').optional(),
    body('category').optional().isIn(['academia', 'tech', 'rides', 'living', 'attire', 'gifts', 'misc']),
    body('type').optional().isIn(['sell', 'rent', 'free']),
    body('condition').optional().isIn(['Brand New', 'Like New', 'Good', 'Fair']),
    body('coverImageIndex').optional().isInt({ min: 0, max: 2 }).withMessage('Cover image index must be 0-2'),
  ],
  validate,
  listingController.updateListing
);

router.delete('/:id/images',
  protect,
  [
    body('publicId').optional().trim().isLength({ min: 1, max: 255 }),
    body('url').optional().trim().isURL().withMessage('Image URL must be valid'),
    body().custom((_value, { req }) => {
      if (!req.body.publicId && !req.body.url) {
        throw new Error('Provide publicId or url for the image to delete');
      }
      return true;
    }),
  ],
  validate,
  listingController.deleteListingImage
);

router.patch('/:id/images/reorder',
  protect,
  [
    body('images').isArray({ min: 1, max: 3 }).withMessage('Images must include 1-3 URLs'),
    body('images.*').isURL().withMessage('Each image must be a valid URL'),
    body('coverImageIndex').optional().isInt({ min: 0, max: 2 }).withMessage('Cover image index must be 0-2'),
  ],
  validate,
  listingController.reorderListingImages
);

router.patch('/:id/status',
  protect,
  [
    param('id').isMongoId().withMessage('Invalid listing ID'),
    body('status').isIn(['available', 'reserved', 'sold', 'hidden']).withMessage('Invalid status'),
  ],
  validate,
  listingController.updateListingStatus
);

router.post('/:id/renew',
  protect,
  [param('id').isMongoId().withMessage('Invalid listing ID')],
  validate,
  listingController.renewListing
);

router.delete('/:id', protect, listingController.deleteListing);
router.post('/:id/save', protect, listingController.toggleSaveListing);

router.post('/:id/report', 
  protect,
  reportLimiter,
  [
    body('reason').isIn(['spam', 'fake', 'inappropriate', 'wrong_price', 'other']).withMessage('Invalid report reason'),
    body('details').optional().trim().isLength({ max: 500 }).withMessage('Details must be at most 500 characters'),
  ],
  validate,
  listingController.reportListing
);

module.exports = router;
