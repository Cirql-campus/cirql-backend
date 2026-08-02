'use strict';
const mongoose = require('mongoose');
const logger = require('../utils/logger');
require('./Category');

const imageMetadataSchema = new mongoose.Schema({
  url:          { type: String, required: true, trim: true },
  secureUrl:    { type: String, trim: true },
  publicId:     { type: String, required: true, trim: true },
  format:       { type: String, trim: true },
  resourceType: { type: String, trim: true },
  bytes:        { type: Number, min: 0 },
  width:        { type: Number, min: 0 },
  height:       { type: Number, min: 0 },
  originalName: { type: String, trim: true },
}, { _id: false });

const listingSchema = new mongoose.Schema({
  title: {
    type:      String,
    required:  [true, 'Title is required'],
    trim:      true,
    minlength: [3,   'Title must be at least 3 characters'],
    maxlength: [100, 'Title must be at most 100 characters'],
  },
  description: {
    type:      String,
    default:   '',
    trim:      true,
    maxlength: [2000, 'Description must be at most 2000 characters'],
  },
  price: {
    type:     Number,
    required: [true, 'Price is required'],
    min:      [0, 'Price cannot be negative'],
    max:      [500000, 'Price cannot exceed ₹5,00,000'],
  },
  category: {
    type:     String,
    required: [true, 'Category is required'],
    lowercase: true,
    trim:      true,
    validate: {
      validator: async function (val) {
        // Use mongoose.model() to avoid circular-require issues
        const exists = await mongoose.model('Category')
          .exists({ slug: val.toLowerCase(), isActive: true });
        return !!exists;
      },
      message: 'Invalid or inactive category',
    },
  },
  type: {
    type:    String,
    enum:    { values: ['sell', 'rent', 'free', 'service'], message: 'Invalid type' },
    default: 'sell',
  },
  status: {
    type:    String,
    enum:    { values: ['available', 'reserved', 'sold', 'hidden', 'expired'], message: 'Invalid listing status' },
    default: 'available',
    index:   true,
  },
  moderationStatus: {
    type:    String,
    enum:    { values: ['pending', 'approved', 'rejected'], message: 'Invalid moderation status' },
    default: 'approved',
    index:   true,
  },
  moderationReason: {
    type:      String,
    trim:      true,
    maxlength: [500, 'Moderation reason must be at most 500 characters'],
    default:   '',
  },
  condition: {
    type:    String,
    enum:    { values: ['Brand New', 'Like New', 'Good', 'Fair'], message: 'Invalid condition' },
    default: 'Good',
  },
  isNegotiable: { type: Boolean, default: false },
  originalPrice: {
    type: Number,
    min:  [0, 'Original price cannot be negative'],
    max:  [500000, 'Original price cannot exceed Rs.5,00,000'],
  },
  quantity: {
    type:    Number,
    min:     [1, 'Quantity must be at least 1'],
    max:     [99, 'Quantity must be at most 99'],
    default: 1,
  },
  rentDuration: {
    type: String,
    enum: { values: ['hourly', 'daily', 'weekly', 'monthly', 'semester'], message: 'Invalid rent duration' },
  },
  brand: { type: String, default: '', trim: true, maxlength: 80 },
  model: { type: String, default: '', trim: true, maxlength: 80 },
  tags: {
    type: [String],
    validate: {
      validator: arr => arr.length <= 10,
      message:   'Maximum 10 tags allowed',
    },
    default: [],
  },
  images: {
    type:     [String],
    validate: {
      validator: arr => arr.length <= 3,
      message:   'Maximum 3 images allowed',
    },
    default: [],
  },
  coverImageIndex: {
    type:    Number,
    default: 0,
    min:     [0, 'Cover image index cannot be negative'],
    max:     [2, 'Cover image index cannot exceed the maximum image count'],
  },
  imageMetadata: {
    type: [imageMetadataSchema],
    validate: {
      validator: arr => arr.length <= 3,
      message:   'Maximum 3 images allowed',
    },
    default: [],
    select: false,
  },
  seller: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  college:  { type: String, default: '', trim: true },
  location: { type: String, default: '', trim: true, maxlength: 100 },
  pickupLocation: { type: String, default: '', trim: true, maxlength: 120 },

  views:           { type: Number, default: 0, min: 0 },
  boostedUntil:    { type: Date, default: null },
  isActive:        { type: Boolean, default: true },
  isSold:          { type: Boolean, default: false },
  flagged:         { type: Boolean, default: false },
  interestedCount: { type: Number, default: 0, min: 0 },
  savedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref:  'User',
  }],

  // TTL: auto-expire listings after 180 days
  expiresAt: {
    type:    Date,
    default: () => new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
  },
}, {
  timestamps: true,
  toJSON:     { virtuals: true },
  toObject:   { virtuals: true },
});

