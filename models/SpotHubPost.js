'use strict';

const mongoose = require('mongoose');

const spotHubPostSchema = new mongoose.Schema({
  placeName: {
    type: String,
    required: [true, 'Place name is required'],
    trim: true,
    minlength: [2, 'Place name must be at least 2 characters'],
    maxlength: [80, 'Place name must be at most 80 characters'],
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [400, 'Description must be at most 400 characters'],
  },
  tags: {
    type: [String],
    validate: {
      validator: arr => arr.length <= 5,
      message: 'Maximum 5 tags allowed',
    },
    default: [],
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: ['food', 'shop', 'hangout', 'services', 'other'],
    lowercase: true,
    trim: true,
    index: true,
  },
  images: {
    type: [String],
    validate: {
      validator: function (v) {
        return Array.isArray(v) && v.length >= 1 && v.length <= 3;
      },
      message: 'Between 1 and 3 images are required',
    },
  },
  poster: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  college: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  upvotes: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    default: [],
  },
  downvotes: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    default: [],
  },
  status: {
    type: String,
    enum: ['active', 'flagged', 'removed'],
    default: 'active',
    index: true,
  },
  isOutdated: {
    type: Boolean,
    default: false,
    index: true,
  },
  comments: {
    type: [{
      poster: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      text: {
        type: String,
        required: true,
        trim: true,
        maxlength: 500,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      }
    }],
    default: [],
  },
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

spotHubPostSchema.pre('save', function (next) {
  if (this.isModified('tags') && Array.isArray(this.tags)) {
    this.tags = [...new Set(
      this.tags
        .map(tag => String(tag || '').trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 5)
    )];
  }
  next();
});

spotHubPostSchema.virtual('voteScore').get(function () {
  const up = this.upvotes ? this.upvotes.length : 0;
  const down = this.downvotes ? this.downvotes.length : 0;
  return up - down;
});

// Text Search Index
spotHubPostSchema.index(
  { placeName: 'text', description: 'text', tags: 'text' },
  { weights: { placeName: 10, tags: 5, description: 1 }, name: 'SpotTextSearch' }
);

spotHubPostSchema.index({ college: 1, status: 1, createdAt: -1 });
spotHubPostSchema.index({ poster: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('SpotHubPost', spotHubPostSchema);
