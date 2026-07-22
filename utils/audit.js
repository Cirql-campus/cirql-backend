'use strict';
const AuditLog = require('../models/AuditLog');

const logAdminAction = async (req, action, targetType, targetId, details) => {
  try {
    await AuditLog.create({
      adminId: req.userId,
      adminEmail: req.user.email,
      adminCollege: req.user.adminCollege || null,
      action,
      targetType,
      targetId,
      details,
    });
  } catch (err) {
    // Non-blocking log failure
    const logger = require('./logger');
    logger.error(`[AUDIT ERROR] Failed to write audit log: ${err.message}`, err);
  }
};

module.exports = { logAdminAction };
