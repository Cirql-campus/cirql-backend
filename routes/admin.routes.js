'use strict';
const express         = require('express');
const { body, param, query } = require('express-validator');
const adminController = require('../controllers/admin.controller');
const asyncHandler    = require('../middleware/asyncHandler');
const { validate }    = require('../middleware/validate.middleware');

const router = express.Router();

// All routes here are already protected by protect + admin middleware in server.js

// ─── Stats ────────────────────────────────────────────────────────────────────
router.get('/stats', asyncHandler(adminController.getStats));
router.get('/dashboard', asyncHandler(adminController.getDashboard));

// ─── Listings ─────────────────────────────────────────────────────────────────
router.get(
  '/listing-reports',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50'),
    query('status').optional().isIn(['open', 'reviewed', 'dismissed', 'actioned', 'all']).withMessage('Invalid status'),
    query('listing').optional().isMongoId().withMessage('Invalid listing ID'),
  ],
  validate,
  asyncHandler(adminController.getListingReports)
);

router.patch(
  '/listing-reports/:id/status',
  [
    param('id').isMongoId().withMessage('Invalid report ID'),
    body('status').isIn(['open', 'reviewed', 'dismissed', 'actioned']).withMessage('Invalid status'),
    body('actionNote').optional().trim().isLength({ max: 500 }).withMessage('Action note too long'),
  ],
  validate,
  asyncHandler(adminController.updateListingReportStatus)
);

router.get(
  '/message-reports',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50'),
    query('status').optional().isIn(['open', 'reviewed', 'dismissed', 'actioned', 'all']).withMessage('Invalid status'),
    query('message').optional().isMongoId().withMessage('Invalid message ID'),
  ],
  validate,
  asyncHandler(adminController.getMessageReports)
);

router.patch(
  '/message-reports/:id/status',
  [
    param('id').isMongoId().withMessage('Invalid report ID'),
    body('status').isIn(['open', 'reviewed', 'dismissed', 'actioned']).withMessage('Invalid status'),
    body('actionNote').optional().trim().isLength({ max: 500 }).withMessage('Action note too long'),
    body('hiddenByAdmin').optional().isBoolean().withMessage('hiddenByAdmin must be true or false'),
    body('hiddenReason').optional().trim().isLength({ max: 300 }).withMessage('Hidden reason too long'),
  ],
  validate,
  asyncHandler(adminController.updateMessageReportStatus)
);

router.get(
  '/flagged-listings',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1–50'),
  ],
  validate,
  asyncHandler(adminController.getFlaggedListings)
);

router.get(
  '/moderation-listings',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50'),
    query('status').optional().isIn(['pending', 'approved', 'rejected']).withMessage('Invalid moderation status'),
  ],
  validate,
  asyncHandler(adminController.getModerationListings)
);

router.patch(
  '/listings/:id/moderation',
  [
    param('id').isMongoId().withMessage('Invalid listing ID'),
    body('moderationStatus').isIn(['pending', 'approved', 'rejected']).withMessage('Invalid moderation status'),
    body('moderationReason').optional().trim().isLength({ max: 500 }).withMessage('Moderation reason too long'),
  ],
  validate,
  asyncHandler(adminController.updateListingModeration)
);

router.put(
  '/listings/:id/unflag',
  [param('id').isMongoId().withMessage('Invalid listing ID')],
  validate,
  asyncHandler(adminController.unflagListing)
);

router.delete(
  '/listings/:id',
  [param('id').isMongoId().withMessage('Invalid listing ID')],
  validate,
  asyncHandler(adminController.deleteListing)
);

// ─── Users ────────────────────────────────────────────────────────────────────
router.get(
  '/user-reports',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1-50'),
    query('status').optional().isIn(['open', 'reviewed', 'dismissed', 'actioned', 'all']).withMessage('Invalid status'),
  ],
  validate,
  asyncHandler(adminController.getUserReports)
);

router.patch(
  '/user-reports/:id/status',
  [
    param('id').isMongoId().withMessage('Invalid report ID'),
    body('status').isIn(['open', 'reviewed', 'dismissed', 'actioned']).withMessage('Invalid status'),
  ],
  validate,
  asyncHandler(adminController.updateUserReportStatus)
);

router.get(
  '/users',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be 1–50'),
    query('search').optional().isString().isLength({ max: 60 }).withMessage('search too long'),
  ],
  validate,
  asyncHandler(adminController.getUsers)
);

router.put(
  '/users/:id/ban',
  [param('id').isMongoId().withMessage('Invalid user ID')],
  validate,
  asyncHandler(adminController.banUser)
);

router.put(
  '/users/:id/unban',
  [param('id').isMongoId().withMessage('Invalid user ID')],
  validate,
  asyncHandler(adminController.unbanUser)
);

module.exports = router;
