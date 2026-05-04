'use strict';
const Notification = require('../models/Notification');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

exports.getNotifications = async (req, res) => {
  try {
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const skip   = (page - 1) * limit;

    const filter = { user: req.userId };
    const [notifications, unreadCount, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments({ user: req.userId, read: false }),
      Notification.countDocuments(filter),
    ]);

    return success(res, {
      notifications,
      unreadCount,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  } catch (err) {
    logger.error(`[${req.requestId}] getNotifications: ${err.message}`, err);
    return error(res, 'Failed to fetch notifications', 500);
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.userId, read: false },
      { $set: { read: true } }
    );
    return success(res, null, 'All notifications marked as read');
  } catch (err) {
    logger.error(`[${req.requestId}] markAllRead: ${err.message}`, err);
    return error(res, 'Failed to update notifications', 500);
  }
};

exports.markOneRead = async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { $set: { read: true } },
      { new: true }
    );
    if (!notif) return error(res, 'Notification not found', 404);
    return success(res, { notification: notif });
  } catch (err) {
    logger.error(`[${req.requestId}] markOneRead: ${err.message}`, err);
    return error(res, 'Failed to update notification', 500);
  }
};
