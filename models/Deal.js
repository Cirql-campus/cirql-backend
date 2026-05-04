'use strict';
const mongoose = require('mongoose');

const dealSchema = new mongoose.Schema({
  listing: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Listing',
    required: true,
    index:    true,
  },
  buyer: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    index:    true,
  },
  seller: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    index:    true,
  },
  status: {
    type:    String,
    enum:    ['requested', 'accepted', 'rejected', 'cancelled', 'completed', 'disputed'],
    default: 'requested',
    index:   true,
  },
  message: {
    type:      String,
    trim:      true,
    maxlength: [500, 'Deal message must be at most 500 characters'],
    default:   '',
  },
  meetupLocation: {
    type:      String,
    trim:      true,
    maxlength: [120, 'Meetup location must be at most 120 characters'],
    default:   '',
  },
  acceptedAt: Date,
  rejectedAt: Date,
  cancelledAt: Date,
  completedAt: Date,
  buyerCompletedAt: Date,
  sellerCompletedAt: Date,
  statusNote: {
    type:      String,
    trim:      true,
    maxlength: [500, 'Status note must be at most 500 characters'],
    default:   '',
  },
}, { timestamps: true });

dealSchema.index(
  { listing: 1, buyer: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['requested', 'accepted'] } },
  }
);
dealSchema.index({ buyer: 1, status: 1, updatedAt: -1 });
dealSchema.index({ seller: 1, status: 1, updatedAt: -1 });

dealSchema.virtual('isCompletedByBoth').get(function () {
  return Boolean(this.buyerCompletedAt && this.sellerCompletedAt);
});

module.exports = mongoose.model('Deal', dealSchema);
