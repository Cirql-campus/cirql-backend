'use strict';
const mongoose     = require('mongoose');
const Conversation = require('../models/Conversation');
const Message      = require('../models/Message');
const MessageReport = require('../models/MessageReport');
const Notification = require('../models/Notification');
const Listing      = require('../models/Listing');
const User         = require('../models/User');
const UserBlock    = require('../models/UserBlock');
const { success, error } = require('../utils/apiResponse');
const { getIO } = require('../config/socket');
const { sendPushNotification } = require('../utils/push.util');
const logger = require('../utils/logger');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const participantIdToString = (participant) =>
  (participant?._id || participant).toString();

const isParticipant = (conversation, userId) =>
  conversation.participants.some(p => participantIdToString(p) === userId);

const getOtherParticipantId = (conversation, userId) =>
  conversation.participants
    .map(participantIdToString)
    .find(id => id !== userId);

const hasBlockBetween = async (userA, userB) => {
  if (!userA || !userB) return false;
  return Boolean(await UserBlock.exists({
    $or: [
      { blocker: userA, blocked: userB },
      { blocker: userB, blocked: userA },
    ],
  }));
};

const canStartConversationForListing = (listing, user) => {
  if (!listing || !user) return false;
  if (user.role === 'admin') return true;
  return Boolean(
    listing.college &&
    listing.college === user.college &&
    ['approved', null, undefined].includes(listing.moderationStatus) &&
    !['hidden', 'expired'].includes(listing.status)
  );
};

const notifyAdmins = async ({ text, link }) => {
  const admins = await User.find({ role: 'admin' }).select('_id').lean();
  if (admins.length === 0) return;
  await Notification.insertMany(admins.map(adminUser => ({
    user: adminUser._id,
    type: 'report',
    text,
    link,
  })));
};

