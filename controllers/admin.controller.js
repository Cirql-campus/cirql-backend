'use strict';
const mongoose = require('mongoose');
const User     = require('../models/User');
const Listing  = require('../models/Listing');
const Report   = require('../models/Report');
const UserReport = require('../models/UserReport');
const MessageReport = require('../models/MessageReport');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const RefreshToken    = require('../models/RefreshToken');
const Conversation    = require('../models/Conversation');
const AuditLog = require('../models/AuditLog');
const { success, error } = require('../utils/apiResponse');
const logger   = require('../utils/logger');
const { categoryCache, listingCache, flushCacheNamespace } = require('../utils/cache');
const { logAdminAction } = require('../utils/audit');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Helper to build college filters
const collegeFilter = (scope) => scope ? { college: scope } : {};
const collegeUserFilter = (scope) => scope ? { college: scope } : {};

// ─── GET /api/v1/admin/stats ──────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  const scope = req.collegeScope; // null for super_admin, college string for college_admin
  const cf = collegeFilter(scope);   // listing/conversation college filter
  const uf = collegeUserFilter(scope); // user college filter
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totalUsers, totalListings, totalConversations, flaggedListings, signupsByDay] =
    await Promise.all([
      User.countDocuments({ ...uf, role: 'user' }),
      Listing.countDocuments(cf),
      Conversation.countDocuments(), // conversations don't have a college field — skip scoping
      Listing.countDocuments({ ...cf, flagged: true }),
      User.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo }, ...uf } },
        {
          $group: {
            _id:   { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            users: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

  return success(res, {
    metrics: { totalUsers, totalListings, totalConversations, flaggedListings },
    charts:  { signupsByDay },
  });
};

// ─── GET /api/v1/admin/dashboard ──────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  const cf = collegeFilter(req.collegeScope);
  const uf = collegeUserFilter(req.collegeScope);

  let openListingReports, openUserReports, openMessageReports, recentListingReports, recentMessageReports;

  if (req.collegeScope) {
    const [collegeListings, collegeUsers] = await Promise.all([
      Listing.find(cf).select('_id'),
      User.find(uf).select('_id'),
    ]);
    const listingIds = collegeListings.map(l => l._id);
    const userIds = collegeUsers.map(u => u._id);

    [openListingReports, openUserReports, openMessageReports] = await Promise.all([
      Report.countDocuments({ status: 'open', listing: { $in: listingIds } }),
      UserReport.countDocuments({ status: 'open', reportedUser: { $in: userIds } }),
      MessageReport.countDocuments({ status: 'open', reportedUser: { $in: userIds } }),
    ]);

    [recentListingReports, recentMessageReports] = await Promise.all([
      Report.find({ status: 'open', listing: { $in: listingIds } })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('listing', 'title price status moderationStatus flagged college')
        .populate('reporter', 'name email college')
        .lean(),
      MessageReport.find({ status: 'open', reportedUser: { $in: userIds } })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('reportedUser', 'name email college')
        .populate('reporter', 'name email college')
        .lean(),
    ]);
  } else {
    [openListingReports, openUserReports, openMessageReports] = await Promise.all([
      Report.countDocuments({ status: 'open' }),
      UserReport.countDocuments({ status: 'open' }),
      MessageReport.countDocuments({ status: 'open' }),
    ]);

    [recentListingReports, recentMessageReports] = await Promise.all([
      Report.find({ status: 'open' })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('listing', 'title price status moderationStatus flagged college')
        .populate('reporter', 'name email college')
        .lean(),
      MessageReport.find({ status: 'open' })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('reportedUser', 'name email college')
        .populate('reporter', 'name email college')
        .lean(),
    ]);
  }

  const [totalUsers, totalListings, totalConversations, pendingListings] = await Promise.all([
    User.countDocuments({ ...uf, role: 'user' }),
    Listing.countDocuments(cf),
    Conversation.countDocuments(),
    Listing.countDocuments({ ...cf, moderationStatus: 'pending' }),
  ]);

  return success(res, {
    metrics: {
      totalUsers,
      totalListings,
      totalConversations,
      openListingReports,
      openUserReports,
      openMessageReports,
      pendingListings,
    },
    queues: {
      recentListingReports,
      recentMessageReports,
    },
  });
};

// ─── GET /api/v1/admin/user-reports ──────────────────────────────────────────
exports.getUserReports = async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip  = (page - 1) * limit;
  const status = req.query.status || 'open';

  const filter = status === 'all' ? {} : { status };

  if (req.collegeScope) {
    const collegeUsers = await User.find({ college: req.collegeScope }).select('_id');
    const userIds = collegeUsers.map(u => u._id);
    filter.reportedUser = { $in: userIds };
  }

  let [reports, total] = await Promise.all([
    UserReport.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('reportedUser', 'name email college isVerified rating reviewCount')
      .populate('reporter', 'name email college isVerified')
      .lean(),
    UserReport.countDocuments(filter),
  ]);

  if (req.collegeScope) {
    reports = reports.filter(r => r.reportedUser?.college === req.collegeScope);
  }

  return success(res, {
    reports,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
};

// ─── PATCH /api/v1/admin/user-reports/:id/status ──────────────────────────────
exports.updateUserReportStatus = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid report ID', 400);

  const report = await UserReport.findById(req.params.id).populate('reportedUser');
  if (!report) return error(res, 'Report not found', 404);

  if (req.collegeScope && report.reportedUser?.college !== req.collegeScope) {
    return error(res, 'Access denied — user belongs to another college', 403);
  }

  report.status = req.body.status;
  await report.save();

  await logAdminAction(req, 'update_user_report', 'report', report._id, `Updated user report status to ${req.body.status}`);

  return success(res, { report }, 'Report updated');
};

// ─── GET /api/v1/admin/listing-reports ────────────────────────────────────────
exports.getListingReports = async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip  = (page - 1) * limit;
  const status = req.query.status || 'open';
  const filter = status === 'all' ? {} : { status };
  if (req.query.listing && isValidId(req.query.listing)) filter.listing = req.query.listing;

  if (req.collegeScope) {
    const cf = collegeFilter(req.collegeScope);
    const collegeListings = await Listing.find(cf).select('_id');
    const listingIds = collegeListings.map(l => l._id);
    if (filter.listing) {
      if (!listingIds.some(id => id.toString() === filter.listing.toString())) {
        return success(res, {
          reports: [],
          pagination: { total: 0, page, limit, totalPages: 0 },
        });
      }
    } else {
      filter.listing = { $in: listingIds };
    }
  }

  const [reports, total] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('listing', 'title price images status moderationStatus flagged seller college')
      .populate('reporter', 'name email college isVerified')
      .populate('reviewedBy', 'name email')
      .lean(),
    Report.countDocuments(filter),
  ]);

  return success(res, {
    reports,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
};

// ─── PATCH /api/v1/admin/listing-reports/:id/status ───────────────────────────
exports.updateListingReportStatus = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid report ID', 400);

  const report = await Report.findById(req.params.id).populate('listing');
  if (!report) return error(res, 'Report not found', 404);

  if (req.collegeScope && report.listing?.college !== req.collegeScope) {
    return error(res, 'Access denied — listing belongs to another college', 403);
  }

  report.status = req.body.status;
  report.actionNote = (req.body.actionNote || '').trim();
  report.reviewedBy = req.userId;
  report.reviewedAt = new Date();
  await report.save();

  await logAdminAction(req, 'update_listing_report', 'report', report._id, `Updated listing report status to ${req.body.status}`);

  return success(res, { report }, 'Listing report updated');
};

