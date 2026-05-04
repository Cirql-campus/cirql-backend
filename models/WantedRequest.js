'use strict';

const mongoose = require('mongoose');

const wantedRequestSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    minlength: [3, 'Title must be at least 3 characters'],
    maxlength: [100, 'Title must be at most 100 characters'],
  },
  description: {
    type: String,
    default: '',
    trim: true,
    maxlength: [1000, 'Description must be at most 1000 characters'],
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: ['academia', 'tech', 'rides', 'living', 'attire', 'misc'],
    lowercase: true,
    trim: true,
    index: true,
  },
  minBudget: {
    type: Number,
    min: [0, 'Minimum budget cannot be negative'],
    max: [500000, 'Minimum budget cannot exceed 500000'],
  },
  maxBudget: {
    type: Number,
    min: [0, 'Maximum budget cannot be negative'],
    max: [500000, 'Maximum budget cannot exceed 500000'],
  },
  urgency: {
    type: String,
    enum: ['anytime', 'this_week', 'urgent'],
    default: 'anytime',
    index: true,
  },
  college: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['open', 'fulfilled', 'closed'],
    default: 'open',
    index: true,
  },
  responseCount: {
    type: Number,
    default: 0,
    min: 0,
  },
}, { timestamps: true });

wantedRequestSchema.pre('validate', function (next) {
  if (this.minBudget !== undefined && this.maxBudget !== undefined && this.maxBudget < this.minBudget) {
    this.invalidate('maxBudget', 'Maximum budget must be greater than or equal to minimum budget');
  }
  next();
});

wantedRequestSchema.index({ college: 1, status: 1, createdAt: -1 });
wantedRequestSchema.index({ requester: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('WantedRequest', wantedRequestSchema);
