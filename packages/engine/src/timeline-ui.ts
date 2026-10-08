import { drawTimeline, GUTTER, layoutLanes, readTheme, type Lane, type View } from "./timeline-draw.ts";
import { MOUTH_SHAPES, FRAME_FIELDS, type TimelineRecorder, type UtteranceTimeline } from "./timeline.ts";
import { attrs, el } from "./ui/dom.ts";

/** The live view shows this much before "now" and this much after it (audio is scheduled a little ahead). */
const LIVE_BEFORE_MS = 8000;
const LIVE_AFTER_MS = 2000;
const REDRAW_MS = 66;
const EXPORT_WIDTH = 1600;
const EXPORT_HEIGHT = 420;

export interface TimelineUi {
  /** "live", or the id of the utterance being reviewed. */
  mode(): string;
  select(mode: "live" | string): void;
  /** The current view as a PNG data URL, drawn at export size. */
  exportPng(): string;
  /** The current view as JSON text. Review includes the audio so a scorecard can reuse it. */
  exportJson(): string;
  /** Where the lanes fall in an exported picture, so a test or a script can look at the right pixels. */
  exportLayout(): { width: number; height: number; gutter: number; lanes: Lane[] };
}

const seconds = (ms: number) => (ms / 1000).toFixed(2);

