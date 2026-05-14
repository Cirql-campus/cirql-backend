'use strict';
const express = require('express');
const { body } = require('express-validator');
const userController = require('../controllers/user.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { reportLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

router.get('/me', protect, userController.getMe);
router.post('/push/subscribe', protect, userController.subscribeToPush);
router.delete('/push/subscribe', protect, userController.unsubscribeFromPush);
router.patch('/notification-preferences', protect, userController.updateNotificationPreferences);
router.get('/blocked', protect, userController.getBlockedUsers);

router.put('/me',
  protect,
  [
    body('name').optional().trim().isLength({ min: 2, max: 60 }).withMessage('Name must be 2–60 characters'),
    body('avatar').optional().isURL().withMessage('Avatar must be a valid URL'),
  ],
  validate,
  userController.updateProfile
);

router.get('/:id', userController.getUserProfile);
router.get('/:id/reviews', userController.getReviews);

router.post('/:id/block',
  protect,
  [
    body('reason').optional().trim().isLength({ max: 300 }).withMessage('Reason must be at most 300 characters'),
  ],
  validate,
  userController.blockUser
);

router.delete('/:id/block', protect, userController.unblockUser);

router.post('/:id/report',
  protect,
  reportLimiter,
  [
    body('reason').isIn(['spam', 'fraud', 'harassment', 'unsafe_behavior', 'fake_profile', 'other']).withMessage('Invalid report reason'),
    body('details').optional().trim().isLength({ max: 500 }).withMessage('Details must be at most 500 characters'),
  ],
  validate,
  userController.reportUser
);

router.post('/:id/review',
  protect,
  [
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be an integer between 1 and 5'),
    body('comment').optional().trim().isLength({ max: 300 }).withMessage('Comment must be at most 300 characters'),
    body('listingId').optional().isMongoId().withMessage('Invalid listing ID'),
  ],
  validate,
  userController.reviewUser
);

module.exports = router;
