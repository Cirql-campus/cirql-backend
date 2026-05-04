'use strict';
const mongoose = require('mongoose');

const VALID_REASONS = ['spam', 'fraud', 'harassment', 'unsafe_behavior', 'fake_profile', 'other'];

const userReportSchema = new mongoose.Schema({
  reportedUser: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
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
    trim:      true,
    maxlength: [500, 'Details must be at most 500 characters'],
    default:   '',
  },
  status: {
    type:    String,
    enum:    ['open', 'reviewed', 'dismissed', 'actioned'],
    default: 'open',
  },
}, { timestamps: true });

userReportSchema.index({ reportedUser: 1, reporter: 1 }, { unique: true });
userReportSchema.index({ reportedUser: 1, status: 1 });
userReportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('UserReport', userReportSchema);
