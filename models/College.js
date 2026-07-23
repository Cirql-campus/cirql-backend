'use strict';
const mongoose = require('mongoose');

const collegeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'College name is required'],
    unique: true,
    trim: true,
  },
  domain: {
    type: String,
    required: [true, 'Email domain is required'],
    unique: true,
    lowercase: true,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('College', collegeSchema);
