'use strict';
const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    slug: {
      type:     String,
      required: [true, 'Slug is required'],
      unique:   true,
      trim:     true,
      lowercase: true,
    },
    label: {
      type:     String,
      required: [true, 'Label is required'],
      trim:     true,
    },
    emoji: {
      type:    String,
      default: '📦',
    },
    description: {
      type:    String,
      default: '',
      trim:    true,
    },
    gradient: {
      type:    String,
      default: 'linear-gradient(135deg,#1a1a2e,#16213e)',
    },
    color: {
      type:    String,
      default: '#4f8ef7',
    },
    listingCount: {
      type:    Number,
      default: 0,
      min:     0,
    },
    sortOrder: {
      type:    Number,
      default: 99,
    },
    isActive: {
      type:    Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────────
// Note: slug unique index is created automatically from `unique: true` on the field.
categorySchema.index({ sortOrder: 1 });
categorySchema.index({ isActive:  1 });

module.exports = mongoose.model('Category', categorySchema);
