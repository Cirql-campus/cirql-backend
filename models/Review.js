'use strict';
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  seller: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  reviewer: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'Listing',
  },
  deal: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'Deal',
  },
  rating: {
    type:     Number,
    required: [true, 'Rating is required'],
    min:      [1, 'Rating must be at least 1'],
    max:      [5, 'Rating must be at most 5'],
  },
  comment: {
    type:      String,
    maxlength: [500, 'Comment must be at most 500 characters'],
    trim:      true,
    default:   '',
  },
}, { timestamps: true });

// ── Indexes ───────────────────────────────────────────────────────────────────
// One review per reviewer-seller pair
reviewSchema.index({ reviewer: 1, seller: 1 }, { unique: true });
// Fast lookup for rating aggregation
reviewSchema.index({ seller: 1 });
reviewSchema.index({ listing: 1 });
reviewSchema.index({ deal: 1 });

module.exports = mongoose.model('Review', reviewSchema);