// ─── GET /chat/conversations ──────────────────────────────────────────────────
exports.getConversations = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const conversations = await Conversation.find({ participants: req.userId })
      .populate('participants', 'name avatar initials isVerified')
      .populate('listing',      'title price images isActive')
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const conversationIds = conversations.map(c => c._id);
    const otherUserIds = conversations
      .map(conversation => getOtherParticipantId(conversation, req.userId))
      .filter(Boolean);

    const [unreadCounts, blocks] = await Promise.all([
      Message.aggregate([
      {
        $match: {
          conversation: { $in: conversationIds },
          sender: { $ne: new mongoose.Types.ObjectId(req.userId) },
          read: false,
        },
      },
      { $group: { _id: '$conversation', count: { $sum: 1 } } },
      ]),
      UserBlock.find({
        $or: [
          { blocker: req.userId, blocked: { $in: otherUserIds } },
          { blocker: { $in: otherUserIds }, blocked: req.userId },
        ],
      }).lean(),
    ]);
    const unreadByConversation = new Map(
      unreadCounts.map(item => [item._id.toString(), item.count])
    );
    const blockedUserIds = new Set(blocks.flatMap(block => [
      block.blocker.toString(),
      block.blocked.toString(),
    ]).filter(id => id !== req.userId));

    const total = await Conversation.countDocuments({ participants: req.userId });

    return success(res, {
      conversations: conversations.map(conversation => ({
        ...conversation,
        isBlocked: blockedUserIds.has(String(getOtherParticipantId(conversation, req.userId))),
        unreadCount: unreadByConversation.get(conversation._id.toString()) || 0,
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  } catch (err) {
    logger.error(`[${req.requestId}] getConversations: ${err.message}`, err);
    return error(res, 'Failed to fetch conversations', 500);
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const conversations = await Conversation.find({ participants: req.userId })
      .select('_id')
      .lean();
    const conversationIds = conversations.map(c => c._id);

    const unreadCount = await Message.countDocuments({
      conversation: { $in: conversationIds },
      sender: { $ne: req.userId },
      read: false,
    });

    return success(res, { unreadCount });
  } catch (err) {
    logger.error(`[${req.requestId}] getUnreadCount: ${err.message}`, err);
    return error(res, 'Failed to fetch unread count', 500);
  }
};

// ─── POST /chat/conversations ─────────────────────────────────────────────────
exports.createOrGetConversation = async (req, res) => {
  try {
    const { listingId, sellerId } = req.body;

    if (!isValidId(listingId) || !isValidId(sellerId)) {
      return error(res, 'Invalid listingId or sellerId', 400);
    }
    if (sellerId === req.userId) {
      return error(res, 'You cannot start a conversation with yourself', 400);
    }

    const listing = await Listing.findOne({ _id: listingId, isActive: true })
      .select('seller title price images college moderationStatus status')
      .lean();
    if (!listing) return error(res, 'Listing not found or no longer active', 404);
    if (listing.seller.toString() !== sellerId) {
      return error(res, 'Seller does not own this listing', 400);
    }
    if (!canStartConversationForListing(listing, req.user)) {
      return error(res, 'This listing is outside your campus or unavailable', 403);
    }

    if (await hasBlockBetween(req.userId, sellerId)) {
      return error(res, 'Conversation is unavailable', 403);
    }

    // Sort participants for a consistent unique key
    const participants = [req.userId, sellerId].sort();

    let conversation = await Conversation.findOne({
      participants: { $all: participants, $size: 2 },
      listing: listingId,
    })
      .populate('participants', 'name avatar initials isVerified')
      .populate('listing',      'title price images');

    if (!conversation) {
      conversation = await Conversation.create({ participants, listing: listingId });
      await conversation.populate([
        { path: 'participants', select: 'name avatar initials isVerified' },
        { path: 'listing',      select: 'title price images' },
      ]);
    }

    return success(res, { conversation }, 'Conversation ready');
  } catch (err) {
    logger.error(`[${req.requestId}] createOrGetConversation: ${err.message}`, err);
    // Duplicate-key on the unique index is fine — just fetch it
    if (err.code === 11000) {
      try {
        const conv = await Conversation.findOne({
          participants: { $all: [req.userId, req.body.sellerId], $size: 2 },
          listing: req.body.listingId,
        })
          .populate('participants', 'name avatar initials isVerified')
          .populate('listing', 'title price images');
        if (conv) return success(res, { conversation: conv }, 'Conversation ready');
      } catch { /* fall through */ }
    }
    return error(res, 'Failed to create conversation', 500);
  }
};

// ─── GET /chat/conversations/:id/messages ────────────────────────────────────
exports.getMessages = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid conversation ID', 400);

    const conversation = await Conversation.findById(req.params.id)
      .populate('participants', 'name avatar initials isVerified')
      .populate('listing', 'title price images isActive')
      .lean();
    if (!conversation) return error(res, 'Conversation not found', 404);

    // Security: only participants can read messages
    if (!isParticipant(conversation, req.userId)) return error(res, 'Access denied', 403);

    const { page = 1, limit = 50 } = req.query;
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parsedLimit;

    const [messages, total] = await Promise.all([
      Message.find({ conversation: req.params.id, hiddenByAdmin: { $ne: true } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .populate('sender', 'name avatar initials')
        .lean(),
      Message.countDocuments({ conversation: req.params.id, hiddenByAdmin: { $ne: true } }),
    ]);

    // Mark messages from the other person as read
    await Message.updateMany(
      { conversation: req.params.id, sender: { $ne: req.userId }, read: false },
      { $set: { read: true } }
    );

    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    return success(res, {
      messages: messages.reverse(),
      total,
      conversation,
      pagination: {
        total,
        page: currentPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
        hasMore: currentPage * parsedLimit < total,
      },
    });
  } catch (err) {
    logger.error(`[${req.requestId}] getMessages: ${err.message}`, err);
    return error(res, 'Failed to fetch messages', 500);
  }
};

// ─── POST /chat/conversations/:id/messages ────────────────────────────────────
exports.sendMessage = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid conversation ID', 400);

    const { text } = req.body;
    const safeText = (text || '').trim().slice(0, 1000);
    if (!safeText) return error(res, 'Message text is required', 400);

    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) return error(res, 'Conversation not found', 404);

    // Security: only participants can send
    if (!isParticipant(conversation, req.userId)) return error(res, 'Access denied', 403);

    const receiverId = getOtherParticipantId(conversation, req.userId);
    if (!receiverId) return error(res, 'Conversation is invalid', 400);
    if (await hasBlockBetween(req.userId, receiverId)) {
      return error(res, 'Message cannot be sent to this user', 403);
    }

    // Create message + update conversation in parallel
    const [message] = await Promise.all([
      Message.create({ conversation: req.params.id, sender: req.userId, text: safeText }),
      Conversation.findByIdAndUpdate(req.params.id, {
        lastMessage:   safeText.slice(0, 100),
        lastMessageAt: new Date(),
      }),
    ]);

    await message.populate('sender', 'name avatar initials');

    // Emit real-time events (non-blocking)
    try {
      const io = getIO();
      io.to(`conv_${req.params.id}`).emit('new_message', {
        message,
        sender: req.userId,
      });
      io.to(`user_${receiverId}`).emit('new_message', {
        message,
        sender: req.userId,
      });
    } catch (socketErr) {
      // Socket errors must never break the REST response
      logger.warn(`[${req.requestId}] Socket emit failed: ${socketErr.message}`);
    }

    // Send push notification to receiver
    try {
      const receiver = await User.findById(receiverId);
      if (receiver && receiver.pushSubscriptions && receiver.pushSubscriptions.length > 0) {
        const preferences = receiver.notificationPreferences || {};
        await sendPushNotification(receiver, {
          title: `New message from ${message.sender.name}`,
          body: preferences.messagePreview ? safeText : 'Tap to view the message.',
          url: `${process.env.FRONTEND_URL}/messages/${req.params.id}`,
          tag: `message-${req.params.id}`,
          type: 'message',
          preferenceKey: 'messages',
        });
      }
    } catch (pushErr) {
      logger.warn(`[${req.requestId}] Push notify failed: ${pushErr.message}`);
    }

    return success(res, { message }, 'Message sent', 201);
  } catch (err) {
    logger.error(`[${req.requestId}] sendMessage: ${err.message}`, err);
    return error(res, 'Failed to send message', 500);
  }
};

