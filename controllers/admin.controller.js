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
const { success, error } = require('../utils/apiResponse');
const logger   = require('../utils/logger');
const { categoryCache, listingCache, flushCacheNamespace } = require('../utils/cache');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ─── GET /api/v1/admin/stats ──────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [totalUsers, totalListings, totalConversations, flaggedListings, signupsByDay] =
      await Promise.all([
        User.countDocuments(),
        Listing.countDocuments(),
        Conversation.countDocuments(),
        Listing.countDocuments({ flagged: true }),
        User.aggregate([
          { $match: { createdAt: { $gte: sevenDaysAgo } } },
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
  } catch (err) {
    logger.error(`[${req.requestId}] getStats: ${err.message}`, err);
    return error(res, 'Failed to generate stats', 500);
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const [
      totalUsers,
      totalListings,
      totalConversations,
      openListingReports,
      openUserReports,
      openMessageReports,
      pendingListings,
      recentListingReports,
      recentMessageReports,
    ] = await Promise.all([
      User.countDocuments(),
      Listing.countDocuments(),
      Conversation.countDocuments(),
      Report.countDocuments({ status: 'open' }),
      UserReport.countDocuments({ status: 'open' }),
      MessageReport.countDocuments({ status: 'open' }),
      Listing.countDocuments({ moderationStatus: 'pending' }),
      Report.find({ status: 'open' })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('listing', 'title price status moderationStatus flagged')
        .populate('reporter', 'name email college')
        .lean(),
      MessageReport.find({ status: 'open' })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('reportedUser', 'name email college')
        .populate('reporter', 'name email college')
        .lean(),
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
  } catch (err) {
    logger.error(`[${req.requestId}] getDashboard: ${err.message}`, err);
    return error(res, 'Failed to load admin dashboard', 500);
  }
};

exports.getUserReports = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip  = (page - 1) * limit;
    const status = req.query.status || 'open';

    const filter = status === 'all' ? {} : { status };

    const [reports, total] = await Promise.all([
      UserReport.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('reportedUser', 'name email college isVerified rating reviewCount')
        .populate('reporter', 'name email college isVerified')
        .lean(),
      UserReport.countDocuments(filter),
    ]);

    return success(res, {
      reports,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error(`[${req.requestId}] getUserReports: ${err.message}`, err);
    return error(res, 'Failed to fetch user reports', 500);
  }
};

exports.updateUserReportStatus = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid report ID', 400);

    const report = await UserReport.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true, runValidators: true }
    );
    if (!report) return error(res, 'Report not found', 404);

    return success(res, { report }, 'Report updated');
  } catch (err) {
    logger.error(`[${req.requestId}] updateUserReportStatus: ${err.message}`, err);
    return error(res, 'Failed to update user report', 500);
  }
};

exports.getListingReports = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip  = (page - 1) * limit;
    const status = req.query.status || 'open';
    const filter = status === 'all' ? {} : { status };
    if (req.query.listing && isValidId(req.query.listing)) filter.listing = req.query.listing;

    const [reports, total] = await Promise.all([
      Report.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('listing', 'title price images status moderationStatus flagged seller')
        .populate('reporter', 'name email college isVerified')
        .populate('reviewedBy', 'name email')
        .lean(),
      Report.countDocuments(filter),
    ]);

    return success(res, {
      reports,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error(`[${req.requestId}] getListingReports: ${err.message}`, err);
    return error(res, 'Failed to fetch listing reports', 500);
  }
};

exports.updateListingReportStatus = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid report ID', 400);

    const report = await Report.findByIdAndUpdate(
      req.params.id,
      {
        status: req.body.status,
        actionNote: (req.body.actionNote || '').trim(),
        reviewedBy: req.userId,
        reviewedAt: new Date(),
      },
      { new: true, runValidators: true }
    );
    if (!report) return error(res, 'Report not found', 404);

    return success(res, { report }, 'Listing report updated');
  } catch (err) {
    logger.error(`[${req.requestId}] updateListingReportStatus: ${err.message}`, err);
    return error(res, 'Failed to update listing report', 500);
  }
};

exports.getMessageReports = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip  = (page - 1) * limit;
    const status = req.query.status || 'open';
    const filter = status === 'all' ? {} : { status };
    if (req.query.message && isValidId(req.query.message)) filter.message = req.query.message;

    const [reports, total] = await Promise.all([
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

    return success(res, {
      reports,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error(`[${req.requestId}] getMessageReports: ${err.message}`, err);
    return error(res, 'Failed to fetch message reports', 500);
  }
};

exports.updateMessageReportStatus = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid report ID', 400);

    const report = await MessageReport.findByIdAndUpdate(
      req.params.id,
      {
        status: req.body.status,
        actionNote: (req.body.actionNote || '').trim(),
        reviewedBy: req.userId,
        reviewedAt: new Date(),
      },
      { new: true, runValidators: true }
    );
    if (!report) return error(res, 'Report not found', 404);

    if (req.body.hiddenByAdmin !== undefined) {
      await Message.findByIdAndUpdate(report.message, {
        hiddenByAdmin: Boolean(req.body.hiddenByAdmin),
        hiddenReason: (req.body.hiddenReason || '').trim(),
      });
    }

    return success(res, { report }, 'Message report updated');
  } catch (err) {
    logger.error(`[${req.requestId}] updateMessageReportStatus: ${err.message}`, err);
    return error(res, 'Failed to update message report', 500);
  }
};

