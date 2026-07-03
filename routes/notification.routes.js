'use strict';
const express = require('express');
const { query } = require('express-validator');
const notifController = require('../controllers/notification.controller');
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');

const router = express.Router();
router.use(protect);

router.get('/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50'),
  ],
  validate,
  asyncHandler(notifController.getNotifications)
);
router.put('/read-all',   asyncHandler(notifController.markAllRead));
router.put('/:id/read',   asyncHandler(notifController.markOneRead));

module.exports = router;
