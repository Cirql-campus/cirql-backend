'use strict';
const mongoose = require('mongoose');

const VALID_REASONS = ['spam', 'fraud', 'harassment', 'inappropriate', 'unsafe_behavior', 'other'];

const messageReportSchema = new mongoose.Schema({
  message: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Message',
    required: true,
  },
  conversation: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Conversation',
    required: true,
  },
  reporter: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  reportedUser: {
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

messageReportSchema.index({ message: 1, reporter: 1 }, { unique: true });
messageReportSchema.index({ conversation: 1 });
messageReportSchema.index({ reportedUser: 1, status: 1 });
messageReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('MessageReport', messageReportSchema);
