/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/__mocks__/obsidian.ts',
    '^@anthropic-ai/claude-agent-sdk$':
      '<rootDir>/__mocks__/claude-agent-sdk.ts',
  },
  testPathIgnorePatterns: ['<rootDir>/REFERENCES/'],
  modulePathIgnorePatterns: ['<rootDir>/REFERENCES/'],
  transform: {
    '^.+.tsx?$': ['ts-jest', {}],
  },
}
