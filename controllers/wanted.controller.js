'use strict';

const mongoose = require('mongoose');
const WantedRequest = require('../models/WantedRequest');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const UserBlock = require('../models/UserBlock');
const { success, error } = require('../utils/apiResponse');
const { getIO } = require('../config/socket');
const logger = require('../utils/logger');
const User = require('../models/User');
const { sendPushNotification } = require('../utils/push.util');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const normalizeBudget = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  return Number(value);
};

const populateWanted = (query) => query.populate('requester', 'name initials avatar college isVerified rating reviewCount');

const hasBlockBetween = async (userA, userB) => Boolean(await UserBlock.exists({
  $or: [
    { blocker: userA, blocked: userB },
    { blocker: userB, blocked: userA },
  ],
}));

exports.getWantedRequests = async (req, res) => {
  try {
    const {
      category,
      status = 'open',
      page = 1,
      limit = 12,
    } = req.query;

    const parsedLimit = Math.min(30, Math.max(1, parseInt(limit, 10) || 12));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;
    const filter = {};

    if (req.user?.college) filter.college = req.user.college;
    if (category && category !== 'all') filter.category = String(category).toLowerCase();
    if (status && status !== 'all') filter.status = status;

    const [wanted, total] = await Promise.all([
      populateWanted(
        WantedRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit)
      ).lean(),
      WantedRequest.countDocuments(filter),
    ]);

    return success(res, {
      wanted,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
        hasMore: parsedPage * parsedLimit < total,
      },
    });
  } catch (err) {
    logger.error(`[${req.requestId}] getWantedRequests: ${err.message}`, err);
    return error(res, 'Failed to fetch wanted items', 500);
  }
};

exports.getMyWantedRequests = async (req, res) => {
  try {
    const status = req.query.status || 'all';
    const parsedLimit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const parsedPage = Math.max(1, parseInt(req.query.page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;
    const filter = { requester: req.userId };
    if (status !== 'all') filter.status = status;

    const [wanted, total] = await Promise.all([
      populateWanted(
        WantedRequest.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(parsedLimit)
      ).lean(),
      WantedRequest.countDocuments(filter),
    ]);

    return success(res, {
      wanted,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
        hasMore: parsedPage * parsedLimit < total,
      },
    });
  } catch (err) {
    logger.error(`[${req.requestId}] getMyWantedRequests: ${err.message}`, err);
    return error(res, 'Failed to fetch your wanted items', 500);
  }
};

exports.createWantedRequest = async (req, res) => {
  try {
    const minBudget = normalizeBudget(req.body.minBudget);
    const maxBudget = normalizeBudget(req.body.maxBudget);

    const wanted = await WantedRequest.create({
      title: req.body.title.trim(),
      description: (req.body.description || '').trim(),
      category: req.body.category,
      minBudget,
      maxBudget,
      urgency: req.body.urgency || 'anytime',
      college: req.user.college,
      requester: req.userId,
    });

    const populated = await populateWanted(WantedRequest.findById(wanted._id)).lean();
    return success(res, { wanted: populated }, 'Wanted item posted', 201);
  } catch (err) {
    logger.error(`[${req.requestId}] createWantedRequest: ${err.message}`, err);
    if (err.name === 'ValidationError') {
      return error(res, Object.values(err.errors)[0].message, 422);
    }
    return error(res, 'Failed to post wanted item', 500);
  }
};

exports.updateWantedStatus = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid wanted item ID', 400);

    const wanted = await WantedRequest.findById(req.params.id);
    if (!wanted) return error(res, 'Wanted item not found', 404);
    if (wanted.requester.toString() !== req.userId && req.user?.role !== 'admin') {
      return error(res, 'Access denied', 403);
    }

    wanted.status = req.body.status;
    await wanted.save();

    const populated = await populateWanted(WantedRequest.findById(wanted._id)).lean();
    return success(res, { wanted: populated }, 'Wanted item updated');
  } catch (err) {
    logger.error(`[${req.requestId}] updateWantedStatus: ${err.message}`, err);
    return error(res, 'Failed to update wanted item', 500);
  }
};

