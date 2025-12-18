// Global test setup file
// This runs before all tests

// Set test environment variables
process.env.NODE_ENV = "test";

// Suppress console output during tests unless explicitly testing console
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

// Store original functions for restoration in tests that need them
globalThis.testUtils = {
  originalLog,
  originalError,
  originalWarn,
};

declare global {
  var testUtils: {
    originalLog: typeof console.log;
    originalError: typeof console.error;
    originalWarn: typeof console.warn;
  };
}
