'use strict';
const { error } = require('../utils/apiResponse');

/**
 * admin — must run AFTER the `protect` middleware (which populates req.user).
 * Returns 403 if the authenticated user does not have the 'admin' role.
 */
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') return next();
  return error(res, 'Access denied — Admin privileges required', 403);
};

module.exports = { admin };
