import { EMOTIONS } from "@vikaki/protocol";
import { mountKaraoke } from "./karaoke.ts";
import type { TimelineRecorder } from "./timeline.ts";
import type { Message } from "@vikaki/protocol";
import type { MdOutlinedTextField } from "@material/web/textfield/outlined-text-field.js";
import { DriverConsole, formatMs, type DriverState } from "./driver-console.ts";
import { el } from "./ui/dom.ts";
import { loadMaterial } from "./ui/material.ts";

export interface SpeechDemoOptions {
  driver: DriverConsole;
  /** Called on each button press, so the browser lets the page make sound. */
  unlockSound(): void;
  /** Where the demo notes what it sent and what the hub reported, on the timeline's clock. */
  timeline?: TimelineRecorder;
  soundBlocked(): boolean;
}

export interface SpeechDemo {
  onState(state: DriverState, info: { speech?: string; voice?: string }): void;
  onMessage(m: Message): void;
  refreshSound(): void;
}

const PRESETS = [
  ["Greeting", "Hello! I'm Vikaki, your new friend. Shall we begin?"],
  ["Poker", "Hmm, let me think about that. Actually, I think you're bluffing, and I'll call your raise."],
  ["Long story", "Once upon a time there was a small gingerbread who loved to talk. He talked in the morning, he talked in the afternoon, and he even talked while the other cookies were trying to sleep. Press cancel whenever you like."],
] as const;

