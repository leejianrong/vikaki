import { resolve } from "node:path";

/**
 * A path the user typed, made absolute. `pnpm serve` and `pnpm vikaki` run the CLI inside packages/cli, so `--personas p.yaml` or
 * `replay log.jsonl` would be looked for there, not where the user is. pnpm and npm say where that was in `INIT_CWD`; use it when
 * it is set, else the current folder (the CLI run directly, as `make` does).
 */
export function fromHere(path: string, env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): string {
  return resolve(env.INIT_CWD || cwd, path);
}
