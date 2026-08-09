'use strict';

const DEFAULT_CATEGORIES = [
  {
    slug: 'academia',
    label: 'Academia',
    description: 'Books, notes, past papers, lab equipment',
    gradient: 'linear-gradient(135deg,#1e3a5f,#2d6a9f)',
    color: '#2d6a9f',
    sortOrder: 1,
  },
  {
    slug: 'tech',
    label: 'Tech',
    description: 'Laptops, phones, accessories, components',
    gradient: 'linear-gradient(135deg,#1a1a2e,#16213e)',
    color: '#4f8ef7',
    sortOrder: 2,
  },
  {
    slug: 'rides',
    label: 'Rides',
    description: 'Bicycles, scooters, helmets, ride sharing',
    gradient: 'linear-gradient(135deg,#2d1b1b,#8b2500)',
    color: '#e05c2a',
    sortOrder: 3,
  },
  {
    slug: 'living',
    label: 'Living',
    description: 'Furniture, appliances, room essentials',
    gradient: 'linear-gradient(135deg,#1b2d1b,#2a5c2a)',
    color: '#3a9c3a',
    sortOrder: 4,
  },
  {
    slug: 'attire',
    label: 'Attire',
    description: 'Clothes, shoes, accessories, uniforms',
    gradient: 'linear-gradient(135deg,#2d1b3d,#5c2d8b)',
    color: '#8b5cf6',
    sortOrder: 5,
  },
  {
    slug: 'gifts',
    label: 'Gifts',
    description: 'Gifts, treats, keepsakes, and celebration items',
    gradient: 'linear-gradient(135deg,#3d1b2d,#8b2d5c)',
    color: '#ec4899',
    sortOrder: 6,
  },
  {
    slug: 'misc',
    label: 'Misc',
    description: 'Everything else that does not fit above',
    gradient: 'linear-gradient(135deg,#2d2a1b,#8b7500)',
    color: '#d4a017',
    sortOrder: 7,
  },
  {
    slug: 'services',
    label: 'Services & Gigs',
    description: 'Tutoring, project help, dorm cleaning, running errands',
    gradient: 'linear-gradient(135deg,#2f1b3d,#8b2d5c)',
    color: '#d946ef',
    sortOrder: 8,
  },
];

module.exports = DEFAULT_CATEGORIES;
