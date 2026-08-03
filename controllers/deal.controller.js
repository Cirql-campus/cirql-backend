'use strict';

const mongoose = require('mongoose');
const Deal = require('../models/Deal');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { listingCache, flushCacheNamespace } = require('../utils/cache');
const { sendPushNotification } = require('../utils/push.util');
const { awardPoints } = require('../utils/points.util');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const populateDeal = (query) => query
  .populate('listing', 'title price images coverImageIndex status isActive seller location pickupLocation')
  .populate('buyer', 'name initials avatar college isVerified rating reviewCount')
  .populate('seller', 'name initials avatar college isVerified rating reviewCount');

const createNotification = async ({ user, text, link }) => {
  const notification = await Notification.create({ user, type: 'deal', text, link });

  try {
    const { getIO } = require('../config/socket');
    getIO().to(`user_${user}`).emit('new_notification', { notification });
  } catch (socketErr) {
    logger.warn(`Deal notification socket emit failed: ${socketErr.message}`);
  }

  try {
    const recipient = await User.findById(user);
    await sendPushNotification(recipient, {
      title: 'CirQl deal update',
      body: text,
      url: `${process.env.FRONTEND_URL}${link}`,
      tag: `deal-${link.split('/').pop()}`,
      type: 'deal',
      preferenceKey: 'deals',
    });
  } catch (pushErr) {
    logger.warn(`Deal push notification failed: ${pushErr.message}`);
  }
};

const ensureParticipant = (deal, userId) =>
  deal.buyer.toString() === userId || deal.seller.toString() === userId;

exports.createDealRequest = async (req, res) => {
  try {
    const { listingId, message = '', meetupLocation = '' } = req.body;
    if (!isValidId(listingId)) return error(res, 'Invalid listing ID', 400);

    const listing = await Listing.findOne({
      _id: listingId,
      isActive: true,
      status: { $in: ['available', 'reserved'] },
    });
    if (!listing) return error(res, 'Listing not found or unavailable', 404);
    if (listing.seller.toString() === req.userId) {
      return error(res, 'You cannot request a deal on your own listing', 400);
    }
    if (listing.moderationStatus && listing.moderationStatus !== 'approved') {
      return error(res, 'This listing is not approved yet', 403);
    }

    const deal = await Deal.create({
      listing: listing._id,
      buyer: req.userId,
      seller: listing.seller,
      message: message.trim(),
      meetupLocation: meetupLocation.trim() || listing.pickupLocation || listing.location || '',
    });

    await createNotification({
      user: listing.seller,
      text: `New deal request for "${listing.title}"`,
      link: `/deals/${deal._id}`,
    });

    const populated = await populateDeal(Deal.findById(deal._id)).lean();
    return success(res, { deal: populated }, 'Deal request sent', 201);
  } catch (err) {
    if (err.code === 11000) return error(res, 'You already have an active deal request for this listing', 409);
    throw err;
  }
};

exports.getMyDeals = async (req, res) => {
  const role = req.query.role;
  const status = req.query.status;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  const filter = {};

  if (role === 'buyer') filter.buyer = req.userId;
  else if (role === 'seller') filter.seller = req.userId;
  else filter.$or = [{ buyer: req.userId }, { seller: req.userId }];

  if (status && status !== 'all') filter.status = status;

  const [deals, total] = await Promise.all([
    populateDeal(
      Deal.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit)
    ).lean(),
    Deal.countDocuments(filter),
  ]);

  return success(res, {
    deals,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
};

exports.getDealById = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid deal ID', 400);

  const deal = await populateDeal(Deal.findById(req.params.id)).lean();
  if (!deal) return error(res, 'Deal not found', 404);
  if (!ensureParticipant(deal, req.userId) && req.user?.role !== 'super_admin' && req.user?.role !== 'college_admin') {
    return error(res, 'Access denied', 403);
  }

  return success(res, { deal });
};