exports.deleteWantedRequest = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid wanted item ID', 400);

    const wanted = await WantedRequest.findById(req.params.id);
    if (!wanted) return error(res, 'Wanted item not found', 404);
    if (wanted.requester.toString() !== req.userId && req.user?.role !== 'admin') {
      return error(res, 'Access denied', 403);
    }

    await wanted.deleteOne();
    return success(res, null, 'Wanted item deleted');
  } catch (err) {
    logger.error(`[${req.requestId}] deleteWantedRequest: ${err.message}`, err);
    return error(res, 'Failed to delete wanted item', 500);
  }
};

exports.respondToWantedRequest = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid wanted item ID', 400);

    const wanted = await WantedRequest.findOne({ _id: req.params.id, status: 'open' })
      .populate('requester', 'name initials avatar college isVerified');
    if (!wanted) return error(res, 'Wanted item not found or closed', 404);
    if (wanted.requester._id.toString() === req.userId) {
      return error(res, 'You cannot respond to your own wanted item', 400);
    }
    if (wanted.college !== req.user.college) {
      return error(res, 'This wanted item is outside your college', 403);
    }
    if (await hasBlockBetween(req.userId, wanted.requester._id)) {
      return error(res, 'Conversation is unavailable', 403);
    }

    const participants = [req.userId, wanted.requester._id.toString()].sort();
    let conversation = await Conversation.findOne({
      participants: { $all: participants, $size: 2 },
      listing: { $exists: false },
    })
      .populate('participants', 'name avatar initials isVerified')
      .populate('listing', 'title price images');

    if (!conversation) {
      conversation = await Conversation.create({ participants });
      await conversation.populate([
        { path: 'participants', select: 'name avatar initials isVerified' },
        { path: 'listing', select: 'title price images' },
      ]);
    }

    const messageText = (req.body.message || `I have this wanted item: ${wanted.title}`).trim().slice(0, 1000);
    const [message] = await Promise.all([
      Message.create({ conversation: conversation._id, sender: req.userId, text: messageText }),
      Conversation.findByIdAndUpdate(conversation._id, {
        lastMessage: messageText.slice(0, 100),
        lastMessageAt: new Date(),
      }),
      WantedRequest.findByIdAndUpdate(wanted._id, { $inc: { responseCount: 1 } }),
    ]);
    await message.populate('sender', 'name avatar initials');

    const notification = await Notification.create({
      user: wanted.requester._id,
      type: 'message',
      text: `${req.user.name} responded to your wanted item "${wanted.title}"`,
      link: `/messages/${conversation._id}`,
    });

    try {
      const io = getIO();
      io.to(`conv_${conversation._id}`).emit('new_message', { message, sender: req.userId });
      io.to(`user_${wanted.requester._id}`).emit('new_message', { message, sender: req.userId });
      io.to(`user_${wanted.requester._id}`).emit('new_notification', { notification });
    } catch (socketErr) {
      logger.warn(`[${req.requestId}] Wanted response socket emit failed: ${socketErr.message}`);
    }

    try {
      const requester = await User.findById(wanted.requester._id);
      await sendPushNotification(requester, {
        title: 'New wanted item response',
        body: `${req.user.name} responded to "${wanted.title}"`,
        url: `${process.env.FRONTEND_URL}/messages/${conversation._id}`,
        tag: `wanted-${wanted._id}`,
        type: 'message',
        preferenceKey: 'wanted',
      });
    } catch (pushErr) {
      logger.warn(`[${req.requestId}] Wanted response push failed: ${pushErr.message}`);
    }

    const updatedConversation = await Conversation.findById(conversation._id)
      .populate('participants', 'name avatar initials isVerified')
      .populate('listing', 'title price images');

    return success(res, { conversation: updatedConversation, message }, 'Response sent', 201);
  } catch (err) {
    logger.error(`[${req.requestId}] respondToWantedRequest: ${err.message}`, err);
    return error(res, 'Failed to respond to wanted item', 500);
  }
};