// ─── GET /api/v1/admin/message-reports ────────────────────────────────────────
exports.getMessageReports = async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip  = (page - 1) * limit;
  const status = req.query.status || 'open';
  const filter = status === 'all' ? {} : { status };
  if (req.query.message && isValidId(req.query.message)) filter.message = req.query.message;

  if (req.collegeScope) {
    const collegeUsers = await User.find({ college: req.collegeScope }).select('_id');
    const userIds = collegeUsers.map(u => u._id);
    filter.reportedUser = { $in: userIds };
  }

  let [reports, total] = await Promise.all([
    MessageReport.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('message', 'text flagged hiddenByAdmin createdAt')
      .populate('conversation', 'listing participants')
      .populate('reporter', 'name email college isVerified')
      .populate('reportedUser', 'name email college isVerified')
      .populate('reviewedBy', 'name email')
      .lean(),
    MessageReport.countDocuments(filter),
  ]);

  if (req.collegeScope) {
    reports = reports.filter(r => r.reportedUser?.college === req.collegeScope);
  }

  return success(res, {
    reports,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
};

// ─── PATCH /api/v1/admin/message-reports/:id/status ───────────────────────────
exports.updateMessageReportStatus = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid report ID', 400);

  const report = await MessageReport.findById(req.params.id).populate('reportedUser');
  if (!report) return error(res, 'Report not found', 404);

  if (req.collegeScope && report.reportedUser?.college !== req.collegeScope) {
    return error(res, 'Access denied — message sender belongs to another college', 403);
  }

  report.status = req.body.status;
  report.actionNote = (req.body.actionNote || '').trim();
  report.reviewedBy = req.userId;
  report.reviewedAt = new Date();
  await report.save();

  if (req.body.hiddenByAdmin !== undefined) {
    await Message.findByIdAndUpdate(report.message, {
      hiddenByAdmin: Boolean(req.body.hiddenByAdmin),
      hiddenReason: (req.body.hiddenReason || '').trim(),
    });
  }

  await logAdminAction(req, 'update_message_report', 'report', report._id, `Updated message report status to ${req.body.status}`);

  return success(res, { report }, 'Message report updated');
};

