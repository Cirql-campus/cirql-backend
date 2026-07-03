'use strict';

const express = require('express');
const { body, param, query } = require('express-validator');
const dealController = require('../controllers/deal.controller');
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = express.Router();
router.use(protect);

router.get('/',
  [
    query('role').optional().isIn(['buyer', 'seller', 'all']).withMessage('Invalid deal role'),
    query('status').optional().isIn(['requested', 'accepted', 'rejected', 'cancelled', 'completed', 'disputed', 'all']).withMessage('Invalid deal status'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50'),
  ],
  validate,
  asyncHandler(dealController.getMyDeals)
);

router.post('/',
  [
    body('listingId').isMongoId().withMessage('Invalid listing ID'),
    body('message').optional().trim().isLength({ max: 500 }).withMessage('Message too long'),
    body('meetupLocation').optional().trim().isLength({ max: 120 }).withMessage('Meetup location too long'),
  ],
  validate,
  asyncHandler(dealController.createDealRequest)
);

router.get('/:id',
  [param('id').isMongoId().withMessage('Invalid deal ID')],
  validate,
  asyncHandler(dealController.getDealById)
);

router.patch('/:id/status',
  [
    param('id').isMongoId().withMessage('Invalid deal ID'),
    body('action').isIn(['accept', 'reject', 'cancel', 'complete', 'dispute']).withMessage('Invalid deal action'),
    body('note').optional().trim().isLength({ max: 500 }).withMessage('Note too long'),
  ],
  validate,
  asyncHandler(dealController.updateDealStatus)
);

module.exports = router;
