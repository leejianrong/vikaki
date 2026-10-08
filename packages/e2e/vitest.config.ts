import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // `smoke` is the quick per-PR subset (pnpm test:e2e:smoke). Everything runs nightly and on main. See docs/testing.md.
    tags: [{ name: "smoke", description: "fast, one or two per surface; runs on every PR" }],
  },
});
