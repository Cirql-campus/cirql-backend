'use strict';

const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const User = require('../models/User');
const logger = require('../utils/logger');

const ROLL_NUMBER_INDEX = 'rollNumber_1_college_1';

const run = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const unsetResult = await User.updateMany(
    { rollNumber: null },
    { $unset: { rollNumber: '' } },
  );

  const indexes = await User.collection.indexes();
  const existingIndex = indexes.find((index) => index.name === ROLL_NUMBER_INDEX);

  if (existingIndex) {
    await User.collection.dropIndex(ROLL_NUMBER_INDEX);
    logger.info(`Dropped existing ${ROLL_NUMBER_INDEX} index`);
  }

  await User.collection.createIndex(
    { rollNumber: 1, college: 1 },
    {
      name: ROLL_NUMBER_INDEX,
      unique: true,
      partialFilterExpression: { rollNumber: { $type: 'string' } },
    },
  );

  logger.info(`Users with null rollNumber cleaned: ${unsetResult.modifiedCount}`);
  logger.info(`Created partial unique ${ROLL_NUMBER_INDEX} index`);
};

run()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error(`Roll number index migration failed: ${err.message}`);
    try {
      await mongoose.connection.close();
    } catch {
      // ignore close errors
    }
    process.exit(1);
  });
