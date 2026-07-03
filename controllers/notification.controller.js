'use strict';
const Notification = require('../models/Notification');
const { success, error } = require('../utils/apiResponse');

exports.getNotifications = async (req, res) => {
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
};

exports.markAllRead = async (req, res) => {
  await Notification.updateMany(
    { user: req.userId, read: false },
    { $set: { read: true } }
  );
  return success(res, null, 'All notifications marked as read');
};

exports.markOneRead = async (req, res) => {
  const notif = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.userId },
    { $set: { read: true } },
    { new: true }
  );
  if (!notif) return error(res, 'Notification not found', 404);
  return success(res, { notification: notif });
};
