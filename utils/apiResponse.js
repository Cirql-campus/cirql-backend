'use strict';

/**
 * Standard API response helpers.
 * All responses follow: { success, message, ...data }
 */

const success = (res, data = null, message = 'Success', statusCode = 200) => {
  if (res.headersSent || res.writableEnded) return undefined;
  const body = { success: true, message };
  if (data !== null && data !== undefined) Object.assign(body, data);
  return res.status(statusCode).json(body);
};

const error = (res, message = 'Something went wrong', statusCode = 400, errors = null) => {
  if (res.headersSent || res.writableEnded) return undefined;
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
};

module.exports = { success, error };
