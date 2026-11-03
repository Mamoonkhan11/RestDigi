// This test will run only for the files in the __tests__ folder 

const nextJest = /** @type {any} */ (require('next/jest')).default ?? require('next/jest');
const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jest-environment-jsdom',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
  ],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },

  collectCoverageFrom: [
    'lib/**/*.{ts,tsx}',
    'middleware.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],

  coverageThreshold: {
    global: {
      branches: 10,
      functions: 9,
      lines: 15,
      statements: 15,
    },
  },
};
module.exports = createJestConfig(config);
