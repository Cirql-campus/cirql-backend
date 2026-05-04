'use strict';
const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  userId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  tokenHash: {
    type:     String,
    required: true,
  },
  used: {
    type:    Boolean,
    default: false,
  },
  expiresAt: {
    type:     Date,
    required: true,
  },
}, { timestamps: true });

// ── Indexes ───────────────────────────────────────────────────────────────────
// Unique lookup by hash — covers the most common query pattern
refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
// Efficient per-user token lookup (used for token rotation / revocation)
refreshTokenSchema.index({ userId: 1 });
// TTL index — MongoDB auto-deletes expired tokens at O(1) cost
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
