'use strict';
const express = require('express');
const { body, param, query } = require('express-validator');
const chatController = require('../controllers/chat.controller');
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { chatLimiter, reportLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();
router.use(protect);

router.get('/unread-count', asyncHandler(chatController.getUnreadCount));
router.get('/conversations',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50'),
  ],
  validate,
  asyncHandler(chatController.getConversations)
);

router.post('/conversations',
  chatLimiter,
  [
    body('listingId').isMongoId().withMessage('Invalid listing ID'),
    body('sellerId').isMongoId().withMessage('Invalid seller ID'),
  ],
  validate,
  asyncHandler(chatController.createOrGetConversation)
);

router.get('/conversations/:id/messages',
  [
    param('id').isMongoId().withMessage('Invalid conversation ID'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
  ],
  validate,
  asyncHandler(chatController.getMessages)
);

router.post('/conversations/:id/messages',
  chatLimiter,
  [
    param('id').isMongoId().withMessage('Invalid conversation ID'),
    body('text').trim().notEmpty().withMessage('Message text is required').isLength({ max: 1000 }),
  ],
  validate,
  asyncHandler(chatController.sendMessage)
);

router.post('/messages/:id/report',
  reportLimiter,
  [
    param('id').isMongoId().withMessage('Invalid message ID'),
    body('reason').isIn(['spam', 'fraud', 'harassment', 'inappropriate', 'unsafe_behavior', 'other']).withMessage('Invalid report reason'),
    body('details').optional().trim().isLength({ max: 500 }).withMessage('Details must be at most 500 characters'),
  ],
  validate,
  asyncHandler(chatController.reportMessage)
);

module.exports = router;
