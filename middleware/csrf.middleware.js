'use strict';

const crypto = require('crypto');
const { success, error } = require('../utils/apiResponse');
const { buildCookieOptions } = require('../utils/cookieOptions');

const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'cirql_csrf';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const parseOrigins = (value = '') => value
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const getAllowedOrigins = () => new Set([
  ...parseOrigins(process.env.FRONTEND_ORIGINS || 'http://localhost:5173'),
  ...parseOrigins(process.env.FRONTEND_URL || ''),
]);

const getRequestOrigin = (req) => {
  if (req.headers.origin) return req.headers.origin;
  if (!req.headers.referer) return '';

  try {
    return new URL(req.headers.referer).origin;
  } catch {
    return '';
  }
};

const isTrustedOrigin = (origin) => Boolean(origin && getAllowedOrigins().has(origin));

const cookieOptions = () => buildCookieOptions({
  httpOnly: false,
  maxAge: 24 * 60 * 60 * 1000,
});

const createToken = () => crypto.randomBytes(32).toString('hex');

const timingSafeEqual = (a, b) => {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const ensureCsrfToken = (req, res) => {
  const token = req.cookies?.[CSRF_COOKIE] || createToken();
  res.cookie(CSRF_COOKIE, token, cookieOptions());
  res.locals.csrfToken = token;
  return token;
};

const hasAuthCookie = (req) => Boolean(req.cookies?.cirql_access || req.cookies?.cirql_refresh);

const shouldRequireHeaderToken = () => process.env.CSRF_REQUIRE_TOKEN === 'true';

const csrfTokenRoute = (req, res) => {
  const csrfToken = ensureCsrfToken(req, res);
  return success(res, { csrfToken });
};

const csrfProtect = (req, res, next) => {
  ensureCsrfToken(req, res);

  if (!UNSAFE_METHODS.has(req.method)) return next();
  if (!hasAuthCookie(req)) return next();

  const requestOrigin = getRequestOrigin(req);
  if (!requestOrigin) return next();
  if (!isTrustedOrigin(requestOrigin)) {
    return error(res, 'Invalid request origin', 403);
  }

  if (!shouldRequireHeaderToken()) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];

  if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
    return error(res, 'Invalid CSRF token', 403);
  }

  next();
};

module.exports = {
  CSRF_HEADER,
  CSRF_COOKIE,
  csrfProtect,
  csrfTokenRoute,
  ensureCsrfToken,
};