listingSchema.pre('save', function (next) {
  if (this.isModified('tags') && Array.isArray(this.tags)) {
    this.tags = [...new Set(
      this.tags
        .map(tag => String(tag || '').trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10)
    )];
  }
  if (this.isModified('status')) {
    this.isSold = this.status === 'sold';
    if (this.status === 'expired') this.isActive = false;
  }
  next();
});

// ── Text search index ─────────────────────────────────────────────────────────
listingSchema.index(
  { title: 'text', description: 'text', category: 'text', tags: 'text', brand: 'text', model: 'text' },
  { weights: { title: 10, tags: 8, brand: 6, model: 6, category: 5, description: 1 }, name: 'TextSearch' }
);

// ── Compound query indexes ────────────────────────────────────────────────────
listingSchema.index({ college: 1, category: 1, isActive: 1, status: 1 });
listingSchema.index({ college: 1, category: 1, status: 1, seller: 1, createdAt: -1 });
listingSchema.index({ college: 1, status: 1, createdAt: -1 });
listingSchema.index({ seller: 1,  isActive: 1 });
listingSchema.index({ seller: 1, status: 1, createdAt: -1 });
listingSchema.index({ isActive: 1, status: 1, moderationStatus: 1, createdAt: -1 });
listingSchema.index({ isActive: 1, status: 1, price: 1 });
listingSchema.index({ isActive: 1, views: -1 });
listingSchema.index({ boostedUntil: -1, isActive: 1 });
listingSchema.index({ flagged: 1 });
listingSchema.index({ tags: 1 });

// ── TTL index ─────────────────────────────────────────────────────────────────
listingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

listingSchema.virtual('coverImage').get(function () {
  return this.images?.[this.coverImageIndex || 0] || this.images?.[0] || '';
});

// ── Category listingCount hooks ───────────────────────────────────────────────
// Increment on new listing creation
listingSchema.post('save', async function (doc) {
  try {
    if (doc.isNew !== false) {
      // doc.isNew is false after first save resolves — use wasNew convention:
      // We check by looking at updatedAt === createdAt (newly created)
      const isNewDoc = doc.createdAt && doc.updatedAt &&
        Math.abs(doc.createdAt.getTime() - doc.updatedAt.getTime()) < 1000;
      if (isNewDoc) {
        await mongoose.model('Category').findOneAndUpdate(
          { slug: doc.category },
          { $inc: { listingCount: 1 } }
        );
      }
    }
  } catch (e) {
    // Non-fatal — log but don't crash
    logger.warn(`[Listing hook] post save count update failed: ${e.message}`);
  }
});

// Decrement when a listing is hard-deleted
listingSchema.post('findOneAndDelete', async function (doc) {
  if (!doc) return;
  try {
    await mongoose.model('Category').findOneAndUpdate(
      { slug: doc.category },
      { $inc: { listingCount: -1 } }
    );
  } catch (e) {
    logger.warn(`[Listing hook] post findOneAndDelete count update failed: ${e.message}`);
  }
});

// Decrement when deleteOne() is called on a document instance
listingSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  try {
    await mongoose.model('Category').findOneAndUpdate(
      { slug: doc.category },
      { $inc: { listingCount: -1 } }
    );
  } catch (e) {
    logger.warn(`[Listing hook] post deleteOne count update failed: ${e.message}`);
  }
});

module.exports = mongoose.model('Listing', listingSchema);
