import type { Page } from "playwright";

/** Fraction of pixels in a lane of the exported picture that differ from the lane's own background. */
export const laneInk = (page: Page, png: string, lane: string) =>
  page.evaluate(
    async ([url, id]) => {
      const layout = window.__vikaki!.timelineUi!.exportLayout();
      const img = new Image();
      img.src = url as string;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const l = layout.lanes.find((x) => x.id === id)!;
      const w = layout.width - layout.gutter;
      const px = g.getImageData(layout.gutter, l.top, w, l.height).data;
      const role = (name: string) => {
        const hex = getComputedStyle(document.documentElement).getPropertyValue(`--md-sys-color-${name}`).trim();
        return [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
      };
      const empty = [role("surface-container"), role("outline-variant")]; // a lane's background and the time gridlines
      let ink = 0;
      for (let i = 0; i < px.length; i += 4) {
        const near = empty.some((c) => Math.abs(px[i]! - c[0]!) + Math.abs(px[i + 1]! - c[1]!) + Math.abs(px[i + 2]! - c[2]!) <= 40);
        if (!near) ink++;
      }
      return { ink: ink / (px.length / 4), size: [img.width, img.height] };
    },
    [png, lane] as const,
  );
