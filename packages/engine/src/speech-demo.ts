import type { Message } from "@vikaki/protocol";
import { DriverConsole, formatMs, type DriverState } from "./driver-console.ts";

export interface SpeechDemoOptions {
  driver: DriverConsole;
  /** Called on each button press, so the browser lets the page make sound. */
  unlockSound(): void;
  soundBlocked(): boolean;
}

const PRESETS = [
  ["Greeting", "Hello! I'm Vikaki, your new friend. Shall we begin?"],
  ["Poker", "Hmm, let me think about that. Actually, I think you're bluffing, and I'll call your raise."],
  ["Long story", "Once upon a time there was a small gingerbread who loved to talk. He talked in the morning, he talked in the afternoon, and he even talked while the other cookies were trying to sleep. Press cancel whenever you like."],
] as const;

const CSS = `
body.demo-wide canvas { width: calc(100% - 400px); }
#speech { position: fixed; top: 0; right: 0; bottom: 0; width: 400px; box-sizing: border-box; padding: 16px; display: flex; flex-direction: column; gap: 10px;
  background: #171d24; color: #cfd8e0; font: 14px/1.4 system-ui, sans-serif; border-left: 1px solid #263039; }
#speech h1 { font-size: 16px; margin: 0; color: #fff; }
#speech p { margin: 0; color: #8fa1b0; font-size: 12px; }
#speech .chips { display: flex; flex-wrap: wrap; gap: 6px; }
#speech .chip { font-size: 12px; padding: 3px 9px; border-radius: 10px; background: #243240; color: #cfd8e0; }
#speech .chip.ok { background: #14532d; color: #bbf7d0; } #speech .chip.warn { background: #713f12; color: #fde68a; } #speech .chip.bad { background: #7f1d1d; color: #fecaca; }
#speech textarea { width: 100%; box-sizing: border-box; min-height: 84px; resize: vertical; background: #0e1318; color: #e6edf3; border: 1px solid #34475a; border-radius: 6px; padding: 8px; font: inherit; }
#speech .row { display: flex; flex-wrap: wrap; gap: 6px; }
#speech button { background: #243240; color: #e6edf3; border: 1px solid #34475a; border-radius: 6px; padding: 8px 12px; font: inherit; cursor: pointer; }
#speech button:hover:not(:disabled) { background: #2d4054; }
#speech button.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
#speech button.danger { background: #7f1d1d; border-color: #b91c1c; }
#speech button:disabled { opacity: .45; cursor: not-allowed; }
#speech button:focus-visible, #speech textarea:focus-visible { outline: 2px solid #8ab4ff; outline-offset: 2px; }
#speech h2 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #7f93a3; margin: 4px 0 0; }
#speech .stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
#speech .stat { background: #0e1318; border-radius: 6px; padding: 6px 8px; }
#speech .stat b { display: block; font-size: 16px; color: #fff; font-variant-numeric: tabular-nums; } #speech .stat span { font-size: 11px; color: #7f93a3; }
#speech #log { flex: 1; min-height: 80px; overflow-y: auto; background: #0e1318; border-radius: 6px; padding: 8px; font: 12px/1.5 ui-monospace, monospace; }
#speech #log div { white-space: pre-wrap; } #speech #log .t { color: #7f93a3; } #speech #log .err { color: #fbbf24; } #speech #log .go { color: #4ade80; } #speech #log .stop { color: #f87171; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

/** A driver console beside the avatar: type text, press Speak, watch and hear it, see what the hub reports. */
export function mountSpeechDemo(o: SpeechDemoOptions): { onState(state: DriverState, info: { speech?: string }): void; onMessage(m: Message): void; refreshSound(): void } {
  document.body.classList.add("demo-wide");
  document.head.append(el("style", { textContent: CSS }));

  const sentAt = new Map<string, number>(); // utterance id -> when we sent its first text
  let lastId: string | undefined;
  let cancelAt: { id: string; at: number } | undefined;

  const chipDriver = el("span", { className: "chip", textContent: "driver: connecting" });
  const chipVoice = el("span", { className: "chip", textContent: "voice: ?" });
  const chipSound = el("span", { className: "chip", textContent: "sound: ?" });
  const text = el("textarea", { id: "say-text", value: PRESETS[0][1], ariaLabel: "What the avatar should say" });
  const speak = el("button", { type: "button", className: "primary", textContent: "Speak" });
  const streamBtn = el("button", { type: "button", textContent: "Speak, streamed word by word" });
  const cancel = el("button", { type: "button", className: "danger", textContent: "Cancel", disabled: true });
  const queue = el("button", { type: "button", textContent: "Queue two lines" });
  const log = el("div", { id: "log", role: "log", ariaLive: "polite" });
  const statFirst = el("b", { textContent: "-" });
  const statSpeech = el("b", { textContent: "-" });
  const statStop = el("b", { textContent: "-" });

  const t0 = performance.now();
  const stamp = () => `${((performance.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
  const line = (cls: string, msg: string) => {
    log.append(el("div", {}, el("span", { className: "t", textContent: `${stamp()}  ` }), el("span", { className: cls, textContent: msg })));
    log.scrollTop = log.scrollHeight;
  };
  const quote = (s: string) => `“${s.length > 46 ? s.slice(0, 45) + "…" : s}”`;

  const send = (how: "say" | "stream", content: string) => {
    o.unlockSound();
    if (!o.driver.ready || !content.trim()) return;
    const id = o.driver.nextId();
    lastId = id;
    sentAt.set(id, performance.now());
    cancel.disabled = false;
    if (how === "say") o.driver.say(content, id);
    else o.driver.stream(content, id, 5);
    line("", `sent ${how === "stream" ? "(streamed) " : ""}${quote(content)}  [${id}]`);
  };

  speak.onclick = () => send("say", text.value);
  streamBtn.onclick = () => send("stream", text.value);
  queue.onclick = () => {
    send("say", "First, a short line.");
    send("say", "And then, a second one right behind it.");
  };
  cancel.onclick = () => {
    if (!lastId) return;
    cancelAt = { id: lastId, at: performance.now() };
    o.driver.cancel(lastId);
    line("stop", `cancel ${lastId}`);
  };

  const presets = el("div", { className: "row" });
  for (const [name, content] of PRESETS) {
    presets.append(el("button", { type: "button", textContent: name, onclick: () => (text.value = content) }));
  }

  document.body.append(
    el(
      "aside",
      { id: "speech", ariaLabel: "vikaki speech demo" },
      el("h1", { textContent: "vikaki speech demo" }),
      el("p", { textContent: "This page is the driver. It sends text to the hub, the hub turns it into speech, and the avatar says it. A real game or LLM does the same from its own process." }),
      el("div", { className: "chips" }, chipDriver, chipVoice, chipSound),
      el("h2", { textContent: "What to say" }),
      text,
      presets,
      el("div", { className: "row" }, speak, streamBtn, queue, cancel),
      el("h2", { textContent: "Measured here" }),
      el(
        "div",
        { className: "stats" },
        el("div", { className: "stat" }, statFirst, el("span", { textContent: "send → speech starts" })),
        el("div", { className: "stat" }, statSpeech, el("span", { textContent: "speech length" })),
        el("div", { className: "stat" }, statStop, el("span", { textContent: "cancel → stopped" })),
      ),
      el("h2", { textContent: "What the hub reports" }),
      log,
    ),
  );

  const setChip = (chip: HTMLElement, label: string, kind: "ok" | "warn" | "bad" | "") => {
    chip.textContent = label;
    chip.className = `chip ${kind}`;
  };
  const refreshSound = () => (o.soundBlocked() ? setChip(chipSound, "sound: click Speak to allow", "warn") : setChip(chipSound, "sound: on", "ok"));
  refreshSound();
  // The browser can allow sound at any moment (a click, or autoplay settings), with no message to announce it.
  setInterval(refreshSound, 400);
  const started = new Map<string, number>();

  return {
    refreshSound,
    onState(state, info) {
      const ready = state === "ready";
      for (const b of [speak, streamBtn, queue]) b.disabled = !ready;
      if (ready) setChip(chipDriver, "driver: connected", "ok");
      else if (state === "busy") setChip(chipDriver, "driver: another program is already driving", "bad");
      else setChip(chipDriver, `driver: ${state}`, "warn");
      if (info.speech === "off") setChip(chipVoice, "voice: off (start with --tts)", "bad");
      else if (info.speech === "fake") setChip(chipVoice, 'voice: test voice ("aah"), see docs/tts.md for real speech', "warn");
      else if (info.speech) setChip(chipVoice, `voice: ${info.speech}`, "ok");
      if (state === "busy") line("err", "Another program is already the driver. Stop it, then reload this page.");
    },
    onMessage(m) {
      refreshSound();
      if (m.type === "speech_started") {
        const sent = sentAt.get(m.utterance_id);
        if (sent !== undefined) statFirst.textContent = formatMs(performance.now() - sent);
        started.set(m.utterance_id, performance.now());
        line("go", `▶ speech started  [${m.utterance_id}]`);
      } else if (m.type === "speech_finished") {
        const s = started.get(m.utterance_id);
        if (s !== undefined) statSpeech.textContent = formatMs(performance.now() - s);
        line("go", `■ speech finished  [${m.utterance_id}]`);
        if (m.utterance_id === lastId) cancel.disabled = true;
      } else if (m.type === "speech_interrupted") {
        if (cancelAt?.id === m.utterance_id) statStop.textContent = formatMs(performance.now() - cancelAt.at);
        line("stop", `✕ speech interrupted (${m.reason})  [${m.utterance_id}]`);
        if (m.utterance_id === lastId) cancel.disabled = true;
      } else if (m.type === "error" && m.code !== "driver_busy") {
        line("err", `⚠ ${m.code}: ${m.message}`);
      }
    },
  };
}
