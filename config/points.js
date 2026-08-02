'use strict';

// Point values for each action
const POINT_VALUES = {
  listing_created:        5,
  deal_completed_seller: 20,
  deal_completed_buyer:  10,
  review_received_5star: 15,
  review_received_4star:  8,
  profile_completed:      5,
  account_30days:        10,
  account_90days:        10,
  spend_boost_listing:  -50,
  spend_cross_college: -100,
};

// Tier thresholds based on lifetimePoints (never decreases)
const TIERS = [
  { name: 'new',          minPoints:    0, label: 'New',          emoji: ''   },
  { name: 'regular',      minPoints:   50, label: 'Regular',      emoji: '🟢' },
  { name: 'trusted',      minPoints:  200, label: 'Trusted',      emoji: '🔵' },
  { name: 'star_seller',  minPoints:  500, label: 'Star Seller',  emoji: '⭐' },
  { name: 'campus_legend',minPoints: 1000, label: 'Campus Legend', emoji: '🏆' },
];

const getTier = (lifetimePoints = 0) => {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (lifetimePoints >= TIERS[i].minPoints) return TIERS[i];
  }
  return TIERS[0];
};

// Spend costs (positive numbers)
const SPEND_COSTS = {
  boost_listing:  50,
  cross_college: 100,
};

// Anti-abuse: max points earnable per day per user
const MAX_DAILY_EARN = 50;

// Point expiry: earned points expire after 180 days
const EARN_EXPIRY_DAYS = 180;

module.exports = { POINT_VALUES, TIERS, getTier, SPEND_COSTS, MAX_DAILY_EARN, EARN_EXPIRY_DAYS };