// ─── GET /api/v1/admin/flagged-listings ───────────────────────────────────────
exports.getFlaggedListings = async (req, res) => {
  const page  = Math.max(1,  parseInt(req.query.page, 10)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip  = (page - 1) * limit;
  const cf = collegeFilter(req.collegeScope);

  const [listings, total] = await Promise.all([
    Listing.find({ flagged: true, ...cf })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('seller', 'name email college isVerified')
      .lean(),
    Listing.countDocuments({ flagged: true, ...cf }),
  ]);

  return success(res, {
    listings,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
};

// ─── GET /api/v1/admin/moderation-listings ────────────────────────────────────
exports.getModerationListings = async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip  = (page - 1) * limit;
  const status = req.query.status || 'pending';
  const cf = collegeFilter(req.collegeScope);

  const [listings, total] = await Promise.all([
    Listing.find({ moderationStatus: status, ...cf })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('seller', 'name email college isVerified rating reviewCount')
      .lean(),
    Listing.countDocuments({ moderationStatus: status, ...cf }),
  ]);

  return success(res, {
    listings,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
};

// ─── PATCH /api/v1/admin/listings/:id/moderation ──────────────────────────────
exports.updateListingModeration = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);

  const listing = await Listing.findById(req.params.id);
  if (!listing) return error(res, 'Listing not found', 404);

  if (req.collegeScope && listing.college !== req.collegeScope) {
    return error(res, 'Access denied — listing belongs to another college', 403);
  }

  const { moderationStatus, moderationReason = '' } = req.body;
  
  listing.moderationStatus = moderationStatus;
  listing.moderationReason = moderationReason.trim();
  listing.isActive = moderationStatus === 'approved';
  listing.status = moderationStatus === 'approved' ? 'available' : 'hidden';

  await listing.save();

  const notification = await Notification.create({
    user: listing.seller,
    type: 'moderation',
    text: moderationStatus === 'approved'
      ? 'Your listing has been approved.'
      : `Your listing was ${moderationStatus}.`,
    link: `/listings/${listing._id}`,
  });

  try {
    const { getIO } = require('../config/socket');
    getIO().to(`user_${listing.seller}`).emit('new_notification', { notification });
  } catch (socketErr) {
    logger.warn(`Admin moderation socket emit failed: ${socketErr.message}`);
  }

  await Promise.all([
    flushCacheNamespace(listingCache, 'listings'),
    flushCacheNamespace(categoryCache, 'categories'),
  ]);

  await logAdminAction(req, 'moderate_listing', 'listing', listing._id, `Listing status updated to ${moderationStatus}`);

  return success(res, { listing }, 'Listing moderation updated');
};

// ─── PUT /api/v1/admin/listings/:id/unflag ────────────────────────────────────
exports.unflagListing = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);

  const listing = await Listing.findById(req.params.id);
  if (!listing) return error(res, 'Listing not found', 404);

  if (req.collegeScope && listing.college !== req.collegeScope) {
    return error(res, 'Access denied — listing belongs to another college', 403);
  }

  listing.flagged = false;
  await listing.save();

  await Report.deleteMany({ listing: listing._id });
  await flushCacheNamespace(listingCache, 'listings');

  await logAdminAction(req, 'unflag_listing', 'listing', listing._id, 'Unflagged listing and cleared reports');

  return success(res, null, 'Listing unflagged and reports cleared');
};

