'use strict';
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');

// Cost factor: 10 = ~150ms/hash (secure & fast); 12 = ~600ms (too slow for UX)
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 10;

const DEFAULT_NOTIFICATION_PREFERENCES = {
  pushEnabled:    true,
  messages:       true,
  deals:          true,
  wanted:         true,
  moderation:     true,
  messagePreview: false,
};

const userSchema = new mongoose.Schema({
  name: {
    type:      String,
    required:  [true, 'Name is required'],
    trim:      true,
    minlength: [2,  'Name must be at least 2 characters'],
    maxlength: [60, 'Name must be at most 60 characters'],
  },
  email: {
    type:      String,
    required:  [true, 'Email is required'],
    unique:    true,
    lowercase: true,
    trim:      true,
    match:     [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
  },
  password: {
    type:      String,
    required:  [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select:    false,
  },
  college:       { type: String, default: '', trim: true },
  collegeDomain: { type: String, default: '', lowercase: true, trim: true },
  initials:      { type: String, default: '' },
  avatar:        { type: String, default: '' },

  isVerified: { type: Boolean, default: false },

  // Manual verification fields (Path B only)
  registrationMethod: {
    type: String,
    enum: ['college_email', 'manual_verification'],
    default: 'college_email',
  },
  verificationStatus: {
    type: String,
    enum: ['not_required', 'pending', 'approved', 'rejected'],
    default: 'not_required',
  },
  rollNumber: {
    type: String,
    trim: true,
    set: value => {
      const normalized = String(value || '').trim().toUpperCase();
      return normalized || undefined;
    },
  },
  idPhotoUrl: {
    type: String,
    default: null,
  },
  verificationNote: {
    type: String, // admin can add a rejection reason
    default: null,
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  verifiedAt: {
    type: Date,
    default: null,
  },

  // OTP stored as SHA-256 hash — never plain text
  verifyOTPHash:   { type: String, select: false },
  verifyOTPExpiry: { type: Date,   select: false },
  otpAttempts:     { type: Number, default: 0, select: false },

  // Password-reset token stored as SHA-256 hash
  resetPasswordHash:   { type: String, select: false },
  resetPasswordExpiry: { type: Date,   select: false },

  rating:       { type: Number, default: 5.0, min: 0, max: 5 },
  reviewCount:  { type: Number, default: 0 },
  listingCount: { type: Number, default: 0 },
  soldCount:    { type: Number, default: 0 },

  // Points system
  totalPoints:    { type: Number, default: 0, min: 0 },
  lifetimePoints: { type: Number, default: 0, min: 0 },
  tier: {
    type: String,
    enum: ['new', 'regular', 'trusted', 'star_seller', 'campus_legend'],
    default: 'new',
  },
  lastCheckIn:   { type: Date, default: null },
  checkInStreak: { type: Number, default: 0 },
  wishlist: [{
    type: mongoose.Schema.Types.ObjectId,
    ref:  'Listing',
  }],
  agreedToTermsAt: { type: Date, default: null },

  role: {
    type: String,
    enum: ['user', 'admin', 'college_admin', 'super_admin'],
    default: 'user',
  },
  adminCollege: {
    type: String,
    default: null,
    trim: true,
  },

  // Account lockout
  failedLoginAttempts: { type: Number, default: 0, select: false },
  lockUntil:           { type: Date, select: false },

  // Bump to invalidate all existing JWTs for this user
  tokenVersion: { type: Number, default: 0, select: false },

  // Web Push Subscriptions
  pushSubscriptions: { type: [Object], default: [] },
  notificationPreferences: {
    pushEnabled:    { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.pushEnabled },
    messages:       { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.messages },
    deals:          { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.deals },
    wanted:         { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.wanted },
    moderation:     { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.moderation },
    messagePreview: { type: Boolean, default: DEFAULT_NOTIFICATION_PREFERENCES.messagePreview },
  },
}, {
  timestamps: true,
  toJSON:    { virtuals: true },
  toObject:  { virtuals: true },
});


// ── Indexes ───────────────────────────────────────────────────────────────────
// email has unique: true in schema definition — Mongoose creates this automatically
userSchema.index({ collegeDomain: 1 });
userSchema.index({ isVerified: 1 });
userSchema.index({ role: 1 });
userSchema.index({ role: 1, adminCollege: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ rollNumber: 1, college: 1 }, {
  unique: true,
  partialFilterExpression: { rollNumber: { $type: 'string' } },
});
userSchema.index({ totalPoints: -1 });
userSchema.index({ lifetimePoints: -1 });

// ── Pre-save hooks ────────────────────────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
  }
  if (this.isModified('name') && this.name) {
    this.initials = this.name
      .trim()
      .split(/\s+/)
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
  next();
});

// ── Instance methods ──────────────────────────────────────────────────────────
userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

/** Generate a 6-digit OTP, store its SHA-256 hash */
userSchema.methods.createOTP = function () {
  const otp            = String(crypto.randomInt(100000, 1000000));
  this.verifyOTPHash   = crypto.createHash('sha256').update(otp).digest('hex');
  this.verifyOTPExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  this.otpAttempts     = 0;
  return otp;
};

/** Verify a plain-text OTP against the stored hash */
userSchema.methods.verifyOTP = function (candidate) {
  const hash = crypto.createHash('sha256').update(String(candidate)).digest('hex');
  return this.verifyOTPHash === hash && this.verifyOTPExpiry > new Date();
};

/** Return a safe public object — strips all sensitive fields */
userSchema.methods.toPublicJSON = function () {
  return {
    _id:           this._id,
    name:          this.name,
    email:         this.email,
    college:       this.college,
    collegeDomain: this.collegeDomain,
    initials:      this.initials,
    avatar:        this.avatar,
    role:          this.role,
    adminCollege:  this.adminCollege,
    isVerified:    this.isVerified,
    verificationStatus: this.verificationStatus,
    registrationMethod: this.registrationMethod,
    rollNumber:         this.rollNumber,
    idPhotoUrl:         this.idPhotoUrl,
    rating:        this.rating,
    reviewCount:   this.reviewCount,
    listingCount:  this.listingCount,
    soldCount:     this.soldCount,
    totalPoints:    this.totalPoints    || 0,
    lifetimePoints: this.lifetimePoints || 0,
    tier:           this.tier           || 'new',
    lastCheckIn:    this.lastCheckIn    || null,
    checkInStreak:  this.checkInStreak  || 0,
    wishlist:      this.wishlist,
    notificationPreferences: {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(this.notificationPreferences?.toObject?.() || this.notificationPreferences || {}),
    },
    pushSubscriptionCount: this.pushSubscriptions?.length || 0,
    agreedToTermsAt: this.agreedToTermsAt,
    createdAt:     this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
