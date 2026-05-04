'use strict';
const winston = require('winston');

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack }) =>
    `[${ts}] ${level}: ${stack || message}`
  )
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = winston.createLogger({
  level:      process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format:     process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
  silent:     process.env.NODE_ENV === 'test',
  // Never crash the process on a logger error
  exitOnError: false,
});

// Morgan stream — pipes HTTP logs through Winston
logger.stream = {
  write: (message) => logger.http(message.trimEnd()),
};

module.exports = logger;
