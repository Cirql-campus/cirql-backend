'use strict';
const Listing = require('../models/Listing');
const { success, error } = require('../utils/apiResponse');
const {
  isValidId,
  findImageIndex,
  destroyCloudinaryImages,
  flushPublicListingCaches,
  decorateListingImages,
  parseCoverImageIndex,
} = require('./listing.controller');

exports.deleteListingImage = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);

  const listing = await Listing.findById(req.params.id).select('+imageMetadata');
  if (!listing) return error(res, 'Listing not found', 404);
  const isAdmin = req.user?.role === 'super_admin' || (req.user?.role === 'college_admin' && req.user.adminCollege === listing.college);
  if (listing.seller.toString() !== req.userId && !isAdmin) {
    return error(res, 'Not authorised', 403);
  }
  if ((listing.images || []).length <= 1) {
    return error(res, 'A listing must keep at least one image', 400);
  }

  const imageIndex = findImageIndex(listing, req.body);
  if (imageIndex < 0) return error(res, 'Image not found on this listing', 404);

  const deletedUrl = listing.images[imageIndex];
  const deletedMetadata = listing.imageMetadata?.[imageIndex];

  listing.images.splice(imageIndex, 1);
  if (Array.isArray(listing.imageMetadata) && listing.imageMetadata.length > imageIndex) {
    listing.imageMetadata.splice(imageIndex, 1);
  }

  if (listing.coverImageIndex === imageIndex) {
    listing.coverImageIndex = 0;
  } else if (listing.coverImageIndex > imageIndex) {
    listing.coverImageIndex -= 1;
  }
  listing.coverImageIndex = Math.min(
    Math.max(listing.coverImageIndex || 0, 0),
    listing.images.length - 1
  );

  await listing.save();
  destroyCloudinaryImages({
    images: deletedUrl ? [deletedUrl] : [],
    imageMetadata: deletedMetadata ? [deletedMetadata] : [],
  }, req.requestId);

  await flushPublicListingCaches();

  return success(res, { listing: decorateListingImages(listing) }, 'Image deleted successfully');
};

exports.reorderListingImages = async (req, res) => {
  if (!isValidId(req.params.id)) return error(res, 'Invalid listing ID', 400);

  const listing = await Listing.findById(req.params.id).select('+imageMetadata');
  if (!listing) return error(res, 'Listing not found', 404);
  const isAdmin = req.user?.role === 'super_admin' || (req.user?.role === 'college_admin' && req.user.adminCollege === listing.college);
  if (listing.seller.toString() !== req.userId && !isAdmin) {
    return error(res, 'Not authorised', 403);
  }

  const requestedImages = req.body.images;
  const currentImages = listing.images || [];
  if (requestedImages.length !== currentImages.length) {
    return error(res, 'Reorder request must include every current image exactly once', 422);
  }

  const currentSet = new Set(currentImages);
  const requestedSet = new Set(requestedImages);
  if (currentSet.size !== requestedSet.size || requestedImages.some(url => !currentSet.has(url))) {
    return error(res, 'Reorder request contains unknown or duplicate images', 422);
  }

  const metadataByUrl = new Map();
  (listing.imageMetadata || []).forEach((metadata, index) => {
    const currentUrl = currentImages[index];
    if (currentUrl) metadataByUrl.set(currentUrl, metadata);
    if (metadata.url) metadataByUrl.set(metadata.url, metadata);
    if (metadata.secureUrl) metadataByUrl.set(metadata.secureUrl, metadata);
  });

  const coverImageIndex = parseCoverImageIndex(
    req.body.coverImageIndex,
    requestedImages.length,
    listing.coverImageIndex
  );
  if (coverImageIndex === null) return error(res, 'Cover image index is invalid', 422);

  listing.images = requestedImages;
  listing.imageMetadata = requestedImages
    .map(url => metadataByUrl.get(url))
    .filter(Boolean);
  listing.coverImageIndex = coverImageIndex;

  await listing.save();
  await flushPublicListingCaches();

  return success(res, { listing: decorateListingImages(listing) }, 'Images reordered successfully');
};
