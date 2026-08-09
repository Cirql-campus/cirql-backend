const webpush = require('web-push');
const mongoose = require('mongoose');
const logger = require('./logger');

const hasVapidConfig = () => Boolean(
  process.env.VAPID_SUBJECT
  && process.env.VAPID_PUBLIC_KEY
  && process.env.VAPID_PRIVATE_KEY
);

if (hasVapidConfig()) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  logger.warn('Web push is disabled because VAPID env vars are not fully configured.');
}

/**
 * Send a push notification to all subscriptions of a user
 * @param {Object} user - The user document
 * @param {Object} payload - { title, body, icon, url, data }
 */
const sendPushNotification = async (user, payload) => {
  if (!hasVapidConfig()) {
    return;
  }

  if (!user || !user.pushSubscriptions || user.pushSubscriptions.length === 0) {
    return;
  }

  const preferences = user.notificationPreferences || {};
  if (preferences.pushEnabled === false || (payload.preferenceKey && preferences[payload.preferenceKey] === false)) {
    return;
  }

  // Calculate unread badge count dynamically if not already provided
  let badgeCount = payload.badge;
  if (badgeCount === undefined) {
    try {
      const Notification = mongoose.model('Notification');
      const Conversation = mongoose.model('Conversation');
      const Message = mongoose.model('Message');

      const conversations = await Conversation.find({ participants: user._id })
        .select('_id')
        .lean();
      const conversationIds = conversations.map(c => c._id);

      const [unreadNotifications, unreadMessages] = await Promise.all([
        Notification.countDocuments({ user: user._id, read: false }),
        Message.countDocuments({
          conversation: { $in: conversationIds },
          sender: { $ne: user._id },
          read: false,
        }),
      ]);
      badgeCount = unreadNotifications + unreadMessages;
    } catch (countErr) {
      logger.warn(`Failed to calculate badge count for push: ${countErr.message}`);
    }
  }

  const { preferenceKey, ...safePayload } = payload;
  if (badgeCount !== undefined) {
    safePayload.badge = badgeCount;
  }

  const payloadString = JSON.stringify(safePayload);
  const expiredEndpoints = [];

  const promises = user.pushSubscriptions.map(sub => 
    webpush.sendNotification(sub, payloadString).catch(err => {
      if (err.statusCode === 404 || err.statusCode === 410) {
        expiredEndpoints.push(sub.endpoint);
        return;
      }

      logger.warn(`Push notification failed: ${err.message}`);
    })
  );

  await Promise.all(promises);

  if (expiredEndpoints.length > 0 && typeof user.save === 'function') {
    user.pushSubscriptions = user.pushSubscriptions.filter(
      sub => !expiredEndpoints.includes(sub.endpoint)
    );
    await user.save();
  }
};

module.exports = {
  sendPushNotification,
  webpush
};
