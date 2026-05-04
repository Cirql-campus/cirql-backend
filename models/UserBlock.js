'use strict';
const mongoose = require('mongoose');

const userBlockSchema = new mongoose.Schema({
  blocker: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  blocked: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  reason: {
    type:      String,
    trim:      true,
    maxlength: [300, 'Reason must be at most 300 characters'],
    default:   '',
  },
}, { timestamps: true });

userBlockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
userBlockSchema.index({ blocked: 1 });

module.exports = mongoose.model('UserBlock', userBlockSchema);
