import type { Page } from "playwright-core";

export interface ScreencastOptions {
  width: number;
  height: number;
  /** JPEG quality, 1 to 100. */
  quality: number;
}

/**
 * Ask Chromium for the page's picture as JPEG frames (the DevTools screencast: far cheaper than a screenshot per frame,
 * and it only sends when something changed). Returns a function that stops it.
 */
export async function startScreencast(page: Page, o: ScreencastOptions, onFrame: (jpeg: Buffer) => void): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", (e: { data: string; sessionId: number }) => {
    onFrame(Buffer.from(e.data, "base64"));
    void cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {}); // the next frame only comes after this
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: o.quality, maxWidth: o.width, maxHeight: o.height, everyNthFrame: 1 });
  return async () => {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await cdp.detach().catch(() => {});
  };
}
