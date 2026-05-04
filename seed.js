'use strict';
/**
 * Seed script — inserts categories + test users + 30 listings.
 * SAFE: refuses to run in production.
 */
const dotenv = require('dotenv');
dotenv.config();

if (process.env.NODE_ENV === 'production') {
  console.error('❌  Seed script must not run in production!');
  process.exit(1);
}

const mongoose = require('mongoose');
const User      = require('./models/User');
const Listing   = require('./models/Listing');
const Category  = require('./models/Category');

// ── Category seed data ────────────────────────────────────────────────────────
const CATEGORIES = [
  {
    slug: 'academia', label: 'Academia', emoji: '📚',
    description: 'Books, notes, past papers, lab equipment',
    gradient: 'linear-gradient(135deg,#1e3a5f,#2d6a9f)',
    color: '#2d6a9f', sortOrder: 1,
  },
  {
    slug: 'tech', label: 'Tech', emoji: '💻',
    description: 'Laptops, phones, accessories, components',
    gradient: 'linear-gradient(135deg,#1a1a2e,#16213e)',
    color: '#4f8ef7', sortOrder: 2,
  },
  {
    slug: 'rides', label: 'Rides', emoji: '🚲',
    description: 'Bicycles, scooters, helmets, ride sharing',
    gradient: 'linear-gradient(135deg,#2d1b1b,#8b2500)',
    color: '#e05c2a', sortOrder: 3,
  },
  {
    slug: 'living', label: 'Living', emoji: '🛋️',
    description: 'Furniture, appliances, room essentials',
    gradient: 'linear-gradient(135deg,#1b2d1b,#2a5c2a)',
    color: '#3a9c3a', sortOrder: 4,
  },
  {
    slug: 'attire', label: 'Attire', emoji: '👕',
    description: 'Clothes, shoes, accessories, uniforms',
    gradient: 'linear-gradient(135deg,#2d1b3d,#5c2d8b)',
    color: '#8b5cf6', sortOrder: 5,
  },
  {
    slug: 'misc', label: 'Misc', emoji: '📦',
    description: 'Everything else that does not fit above',
    gradient: 'linear-gradient(135deg,#2d2a1b,#8b7500)',
    color: '#d4a017', sortOrder: 6,
  },
];

// ── Users ─────────────────────────────────────────────────────────────────────
const USERS = [
  { name: 'Aarav Sharma',  email: 'aarav@kiet.edu',    college: 'KIET Group of Institutions',           collegeDomain: 'kiet.edu' },
  { name: 'Priya Patel',   email: 'priya@dtu.ac.in',   college: 'Delhi Technological University (DTU)', collegeDomain: 'dtu.ac.in' },
  { name: 'Ravi Verma',    email: 'ravi@iitd.ac.in',   college: 'IIT Delhi',                            collegeDomain: 'iitd.ac.in' },
  { name: 'Sneha Mishra',  email: 'sneha@jiit.ac.in',  college: 'JIIT Noida',                           collegeDomain: 'jiit.ac.in' },
];

// ── Listings (category = slug, lowercase) ─────────────────────────────────────
const LISTING_TEMPLATES = [
  { title: 'Casio fx-991EX Scientific Calculator',    price: 800,   category: 'academia', type: 'sell', condition: 'Like New', description: 'Barely used. All buttons work.' },
  { title: 'Arduino Uno Starter Kit',                  price: 1500,  category: 'tech',     type: 'sell', condition: 'Good',     description: 'Complete kit with breadboard and wires.' },
  { title: 'Data Structures Textbook (Cormen)',         price: 450,   category: 'academia', type: 'sell', condition: 'Good',     description: 'No markings inside.' },
  { title: 'Hercules Roadeo Bicycle',                  price: 3500,  category: 'rides',    type: 'sell', condition: 'Fair',     description: 'Recently serviced.' },
  { title: 'Mini Fridge (Rent per semester)',           price: 500,   category: 'living',   type: 'rent', condition: 'Good',     description: 'Available immediately.' },
  { title: 'HP Pavilion Laptop 15 (2021)',              price: 28000, category: 'tech',     type: 'sell', condition: 'Like New', description: 'i5 11th gen, 8GB RAM, 512GB SSD.' },
  { title: 'Old Navy Hoodie (L)',                       price: 0,     category: 'attire',   type: 'free', condition: 'Good',     description: 'Just take it.' },
  { title: 'Single Room Mattress',                      price: 1200,  category: 'living',   type: 'sell', condition: 'Fair',     description: 'Moving out of hostel.' },
  { title: 'Engg Mathematics Vol 1 & 2 – B.S. Grewal', price: 350,   category: 'academia', type: 'sell', condition: 'Good',     description: 'Light pencil marks on some pages.' },
  { title: 'Raspberry Pi 4 (4GB)',                      price: 4200,  category: 'tech',     type: 'sell', condition: 'Like New', description: 'Used for one project only.' },
];

const seed = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected');

  // ── Seed categories (upsert so re-runs are safe) ─────────────────────────
  console.log('\n🌱 Seeding categories…');
  for (const cat of CATEGORIES) {
    await Category.findOneAndUpdate(
      { slug: cat.slug },
      { $set: cat },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`   Category: ${cat.emoji}  ${cat.label}`);
  }

  // ── Clear & re-seed users and listings ────────────────────────────────────
  await User.deleteMany();
  await Listing.deleteMany();
  // Reset listingCounts on categories
  await Category.updateMany({}, { $set: { listingCount: 0 } });
  console.log('\n🗑  Cleared users & listings');

  const createdUsers = [];
  for (const u of USERS) {
    const doc = new User({ ...u, password: 'Password1', isVerified: true });
    await doc.save(); // triggers pre-save hooks (hash pw, set initials)
    createdUsers.push(doc);
    console.log(`   User: ${doc.name} (${doc.email})`);
  }

  let count = 0;
  // Bypass the async category validator during seeding by using Model.create()
  // after categories are already in DB, or use insertMany for speed.
  for (let i = 0; i < 30; i++) {
    const tpl    = LISTING_TEMPLATES[i % LISTING_TEMPLATES.length];
    const seller = createdUsers[i % createdUsers.length];

    // create() triggers full validation + post-save hook → increments listingCount
    await Listing.create({
      ...tpl,
      title:    `${tpl.title}  #${i + 1}`,
      seller:   seller._id,
      college:  seller.college,
      location: seller.college,
      images:   [],
    });
    await User.findByIdAndUpdate(seller._id, { $inc: { listingCount: 1 } });
    count++;
  }

  console.log(`\n✅ Seeded ${count} listings`);
  console.log('\nTest credentials (password: Password1):');
  createdUsers.forEach(u => console.log(`  ${u.email}`));

  process.exit(0);
};

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
