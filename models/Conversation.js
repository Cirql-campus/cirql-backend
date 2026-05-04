'use strict';
const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      required: true,
    }],
    validate: {
      validator: arr => arr.length === 2,
      message:   'A conversation must have exactly 2 participants',
    },
  },
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'Listing',
    index: true,
  },
  lastMessage:   { type: String, default: '', maxlength: 500 },
  lastMessageAt: { type: Date,   default: Date.now },
}, {
  timestamps: true,
});

// ── Indexes ───────────────────────────────────────────────────────────────────
conversationSchema.index({ participants: 1 });
conversationSchema.index({ participants: 1, listing: 1 });
conversationSchema.index({ participants: 1, createdAt: -1 });
conversationSchema.index({ participants: 1, lastMessageAt: -1 });
conversationSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
