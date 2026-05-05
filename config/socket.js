'use strict';
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const UserBlock = require('../models/UserBlock');
const logger = require('../utils/logger');
const { isRedisEnabled, duplicateRedisClient } = require('../utils/redis');

let io;

// Per-socket message rate limiter (max 20 messages / 10 s)
const msgTimestamps = new Map(); // socketId → [timestamps]
const MAX_MSGS  = 20;
const WINDOW_MS = 10_000;

const getCookieValue = (cookieHeader, name) => {
  if (!cookieHeader) return null;
  const cookies = String(cookieHeader).split(';');
  for (const cookie of cookies) {
    const [rawKey, ...rawValue] = cookie.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rawValue.join('='));
  }
  return null;
};

function isRateLimited(socketId) {
  const now = Date.now();
  const times = (msgTimestamps.get(socketId) || []).filter(t => now - t < WINDOW_MS);
  times.push(now);
  msgTimestamps.set(socketId, times);
  return times.length > MAX_MSGS;
}

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const hasBlockBetween = async (userA, userB) => Boolean(await UserBlock.exists({
  $or: [
    { blocker: userA, blocked: userB },
    { blocker: userB, blocked: userA },
  ],
}));

const getAccessibleConversation = async (conversationId, userId) => {
  if (!isValidId(conversationId)) return null;

  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation) return null;

  const participantIds = conversation.participants.map(p => p.toString());
  if (!participantIds.includes(userId)) return null;

  const otherUserId = participantIds.find(id => id !== userId);
  if (await hasBlockBetween(userId, otherUserId)) return null;

  return conversation;
};

const initSocket = (server) => {
  const allowedOrigins = (process.env.FRONTEND_ORIGINS || 'http://localhost:5173')
    .split(',').map(o => o.trim());

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
      methods:     ['GET', 'POST'],
    },
    // Prevent huge payloads over socket
    maxHttpBufferSize: 1e4, // 10 KB max per message
    pingTimeout:  20_000,
    pingInterval: 25_000,
  });

  const shouldUseClusterAdapter =
    process.env.NODE_ENV === 'production' &&
    process.env.DISABLE_CLUSTER !== 'true' &&
    typeof process.send === 'function';

  if (isRedisEnabled()) {
    (async () => {
      try {
        const pubClient = await duplicateRedisClient();
        const subClient = await duplicateRedisClient();
        if (!pubClient || !subClient) return;
        const { createAdapter } = require('@socket.io/redis-adapter');
        io.adapter(createAdapter(pubClient, subClient));
        logger.info('Socket.io Redis adapter enabled.');
      } catch (err) {
        logger.warn(`Socket.io Redis adapter unavailable: ${err.message}`);
      }
    })();
  } else if (shouldUseClusterAdapter) {
    const { createAdapter } = require('@socket.io/cluster-adapter');
    io.adapter(createAdapter());
  }

  // ── Auth middleware ────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token
      || socket.handshake.headers?.authorization?.replace('Bearer ', '')
      || getCookieValue(socket.handshake.headers?.cookie, 'cirql_access');

    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('+tokenVersion name').lean();
      if (!user) return next(new Error('Account no longer exists'));
      if (user.tokenVersion !== (decoded.tv ?? 0)) {
        return next(new Error('Session invalidated'));
      }
      socket.userId = user._id.toString();
      socket.userName = user.name;
      socket.joinedConversations = new Set();
      next();
    } catch (err) {
      logger.warn(`Socket auth failed: ${err.message}`);
      next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection handler ─────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    // Each user auto-joins their personal notification room
    socket.join(`user_${socket.userId}`);

    // ── Join a conversation room ─────────────────────────────────────────────
    socket.on('join_conversation', async ({ conversationId }, ack) => {
      if (!conversationId || typeof conversationId !== 'string') return;
      try {
        const conversation = await getAccessibleConversation(conversationId, socket.userId);
        if (!conversation) {
          if (typeof ack === 'function') ack({ success: false, message: 'Access denied' });
          return;
        }
        socket.join(`conv_${conversationId}`);
        socket.joinedConversations.add(conversationId);
        if (typeof ack === 'function') ack({ success: true });
      } catch (err) {
        logger.warn(`Socket join_conversation failed: ${err.message}`);
        if (typeof ack === 'function') ack({ success: false, message: 'Could not join conversation' });
      }
    });

    // ── Typing indicator ─────────────────────────────────────────────────────
    socket.on('typing', async ({ conversationId }) => {
      if (!conversationId || typeof conversationId !== 'string') return;
      if (!socket.joinedConversations.has(conversationId)) {
        const conversation = await getAccessibleConversation(conversationId, socket.userId);
        if (!conversation) return;
        socket.joinedConversations.add(conversationId);
      }
      socket.to(`conv_${conversationId}`).emit('typing_indicator', {
        conversationId,
        userName: String(socket.userName || '').slice(0, 50),
      });
    });

    // ── Client-side "send_message" event ─────────────────────────────────────
    // NOTE: The canonical message save flow goes through the REST endpoint.
    // This event only re-broadcasts to the room for instant UX feel.
    socket.on('send_message', async ({ conversationId, text }) => {
      if (isRateLimited(socket.id)) {
        socket.emit('error', { message: 'Slow down — too many messages.' });
        return;
      }
      if (!conversationId || typeof text !== 'string') return;
      if (!socket.joinedConversations.has(conversationId)) {
        const conversation = await getAccessibleConversation(conversationId, socket.userId);
        if (!conversation) return;
        socket.joinedConversations.add(conversationId);
      }
      const safeText = text.trim().slice(0, 1000);
      if (!safeText) return;
      socket.to(`conv_${conversationId}`).emit('new_message', {
        message: { text: safeText, conversationId },
        sender: socket.userId,
      });
    });

    socket.on('disconnect', () => {
      msgTimestamps.delete(socket.id);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized — call initSocket first');
  return io;
};

module.exports = { initSocket, getIO };