// ─── DELETE /api/v1/admin/listings/:id ────────────────────────────────────────
exports.deleteListing = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);

  const listing = await Listing.findById(req.params.id);
  if (!listing) return error(res, 'Listing not found', 404);

  if (req.collegeScope && listing.college !== req.collegeScope) {
    return error(res, 'Access denied — listing belongs to another college', 403);
  }

  await Promise.all([
    listing.deleteOne(),
    User.findByIdAndUpdate(listing.seller, { $inc: { listingCount: -1 } }),
    Report.deleteMany({ listing: listing._id }),
  ]);

  if (listing.images && listing.images.length > 0) {
    const cloudinary = require('../config/cloudinary');
    Promise.all(
      listing.images.map(url => {
        const match = url.match(/\/v\d+\/(cirql\/.+?)(?:\.\w+)?$/);
        return match ? cloudinary.uploader.destroy(match[1]) : Promise.resolve();
      })
    ).catch(e =>
      logger.warn(`Cloudinary cleanup failed for ${listing._id}: ${e.message}`)
    );
  }

  await flushCacheNamespace(listingCache, 'listings');

  await logAdminAction(req, 'delete_listing', 'listing', listing._id, `Deleted listing: ${listing.title}`);

  return success(res, null, 'Listing permanently removed');
};

// ─── GET /api/v1/admin/users ──────────────────────────────────────────────────
exports.getUsers = async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip   = (page - 1) * limit;
  const { search } = req.query;

  const uf = collegeUserFilter(req.collegeScope);
  const filter = { ...uf };

  if (search) {
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60);
    filter.$or = [
      { name: new RegExp(safe, 'i') },
      { email: new RegExp(safe, 'i') },
      { collegeDomain: new RegExp(safe, 'i') },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .select('name email college collegeDomain isVerified role createdAt listingCount')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  return success(res, {
    users,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
};

// ─── PUT /api/v1/admin/users/:id/ban ──────────────────────────────────────────
exports.banUser = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid user ID', 400);
  if (req.params.id === req.userId) return error(res, 'Cannot ban yourself', 400);

  const user = await User.findById(req.params.id).select('+tokenVersion');
  if (!user) return error(res, 'User not found', 404);

  if (req.collegeScope && user.college !== req.collegeScope) {
    return error(res, 'Access denied — user belongs to another college', 403);
  }

  if (user.role === 'super_admin' || user.role === 'college_admin') {
    return error(res, 'Cannot ban another admin', 403);
  }

  user.isVerified   = false;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  await Promise.all([
    RefreshToken.deleteMany({ userId: user._id }),
    Listing.updateMany({ seller: user._id }, { isActive: false }),
  ]);

  await flushCacheNamespace(listingCache, 'listings');

  await logAdminAction(req, 'ban_user', 'user', user._id, `Banned user: ${user.email}`);

  return success(res, null, 'User banned — all sessions invalidated and listings deactivated');
};

// ─── PUT /api/v1/admin/users/:id/unban ────────────────────────────────────────
exports.unbanUser = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid user ID', 400);

  const user = await User.findById(req.params.id);
  if (!user) return error(res, 'User not found', 404);

  if (req.collegeScope && user.college !== req.collegeScope) {
    return error(res, 'Access denied — user belongs to another college', 403);
  }

  user.isVerified = true;
  await user.save();

  await logAdminAction(req, 'unban_user', 'user', user._id, `Unbanned user: ${user.email}`);

  return success(res, null, 'User reinstated successfully');
};


// ==========================================
// PART 4 — New Super Admin Endpoints
// ==========================================

// GET /api/v1/admin/college-admins — list all college admins (super_admin only)
exports.getCollegeAdmins = async (req, res) => {
  const admins = await User.find({ role: 'college_admin' })
    .select('name email college adminCollege createdAt isVerified')
    .sort({ adminCollege: 1 })
    .lean();
  return success(res, { admins });
};

