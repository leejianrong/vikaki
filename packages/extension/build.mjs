// Builds the extension into dist/ (or --out <dir>). --extra-match <pattern> adds a page to run on, for tests.
// usage: node build.mjs [--out dir] [--extra-match "http://127.0.0.1/*"]
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: { out: { type: "string", default: resolve(here, "dist") }, "extra-match": { type: "string", multiple: true, default: [] } },
});
const out = resolve(values.out);

const entries = [
  ["main-world", "src/main-world.ts"],
  ["bridge", "src/bridge.ts"],
];
for (const [i, [name, entry]] of entries.entries()) {
  await build({
    root: here,
    configFile: false,
    logLevel: "warn",
    // Classic content scripts cannot contain import.meta; libraries use it to resolve their own URL.
    define: { "import.meta.url": "location.href" },
    build: {
      outDir: out,
      emptyOutDir: i === 0,
      target: "esnext",
      minify: true,
      chunkSizeWarningLimit: 4000,
      lib: { entry: resolve(here, entry), formats: ["es"], name: `vikaki_${name.replace("-", "_")}`, fileName: () => `${name}.js` },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
}

// Content scripts are classic scripts, so an ES module cannot be used as is. The lip-sync library
// uses top-level await (it compiles WASM at import), so wrap the whole bundle in an async function.
for (const [name] of entries) {
  const file = resolve(out, `${name}.js`);
  const code = readFileSync(file, "utf8");
  if (code.includes("import.meta")) throw new Error(`${name}.js still contains import.meta; it would not run as a content script`);
  if (/^\s*(import|export)\s/m.test(code)) throw new Error(`${name}.js still has import/export statements; it cannot run as a content script`);
  writeFileSync(file, `(async () => {\n${code}\n})();\n`);
}

mkdirSync(resolve(out, "assets"), { recursive: true });
const engine = resolve(here, "../engine/public");
cpSync(resolve(engine, "avatars/cookieman.vrm"), resolve(out, "assets/avatar.vrm"));
cpSync(resolve(engine, "profiles/default.bin"), resolve(out, "assets/profile.bin"));

const manifest = JSON.parse(readFileSync(resolve(here, "manifest.json"), "utf8"));
for (const extra of values["extra-match"]) {
  for (const cs of manifest.content_scripts) cs.matches.push(extra);
  for (const war of manifest.web_accessible_resources) war.matches.push(extra);
}
writeFileSync(resolve(out, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`extension built in ${out}`);
