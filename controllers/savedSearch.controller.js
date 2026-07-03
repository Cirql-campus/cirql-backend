'use strict';
const SavedSearch = require('../models/SavedSearch');
const { success, error } = require('../utils/apiResponse');
const {
  isValidId,
  normalizeTags,
  parseBoolean,
} = require('./listing.controller');

exports.getSavedSearches = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  const filter = { user: req.userId };
  const [savedSearches, total] = await Promise.all([
    SavedSearch.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SavedSearch.countDocuments(filter),
  ]);
  return success(res, {
    savedSearches,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
};

exports.createSavedSearch = async (req, res) => {
  try {
    const savedSearch = await SavedSearch.create({
      user: req.userId,
      name: (req.body.name || '').trim(),
      query: (req.body.query || '').trim(),
      category: req.body.category || '',
      type: req.body.type || '',
      minPrice: req.body.minPrice === undefined || req.body.minPrice === '' ? undefined : Number(req.body.minPrice),
      maxPrice: req.body.maxPrice === undefined || req.body.maxPrice === '' ? undefined : Number(req.body.maxPrice),
      condition: req.body.condition || '',
      location: (req.body.location || '').trim(),
      tags: normalizeTags(req.body.tags),
      alertsEnabled: req.body.alertsEnabled === undefined ? true : parseBoolean(req.body.alertsEnabled),
    });

    return success(res, { savedSearch }, 'Saved search created', 201);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return error(res, Object.values(err.errors)[0].message, 422);
    }
    throw err;
  }
};

exports.deleteSavedSearch = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid saved search ID', 400);
  const result = await SavedSearch.deleteOne({ _id: req.params.id, user: req.userId });
  if (result.deletedCount === 0) return error(res, 'Saved search not found', 404);
  return success(res, null, 'Saved search deleted');
};