// POST /api/v1/admin/college-admins — promote a user to college_admin (super_admin only)
exports.promoteCollegeAdmin = async (req, res) => {
  const { email, college } = req.body;
  if (!email || !college) return error(res, 'email and college are required', 400);

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) return error(res, 'User not found. They must have an account on CirQl first.', 404);
  if (user.role === 'super_admin') return error(res, 'Cannot demote a super admin this way', 400);

  // Check no other college_admin already manages this college
  const existing = await User.findOne({ role: 'college_admin', adminCollege: college });
  if (existing && existing._id.toString() !== user._id.toString()) {
    return error(res, `${college} already has a college admin (${existing.email}). Dismiss them first.`, 409);
  }

  user.role = 'college_admin';
  user.adminCollege = college;
  await user.save();

  // Notify the user
  await Notification.create({
    user: user._id,
    type: 'deal', // reuse existing type
    text: `You have been made the admin for ${college} on CirQl.`,
    link: '/admin',
  });

  await logAdminAction(req, 'promote_admin', 'admin', user._id, `Promoted ${email} to college_admin of ${college}`);
  logger.info(`[SUPER_ADMIN] ${req.user.email} promoted ${email} to college_admin for ${college}`);
  return success(res, { message: `${email} is now the admin for ${college}`, user: user.toPublicJSON() });
};

// DELETE /api/v1/admin/college-admins/:id — dismiss a college admin (super_admin only)
exports.dismissCollegeAdmin = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return error(res, 'User not found', 404);
  if (user.role !== 'college_admin') return error(res, 'User is not a college admin', 400);

  const wasAdminOf = user.adminCollege;
  user.role = 'user';
  user.adminCollege = null;
  await user.save();

  await logAdminAction(req, 'dismiss_admin', 'admin', user._id, `Dismissed admin of ${wasAdminOf} (${user.email})`);
  logger.info(`[SUPER_ADMIN] ${req.user.email} dismissed ${user.email} as admin of ${wasAdminOf}`);
  return success(res, { message: `${user.email} has been removed as admin of ${wasAdminOf}` });
};

// GET /api/v1/admin/super-stats — cross-college overview (super_admin only)
exports.getSuperStats = async (req, res) => {
  const [collegeStats, collegeAdmins] = await Promise.all([
    Listing.aggregate([
      { $group: {
        _id: '$college',
        totalListings: { $sum: 1 },
        activeListings: { $sum: { $cond: ['$isActive', 1, 0] } },
        flaggedListings: { $sum: { $cond: ['$flagged', 1, 0] } },
      }},
      { $sort: { totalListings: -1 } },
    ]),
    User.find({ role: 'college_admin' }).select('email adminCollege').lean(),
  ]);

  // Merge listings stats with user stats by college name
  const usersByCollege = Object.fromEntries(
    (await User.aggregate([{ $group: { _id: '$college', count: { $sum: 1 } } }]))
      .map(r => [r._id, r.count])
  );

  const result = collegeStats.map(c => ({
    college: c._id,
    totalUsers: usersByCollege[c._id] || 0,
    totalListings: c.totalListings,
    activeListings: c.activeListings,
    flaggedListings: c.flaggedListings,
    hasAdmin: collegeAdmins.some(a => a.adminCollege === c._id),
    adminEmail: collegeAdmins.find(a => a.adminCollege === c._id)?.email || null,
  }));

  return success(res, { colleges: result });
};

