'use strict';
const mongoose = require('mongoose');

const savedSearchSchema = new mongoose.Schema({
  user: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    index:    true,
  },
  name: {
    type:      String,
    trim:      true,
    maxlength: [80, 'Saved search name must be at most 80 characters'],
    default:   '',
  },
  query: {
    type:      String,
    trim:      true,
    maxlength: [100, 'Search query must be at most 100 characters'],
    default:   '',
  },
  category: {
    type: String,
    enum: ['academia', 'tech', 'rides', 'living', 'attire', 'misc', ''],
    default: '',
  },
  type: {
    type: String,
    enum: ['sell', 'rent', 'free', ''],
    default: '',
  },
  minPrice: { type: Number, min: 0 },
  maxPrice: { type: Number, min: 0 },
  condition: {
    type: String,
    enum: ['Brand New', 'Like New', 'Good', 'Fair', ''],
    default: '',
  },
  location: { type: String, trim: true, maxlength: 60, default: '' },
  tags: {
    type: [String],
    validate: {
      validator: arr => arr.length <= 10,
      message: 'Maximum 10 tags allowed',
    },
    default: [],
  },
  alertsEnabled: { type: Boolean, default: true },
  lastNotifiedAt: { type: Date },
}, { timestamps: true });

savedSearchSchema.index({ user: 1, createdAt: -1 });
savedSearchSchema.index({ alertsEnabled: 1, category: 1, type: 1 });

savedSearchSchema.pre('save', function (next) {
  if (this.isModified('tags') && Array.isArray(this.tags)) {
    this.tags = [...new Set(
      this.tags.map(tag => String(tag || '').trim().toLowerCase()).filter(Boolean).slice(0, 10)
    )];
  }
  next();
});

module.exports = mongoose.model('SavedSearch', savedSearchSchema);
