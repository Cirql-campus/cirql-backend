'use strict';
const mongoose = require('mongoose');
const logger   = require('../utils/logger');
const Category = require('../models/Category');
const DEFAULT_CATEGORIES = require('./defaultCategories');

// ─── Connection options ───────────────────────────────────────────────────────
const OPTIONS = {
  maxPoolSize:              10,
  minPoolSize:              2,
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS:          45_000,
  heartbeatFrequencyMS:     10_000,
  retryWrites: true,
  w: 'majority',
};

let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;

  try {
    if (process.env.NODE_ENV !== 'production') {
      mongoose.set('debug', (coll, method, query) => {
        logger.debug(`MongoDB ${coll}.${method}`, { query });
      });
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI, OPTIONS);
    isConnected = true;
    logger.info(`✅ MongoDB connected: ${conn.connection.host}`);

    await Category.bulkWrite(
      DEFAULT_CATEGORIES.map(category => ({
        updateOne: {
          filter: { slug: category.slug },
          update: { $setOnInsert: { ...category, isActive: true } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    logger.info(`Default categories ensured: ${DEFAULT_CATEGORIES.length}`);
  } catch (err) {
    logger.error(`❌ MongoDB initial connection failed: ${err.message}`);
    // Retry indefinitely every 5s instead of crashing
    setTimeout(() => {
      logger.info('🔄 Retrying MongoDB connection...');
      connectDB();
    }, 5_000);
  }
};

// ─── Auto-reconnect events ────────────────────────────────────────────────────
mongoose.connection.on('disconnected', () => {
  isConnected = false;
  logger.warn('⚠️  MongoDB disconnected — will auto-reconnect…');
});
mongoose.connection.on('reconnected', () => {
  isConnected = true;
  logger.info('✅ MongoDB reconnected.');
});
mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB connection error: ${err.message}`);
});

module.exports = connectDB;
