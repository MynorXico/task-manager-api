import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
  },
  resolve: {
    // Allow TypeScript source files to be imported with .js extensions
    // (TypeScript's Node16 / NodeNext convention).
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
});