exports.updateDealStatus = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid deal ID', 400);
  const action = req.body.action;
  const note = (req.body.note || '').trim();

  const deal = await Deal.findById(req.params.id);
  if (!deal) return error(res, 'Deal not found', 404);
  if (!ensureParticipant(deal, req.userId) && req.user?.role !== 'super_admin' && req.user?.role !== 'college_admin') {
    return error(res, 'Access denied', 403);
  }

  const isBuyer = deal.buyer.toString() === req.userId;
  const isSeller = deal.seller.toString() === req.userId;
  const listing = await Listing.findById(deal.listing);
  if (!listing) return error(res, 'Listing not found', 404);

  if (action === 'accept') {
    if (!isSeller && req.user?.role !== 'super_admin' && req.user?.role !== 'college_admin') return error(res, 'Only the seller can accept', 403);
    if (deal.status !== 'requested') return error(res, 'Only requested deals can be accepted', 400);
    deal.status = 'accepted';
    deal.acceptedAt = new Date();
    deal.statusNote = note;
    listing.status = 'reserved';
    listing.isActive = true;
    await createNotification({
      user: deal.buyer,
      text: `Your deal request for "${listing.title}" was accepted`,
      link: `/deals/${deal._id}`,
    });
  } else if (action === 'reject') {
    if (!isSeller && req.user?.role !== 'super_admin' && req.user?.role !== 'college_admin') return error(res, 'Only the seller can reject', 403);
    if (deal.status !== 'requested') return error(res, 'Only requested deals can be rejected', 400);
    deal.status = 'rejected';
    deal.rejectedAt = new Date();
    deal.statusNote = note;
    await createNotification({
      user: deal.buyer,
      text: `Your deal request for "${listing.title}" was rejected`,
      link: `/deals/${deal._id}`,
    });
  } else if (action === 'cancel') {
    if (!['requested', 'accepted'].includes(deal.status)) return error(res, 'This deal cannot be cancelled', 400);
    deal.status = 'cancelled';
    deal.cancelledAt = new Date();
    deal.statusNote = note;
    if (listing.status === 'reserved') listing.status = 'available';
    await createNotification({
      user: isBuyer ? deal.seller : deal.buyer,
      text: `A deal for "${listing.title}" was cancelled`,
      link: `/deals/${deal._id}`,
    });
  } else if (action === 'complete') {
    if (deal.status !== 'accepted') return error(res, 'Only accepted deals can be completed', 400);
    if (isBuyer) deal.buyerCompletedAt = deal.buyerCompletedAt || new Date();
    if (isSeller || req.user?.role === 'super_admin' || req.user?.role === 'college_admin') deal.sellerCompletedAt = deal.sellerCompletedAt || new Date();
    deal.statusNote = note;

    if (deal.buyerCompletedAt && deal.sellerCompletedAt) {
      deal.status = 'completed';
      deal.completedAt = new Date();
      listing.status = 'sold';
      listing.isSold = true;
      listing.isActive = false;
      await User.findByIdAndUpdate(deal.seller, { $inc: { soldCount: 1 } });
      // Award points — wrapped in Promise.all but errors are swallowed inside awardPoints (fired in background, not awaited)
      Promise.all([
        awardPoints(deal.seller, 'deal_completed_seller', {
          refModel: 'Deal',
          refId: deal._id,
          note: `Deal completed: "${listing.title}"`,
        }),
        awardPoints(deal.buyer, 'deal_completed_buyer', {
          refModel: 'Deal',
          refId: deal._id,
          note: `Deal completed: "${listing.title}"`,
        }),
      ]).catch(err => logger.error('[POINTS] deal award Promise.all error:', err.message));
      await Deal.updateMany(
        { _id: { $ne: deal._id }, listing: listing._id, status: { $in: ['requested', 'accepted'] } },
        { $set: { status: 'cancelled', cancelledAt: new Date(), statusNote: 'Listing sold through another deal' } }
      );
      await createNotification({
        user: isBuyer ? deal.seller : deal.buyer,
        text: `Deal completed for "${listing.title}". You can now leave a review.`,
        link: `/deals/${deal._id}`,
      });
    } else {
      await createNotification({
        user: isBuyer ? deal.seller : deal.buyer,
        text: `Please confirm completion for "${listing.title}"`,
        link: `/deals/${deal._id}`,
      });
    }
  } else if (action === 'dispute') {
    if (!['requested', 'accepted', 'completed'].includes(deal.status)) {
      return error(res, 'This deal cannot be disputed', 400);
    }
    deal.status = 'disputed';
    deal.statusNote = note;
    await createNotification({
      user: isBuyer ? deal.seller : deal.buyer,
      text: `A deal for "${listing.title}" was disputed`,
      link: `/deals/${deal._id}`,
    });
  } else {
    return error(res, 'Invalid deal action', 400);
  }

  await Promise.all([deal.save(), listing.save(), flushCacheNamespace(listingCache, 'listings')]);

  const populated = await populateDeal(Deal.findById(deal._id)).lean();
  return success(res, { deal: populated }, 'Deal updated');
};
