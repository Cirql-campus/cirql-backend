'use strict';
const mongoose = require('mongoose');

const VALID_REASONS = ['spam', 'fake', 'inappropriate', 'wrong_price', 'other'];

const reportSchema = new mongoose.Schema({
  listing: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Listing',
    required: true,
  },
  reporter: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  reason: {
    type:     String,
    enum:     { values: VALID_REASONS, message: 'Invalid report reason' },
    required: [true, 'Reason is required'],
  },
  details: {
    type:      String,
    maxlength: [500, 'Details must be at most 500 characters'],
    trim:      true,
    default:   '',
  },
  status: {
    type:    String,
    enum:    ['open', 'reviewed', 'dismissed', 'actioned'],
    default: 'open',
    index:   true,
  },
  actionNote: {
    type:      String,
    maxlength: [500, 'Action note must be at most 500 characters'],
    trim:      true,
    default:   '',
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'User',
  },
  reviewedAt: Date,
}, { timestamps: true });

// ── Indexes ───────────────────────────────────────────────────────────────────
// Prevent a user from reporting the same listing more than once
reportSchema.index({ listing: 1, reporter: 1 }, { unique: true });
// Fast count lookup for auto-flagging logic
reportSchema.index({ listing: 1 });
reportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
