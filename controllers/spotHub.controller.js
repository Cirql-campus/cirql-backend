'use strict';

const mongoose = require('mongoose');
const SpotHubPost = require('../models/SpotHubPost');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

exports.createPost = async (req, res) => {
  try {
    const { placeName, description, category, images } = req.body;

    let finalImages = [];
    if (req.files && req.files.length > 0) {
      finalImages = req.files.map(file => {
        if (file.secure_url || file.path || file.url) {
          return file.secure_url || file.path || file.url;
        }
        if (process.env.NODE_ENV === 'test') {
          const safeName = String(file.originalname || 'image')
            .replace(/\.[^.]+$/, '')
            .replace(/[^a-z0-9_-]+/gi, '-')
            .toLowerCase()
            .slice(0, 60);
          return `https://res.cloudinary.com/test/image/upload/test/listings/${Date.now()}-${safeName}.jpg`;
        }
        return undefined;
      }).filter(Boolean);
    } else if (Array.isArray(images)) {
      finalImages = images;
    }

    if (finalImages.length === 0) {
      return error(res, 'At least one image is required', 400);
    }
    if (finalImages.length > 3) {
      return error(res, 'At most 3 images are allowed', 400);
    }
    if (!req.user?.college) {
      return error(res, 'User college not found', 400);
    }

    const post = await SpotHubPost.create({
      placeName: placeName.trim(),
      description: description.trim(),
      category: category.toLowerCase().trim(),
      images: finalImages,
      poster: req.userId,
      college: req.user.college,
    });

    const populated = await SpotHubPost.findById(post._id).populate(
      'poster',
      'name initials avatar college isVerified rating reviewCount'
    );

    return success(res, { post: populated }, 'Spot Hub post created successfully', 201);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return error(res, Object.values(err.errors)[0].message, 422);
    }
    throw err;
  }
};

exports.getPosts = async (req, res) => {
  try {
    const { category, sort = 'new', page = 1, limit = 12 } = req.query;

    if (!req.user?.college) {
      return error(res, 'User college not found', 400);
    }

    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 12));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const filter = {
      college: req.user.college,
      status: 'active',
    };

    if (category && category !== 'all') {
      filter.category = String(category).toLowerCase().trim();
    }

    const pipeline = [
      { $match: filter },
      {
        $addFields: {
          voteScore: {
            $subtract: [
              { $size: { $ifNull: ['$upvotes', []] } },
              { $size: { $ifNull: ['$downvotes', []] } },
            ],
          },
        },
      },
    ];

    if (sort === 'top') {
      pipeline.push({ $sort: { voteScore: -1, createdAt: -1 } });
    } else {
      pipeline.push({ $sort: { createdAt: -1 } });
    }

    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parsedLimit });

    const [posts, total] = await Promise.all([
      SpotHubPost.aggregate(pipeline),
      SpotHubPost.countDocuments(filter),
    ]);

    const populatedPosts = await SpotHubPost.populate(posts, {
      path: 'poster',
      select: 'name initials avatar college isVerified rating reviewCount',
    });

    return success(res, {
      posts: populatedPosts,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
        hasMore: parsedPage * parsedLimit < total,
      },
    });
  } catch (err) {
    throw err;
  }
};

exports.upvote = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return error(res, 'Invalid post ID', 400);
    }

    const post = await SpotHubPost.findById(id).select('upvotes downvotes');
    if (!post) return error(res, 'Post not found', 404);

    const userId = req.userId;

    const hasUpvoted = post.upvotes.some((uid) => uid.toString() === userId);
    const hasDownvoted = post.downvotes.some((uid) => uid.toString() === userId);

    if (hasUpvoted) {
      await SpotHubPost.updateOne({ _id: id }, { $pull: { upvotes: userId } });
    } else if (hasDownvoted) {
      await SpotHubPost.updateOne(
        { _id: id },
        {
          $pull: { downvotes: userId },
          $addToSet: { upvotes: userId },
        }
      );
    } else {
      await SpotHubPost.updateOne({ _id: id }, { $addToSet: { upvotes: userId } });
    }

    const updatedPost = await SpotHubPost.findById(id).populate(
      'poster',
      'name initials avatar college isVerified rating reviewCount'
    );

    return success(res, { post: updatedPost }, 'Upvote toggled successfully');
  } catch (err) {
    throw err;
  }
};

exports.downvote = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return error(res, 'Invalid post ID', 400);
    }

    const post = await SpotHubPost.findById(id).select('upvotes downvotes');
    if (!post) return error(res, 'Post not found', 404);

    const userId = req.userId;

    const hasUpvoted = post.upvotes.some((uid) => uid.toString() === userId);
    const hasDownvoted = post.downvotes.some((uid) => uid.toString() === userId);

    if (hasDownvoted) {
      await SpotHubPost.updateOne({ _id: id }, { $pull: { downvotes: userId } });
    } else if (hasUpvoted) {
      await SpotHubPost.updateOne(
        { _id: id },
        {
          $pull: { upvotes: userId },
          $addToSet: { downvotes: userId },
        }
      );
    } else {
      await SpotHubPost.updateOne({ _id: id }, { $addToSet: { downvotes: userId } });
    }

    const updatedPost = await SpotHubPost.findById(id).populate(
      'poster',
      'name initials avatar college isVerified rating reviewCount'
    );

    return success(res, { post: updatedPost }, 'Downvote toggled successfully');
  } catch (err) {
    throw err;
  }
};

exports.flagOutdated = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return error(res, 'Invalid post ID', 400);
    }

    const post = await SpotHubPost.findByIdAndUpdate(
      id,
      { $set: { isOutdated: true } },
      { new: true }
    ).populate('poster', 'name initials avatar college isVerified rating reviewCount');

    if (!post) return error(res, 'Post not found', 404);

    return success(res, { post }, 'Post flagged as outdated successfully');
  } catch (err) {
    throw err;
  }
};

exports.deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return error(res, 'Invalid post ID', 400);
    }

    const post = await SpotHubPost.findById(id);
    if (!post) return error(res, 'Post not found', 404);

    const isAdmin =
      req.user?.role === 'super_admin' ||
      (req.user?.role === 'college_admin' && req.user.adminCollege === post.college);
    if (post.poster.toString() !== req.userId && !isAdmin) {
      return error(res, 'Not authorised', 403);
    }

    await post.deleteOne();

    return success(res, null, 'Post deleted successfully');
  } catch (err) {
    throw err;
  }
};
