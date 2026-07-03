'use strict';
const express  = require('express');
const { getCategories, getCategoryBySlug } = require('../controllers/category.controller');
const asyncHandler = require('../middleware/asyncHandler');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

// GET /api/v1/categories
router.get('/', asyncHandler(getCategories));

// GET /api/v1/categories/:slug
router.get('/:slug', protect, asyncHandler(getCategoryBySlug));

module.exports = router;
