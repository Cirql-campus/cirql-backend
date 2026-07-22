'use strict';
const { error } = require('../utils/apiResponse');

// Must be super_admin
const superAdmin = (req, res, next) => {
  if (req.user?.role === 'super_admin') return next();
  return error(res, 'Access denied — Super Admin privileges required', 403);
};

// Must be college_admin OR super_admin
const anyAdmin = (req, res, next) => {
  if (req.user?.role === 'super_admin' || req.user?.role === 'college_admin') return next();
  return error(res, 'Access denied — Admin privileges required', 403);
};

// Attaches college scope to req — super_admin gets null (all colleges),
// college_admin gets their adminCollege value
const scopeCollege = (req, res, next) => {
  if (req.user?.role === 'super_admin') {
    req.collegeScope = null; // null = no filter = see everything
  } else if (req.user?.role === 'college_admin') {
    req.collegeScope = req.user.adminCollege;
    if (!req.collegeScope) {
      return error(res, 'College admin has no assigned college', 403);
    }
  } else {
    return error(res, 'Access denied', 403);
  }
  next();
};

// Keep old `admin` export for backward compat during transition, pointing to anyAdmin
const admin = anyAdmin;

module.exports = { superAdmin, anyAdmin, admin, scopeCollege };
