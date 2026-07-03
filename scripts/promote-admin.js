'use strict';

const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const User = require('../models/User');
const logger = require('../utils/logger');

const run = async () => {
  const email = process.argv[2];
  if (!email) {
    throw new Error('Please provide a user email address. Usage: node scripts/promote-admin.js <email>');
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is required');
  }

  logger.info(`Connecting to database...`);
  await mongoose.connect(process.env.MONGODB_URI);

  logger.info(`Searching for user with email: ${normalizedEmail}`);
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    throw new Error(`User with email "${normalizedEmail}" not found.`);
  }

  if (user.role === 'admin') {
    logger.info(`User "${normalizedEmail}" is already an admin.`);
    return;
  }

  user.role = 'admin';
  await user.save();

  logger.info(`Successfully promoted user "${normalizedEmail}" to admin!`);
};

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error(`Promotion failed: ${err.message}`);
    try {
      await mongoose.connection.close();
    } catch {
      // ignore close errors
    }
    process.exit(1);
  });
