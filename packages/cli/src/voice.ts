import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, found from this file, so `.vikaki/voice` is the same wherever the CLI is run from. */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface VoiceInstall {
  /** Where to import kokoro-js from. */
  entry: string;
  /** How it was found: an environment variable, the repo-local install, or an ordinary node_modules install. */
  source: "environment" | "local" | "global";
}

const localDir = (root: string) => join(root, ".vikaki", "voice");
const localEntry = (root: string) => join(localDir(root), "node_modules", "kokoro-js", "dist", "kokoro.js");

/** Where the voice model would be cached by the repo-local install. */
export const modelPath = (root: string) =>
  join(localDir(root), "node_modules", "@huggingface", "transformers", ".cache", "onnx-community", "Kokoro-82M-v1.0-ONNX", "onnx", "model_quantized.onnx");

/**
 * Find an installed Kokoro: the `VIKAKI_KOKORO_PATH` override first, then the `make install-voice`
 * location, then plain `kokoro-js`. Returns undefined when none is present.
 */
export function findVoice(env: NodeJS.ProcessEnv = process.env, root = repoRoot, exists: (p: string) => boolean = existsSync): VoiceInstall | undefined {
  if (env.VIKAKI_KOKORO_PATH) return exists(env.VIKAKI_KOKORO_PATH) ? { entry: env.VIKAKI_KOKORO_PATH, source: "environment" } : undefined;
  if (exists(localEntry(root))) return { entry: localEntry(root), source: "local" };
  return undefined;
}

export const INSTALL_COMMAND = "make install-voice";
