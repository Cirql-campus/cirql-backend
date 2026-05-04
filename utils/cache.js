'use strict';
const NodeCache = require('node-cache');
const { isRedisEnabled, connectRedis } = require('./redis');
const logger = require('./logger');

/**
 * Singleton in-memory cache instances.
 * Import this module anywhere that needs caching — one instance per logical domain.
 *
 * Usage:
 *   const { listingCache } = require('../utils/cache');
 *   listingCache.set(key, value, ttlSeconds);
 *   listingCache.get(key);
 *   listingCache.del(key);
 *   listingCache.flushAll();
 */

// Public listing browse / detail pages — 30 s for browse, 60 s for single
const listingCache = new NodeCache({
  stdTTL:      30,    // default TTL in seconds
  checkperiod: 60,    // internal TTL check interval
  useClones:   false, // avoid deep-clone overhead — treat values as immutable
});

// Search autocomplete suggestions — 30 s
const suggestionCache = new NodeCache({
  stdTTL:      30,
  checkperiod: 60,
  useClones:   false,
});

// Category list + slug pages — 5 min (changes infrequently)
const categoryCache = new NodeCache({
  stdTTL:      300,
  checkperiod: 60,
  useClones:   false,
});

const redisKey = (namespace, key) =>
  `cache:${namespace}:${Buffer.from(String(key)).toString('base64url')}`;

const getCacheValue = async (cache, namespace, key) => {
  if (isRedisEnabled()) {
    try {
      const client = await connectRedis();
      if (client) {
        const value = await client.get(redisKey(namespace, key));
        return value ? JSON.parse(value) : undefined;
      }
    } catch (err) {
      logger.warn(`Redis cache get failed: ${err.message}`);
    }
  }
  return cache.get(key);
};

const setCacheValue = async (cache, namespace, key, value, ttlSeconds) => {
  if (isRedisEnabled()) {
    try {
      const client = await connectRedis();
      if (client) {
        await client.set(redisKey(namespace, key), JSON.stringify(value), { EX: ttlSeconds });
        return;
      }
    } catch (err) {
      logger.warn(`Redis cache set failed: ${err.message}`);
    }
  }
  cache.set(key, value, ttlSeconds);
};

const flushCacheNamespace = async (cache, namespace) => {
  cache.flushAll();
  if (!isRedisEnabled()) return;

  try {
    const client = await connectRedis();
    if (!client) return;
    const keys = await client.keys(`cache:${namespace}:*`);
    if (keys.length > 0) await client.del(keys);
  } catch (err) {
    logger.warn(`Redis cache flush failed: ${err.message}`);
  }
};

module.exports = {
  listingCache,
  suggestionCache,
  categoryCache,
  getCacheValue,
  setCacheValue,
  flushCacheNamespace,
};
