import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser, Page } from "playwright";

/** A stand-in for a game's page: another origin (its own port) that frames the hub's /avatar, as Wavelength will (VIK-64 to 67). */
export interface HostPage {
  origin: string;
  close(): Promise<void>;
}

/** Serves `html` at `/` on a free port of 127.0.0.1. The hub is on another port, so the two are different origins. */
export async function serveHost(html: (origin: string) => string, host = "127.0.0.1"): Promise<HostPage> {
  let origin = "";
  const server: Server = createServer((req, res) => {
    if (req.url === "/" || req.url?.startsWith("/?")) res.writeHead(200, { "content-type": "text/html" }).end(html(origin));
    else res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, host, ok));
  origin = `http://${host}:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    close: () =>
      new Promise<void>((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      }),
  };
}

/** `<iframe>` markup for the avatar page; `style` and `attrs` are the host's. */
export const frameHtml = (src: string, attrs = 'allow="autoplay"', style = "position:fixed;inset:0;width:100%;height:100%;border:0") =>
  `<!doctype html><meta charset=utf-8><body style="margin:0;background:#ff00ff"><iframe id="avatar" src="${src}" ${attrs} style="${style}"></iframe>`;

/** The pixel (RGBA) of a PNG screenshot at x, y, read by drawing it on a canvas in a scratch page. */
export async function pixelAt(browser: Browser, png: Buffer, points: [number, number][]): Promise<number[][]> {
  const scratch: Page = await browser.newPage();
  try {
    return await scratch.evaluate(
      async ([b64, pts]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return (pts as [number, number][]).map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
      },
      [png.toString("base64"), points] as const,
    );
  } finally {
    await scratch.close();
  }
}
