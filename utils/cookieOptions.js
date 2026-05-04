"use strict";

const VALID_SAME_SITE = new Set(["lax", "strict", "none"]);

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes"].includes(String(value).toLowerCase());
};

const getSameSite = () => {
  const configured = String(process.env.COOKIE_SAME_SITE || "").toLowerCase();
  if (VALID_SAME_SITE.has(configured)) return configured;
  return process.env.NODE_ENV === "production" ? "none" : "lax";
};

const getSecure = (sameSite) => {
  const secure = parseBoolean(
    process.env.COOKIE_SECURE,
    process.env.NODE_ENV === "production",
  );
  return sameSite === "none" ? true : secure;
};

const buildCookieOptions = ({ httpOnly = true, maxAge } = {}) => {
  const sameSite = getSameSite();
  const options = {
    httpOnly,
    secure: getSecure(sameSite),
    sameSite,
    path: "/",
  };

  if (maxAge !== undefined) options.maxAge = maxAge;
  return options;
};

module.exports = {
  buildCookieOptions,
};