/** A driver console beside the avatar: type text, press Speak, watch and hear it, see what the hub reports. */
export async function mountSpeechDemo(o: SpeechDemoOptions): Promise<SpeechDemo> {
  await loadMaterial();
  document.body.classList.add("has-panel");

  const sentAt = new Map<string, number>(); // utterance id -> when we sent its first text
  const started = new Map<string, number>();
  let lastId: string | undefined;
  let cancelAt: { id: string; at: number } | undefined;

  // ---- the voice banner: the one thing that must never be missed ----
  const banner = el("div", { className: "voice-banner", role: "status" });
  const setBanner = (kind: "ok" | "warn" | "bad" | "", title: string, ...body: (Node | string)[]) => {
    banner.className = `voice-banner ${kind}`;
    banner.replaceChildren(el("div", { className: "title-medium", textContent: title }), el("p", { className: "body-medium" }, ...body));
  };
  setBanner("", "Checking the voice…", "Waiting for the hub to say which voice it uses.");

  const chipDriver = el("span", { className: "chip", textContent: "driver: connecting" });
  const chipSound = el("span", { className: "chip", textContent: "sound: …" });

  const text = el("md-outlined-text-field", { id: "say-text", type: "textarea", rows: 2, label: "What the avatar should say", value: PRESETS[0][1] }) as MdOutlinedTextField;
  const speak = el("md-filled-button", { textContent: "Speak" });
  const streamBtn = el("md-filled-tonal-button", { textContent: "Speak word by word" });
  const queue = el("md-outlined-button", { textContent: "Queue two lines" });
  const cancel = el("md-filled-tonal-button", { className: "danger", textContent: "Cancel", disabled: true });
  const emotion = el("md-outlined-select", { label: "Emotion" }) as HTMLElement & { value: string };
  emotion.append(...EMOTIONS.map((e) => el("md-select-option", { value: e, selected: e === "neutral" }, el("div", { slot: "headline", textContent: e[0]!.toUpperCase() + e.slice(1) }))));
  const presets = el("md-chip-set", { ariaLabel: "Example lines" });
  for (const [name, content] of PRESETS) presets.append(el("md-assist-chip", { label: name, onclick: () => (text.value = content) }));

  const statFirst = el("b", { textContent: "–" });
  const statSpeech = el("b", { textContent: "–" });
  const statStop = el("b", { textContent: "–" });
  const log = el("div", { id: "log", className: "log", role: "log", ariaLive: "polite" });

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
    o.timeline?.event("sent", id, how);
    sentAt.set(id, performance.now());
    cancel.disabled = false;
    const feeling = emotion.value && emotion.value !== "neutral" ? emotion.value : undefined;
    if (how === "say") o.driver.say(content, id, feeling);
    else o.driver.stream(content, id, 5, feeling);
    line("", `sent ${how === "stream" ? "(word by word) " : ""}${feeling ? `[${feeling}] ` : ""}${quote(content)}  [${id}]`);
  };

  speak.addEventListener("click", () => send("say", text.value));
  streamBtn.addEventListener("click", () => send("stream", text.value));
  queue.addEventListener("click", () => {
    send("say", "First, a short line.");
    send("say", "And then, a second one right behind it.");
  });
  cancel.addEventListener("click", () => {
    if (!lastId) return;
    cancelAt = { id: lastId, at: performance.now() };
    o.timeline?.event("cancel", lastId);
    o.driver.cancel(lastId);
    line("stop", `cancel ${lastId}`);
  });

  const tile = (value: HTMLElement, label: string) => el("div", { className: "tile" }, value, el("span", { className: "label-medium", textContent: label }));

  document.body.append(
    el(
      "aside",
      { id: "speech", className: "side-sheet", ariaLabel: "Speech demo" },
      el("h1", { className: "headline-small", textContent: "Speech demo" }),
      banner,
      el("div", { className: "chips" }, chipDriver, chipSound),
      el("section", {}, text, presets, emotion, el("div", { className: "actions" }, speak, streamBtn, queue, cancel)),
      ...(o.timeline ? [mountKaraoke(o.timeline)] : []),
      el("section", {}, el("h2", { className: "title-small", textContent: "Measured here" }), el("div", { className: "tiles" }, tile(statFirst, "to first sound"), tile(statSpeech, "speech length"), tile(statStop, "cancel to stop"))),
      el("section", { style: "flex:1;min-height:0" }, el("h2", { className: "title-small", textContent: "What the hub reports" }), log),
    ),
  );

  const setChip = (chip: HTMLElement, label: string, kind: "ok" | "warn" | "bad" | "") => {
    chip.textContent = label;
    chip.className = `chip ${kind}`;
  };
  const refreshSound = () => (o.soundBlocked() ? setChip(chipSound, "sound: press Speak to allow", "warn") : setChip(chipSound, "sound: on", "ok"));
  refreshSound();
  // The browser can allow sound at any moment (a click, or autoplay settings), with no message to announce it.
  setInterval(refreshSound, 400);

  return {
    refreshSound,
    onState(state, info) {
      const ready = state === "ready" && info.speech !== "off"; // with no engine, Speak could do nothing
      for (const b of [speak, streamBtn, queue]) b.disabled = !ready;
      if (ready) setChip(chipDriver, "driver: connected", "ok");
      else if (state === "busy") setChip(chipDriver, "driver: another program is already driving", "bad");
      else setChip(chipDriver, `driver: ${state}`, "warn");

      if (state === "busy") {
        setBanner("bad", "Another program is driving", "Stop it, then reload this page. Only one driver can send speech at a time.");
      } else if (info.speech === "off") {
        setBanner("bad", "Speech is off", "The server was started without a voice. Restart it without ", el("code", { textContent: "--tts none" }), ".");
      } else if (info.speech === "fake") {
        setBanner("warn", "This is a test tone, not speech", "The real voice isn't installed, so the avatar will hold one steady “aah”. Run ", el("code", { textContent: "make install-voice" }), ", then restart this demo.");
      } else if (info.speech) {
        setBanner("ok", "Real voice", `${info.speech === "kokoro" ? "Kokoro" : info.speech}${info.voice ? `, voice ${info.voice}` : ""}. What you hear is generated speech.`);
      }
      if (state === "busy") line("err", "Another program is already the driver. Stop it, then reload this page.");
    },
    onMessage(m) {
      refreshSound();
      if (m.type === "speech_started") {
        const sent = sentAt.get(m.utterance_id);
        if (sent !== undefined) statFirst.textContent = formatMs(performance.now() - sent);
        started.set(m.utterance_id, performance.now());
        o.timeline?.event("driver:started", m.utterance_id);
        line("go", `▶ speech started  [${m.utterance_id}]`);
      } else if (m.type === "speech_finished") {
        const s = started.get(m.utterance_id);
        if (s !== undefined) statSpeech.textContent = formatMs(performance.now() - s);
        o.timeline?.event("driver:finished", m.utterance_id);
        line("go", `■ speech finished  [${m.utterance_id}]`);
        if (m.utterance_id === lastId) cancel.disabled = true;
      } else if (m.type === "speech_interrupted") {
        if (cancelAt?.id === m.utterance_id) statStop.textContent = formatMs(performance.now() - cancelAt.at);
        o.timeline?.event("driver:interrupted", m.utterance_id, m.reason);
        line("stop", `✕ speech interrupted (${m.reason})  [${m.utterance_id}]`);
        if (m.utterance_id === lastId) cancel.disabled = true;
      } else if (m.type === "error" && m.code !== "driver_busy") {
        o.timeline?.event("error", m.utterance_id, m.code);
        line("err", `⚠ ${m.code}: ${m.message}`);
      }
    },
  };
}
