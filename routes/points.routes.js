'use strict';
const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth.middleware');
const { param } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');
const pointsController = require('../controllers/points.controller');

router.get('/me', protect, asyncHandler(pointsController.getMyPoints));

router.post('/check-in', protect, asyncHandler(pointsController.checkIn));

router.post('/boost-listing/:listingId',
  protect,
  [param('listingId').isMongoId().withMessage('Invalid listing ID')],
  validate,
  asyncHandler(pointsController.boostListing)
);

module.exports = router;
