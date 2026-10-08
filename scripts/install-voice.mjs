#!/usr/bin/env node
// Installs the real voice (Kokoro, Apache-2.0) into .vikaki/voice, away from the workspace so CI and
// everyone else keep a small install (ADR-0010). Safe to run again: it skips what is already there.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".vikaki", "voice");
const entry = join(dir, "node_modules", "kokoro-js", "dist", "kokoro.js");
const modelFile = join(dir, "node_modules", "@huggingface", "transformers", ".cache", "onnx-community", "Kokoro-82M-v1.0-ONNX", "onnx", "model_quantized.onnx");

const step = (msg) => console.log(`\n==> ${msg}`);
const fail = (msg) => {
  console.error(`\nCould not install the voice: ${msg}`);
  process.exit(1);
};

if (!existsSync(entry)) {
  step("Installing kokoro-js (about 410 MB with its runtime). This takes a minute or two.");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, "package.json"))) writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "vikaki-voice", private: true, type: "module" }, null, 2));
  // The flag avoids an onnxruntime-node install error on machines where CUDA 11 is detected (seen under WSL).
  const r = spawnSync("npm", ["install", "kokoro-js", "--onnxruntime-node-install-cuda=skip", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit" });
  if (r.status !== 0) fail("npm install failed. The output above says why; the most common causes are no network or no disk space.");
} else {
  console.log("kokoro-js is already installed.");
}

if (!existsSync(modelFile)) {
  step("Downloading the voice model (about 90 MB) and checking that it speaks.");
  const probe = `
    const { KokoroTTS } = await import(${JSON.stringify(entry)});
    const t0 = Date.now();
    const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
    const a = await tts.generate("Hello, I am ready.", { voice: "af_heart" });
    console.log("model loaded and spoke " + (a.audio.length / a.sampling_rate).toFixed(1) + " s of audio in " + ((Date.now() - t0) / 1000).toFixed(0) + " s");`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: dir, stdio: "inherit" });
  if (r.status !== 0) fail("the model did not download or run. Check your network and try again.");
} else {
  console.log("The voice model is already downloaded.");
}

console.log("\nThe real voice is installed. `make demo-speech` will use it.");
