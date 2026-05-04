'use strict';

const logger = require('../utils/logger');

const requestTimeout = (timeoutMs = 30000) => (req, res, next) => {
  if (req.path === '/health') return next();

  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    req.timedOut = true;

    if (!res.headersSent) {
      logger.warn(`[${req.requestId || 'no-request-id'}] Request timed out: ${req.method} ${req.originalUrl}`);
      res.status(503).json({
        success: false,
        message: 'Server is taking too long to respond. Please try again.',
        requestId: req.requestId,
      });
    }
  }, timeoutMs);

  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));

  req.on('aborted', () => {
    timedOut = true;
    clearTimeout(timer);
  });

  res.locals.hasTimedOut = () => timedOut;
  next();
};

module.exports = requestTimeout;
