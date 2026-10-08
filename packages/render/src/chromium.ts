import { existsSync } from "node:fs";

/** What to run to get a browser for headless rendering (an optional install, like the voice: ADR-0010). */
export const INSTALL_RENDERER_COMMAND = "make install-renderer";

export interface ChromiumEnv {
  env: NodeJS.ProcessEnv;
  exists(path: string): boolean;
  /** Where Playwright expects its Chromium, or undefined if Playwright is not installed. */
  playwrightPath(): Promise<string | undefined>;
}

export type Located = { ok: true; path: string; source: "VIKAKI_CHROME" | "playwright" } | { ok: false; problem: string; fix: string };

/** Find a Chromium to render with: `VIKAKI_CHROME` if set, otherwise the one Playwright installed. Says what is wrong and how to fix it if not. */
export async function locateChromium(d: ChromiumEnv): Promise<Located> {
  const given = d.env.VIKAKI_CHROME;
  if (given) {
    return d.exists(given)
      ? { ok: true, path: given, source: "VIKAKI_CHROME" }
      : { ok: false, problem: `VIKAKI_CHROME points at ${given}, which does not exist`, fix: "Fix the path, or unset VIKAKI_CHROME to use the browser Playwright installs." };
  }
  const path = await d.playwrightPath();
  if (path === undefined) {
    return { ok: false, problem: "Playwright (playwright-core) is not installed, so there is no browser to render with", fix: `Run \`${INSTALL_RENDERER_COMMAND}\` (about 170 MB), or set VIKAKI_CHROME to a Chrome or Chromium you already have.` };
  }
  if (!d.exists(path)) {
    return { ok: false, problem: `the browser Playwright expects (${path}) is not downloaded yet`, fix: `Run \`${INSTALL_RENDERER_COMMAND}\` (about 170 MB), or set VIKAKI_CHROME to a Chrome or Chromium you already have.` };
  }
  return { ok: true, path, source: "playwright" };
}

/** The real machine. */
export const realChromiumEnv: ChromiumEnv = {
  env: process.env,
  exists: existsSync,
  playwrightPath: async () => {
    try {
      const { chromium } = await import("playwright-core");
      return chromium.executablePath();
    } catch {
      return undefined; // not installed
    }
  },
};
