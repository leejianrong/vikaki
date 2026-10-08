import { VISEMES, type VisemeWeights } from "./renderer.ts";
import { el } from "./ui/dom.ts";
import { loadMaterial } from "./ui/material.ts";

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

export interface DemoPanel {
  update(f: DemoFrame): void;
  status(text: string): void;
  setMic(on: boolean): void;
}

/** A side sheet for judging the avatar by eye: held mouth shapes, blink, mic, audio file, live meters. */
export async function mountDemoPanel(ctl: DemoControls): Promise<DemoPanel> {
  await loadMaterial();
  document.body.classList.add("has-panel");

  const status = el("p", { className: "body-small status", role: "status", style: "min-height:1rem;color:var(--md-sys-color-warning)" });

  // Hold a button to hold the shape.
  const shapes = el("div", { className: "actions" });
  for (const v of [...VISEMES, "closed"] as const) {
    const b = el("md-filled-tonal-button", { textContent: v });
    const press = () => ctl.hold(v === "closed" ? {} : { [v]: 1 });
    const release = () => ctl.hold({});
    b.addEventListener("pointerdown", press);
    b.addEventListener("pointerup", release);
    b.addEventListener("pointerleave", release);
    b.addEventListener("keydown", (e) => (e.key === " " || e.key === "Enter") && press());
    b.addEventListener("keyup", release);
    shapes.append(b);
  }

  const blinkBtn = el("md-outlined-button", { textContent: "Blink now" });
  blinkBtn.addEventListener("click", () => ctl.blink());

  const micBtn = el("md-filled-tonal-button", { textContent: "Microphone: off" });
  micBtn.addEventListener("click", () => {
    micBtn.disabled = true;
    ctl.toggleMic().finally(() => (micBtn.disabled = false));
  });

  const fileInput = el("input", { type: "file", accept: "audio/*", className: "file-input" });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (f) void ctl.playFile(f);
  });
  const fileBtn = el("md-outlined-button", { textContent: "Play an audio file…" });
  fileBtn.addEventListener("click", () => fileInput.click());

  const meters = new Map<string, { bar: HTMLElement; num: HTMLElement }>();
  const meterRows = el("div", { style: "display:flex;flex-direction:column;gap:8px" });
  for (const [name, cls] of [...VISEMES.map((v) => [v, ""] as const), ["blink", "blink"], ["volume", "vol"]] as const) {
    const bar = el("i");
    const num = el("span", { className: "num label-medium", textContent: "0.00" });
    meters.set(name, { bar, num });
    meterRows.append(el("div", { className: "meter" }, el("span", { className: "name label-medium", textContent: name }), el("div", { className: `bar ${cls}` }, bar), num));
  }

  document.body.append(
    el(
      "aside",
      { id: "demo", className: "side-sheet", ariaLabel: "Avatar demo" },
      el("header", {}, el("h1", { className: "headline-small", textContent: "Avatar demo" }), el("p", { className: "body-medium", textContent: "Is the mouth readable, does it feel alive, and is it cute rather than creepy?" })),
      el("section", {}, el("h2", { className: "title-small", textContent: "Hold a mouth shape" }), shapes),
      el("section", {}, el("h2", { className: "title-small", textContent: "Eyes" }), el("div", { className: "actions" }, blinkBtn)),
      el("section", {}, el("h2", { className: "title-small", textContent: "Voice in" }), el("div", { className: "actions" }, micBtn, fileBtn, fileInput), el("p", { className: "body-small", textContent: "Microphone audio stays in this page. An audio file also plays through your speakers." }), status),
      el("section", {}, el("h2", { className: "title-small", textContent: "What lip sync reports" }), meterRows),
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
