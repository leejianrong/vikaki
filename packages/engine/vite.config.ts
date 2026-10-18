import { defineConfig } from "vite";

// The server mounts the built page at /avatar, so assets must resolve under it.
export default defineConfig({
  base: "/avatar/",
  build: { outDir: "dist", emptyOutDir: true, target: "esnext", rollupOptions: { input: { main: "index.html", home: "home.html" } } }, // home.html is the landing page the hub serves at /
});
