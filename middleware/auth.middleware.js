'use strict';
const jwt  = require('jsonwebtoken');
const User = require('../models/User');
const { error } = require('../utils/apiResponse');
const { isSuperAdminEmail } = require('../utils/adminEmails');

const protect = async (req, res, next) => {
  let token = req.cookies?.cirql_access;
  if (!token) {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) token = auth.slice(7);
  }
  if (!token) return error(res, 'Not authorised — please log in', 401);

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    const msg = err.name === 'TokenExpiredError'
      ? 'Session expired — please log in again'
      : 'Not authorised — invalid token';
    return error(res, msg, 401);
  }

  let user;
  try {
    user = await User.findById(decoded.id).select('+tokenVersion');
  } catch {
    return error(res, 'Server error during auth', 500);
  }

  if (!user) return error(res, 'Account no longer exists', 401);

  // Token-version check lets us invalidate all sessions after password change
  if (user.tokenVersion !== (decoded.tv ?? 0)) {
    return error(res, 'Session invalidated — please log in again', 401);
  }

  if (isSuperAdminEmail(user.email) && user.role !== 'super_admin') {
    user.role = 'super_admin';
    try {
      await user.save();
    } catch (saveErr) {
      // Log but don't crash the request — role will be correct in memory for this session
      console.error('[AUTH] Failed to persist super_admin role:', saveErr.message);
    }
  }

  req.userId = user._id.toString();
  req.user   = user;
  next();
};

const optionalAuth = async (req, _res, next) => {
  try {
    let token = req.cookies?.cirql_access;
    if (!token) {
      const auth = req.headers.authorization || '';
      if (auth.startsWith('Bearer ')) token = auth.slice(7);
    }
    if (!token) return next();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('+tokenVersion');
    if (user && user.tokenVersion === (decoded.tv ?? 0)) {
      if (isSuperAdminEmail(user.email) && user.role !== 'super_admin') {
        user.role = 'super_admin';
        try {
          await user.save();
        } catch (saveErr) {
          console.error('[AUTH] Failed to persist super_admin role:', saveErr.message);
        }
      }
      req.userId = user._id.toString();
      req.user   = user;
    }
  } catch { /* ignore */ }
  next();
};

module.exports = { protect, optionalAuth };
