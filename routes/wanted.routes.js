'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const wantedController = require('../controllers/wanted.controller');
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { wantedLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();
router.use(protect);

router.get('/',
  [
    query('category').optional().isIn(['all', 'academia', 'tech', 'rides', 'living', 'attire', 'gifts', 'misc']).withMessage('Invalid category'),
    query('status').optional().isIn(['open', 'fulfilled', 'closed', 'all']).withMessage('Invalid status'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 30 }).withMessage('Limit must be 1-30'),
  ],
  validate,
  asyncHandler(wantedController.getWantedRequests)
);

router.get('/mine',
  [
    query('status').optional().isIn(['open', 'fulfilled', 'closed', 'all']).withMessage('Invalid status'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50'),
  ],
  validate,
  asyncHandler(wantedController.getMyWantedRequests)
);

router.post('/',
  wantedLimiter,
  [
    body('title').trim().notEmpty().withMessage('Title is required').isLength({ min: 3, max: 100 }),
    body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description too long'),
    body('category').isIn(['academia', 'tech', 'rides', 'living', 'attire', 'gifts', 'misc']).withMessage('Invalid category'),
    body('minBudget').optional({ checkFalsy: true }).isFloat({ min: 0, max: 500000 }).withMessage('Minimum budget must be 0-500000'),
    body('maxBudget').optional({ checkFalsy: true }).isFloat({ min: 0, max: 500000 }).withMessage('Maximum budget must be 0-500000'),
    body('maxBudget').custom((value, { req }) => {
      if (value !== undefined && value !== '' && req.body.minBudget !== undefined && req.body.minBudget !== '') {
        if (Number(value) < Number(req.body.minBudget)) throw new Error('Maximum budget must be greater than or equal to minimum budget');
      }
      return true;
    }),
    body('urgency').optional().isIn(['anytime', 'this_week', 'urgent']).withMessage('Invalid urgency'),
  ],
  validate,
  asyncHandler(wantedController.createWantedRequest)
);

router.post('/:id/respond',
  wantedLimiter,
  [
    param('id').isMongoId().withMessage('Invalid wanted item ID'),
    body('message').optional().trim().isLength({ max: 1000 }).withMessage('Message too long'),
  ],
  validate,
  asyncHandler(wantedController.respondToWantedRequest)
);

router.patch('/:id/status',
  [
    param('id').isMongoId().withMessage('Invalid wanted item ID'),
    body('status').isIn(['open', 'fulfilled', 'closed']).withMessage('Invalid status'),
  ],
  validate,
  asyncHandler(wantedController.updateWantedStatus)
);

router.delete('/:id',
  [param('id').isMongoId().withMessage('Invalid wanted item ID')],
  validate,
  asyncHandler(wantedController.deleteWantedRequest)
);

module.exports = router;
