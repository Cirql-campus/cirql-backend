'use strict';
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * validate — reads express-validator results and short-circuits with 422
 * if any validation failed. Place this after any validator array and before
 * the controller function.
 *
 * Usage:
 *   router.post('/register', [
 *     body('email').isEmail(),
 *     validate,
 *     authController.register,
 *   ]);
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const formatted = errors.array().map(e => ({
    field:   e.path || e.param,
    message: e.msg,
  }));

  logger.debug(`[${req.requestId}] Validation failed: ${JSON.stringify(formatted)}`);

  const firstMessage = formatted[0]?.message || 'Validation failed';

  return res.status(422).json({
    success: false,
    message: firstMessage === 'Validation failed' ? 'Validation failed' : firstMessage,
    errors:  formatted,
  });
};

module.exports = { validate };
