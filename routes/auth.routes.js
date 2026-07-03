'use strict';
const express = require('express');
const { body } = require('express-validator');

const authController = require('../controllers/auth.controller');
const userController = require('../controllers/user.controller');
const { authLimiter, otpLimiter } = require('../middleware/rateLimit.middleware');
const { validate } = require('../middleware/validate.middleware');
const { protect } = require('../middleware/auth.middleware');
const asyncHandler = require('../middleware/asyncHandler');

const passwordValidationRules = (field) => body(field)
  .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
  .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
  .matches(/[0-9]/).withMessage('Password must contain at least one number')
  .matches(/[\W_]/).withMessage('Password must contain at least one special character');

const router = express.Router();

// POST /api/v1/auth/register
router.post('/register',
  authLimiter,
  [
    body('name')
      .trim().notEmpty().withMessage('Name is required')
      .isLength({ min: 2, max: 60 }).withMessage('Name must be 2–60 characters'),
    body('email')
      .trim().isEmail().withMessage('Must be a valid email address')
      .normalizeEmail({ gmail_remove_dots: false }),
    passwordValidationRules('password'),
  ],
  validate,
  asyncHandler(authController.register)
);

// POST /api/auth/verify-otp
router.post('/verify-otp',
  otpLimiter,
  [
    body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail({ gmail_remove_dots: false }),
    body('otp').trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be 6 digits'),
  ],
  validate,
  asyncHandler(authController.verifyOTP)
);

// POST /api/auth/resend-otp
router.post('/resend-otp',
  authLimiter,
  [body('email').trim().isEmail().withMessage('Valid email required')],
  validate,
  asyncHandler(authController.resendOTP)
);

// POST /api/v1/auth/login
router.post('/login',
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Valid email required').normalizeEmail({ gmail_remove_dots: false }),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  asyncHandler(authController.login)
);

// POST /api/auth/refresh
router.post('/refresh', asyncHandler(authController.refresh));

// POST /api/auth/logout
router.post('/logout', asyncHandler(authController.logout));

// GET /api/v1/auth/me
router.get('/me', protect, asyncHandler(userController.getMe));

// POST /api/auth/forgot-password
router.post('/forgot-password',
  authLimiter,
  [body('email').trim().isEmail().withMessage('Valid email required')],
  validate,
  asyncHandler(authController.forgotPassword)
);

// POST /api/auth/reset-password
router.post('/reset-password',
  authLimiter,
  [
    body('token').notEmpty().withMessage('Token is required'),
    passwordValidationRules('newPassword'),
  ],
  validate,
  asyncHandler(authController.resetPassword)
);

// PUT /api/auth/change-password
router.put('/change-password',
  protect,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    passwordValidationRules('newPassword'),
  ],
  validate,
  asyncHandler(authController.changePassword)
);

module.exports = router;
