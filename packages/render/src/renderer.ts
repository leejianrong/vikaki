import type { Browser, Page } from "playwright-core";
import { locateChromium, realChromiumEnv, type ChromiumEnv } from "./chromium.ts";

/** Headless rendering is not possible here, and what to do about it. */
export class RendererUnavailable extends Error {
  constructor(
    readonly problem: string,
    readonly fix: string,
  ) {
    super(`${problem}. ${fix}`);
  }
}

export interface RenderOptions {
  /** The avatar page, such as `http://127.0.0.1:8787/avatar`. */
  pageUrl: string;
  /** One page per entry: a persona name, or undefined for a page that shows every line. Default: one page for everyone. */
  personas?: (string | undefined)[];
  /** Pixels. Default 1280 by 720. */
  size?: { width: number; height: number };
  /** Open audio-only pages (`?render=off`) instead of drawing avatars. */
  audioOnly?: boolean;
  /** Use the machine's GPU instead of software WebGL (swiftshader). Faster where there is one; headless containers usually have none. */
  gpu?: boolean;
  /** Extra query parameters for every page, such as `{ bg: "00ff00" }` or `{ seed: "3" }`. */
  query?: Record<string, string>;
  /** Overrides how the browser is found (tests). */
  chromium?: ChromiumEnv;
  /** Reported when a page prints an error. */
  onPageError?: (message: string, persona: string | undefined) => void;
}

/**
 * A hidden Chromium that opens the avatar page, one tab per persona, connected to the hub like any browser. Lines are
 * rendered for real (so the driver hears timings measured on a page that drew frames) with no one at a screen, which is
 * what CI and unattended runs need. Needs Playwright's Chromium: an optional install (`make install-renderer`).
 */
export class HeadlessRenderer {
  private constructor(
    private readonly browser: Browser,
    readonly pages: ReadonlyMap<string | undefined, Page>,
  ) {}

  static async launch(o: RenderOptions): Promise<HeadlessRenderer> {
    const found = await locateChromium(o.chromium ?? realChromiumEnv);
    if (!found.ok) throw new RendererUnavailable(found.problem, found.fix);
    const { chromium } = await import("playwright-core");
    const args = ["--autoplay-policy=no-user-gesture-required", "--mute-audio"];
    if (!o.gpu) args.push("--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist");
    // The owner (`vikaki serve`) handles Ctrl+C and closes this itself; Playwright's own handler would exit 130 first.
    const browser = await chromium.launch({ executablePath: found.path, args, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
    try {
      const size = o.size ?? { width: 1280, height: 720 };
      const pages = new Map<string | undefined, Page>();
      for (const persona of o.personas ?? [undefined]) {
        const page = await browser.newPage({ viewport: size });
        page.on("pageerror", (e) => o.onPageError?.(e.message, persona));
        const query = new URLSearchParams({ live: "1", hud: "0", ...(persona ? { persona } : {}), ...(o.audioOnly ? { render: "off" } : {}), ...o.query });
        await page.goto(`${o.pageUrl}?${query}`);
        pages.set(persona, page);
      }
      await Promise.all([...pages.values()].map((p) => p.waitForFunction("window.__vikaki?.live?.state === 'connected'", null, { timeout: 60_000 })));
      return new HeadlessRenderer(browser, pages);
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