exports.reportMessage = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return error(res, 'Invalid message ID', 400);

    const message = await Message.findById(req.params.id);
    if (!message) return error(res, 'Message not found', 404);
    if (message.sender.toString() === req.userId) {
      return error(res, 'You cannot report your own message', 400);
    }

    const conversation = await Conversation.findById(message.conversation).lean();
    if (!conversation) return error(res, 'Conversation not found', 404);
    if (!isParticipant(conversation, req.userId)) return error(res, 'Access denied', 403);

    await MessageReport.create({
      message: message._id,
      conversation: conversation._id,
      reporter: req.userId,
      reportedUser: message.sender,
      reason: req.body.reason,
      details: (req.body.details || '').trim(),
    });

    const reportCount = await MessageReport.countDocuments({ message: message._id });
    if (reportCount >= 3 && !message.flagged) {
      message.flagged = true;
      await message.save();
    }

    await notifyAdmins({
      text: `Chat message reported for ${req.body.reason}`,
      link: `/admin/message-reports?message=${message._id}`,
    });

    return success(res, null, 'Message reported successfully', 201);
  } catch (err) {
    if (err.code === 11000) return error(res, 'You have already reported this message', 409);
    logger.error(`[${req.requestId}] reportMessage: ${err.message}`, err);
    return error(res, 'Failed to report message', 500);
  }
};
