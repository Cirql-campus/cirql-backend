'use strict';

let sentry;
let initialized = false;

const initMonitoring = () => {
  if (initialized) return sentry;
  initialized = true;

  if (!process.env.SENTRY_DSN) return null;

  sentry = require('@sentry/node');
  const packageJson = require('../package.json');

  sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.RELEASE_VERSION || `${packageJson.name}@${packageJson.version}`,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
  });

  return sentry;
};

const setupExpressMonitoring = (app) => {
  if (!sentry) return;
  if (typeof sentry.setupExpressErrorHandler === 'function') {
    sentry.setupExpressErrorHandler(app);
  } else if (typeof sentry.expressErrorHandler === 'function') {
    app.use(sentry.expressErrorHandler());
  }
};

const captureException = (err, req) => {
  if (!sentry || !err) return;
  sentry.captureException(err, {
    tags: {
      requestId: req?.requestId,
      path: req?.originalUrl,
      method: req?.method,
    },
    user: req?.userId ? { id: req.userId } : undefined,
  });
};

const getMonitoringStatus = () => ({
  enabled: Boolean(sentry),
  provider: sentry ? 'sentry' : null,
});

module.exports = {
  initMonitoring,
  setupExpressMonitoring,
  captureException,
  getMonitoringStatus,
};
