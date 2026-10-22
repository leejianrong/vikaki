// The side panel's width (VIK-111): a drag handle on its edge, also usable from the keyboard, and the width remembered. The width is a CSS
// custom property on the body, `--panel-width`, which the grid and the overlay already follow: nothing here sizes the canvas (ADR-0012).

export const PANEL_MIN = 280;
/** The panel opens at about this share of the window (VIK-138): wide enough for the players, the log and the chat to read without scrolling sideways. */
export const PANEL_SHARE = 0.45;
const STORAGE_KEY = "vikaki.panel-width";

/** The widest the panel may be: most of the window, but the table keeps at least 30% of it. */
export function panelMax(viewport: number): number {
  return Math.max(PANEL_MIN, Math.min(960, Math.round(viewport * 0.7)));
}

/** The width the panel opens with, and returns to on a double click. */
export function defaultWidth(viewport: number): number {
  return clampWidth(viewport * PANEL_SHARE, viewport);
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

/** Put a resize handle on the panel and apply the remembered width.  */
export function makeResizable(): void {
  const body = document.body;
  const handle = document.createElement("div");
  handle.className = "panel-handle";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Resize panel");
  handle.tabIndex = 0;
  let width = defaultWidth(window.innerWidth);
  const apply = (w: number, keep = true) => {
    width = clampWidth(w, window.innerWidth);
    body.style.setProperty("--panel-width", `${width}px`);
    handle.setAttribute("aria-valuemin", String(PANEL_MIN));
    handle.setAttribute("aria-valuemax", String(panelMax(window.innerWidth)));
    handle.setAttribute("aria-valuenow", String(width));
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
  handle.addEventListener("dblclick", () => apply(defaultWidth(window.innerWidth)));
  window.addEventListener("resize", () => apply(width, false)); // a smaller window may no longer fit the width
  body.append(handle);
  apply(remembered() ?? width, false);
}
