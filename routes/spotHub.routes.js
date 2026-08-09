'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const spotHubController = require('../controllers/spotHub.controller');
const asyncHandler = require('../middleware/asyncHandler');
const { protect, requireVerified } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { createLimiter } = require('../middleware/rateLimit.middleware');

const {
  upload,
  handleUploadError,
  requireCloudinaryConfig,
  validateFileMagicBytes,
} = require('../middleware/upload.middleware');

const router = express.Router();
router.use(protect);

router.get('/',
  [
    query('category').optional().isIn(['all', 'food', 'shop', 'hangout', 'services', 'other']).withMessage('Invalid category'),
    query('sort').optional().isIn(['new', 'top']).withMessage('Invalid sort parameter'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50'),
  ],
  validate,
  asyncHandler(spotHubController.getPosts)
);

router.post('/',
  requireVerified,
  createLimiter,
  requireCloudinaryConfig,
  upload.array('images', 3),
  handleUploadError,
  validateFileMagicBytes,
  [
    body('placeName').trim().notEmpty().withMessage('Place name is required').isLength({ min: 2, max: 80 }).withMessage('Place name must be 2 to 80 characters'),
    body('description').trim().notEmpty().withMessage('Description is required').isLength({ max: 400 }).withMessage('Description must be at most 400 characters'),
    body('category').isIn(['food', 'shop', 'hangout', 'services', 'other']).withMessage('Invalid category'),
    body('images').optional().custom((value, { req }) => {
      if (req.files && req.files.length > 0) {
        if (req.files.length > 3) {
          throw new Error('Maximum 3 images allowed');
        }
        return true;
      }
      if (Array.isArray(value)) {
        if (value.length < 1 || value.length > 3) {
          throw new Error('Between 1 and 3 images are required');
        }
        if (!value.every(v => typeof v === 'string' && v.trim() !== '')) {
          throw new Error('Image URL must be a non-empty string');
        }
        return true;
      }
      throw new Error('Between 1 and 3 images are required');
    }),
  ],
  validate,
  asyncHandler(spotHubController.createPost)
);

router.post('/:id/upvote',
  [param('id').isMongoId().withMessage('Invalid post ID')],
  validate,
  asyncHandler(spotHubController.upvote)
);

router.post('/:id/downvote',
  [param('id').isMongoId().withMessage('Invalid post ID')],
  validate,
  asyncHandler(spotHubController.downvote)
);

router.post('/:id/flag-outdated',
  [param('id').isMongoId().withMessage('Invalid post ID')],
  validate,
  asyncHandler(spotHubController.flagOutdated)
);

router.delete('/:id',
  [param('id').isMongoId().withMessage('Invalid post ID')],
  validate,
  asyncHandler(spotHubController.deletePost)
);

router.post('/:id/comments',
  requireVerified,
  [
    param('id').isMongoId().withMessage('Invalid post ID'),
    body('text').trim().notEmpty().withMessage('Comment text is required').isLength({ max: 500 }).withMessage('Comment must be at most 500 characters'),
  ],
  validate,
  asyncHandler(spotHubController.addComment)
);

router.delete('/:id/comments/:commentId',
  [
    param('id').isMongoId().withMessage('Invalid post ID'),
    param('commentId').isMongoId().withMessage('Invalid comment ID'),
  ],
  validate,
  asyncHandler(spotHubController.deleteComment)
);

module.exports = router;
