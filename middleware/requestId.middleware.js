'use strict';
const { randomUUID } = require('crypto');

exports.assignRequestId = (req, res, next) => {
  // Extract existing Request-ID if frontend sent it, otherwise strictly generate a new UUID
  const reqId = req.headers['x-request-id'] || randomUUID();
  
  req.requestId = reqId;

  // Affix back onto the response headers for frontend tracing mapping
  res.setHeader('X-Request-ID', reqId);
  next();
};
