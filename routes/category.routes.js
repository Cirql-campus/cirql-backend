'use strict';
const express  = require('express');
const { getCategories, getCategoryBySlug } = require('../controllers/category.controller');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

// GET /api/v1/categories
router.get('/', getCategories);

// GET /api/v1/categories/:slug
router.get('/:slug', protect, getCategoryBySlug);

module.exports = router;
