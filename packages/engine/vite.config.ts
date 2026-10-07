import { defineConfig } from "vite";

// The server mounts the built page at /avatar, so assets must resolve under it.
export default defineConfig({
  base: "/avatar/",
  build: { outDir: "dist", emptyOutDir: true },
});
