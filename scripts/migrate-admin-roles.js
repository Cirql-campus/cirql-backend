// Run once: node scripts/migrate-admin-roles.js
const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');

async function migrate() {
  if (!process.env.MONGODB_URI) {
    console.error('Error: MONGODB_URI is not defined in the environment.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected successfully.');

  // 1. Migrate existing users with role 'admin' to 'super_admin'
  const result = await User.updateMany(
    { role: 'admin' },
    { $set: { role: 'super_admin' } }
  );
  console.log(`Migrated ${result.modifiedCount} admin users to super_admin`);

  // 2. Explicitly ensure target user 'abhishek.25014001@kiet.edu' is super_admin
  const targetEmail = 'abhishek.25014001@kiet.edu';
  const targetUser = await User.findOne({ email: targetEmail.toLowerCase().trim() });
  if (targetUser) {
    if (targetUser.role !== 'super_admin') {
      targetUser.role = 'super_admin';
      await targetUser.save();
      console.log(`User ${targetEmail} role updated to super_admin.`);
    } else {
      console.log(`User ${targetEmail} is already super_admin.`);
    }
  } else {
    console.log(`Target user ${targetEmail} not found in the database. They will be auto-promoted to super_admin upon their next login.`);
  }

  await mongoose.disconnect();
  console.log('Database migration complete. Disconnected.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
