import { VISEMES, type VisemeWeights } from "./renderer.ts";

export interface DemoControls {
  /** Hold a mouth shape (or {} to release). */
  hold(weights: VisemeWeights): void;
  blink(): void;
  toggleMic(): Promise<void>;
  playFile(file: File): Promise<void>;
}

export interface DemoFrame {
  visemes: VisemeWeights;
  blink: number;
  volume: number;
}

const CSS = `
body.demo canvas { width: calc(100% - 320px); }
#demo { position: fixed; top: 0; right: 0; bottom: 0; width: 320px; box-sizing: border-box; padding: 16px;
  background: #171d24; color: #cfd8e0; font: 14px/1.4 system-ui, sans-serif; overflow-y: auto; border-left: 1px solid #263039; }
#demo h1 { font-size: 16px; margin: 0 0 4px; color: #fff; }
#demo h2 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #7f93a3; margin: 18px 0 6px; }
#demo p { margin: 0 0 6px; color: #8fa1b0; font-size: 12px; }
#demo .row { display: flex; flex-wrap: wrap; gap: 6px; }
#demo button, #demo label.btn { background: #243240; color: #e6edf3; border: 1px solid #34475a; border-radius: 6px;
  padding: 8px 12px; font: inherit; cursor: pointer; user-select: none; }
#demo button:hover, #demo label.btn:hover { background: #2d4054; }
#demo button:active, #demo button.on { background: #3b82f6; border-color: #3b82f6; color: #fff; }
#demo button:focus-visible, #demo label.btn:focus-within { outline: 2px solid #8ab4ff; outline-offset: 2px; }
#demo input[type=file] { position: absolute; opacity: 0; width: 1px; height: 1px; }
#demo .meter { display: grid; grid-template-columns: 56px 1fr 38px; gap: 8px; align-items: center; margin: 3px 0; font-size: 12px; }
#demo .bar { height: 10px; background: #0e1318; border-radius: 5px; overflow: hidden; }
#demo .bar > i { display: block; height: 100%; width: 0; background: #4ade80; }
#demo .bar.blink > i { background: #fbbf24; } #demo .bar.vol > i { background: #60a5fa; }
#demo .num { text-align: right; color: #8fa1b0; font-variant-numeric: tabular-nums; }
#demo .status { min-height: 1.4em; color: #fbbf24; font-size: 12px; margin-top: 6px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

/** A side panel for judging the avatar by eye: held mouth shapes, blink, mic, audio file, live meters. */
export function mountDemoPanel(ctl: DemoControls): { update(f: DemoFrame): void; status(text: string): void; setMic(on: boolean): void } {
  document.body.classList.add("demo");
  document.head.append(el("style", { textContent: CSS }));

  const status = el("div", { className: "status", role: "status" });

  // Mouth shapes: hold a button to hold the shape.
  const shapes = el("div", { className: "row" });
  for (const v of [...VISEMES, "closed"] as const) {
    const b = el("button", { type: "button", textContent: v });
    const press = () => ctl.hold(v === "closed" ? {} : { [v]: 1 });
    const release = () => ctl.hold({});
    b.addEventListener("pointerdown", press);
    b.addEventListener("pointerup", release);
    b.addEventListener("pointerleave", release);
    b.addEventListener("keydown", (e) => (e.key === " " || e.key === "Enter") && press());
    b.addEventListener("keyup", release);
    shapes.append(b);
  }

  const blinkBtn = el("button", { type: "button", textContent: "Blink now" });
  blinkBtn.addEventListener("click", () => ctl.blink());

  const micBtn = el("button", { type: "button", textContent: "Microphone: off" });
  micBtn.addEventListener("click", () => {
    micBtn.disabled = true;
    ctl.toggleMic().finally(() => (micBtn.disabled = false));
  });

  const fileInput = el("input", { type: "file", accept: "audio/*" });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (f) void ctl.playFile(f);
  });
  const fileBtn = el("label", { className: "btn" }, "Play an audio file…", fileInput);

  const meters = new Map<string, { bar: HTMLElement; num: HTMLElement }>();
  const meterRows = el("div");
  for (const [name, cls] of [...VISEMES.map((v) => [v, ""] as const), ["blink", "blink"], ["volume", "vol"]] as const) {
    const bar = el("i");
    const num = el("span", { className: "num", textContent: "0.00" });
    meters.set(name, { bar, num });
    meterRows.append(el("div", { className: "meter" }, el("span", { textContent: name }), el("div", { className: `bar ${cls}` }, bar), num));
  }

  document.body.append(
    el(
      "aside",
      { id: "demo", ariaLabel: "vikaki demo controls" },
      el("h1", { textContent: "vikaki demo" }),
      el("p", { textContent: "Judge by eye: is the mouth readable, does it feel alive, is it cute rather than creepy?" }),
      el("h2", { textContent: "Mouth shapes (hold)" }),
      shapes,
      el("h2", { textContent: "Eyes" }),
      blinkBtn,
      el("h2", { textContent: "Voice" }),
      el("div", { className: "row" }, micBtn, fileBtn),
      el("p", { textContent: "Mic audio stays in this page. An audio file also plays through your speakers." }),
      status,
      el("h2", { textContent: "What lip sync reports" }),
      meterRows,
    ),
  );

  const set = (name: string, value: number) => {
    const m = meters.get(name);
    if (!m) return;
    const v = Math.min(1, Math.max(0, value));
    m.bar.style.width = `${(v * 100).toFixed(0)}%`;
    m.num.textContent = v.toFixed(2);
  };

  return {
    update(f) {
      for (const v of VISEMES) set(v, f.visemes[v] ?? 0);
      set("blink", f.blink);
      set("volume", f.volume);
    },
    status(text) {
      status.textContent = text;
    },
    setMic(on) {
      micBtn.textContent = `Microphone: ${on ? "on" : "off"}`;
      micBtn.classList.toggle("on", on);
    },
  };
}
