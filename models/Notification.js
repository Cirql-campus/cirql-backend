'use strict';
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  type: {
    type:    String,
    enum:    ['message', 'listing_view', 'sold', 'system', 'report', 'moderation', 'saved_search', 'deal'],
    default: 'system',
  },
  text: {
    type:      String,
    required:  true,
    maxlength: 200,
  },
  read: { type: Boolean, default: false },
  link: { type: String,  default: '', maxlength: 200 },
}, {
  timestamps: true,
});

// ── Indexes ───────────────────────────────────────────────────────────────────
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, read: 1 });
// Auto-delete notifications older than 60 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);
