'use strict';

const REQUIRED_VARS = [
  'MONGODB_URI',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'FIELD_ENCRYPTION_KEY',
  'EMAIL_HOST',
  'EMAIL_USER',
  'EMAIL_PASS',
  'EMAIL_FROM_NAME',
  'EMAIL_FROM_ADDRESS',
  'FRONTEND_URL',
  'FRONTEND_ORIGINS',
  'ALLOWED_COLLEGE_DOMAINS',
  'ADMIN_EMAILS',
];

const OPTIONAL_GROUPS = [
  {
    name: 'Cloudinary uploads',
    vars: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
    requiredInProduction: true,
  },
  {
    name: 'Redis production scaling',
    vars: ['REDIS_URL'],
  },
  {
    name: 'Sentry error monitoring',
    vars: ['SENTRY_DSN'],
  },
];

const MIN_SECRET_LENGTH = 32;

const parseOrigins = (value = '') => value
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const isLocalUrl = (value = '') =>
  /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value);

module.exports = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const productionRequiredVars = OPTIONAL_GROUPS
    .filter(group => group.requiredInProduction)
    .flatMap(group => group.vars);
  const missing = [...REQUIRED_VARS, ...(isProduction ? productionRequiredVars : [])]
    .filter(v => !process.env[v]);
  const weakSecrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'FIELD_ENCRYPTION_KEY']
    .filter(v => process.env[v] && process.env[v].length < MIN_SECRET_LENGTH);
  const productionConfigErrors = [];

  if (isProduction) {
    const frontendOrigins = parseOrigins(process.env.FRONTEND_ORIGINS);
    if (!process.env.FRONTEND_URL?.startsWith('https://')) {
      productionConfigErrors.push('FRONTEND_URL must use https:// in production');
    }
    if (frontendOrigins.length === 0 || frontendOrigins.some(origin => !origin.startsWith('https://') || isLocalUrl(origin))) {
      productionConfigErrors.push('FRONTEND_ORIGINS must contain only deployed https:// origins in production');
    }
    if (isLocalUrl(process.env.FRONTEND_URL)) {
      productionConfigErrors.push('FRONTEND_URL cannot point to localhost in production');
    }
    if (process.env.MONGODB_URI && !/mongodb\+srv:\/\//.test(process.env.MONGODB_URI)) {
      productionConfigErrors.push('Use a hosted MongoDB connection string, preferably mongodb+srv://, in production');
    }
    if (!process.env.SENTRY_DSN) {
      productionConfigErrors.push('SENTRY_DSN is required in production for error monitoring');
    }
  }

  if (missing.length > 0 || (isProduction && weakSecrets.length > 0) || productionConfigErrors.length > 0) {
    const lines = [];
    if (missing.length > 0) {
      lines.push(`Missing required environment variables:\n  - ${missing.join('\n  - ')}`);
    }
    if (weakSecrets.length > 0) {
      lines.push(`Secrets must be at least ${MIN_SECRET_LENGTH} characters:\n  - ${weakSecrets.join('\n  - ')}`);
    }
    if (productionConfigErrors.length > 0) {
      lines.push(`Invalid production configuration:\n  - ${productionConfigErrors.join('\n  - ')}`);
    }

    process.stderr.write(`\n[FATAL] ${lines.join('\n\n')}\n\nThe server cannot start. Exiting.\n\n`);
    process.exit(1);
  }

  if (!isProduction && weakSecrets.length > 0) {
    process.stderr.write(
      `[WARN] Weak development secrets. Use at least ${MIN_SECRET_LENGTH} characters before production: ${weakSecrets.join(', ')}\n`
    );
  }

  OPTIONAL_GROUPS
    .filter(group => !(isProduction && group.requiredInProduction))
    .forEach(group => {
    const missingOptional = group.vars.filter(v => !process.env[v]);
    if (missingOptional.length > 0 && missingOptional.length < group.vars.length) {
      process.stderr.write(
        `[WARN] ${group.name} is partially configured. Missing: ${missingOptional.join(', ')}\n`
      );
    } else if (missingOptional.length === group.vars.length) {
      process.stderr.write(`[WARN] ${group.name} is not configured; related features will be unavailable.\n`);
    }
  });
};