// GET /api/v1/admin/audit-log — show all admin actions (super_admin only)
exports.getAuditLog = async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const skip  = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    AuditLog.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('adminId', 'name email')
      .lean(),
    AuditLog.countDocuments(),
  ]);

  return success(res, {
    logs,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
};


// ==========================================
// PART 6 — Additional Admin Endpoints
// ==========================================

// POST /api/v1/admin/listings/bulk-action — bulk moderate/delete listings (college scoped)
exports.bulkActionListings = async (req, res) => {
  const { ids, action } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return error(res, 'ids array is required', 400);
  }
  if (ids.length > 10) {
    return error(res, 'Bulk actions are limited to 10 listings at once', 400);
  }
  if (!['delete', 'approve', 'reject'].includes(action)) {
    return error(res, 'Invalid action', 400);
  }

  // Fetch target listings to verify college scope
  const listings = await Listing.find({ _id: { $in: ids } });
  if (listings.length === 0) {
    return error(res, 'No listings found', 404);
  }

  if (req.collegeScope) {
    const invalidListings = listings.filter(l => l.college !== req.collegeScope);
    if (invalidListings.length > 0) {
      return error(res, 'Access denied — some listings belong to another college', 403);
    }
  }

  if (action === 'delete') {
    await Promise.all(listings.map(async (listing) => {
      await Promise.all([
        listing.deleteOne(),
        User.findByIdAndUpdate(listing.seller, { $inc: { listingCount: -1 } }),
        Report.deleteMany({ listing: listing._id }),
      ]);

      if (listing.images && listing.images.length > 0) {
        const cloudinary = require('../config/cloudinary');
        Promise.all(
          listing.images.map(url => {
            const match = url.match(/\/v\d+\/(cirql\/.+?)(?:\.\w+)?$/);
            return match ? cloudinary.uploader.destroy(match[1]) : Promise.resolve();
          })
        ).catch(e =>
          logger.warn(`Cloudinary cleanup failed for ${listing._id}: ${e.message}`)
        );
      }

      await logAdminAction(req, 'delete_listing', 'listing', listing._id, `Bulk deleted listing: ${listing.title}`);
    }));

    await flushCacheNamespace(listingCache, 'listings');
    return success(res, null, `Successfully deleted ${listings.length} listings`);

  } else {
    // approve or reject
    const moderationStatus = action === 'approve' ? 'approved' : 'rejected';
    const update = {
      moderationStatus,
      moderationReason: 'Bulk moderated by admin',
      isActive: moderationStatus === 'approved',
      status: moderationStatus === 'approved' ? 'available' : 'hidden',
    };

    await Promise.all(listings.map(async (listing) => {
      listing.moderationStatus = moderationStatus;
      listing.moderationReason = update.moderationReason;
      listing.isActive = update.isActive;
      listing.status = update.status;
      await listing.save();

      const notification = await Notification.create({
        user: listing.seller,
        type: 'moderation',
        text: moderationStatus === 'approved'
          ? 'Your listing has been approved.'
          : `Your listing was rejected.`,
        link: `/listings/${listing._id}`,
      });

      try {
        const { getIO } = require('../config/socket');
        getIO().to(`user_${listing.seller}`).emit('new_notification', { notification });
      } catch (socketErr) {
        logger.warn(`Admin moderation socket emit failed: ${socketErr.message}`);
      }

      await logAdminAction(req, `bulk_${action}_listing`, 'listing', listing._id, `Bulk ${action}d listing: ${listing.title}`);
    }));

    await Promise.all([
      flushCacheNamespace(listingCache, 'listings'),
      flushCacheNamespace(categoryCache, 'categories'),
    ]);

    return success(res, null, `Successfully ${action}d ${listings.length} listings`);
  }
};

// POST /api/v1/admin/notify-college — college-wide broadcast notification
exports.notifyCollege = async (req, res) => {
  const { text, link } = req.body;
  if (!text) return error(res, 'text is required', 400);

  // Check last broadcast for this college in last 24 hours
  const lastBroadcast = await AuditLog.findOne({
    action: 'broadcast_notification',
    adminCollege: req.collegeScope || null,
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });
  if (lastBroadcast) return error(res, 'You can only send one broadcast per 24 hours', 429);

  // Find users in scope
  const uf = collegeUserFilter(req.collegeScope);
  const users = await User.find({ ...uf, role: 'user' }).select('_id');
  if (users.length === 0) {
    return success(res, null, 'No users to notify');
  }

  // Create notifications in bulk
  const notifications = users.map(u => ({
    user: u._id,
    type: 'deal', // reuse existing type
    text: text.slice(0, 200),
    link: (link || '').slice(0, 200),
  }));

  await Notification.insertMany(notifications);

  await logAdminAction(
    req,
    'broadcast_notification',
    null,
    null,
    `Broadcasted message to ${req.collegeScope || 'all colleges'}: "${text}"`
  );

  return success(res, null, `Broadcast sent to ${users.length} users`);
};
