// On a failing test, save a screenshot and the browser console of every open page, so a CI failure can be looked at
// instead of re-run. CI uploads packages/e2e/artifacts when e2e fails. Tests need no changes: pages are tracked by
// wrapping the two ways they are made.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { beforeEach, onTestFailed } from "vitest";

const OUT = fileURLToPath(new URL("../artifacts/", import.meta.url));
interface Tracked {
  page: Page;
  log: string[];
}
const open = new Set<Tracked>();

function track(page: Page): void {
  const t: Tracked = { page, log: [] };
  open.add(t);
  page.on("console", (m) => t.log.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => t.log.push(`[pageerror] ${e.message}`));
  page.on("close", () => open.delete(t));
}
function wrapNewPage(owner: Browser | BrowserContext): void {
  const original = owner.newPage.bind(owner) as (...a: unknown[]) => Promise<Page>;
  (owner as { newPage: unknown }).newPage = async (...a: unknown[]) => {
    const page = await original(...a);
    track(page);
    return page;
  };
}

const launch = chromium.launch.bind(chromium);
chromium.launch = async (...a: Parameters<typeof launch>) => {
  const b = await launch(...a);
  wrapNewPage(b);
  return b;
};
const launchPersistent = chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext = async (...a: Parameters<typeof launchPersistent>) => {
  const c = await launchPersistent(...a);
  wrapNewPage(c);
  c.on("page", track); // pages the browser opens itself, such as the extension's
  return c;
};

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 80);

beforeEach((ctx) => {
  open.clear();
  onTestFailed(async () => {
    const dir = join(OUT, `${slug(ctx.task.file?.name.split("/").pop() ?? "test")}--${slug(ctx.task.name)}`);
    mkdirSync(dir, { recursive: true });
    let n = 0;
    for (const t of [...open]) {
      const id = ++n;
      writeFileSync(join(dir, `page-${id}.console.log`), `${t.page.url()}\n\n${t.log.join("\n")}\n`);
      await t.page.screenshot({ path: join(dir, `page-${id}.png`), timeout: 5000 }).catch(() => {});
    }
  });
});
