'use strict';

const normalizeEmail = (email) =>
  String(email || '')
    .toLowerCase()
    .trim();

const BUILT_IN_ADMIN_EMAILS = new Set([
  'abhishek.25014001@kiet.edu',
]);

const getConfiguredAdminEmails = () =>
  process.env.ADMIN_EMAILS
    ? process.env.ADMIN_EMAILS.split(',').map((email) => normalizeEmail(email))
    : [];

const isAdminEmail = (email) =>
  BUILT_IN_ADMIN_EMAILS.has(normalizeEmail(email)) ||
  getConfiguredAdminEmails().includes(normalizeEmail(email));

module.exports = { isAdminEmail };
