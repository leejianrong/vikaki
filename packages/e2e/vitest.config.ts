import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // afterEach hooks run in the order they were registered, so setup.ts can photograph a failed test before the file closes its pages
    sequence: { hooks: "list" },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // `smoke` is the quick per-PR subset (pnpm test:e2e:smoke). Everything runs nightly and on main. See docs/testing.md.
    tags: [{ name: "smoke", description: "fast, one or two per surface; runs on every PR" }],
  },
});