// ─── GET /api/v1/admin/flagged-listings ───────────────────────────────────────
exports.getFlaggedListings = async (req, res) => {
  try {
    const page  = Math.max(1,  parseInt(req.query.page, 10)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip  = (page - 1) * limit;

    const [listings, total] = await Promise.all([
      Listing.find({ flagged: true })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('seller', 'name email college isVerified')
        .lean(),
      Listing.countDocuments({ flagged: true }),
    ]);

    return success(res, {
      listings,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error(`[${req.requestId}] getFlaggedListings: ${err.message}`, err);
    return error(res, 'Failed to fetch flagged listings', 500);
  }
};

exports.getModerationListings = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip  = (page - 1) * limit;
    const status = req.query.status || 'pending';

    const [listings, total] = await Promise.all([
      Listing.find({ moderationStatus: status })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('seller', 'name email college isVerified rating reviewCount')
        .lean(),
      Listing.countDocuments({ moderationStatus: status }),
    ]);

    return success(res, {
      listings,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error(`[${req.requestId}] getModerationListings: ${err.message}`, err);
    return error(res, 'Failed to fetch moderation listings', 500);
  }
};

exports.updateListingModeration = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);

    const { moderationStatus, moderationReason = '' } = req.body;
    const update = {
      moderationStatus,
      moderationReason: moderationReason.trim(),
      isActive: moderationStatus === 'approved',
      status: moderationStatus === 'approved' ? 'available' : 'hidden',
    };

    const listing = await Listing.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });
    if (!listing) return error(res, 'Listing not found', 404);

    await Notification.create({
      user: listing.seller,
      type: 'moderation',
      text: moderationStatus === 'approved'
        ? 'Your listing has been approved.'
        : `Your listing was ${moderationStatus}.`,
      link: `/listings/${listing._id}`,
    });

    await Promise.all([
      flushCacheNamespace(listingCache, 'listings'),
      flushCacheNamespace(categoryCache, 'categories'),
    ]);
    return success(res, { listing }, 'Listing moderation updated');
  } catch (err) {
    logger.error(`[${req.requestId}] updateListingModeration: ${err.message}`, err);
    return error(res, 'Failed to update listing moderation', 500);
  }
};

// ─── PUT /api/v1/admin/listings/:id/unflag ────────────────────────────────────
exports.unflagListing = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);

    const listing = await Listing.findByIdAndUpdate(
      req.params.id,
      { flagged: false },
      { new: true }
    );
    if (!listing) return error(res, 'Listing not found', 404);

    // Wipe related reports so the counter resets properly
    await Report.deleteMany({ listing: listing._id });
    await flushCacheNamespace(listingCache, 'listings');

    return success(res, null, 'Listing unflagged and reports cleared');
  } catch (err) {
    logger.error(`[${req.requestId}] unflagListing: ${err.message}`, err);
    return error(res, 'Failed to unflag listing', 500);
  }
};

// ─── DELETE /api/v1/admin/listings/:id ────────────────────────────────────────
exports.deleteListing = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);

    const listing = await Listing.findById(req.params.id);
    if (!listing) return error(res, 'Listing not found', 404);

    await Promise.all([
      listing.deleteOne(),
      User.findByIdAndUpdate(listing.seller, { $inc: { listingCount: -1 } }),
      Report.deleteMany({ listing: listing._id }),
    ]);

    // Non-blocking Cloudinary cleanup
    if (listing.images && listing.images.length > 0) {
      const cloudinary = require('../config/cloudinary');
      Promise.all(
        listing.images.map(url => {
          const match = url.match(/\/v\d+\/(cirql\/.+?)(?:\.\w+)?$/);
          return match ? cloudinary.uploader.destroy(match[1]) : Promise.resolve();
        })
      ).catch(e =>
        logger.warn(`[${req.requestId}] Cloudinary cleanup failed for ${listing._id}: ${e.message}`)
      );
    }

    await flushCacheNamespace(listingCache, 'listings');
    return success(res, null, 'Listing permanently removed');
  } catch (err) {
    logger.error(`[${req.requestId}] adminDeleteListing: ${err.message}`, err);
    return error(res, 'Failed to delete listing', 500);
  }
};

// ─── GET /api/v1/admin/users ──────────────────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip   = (page - 1) * limit;
    const { search } = req.query;

    const filter = {};
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60);
      filter.$or = [
        { name: new RegExp(safe, 'i') },
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
  } catch (err) {
    logger.error(`[${req.requestId}] getUsers: ${err.message}`, err);
    return error(res, 'Failed to fetch users', 500);
  }
};

// ─── PUT /api/v1/admin/users/:id/ban ─────────────────────────────────────────
exports.banUser = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid user ID', 400);
    if (req.params.id === req.userId) return error(res, 'Cannot ban yourself', 400);

    const user = await User.findById(req.params.id).select('+tokenVersion');
    if (!user) return error(res, 'User not found', 404);
    if (user.role === 'admin') return error(res, 'Cannot ban another admin', 403);

    // Setting isVerified false blocks login; bump tokenVersion kills active sessions
    user.isVerified   = false;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    await Promise.all([
      RefreshToken.deleteMany({ userId: user._id }),
      Listing.updateMany({ seller: user._id }, { isActive: false }),
    ]);

    await flushCacheNamespace(listingCache, 'listings');
    return success(res, null, 'User banned — all sessions invalidated and listings deactivated');
  } catch (err) {
    logger.error(`[${req.requestId}] banUser: ${err.message}`, err);
    return error(res, 'Failed to ban user', 500);
  }
};

// ─── PUT /api/v1/admin/users/:id/unban ───────────────────────────────────────
exports.unbanUser = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid user ID', 400);

    const user = await User.findById(req.params.id);
    if (!user) return error(res, 'User not found', 404);

    user.isVerified = true;
    await user.save();

    return success(res, null, 'User reinstated successfully');
  } catch (err) {
    logger.error(`[${req.requestId}] unbanUser: ${err.message}`, err);
    return error(res, 'Failed to unban user', 500);
  }
};
