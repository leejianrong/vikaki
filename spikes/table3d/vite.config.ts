import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Throwaway: serves this folder with the engine's avatars. `three` and `three-vrm` come from a git-ignored link, made once with
//   ln -s ../../packages/engine/node_modules spikes/table3d/node_modules
// then run from packages/engine:
//   pnpm --filter @vikaki/engine exec vite --config ../../spikes/table3d/vite.config.ts --port 5199
const engine = fileURLToPath(new URL("../../packages/engine/", import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: `${engine}public`,
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
});