/** A dock under the avatar that draws the recorder's data on a shared time axis: live, or one utterance at a time. */
export function mountTimeline(rec: TimelineRecorder): TimelineUi {
  let mode = "live";
  let dirty = true;
  let optionKey = "";

  const select = el("md-outlined-select", { label: "Show" }) as HTMLElement & { value: string };
  const canvas = el("canvas", { role: "img" });
  const summary = el("p", { className: "dock-summary body-small" });
  const table = el("tbody");
  const plot = el("div", { className: "dock-plot" }, canvas);
  const savePng = el("md-outlined-button", { textContent: "Save PNG" });
  const saveJson = el("md-outlined-button", { textContent: "Save JSON" });
  const hide = el("md-outlined-button", { textContent: "Hide" });
  const data = el(
    "details",
    { className: "dock-data" },
    el("summary", { className: "label-large", textContent: "Sentences in this view" }),
    el("table", { className: "body-small" }, el("thead", {}, el("tr", {}, ...["Utterance", "#", "Text", "From", "To"].map((h) => el("th", { scope: "col", textContent: h })))), table),
  );
  const dock = el(
    "section",
    { id: "timeline", className: "timeline-dock", ariaLabel: "Timeline" },
    el("header", { className: "dock-bar" }, el("h2", { className: "title-small", textContent: "Timeline" }), select, el("span", { className: "grow" }), savePng, saveJson, hide),
    plot,
    summary,
    data,
  );
  document.body.classList.add("has-timeline");
  document.body.append(dock);

  const current = (): UtteranceTimeline | undefined => (mode === "live" ? undefined : rec.utterance(mode));
  const view = (): View => {
    const u = current();
    if (u) return { fromMs: u.startMs - 300, toMs: Math.max(u.endMs, u.startMs + 500) + 600, originMs: u.startMs };
    const now = rec.now();
    return { fromMs: now - LIVE_BEFORE_MS, toMs: now + LIVE_AFTER_MS, originMs: now, nowMs: now };
  };

  // The select can only show a value once its options have been upgraded, so say it again a moment later.
  const showMode = () => {
    select.value = mode;
    setTimeout(() => (select.value = mode), 0);
  };
  const label = (u: UtteranceTimeline) => {
    const text = u.source === "mic" ? "microphone" : u.pieces[0]?.text || "speech";
    return `${u.id} · ${text.length > 20 ? `${text.slice(0, 19)}…` : text} · ${(u.endMs - u.startMs) / 1000 < 10 ? seconds(u.endMs - u.startMs) : ((u.endMs - u.startMs) / 1000).toFixed(1)} s`;
  };
  const headlines = new Map<string, HTMLElement>();
  const syncOptions = () => {
    const list = rec.utterances().slice().reverse();
    const key = list.map((u) => u.id).join("|");
    if (key === optionKey) {
      // the same utterances, but one may still be growing as its audio is scheduled: refresh the words without rebuilding the open list
      for (const u of list) {
        const h = headlines.get(u.id);
        if (h && h.textContent !== label(u)) h.textContent = label(u);
      }
      return;
    }
    optionKey = key;
    headlines.clear();
    select.replaceChildren(
      el("md-select-option", { value: "live", selected: mode === "live" }, el("div", { slot: "headline", textContent: "Live (last 8 seconds)" })),
      ...list.map((u) => {
        const headline = el("div", { slot: "headline", textContent: label(u) });
        headlines.set(u.id, headline);
        return el("md-select-option", { value: u.id, selected: mode === u.id }, headline);
      }),
    );
    if (mode !== "live" && !rec.utterance(mode)) mode = "live"; // it was forgotten
    showMode();
    dirty = true;
  };

  const describe = (v: View) => {
    const u = current();
    if (!u) {
      summary.textContent = `Live view of the last ${LIVE_BEFORE_MS / 1000} seconds. Lanes: words, waveform, spectrum, mouth movement and events.`;
      table.replaceChildren();
      return;
    }
    const fr = rec.frames(u.startMs, u.endMs);
    let peak = 0;
    for (let i = 0; i < fr.count; i++) for (let k = 0; k < MOUTH_SHAPES.length; k++) peak = Math.max(peak, fr.data[i * FRAME_FIELDS + k]!);
    summary.textContent =
      u.source === "mic"
        ? `Phrase ${u.id} from the microphone: ${seconds(u.endMs - u.startMs)} seconds, with no words (the microphone has no text). The mouth opened to at most ${peak.toFixed(2)}.`
        : `Utterance ${u.id}: ${u.pieces.length} sentence${u.pieces.length === 1 ? "" : "s"}, ${seconds(u.endMs - u.startMs)} seconds${u.interruptedAtMs !== undefined ? ", cut off" : ""}. The mouth opened to at most ${peak.toFixed(2)}.`;
    table.replaceChildren(
      ...u.pieces.map((p) =>
        el("tr", {}, el("td", { textContent: u.id }), el("td", { textContent: String(p.index + 1) }), el("td", { textContent: p.text }), el("td", { textContent: `${seconds(p.startMs - v.originMs)} s` }), el("td", { textContent: `${seconds(p.endMs - v.originMs)} s` })),
      ),
    );
  };

  const resize = () => {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(plot.clientWidth * dpr));
    const h = Math.max(1, Math.round(plot.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; // the drawing buffer; the size on the page comes from the stylesheet
      canvas.height = h;
      dirty = true;
    }
  };
  new ResizeObserver(resize).observe(plot);

  const paint = () => {
    resize();
    const v = view();
    const ctx = canvas.getContext("2d")!;
    const dpr = canvas.width / Math.max(1, plot.clientWidth);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTimeline(ctx, plot.clientWidth, plot.clientHeight, rec, v, readTheme());
    describe(v);
    canvas.setAttribute("aria-label", summary.textContent ?? "Timeline");
  };

  const timer = setInterval(() => {
    if (dock.classList.contains("collapsed") || document.hidden) return;
    syncOptions();
    if (mode === "live" || dirty) {
      paint();
      dirty = false;
    }
  }, REDRAW_MS);
  void timer;

  select.addEventListener("change", () => {
    mode = select.value || "live";
    dirty = true;
  });
  hide.addEventListener("click", () => {
    const collapsed = dock.classList.toggle("collapsed");
    hide.textContent = collapsed ? "Show" : "Hide";
    dirty = true;
  });

  const exportCanvas = (): HTMLCanvasElement => {
    const out = el("canvas");
    out.width = EXPORT_WIDTH;
    out.height = EXPORT_HEIGHT;
    drawTimeline(out.getContext("2d")!, EXPORT_WIDTH, EXPORT_HEIGHT, rec, view(), readTheme());
    return out;
  };
  const exportPng = () => exportCanvas().toDataURL("image/png");
  const exportJson = () => JSON.stringify(rec.toJSON({ fromMs: view().fromMs, toMs: view().toMs, includeAudio: mode !== "live" }), null, 1);
  const download = (href: string, name: string) => {
    const a = attrs(el("a"), { href, download: name });
    a.click();
  };
  const stamp = () => `${mode === "live" ? "live" : mode}-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`;
  savePng.addEventListener("click", () => download(exportPng(), `vikaki-timeline-${stamp()}.png`));
  saveJson.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([exportJson()], { type: "application/json" }));
    download(url, `vikaki-timeline-${stamp()}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  syncOptions();
  paint();
  return {
    mode: () => mode,
    select(next) {
      mode = next;
      showMode();
      dirty = true;
    },
    exportPng,
    exportJson,
    exportLayout: () => ({ width: EXPORT_WIDTH, height: EXPORT_HEIGHT, gutter: GUTTER, lanes: layoutLanes(EXPORT_HEIGHT) }),
  };
}
