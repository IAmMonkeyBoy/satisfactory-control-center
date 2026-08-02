import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Server contract tests need Node APIs (http, streams); web component tests
    // (added in later slices) opt into jsdom per-file.
    environment: "node",
    include: ["packages/**/*.test.ts"],
  },
});
