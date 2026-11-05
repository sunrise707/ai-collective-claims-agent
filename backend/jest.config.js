module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/.*\.spec\.ts$',
  transform: { '^.+\.ts$': ['ts-jest', { diagnostics: { ignoreCodes: [151001] } }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
};
