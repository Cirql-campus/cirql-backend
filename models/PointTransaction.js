'use strict';
const mongoose = require('mongoose');

// Every point earn or spend is recorded as an immutable transaction.
// User's live balance = sum of all non-expired transactions for that user.
// lifetimePoints (on User) = total ever earned, used for tier, never decreases.

const POINT_ACTIONS = [
  'listing_created',      // +5  — listing posted and stays active 24h
  'deal_completed_seller',// +20 — seller side of a completed deal
  'deal_completed_buyer', // +10 — buyer side of a completed deal
  'review_received_5star',// +15 — received a 5-star review
  'review_received_4star',// +8  — received a 4-star review
  'profile_completed',    // +5  — one-time: avatar + bio filled in
  'account_30days',       // +10 — one-time milestone: 30 days on platform
  'account_90days',       // +10 — one-time milestone: 90 days on platform
  'daily_check_in',       // +1 — daily check-in
  'check_in_streak_7day', // +10 — 7-day check-in streak bonus
  'spend_boost_listing',  // -50 — spent to boost a listing to top
  'spend_cross_college',  // -100 — spent to show listing at another college
];

const pointTransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  action: {
    type: String,
    enum: POINT_ACTIONS,
    required: true,
  },
  points: {
    // Positive = earn, Negative = spend
    type: Number,
    required: true,
  },
  // Optional reference to what caused this transaction
  refModel: {
    type: String,
    enum: ['Listing', 'Deal', 'Review', null],
    default: null,
  },
  refId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  note: {
    type: String,
    default: '',
    maxlength: 200,
  },
  // Points expire after 180 days of inactivity to prevent stale hoarding.
  // Only applies to earned points (points > 0).
  // Spent points (points < 0) never expire.
  expiresAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

pointTransactionSchema.index({ user: 1, createdAt: -1 });
pointTransactionSchema.index({ user: 1, action: 1 });
pointTransactionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

module.exports = mongoose.model('PointTransaction', pointTransactionSchema);
module.exports.POINT_ACTIONS = POINT_ACTIONS;
