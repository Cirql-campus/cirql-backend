'use strict';
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedisClient, isRedisEnabled, connectRedis } = require('../utils/redis');

if (isRedisEnabled()) {
  connectRedis();
}

const getStore = (prefix) => {
  if (!isRedisEnabled()) return undefined;
  const client = getRedisClient();
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args) => client.sendCommand(args),
  });
};

const makeOptions = (windowMinutes, max, message, prefix, keyByUser = false) => ({
  windowMs:       windowMinutes * 60 * 1000,
  max,
  ...(prefix ? { store: getStore(prefix) } : {}),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message },
  keyGenerator: (req) => {
    if (keyByUser && req.userId) return `user:${req.userId}`;
    return `${req.ip}:${req.headers['user-agent'] || ''}`;
  },
  skip: (req) => process.env.NODE_ENV === 'test' || req.path === '/health',
});

const generalLimiter = rateLimit(makeOptions(
  15, 200,
  'Too many requests, please try again in 15 minutes.',
  'general'
));

const authLimiter = rateLimit(makeOptions(
  15, 10,
  'Too many authentication attempts. Please wait 15 minutes.',
  'auth'
));

const otpLimiter = rateLimit(makeOptions(
  15, 15,
  'Too many OTP attempts. Please wait 15 minutes.',
  'otp'
));

const createLimiter = rateLimit(makeOptions(
  10, 10,
  'You are posting too fast. Please wait 10 minutes.',
  'create',
  true
));

const chatLimiter = rateLimit(makeOptions(
  1, 60,
  'Too many chat actions. Please slow down.',
  'chat',
  true
));

const reportLimiter = rateLimit(makeOptions(
  15, 8,
  'Too many reports submitted. Please wait before reporting again.',
  'report',
  true
));

const wantedLimiter = rateLimit(makeOptions(
  15, 12,
  'Too many wanted item actions. Please wait before trying again.',
  'wanted',
  true
));

module.exports = {
  generalLimiter,
  authLimiter,
  otpLimiter,
  createLimiter,
  chatLimiter,
  reportLimiter,
  wantedLimiter,
};
