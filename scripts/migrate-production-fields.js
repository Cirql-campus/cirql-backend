'use strict';

const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const Listing = require('../models/Listing');
const Report = require('../models/Report');
const Message = require('../models/Message');
const logger = require('../utils/logger');

const run = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const [listingResult, reportResult, messageResult] = await Promise.all([
    Listing.updateMany(
      {
        $or: [
          { status: { $exists: false } },
          { moderationStatus: { $exists: false } },
          { coverImageIndex: { $exists: false } },
        ],
      },
      {
        $set: {
          status: 'available',
          moderationStatus: 'approved',
          coverImageIndex: 0,
        },
      }
    ),
    Report.updateMany(
      { status: { $exists: false } },
      { $set: { status: 'open', actionNote: '' } }
    ),
    Message.updateMany(
      {
        $or: [
          { flagged: { $exists: false } },
          { hiddenByAdmin: { $exists: false } },
        ],
      },
      { $set: { flagged: false, hiddenByAdmin: false, hiddenReason: '' } }
    ),
  ]);

  logger.info(`Listings updated: ${listingResult.modifiedCount}`);
  logger.info(`Listing reports updated: ${reportResult.modifiedCount}`);
  logger.info(`Messages updated: ${messageResult.modifiedCount}`);
};

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error(`Migration failed: ${err.message}`);
    try {
      await mongoose.connection.close();
    } catch {
      // ignore close errors
    }
    process.exit(1);
  });
