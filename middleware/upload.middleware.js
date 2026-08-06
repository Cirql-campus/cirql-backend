'use strict';
const multer    = require('multer');
const crypto    = require('crypto');
const cloudinaryStorageModule = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const CloudinaryStorage =
  cloudinaryStorageModule.CloudinaryStorage ||
  cloudinaryStorageModule.default ||
  cloudinaryStorageModule;

const cloudinaryForStorage = cloudinary.v2 ? cloudinary : { v2: cloudinary };

// Allowed MIME types and their extensions
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png',
  'image/webp',
]);

const MAGIC_BYTES = [
  { bytes: [0xFF, 0xD8, 0xFF] },
  { bytes: [0x89, 0x50, 0x4E, 0x47] },
  {
    check: (buffer) =>
      buffer.length >= 12 &&
      buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
      buffer.slice(8, 12).toString('ascii') === 'WEBP',
  },
];

const matchesMagicBytes = (buffer) => MAGIC_BYTES.some((signature) => {
  if (signature.check) return signature.check(buffer);
  return buffer.length >= signature.bytes.length &&
    signature.bytes.every((byte, index) => buffer[index] === byte);
});

const cloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinaryForStorage,
  params: (_req, _file, cb) => cb(undefined, {
    folder: 'cirql/listings',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto:good' }],
    public_id: `listing-${Date.now()}-${crypto.randomUUID()}`,
  }),
});

const storage = process.env.NODE_ENV === 'test'
  ? multer.memoryStorage()
  : cloudinaryStorage;

const isCloudinaryConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );

const requireCloudinaryConfig = (_req, res, next) => {
  if (process.env.NODE_ENV === 'test' || isCloudinaryConfigured()) {
    return next();
  }

  return res.status(503).json({
    success: false,
    message: 'Image upload service is not configured',
  });
};

const fileFilter = (_req, file, cb) => {
  // Double-check MIME — do NOT trust the extension alone
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(Object.assign(new Error('Only JPEG, PNG, or WebP images are allowed'), { status: 400 }), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB per file
    files:    3,               // max 3 images per request
    fieldSize: 2048,           // 2 KB per text field maximum
    fields: 20,                // 20 non-file structural text fields maximum
  },
});

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB for ID photos
    files:    1,
  },
});

// Multer error handler — converts multer errors to our standard format
const validateFileMagicBytes = (req, res, next) => {
  if (!req.files || req.files.length === 0) return next();

  for (const file of req.files) {
    if (file.buffer && !matchesMagicBytes(file.buffer)) {
      return res.status(400).json({
        success: false,
        message: 'File content does not match a supported image format',
      });
    }
  }

  next();
};

const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE')  return res.status(400).json({ success: false, message: 'Each file must be 2 MB or less' });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ success: false, message: 'Maximum 3 images allowed' });
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err) return res.status(err.status || 400).json({ success: false, message: err.message });
  next();
};

module.exports = { upload, memoryUpload, handleUploadError, requireCloudinaryConfig, validateFileMagicBytes };
