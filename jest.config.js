'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 60_000,
  clearMocks: true,
  restoreMocks: true,
};
