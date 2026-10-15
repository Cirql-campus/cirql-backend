'use strict';

// Single source of truth for how long a login stays alive on a device.
//
// A user who logs in once keeps a refresh-token cookie for REFRESH_TOKEN_TTL_DAYS.
// Every time the short-lived access token (15 min) expires, the frontend silently
// calls /auth/refresh, which rotates the refresh token and starts a fresh window.
// So the user only has to log in again after 45 days WITHOUT opening the app.
//
// The same value drives the JWT expiry, the cookie lifetime and the MongoDB
// RefreshToken expiry so the three can never drift apart.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 45;
const MAX_REFRESH_TOKEN_TTL_DAYS = 365;

const getRefreshTokenTtlDays = () => {
  const configured = Number.parseInt(process.env.REFRESH_TOKEN_TTL_DAYS, 10);
  if (
    Number.isInteger(configured) &&
    configured >= 1 &&
    configured <= MAX_REFRESH_TOKEN_TTL_DAYS
  ) {
    return configured;
  }
  return DEFAULT_REFRESH_TOKEN_TTL_DAYS;
};

const getRefreshTokenTtlMs = () => getRefreshTokenTtlDays() * DAY_MS;

module.exports = {
  DEFAULT_REFRESH_TOKEN_TTL_DAYS,
  getRefreshTokenTtlDays,
  getRefreshTokenTtlMs,
};
