/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['reflect-metadata'],
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!index.ts'],
  coverageDirectory: '../coverage',
};
