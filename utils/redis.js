'use strict';

const logger = require('./logger');

let redisClient;
let redisConnectPromise;

const isRedisEnabled = () => Boolean(process.env.REDIS_URL);

const getRedisClient = () => {
  if (!isRedisEnabled()) return null;
  if (redisClient) return redisClient;

  const { createClient } = require('redis');
  redisClient = createClient({ url: process.env.REDIS_URL });

  redisClient.on('error', (err) => {
    logger.warn(`Redis error: ${err.message}`);
  });

  redisClient.on('connect', () => {
    logger.info('Redis connected.');
  });

  return redisClient;
};

const connectRedis = async () => {
  const client = getRedisClient();
  if (!client) return null;
  if (client.isOpen) return client;

  redisConnectPromise ||= client.connect().catch((err) => {
    redisConnectPromise = null;
    logger.warn(`Redis connection failed: ${err.message}`);
    return null;
  });

  return redisConnectPromise;
};

const duplicateRedisClient = async () => {
  const client = await connectRedis();
  if (!client) return null;

  const duplicate = client.duplicate();
  duplicate.on('error', (err) => {
    logger.warn(`Redis duplicate client error: ${err.message}`);
  });
  await duplicate.connect();
  return duplicate;
};

module.exports = {
  isRedisEnabled,
  getRedisClient,
  connectRedis,
  duplicateRedisClient,
};
