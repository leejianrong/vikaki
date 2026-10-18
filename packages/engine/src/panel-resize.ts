// The side panel's width (VIK-111): a drag handle on its edge, also usable from the keyboard, and the width remembered. The width is a CSS
// custom property on the body, `--panel-width`, which the grid and the overlay already follow: nothing here sizes the canvas (ADR-0012).

export const PANEL_MIN = 280;
export const PANEL_DEFAULT = 340;
/** From this width the panel puts the pot and cards on the left and the chat and thoughts on the right. */
export const PANEL_WIDE = 640;
const STORAGE_KEY = "vikaki.panel-width";

/** The widest the panel may be: most of the window, but the table keeps at least 30% of it. */
export function panelMax(viewport: number): number {
  return Math.max(PANEL_MIN, Math.min(960, Math.round(viewport * 0.7)));
}

export function clampWidth(width: number, viewport: number): number {
  return Math.round(Math.min(panelMax(viewport), Math.max(PANEL_MIN, width)));
}

/** The width a keystroke on the handle asks for, or undefined for a key it does not use. Arrows move 20 px (80 with Shift); the left arrow widens the panel, the handle being on its left edge. */
export function widthForKey(key: string, shift: boolean, width: number, viewport: number): number | undefined {
  const step = shift ? 80 : 20;
  if (key === "ArrowLeft") return clampWidth(width + step, viewport);
  if (key === "ArrowRight") return clampWidth(width - step, viewport);
  if (key === "Home") return PANEL_MIN;
  if (key === "End") return panelMax(viewport);
  return undefined;
}

function remembered(): number | undefined {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

function remember(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    /* private window or blocked storage: the width just is not kept */
  }
}

/** Put a resize handle on the panel and apply the remembered width. `onWide` is told whenever the panel crosses `PANEL_WIDE`. */
export function makeResizable(onWide: (wide: boolean) => void): void {
  const body = document.body;
  const handle = document.createElement("div");
  handle.className = "panel-handle";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Resize panel");
  handle.tabIndex = 0;
  let width = PANEL_DEFAULT;
  const apply = (w: number, keep = true) => {
    width = clampWidth(w, window.innerWidth);
    body.style.setProperty("--panel-width", `${width}px`);
    handle.setAttribute("aria-valuemin", String(PANEL_MIN));
    handle.setAttribute("aria-valuemax", String(panelMax(window.innerWidth)));
    handle.setAttribute("aria-valuenow", String(width));
    onWide(width >= PANEL_WIDE);
    if (keep) remember(width);
  };
  handle.addEventListener("pointerdown", (e) => {
    handle.setPointerCapture(e.pointerId);
    body.classList.add("resizing-panel");
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (handle.hasPointerCapture(e.pointerId)) apply(window.innerWidth - e.clientX);
  });
  const end = (e: PointerEvent) => {
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    body.classList.remove("resizing-panel");
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("keydown", (e) => {
    const w = widthForKey(e.key, e.shiftKey, width, window.innerWidth);
    if (w === undefined) return;
    e.preventDefault();
    apply(w);
  });
  handle.addEventListener("dblclick", () => apply(PANEL_DEFAULT));
  window.addEventListener("resize", () => apply(width, false)); // a smaller window may no longer fit the width
  body.append(handle);
  apply(remembered() ?? PANEL_DEFAULT, false);
}
