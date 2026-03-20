/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          esModuleInterop: true,
          strict: false,
          skipLibCheck: true,
          resolveJsonModule: true,
          moduleResolution: 'node',
          noEmit: true,
        },
        diagnostics: false,
      },
    ],
  },
};
