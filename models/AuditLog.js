'use strict';
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  adminId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  adminEmail: { 
    type: String, 
    required: true 
  },
  adminCollege: { 
    type: String, 
    default: null 
  }, // null = super_admin
  action: { 
    type: String, 
    required: true 
  }, // 'ban_user', 'delete_listing', 'promote_admin', etc.
  targetType: { 
    type: String, 
    enum: ['user', 'listing', 'report', 'admin'] 
  },
  targetId: { 
    type: mongoose.Schema.Types.ObjectId 
  },
  details: { 
    type: String 
  },
  createdAt: { 
    type: Date, 
    default: Date.now, 
    expires: 90 * 24 * 60 * 60 // auto-delete after 90 days
  },
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
