'use strict';
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Conversation',
    required: true,
    index:    true,
  },
  sender: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  text: {
    type:      String,
    required:  [true, 'Message text is required'],
    trim:      true,
    maxlength: [1000, 'Message must be at most 1000 characters'],
  },
  read: { type: Boolean, default: false },
  flagged: { type: Boolean, default: false, index: true },
  hiddenByAdmin: { type: Boolean, default: false, index: true },
  hiddenReason: { type: String, default: '', trim: true, maxlength: 300 },
}, {
  timestamps: true,
});

messageSchema.index({ conversation: 1, createdAt: 1 });
messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ conversation: 1, sender: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
