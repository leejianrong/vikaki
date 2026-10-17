// `vikaki embed-demo` (VIK-78): the whole embed story on one screen, to see what the embed cards built. A stand-in for a game's page (another
// origin from the hub, like Wavelength's) frames `/avatar?seats=2&embed=1&layout=duet`, draws a placeholder dial in the clear central band,
// and has a box to type a line for either seat. The page never talks to the hub: this process holds one driver per seat, as a game server
// would (ADR-0017), and the page asks it to speak. Two logs show the two ways a host hears about speech: what the frame posts to the page
// (docs/embed.md) and what the drivers hear from the hub.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { make, type Message } from "@vikaki/protocol";
import { HubClient } from "./hub-client.ts";

const SEATS = ["seat-1", "seat-2"] as const;

export interface EmbedDemo {
  origin: string;
  close(): Promise<void>;
}

/** The page. `hub` is the hub's origin: the frame's address, and the only origin the page accepts messages from or sends `unlock` to. */
export function hostPage(hub: string, hostOrigin: string): string {
  const frame = `${hub}/avatar?seats=2&embed=1&layout=duet&hud=0&parent=${encodeURIComponent(hostOrigin)}`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>vikaki embed demo</title>
<style>
  :root { color-scheme: light dark; --bg: #f3ecff; --ink: #1d1b20; --panel: #fffbfe; --line: #cac4d0; --accent: #6750a4; --on-accent: #fff; --mute: #625b71; }
  @media (prefers-color-scheme: dark) { :root { --bg: #25203a; --ink: #e6e0e9; --panel: #1d1b20; --line: #49454f; --accent: #cfbcff; --on-accent: #381e72; --mute: #cac4d0; } }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--ink); font: 14px/1.4 system-ui, sans-serif; }
  body { display: grid; grid-template-rows: minmax(0, 1fr) auto; }
  #stage { position: relative; min-height: 0; }
  iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  /* the host's own drawing in the clear band: a half-circle dial, 440 px wide (full width on a phone) */
  #dial { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); width: min(440px, calc(100% - 32px)); pointer-events: none; }
  #dial svg { width: 100%; display: block; }
  #bar { background: var(--panel); border-top: 1px solid var(--line); padding: 12px 16px; display: grid; gap: 10px; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr); }
  /* a phone: the stage needs height for the avatars above a half-circle dial, so the controls go below the fold and the page scrolls */
  @media (max-width: 800px) { #bar { grid-template-columns: 1fr; } html, body { height: auto; } body { display: block; } #stage { height: 78vh; } }
  h2 { margin: 0 0 6px; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--mute); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  input[type=text] { flex: 1 1 200px; min-width: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
  select, button { padding: 8px 14px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
  button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  #state { font-weight: 600; }
  .log { height: 96px; overflow-y: auto; margin: 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; font: 12px/1.35 ui-monospace, monospace; white-space: pre-wrap; }
</style>
<body>
<div id="stage">
  <iframe id="avatar" title="vikaki avatars" allow="autoplay" src="${frame}"></iframe>
  <div id="dial" aria-hidden="true"><svg viewBox="0 0 440 230"><path d="M20 210 A200 200 0 0 1 420 210" fill="none" stroke="var(--line)" stroke-width="26" stroke-linecap="round"/><path d="M150 210 A200 200 0 0 1 290 210" fill="none" stroke="var(--accent)" stroke-width="26" opacity=".35"/><line id="needle" x1="220" y1="210" x2="220" y2="40" stroke="var(--ink)" stroke-width="5" stroke-linecap="round" transform="rotate(0 220 210)"/><circle cx="220" cy="210" r="12" fill="var(--ink)"/></svg></div>
</div>
<section id="bar">
  <div>
    <h2>Say a line</h2>
    <form class="row" id="say"><label class="row">Seat <select id="seat" aria-label="Seat"><option>seat-1</option><option>seat-2</option></select></label>
      <input id="text" type="text" aria-label="Line to say" value="Is it closer to cold or hot?" autocomplete="off">
      <select id="emotion" aria-label="Emotion"><option value="">neutral</option><option>happy</option><option>sad</option><option>angry</option><option>surprised</option><option>thinking</option></select>
      <button class="primary" type="submit">Speak</button><button type="button" id="cancel">Cancel</button></form>
    <div class="row" style="margin-top:8px"><button type="button" id="start">Start sound</button><span>Sound: <span id="state">waiting for the frame</span></span>
      <label class="row">Dial <input id="dialRange" type="range" min="-80" max="80" value="0" aria-label="Dial needle"></label></div>
  </div>
  <div><h2>The frame tells this page</h2><pre class="log" id="frameLog" aria-label="Messages from the frame"></pre></div>
  <div><h2>The game server's drivers hear</h2><pre class="log" id="driverLog" aria-label="What the drivers hear"></pre></div>
</section>
<script>
const HUB = ${JSON.stringify(hub)};
const frame = document.getElementById("avatar");
const $ = (id) => document.getElementById(id);
const log = (el, text) => { const t = new Date().toLocaleTimeString([], { hour12: false }); el.textContent += t + "  " + text + "\\n"; el.scrollTop = el.scrollHeight; };
addEventListener("message", (e) => {
  if (e.origin !== HUB || e.source !== frame.contentWindow) return; // only the frame we embedded, from the hub's origin
  const m = e.data || {};
  if (m.type === "audio_locked") { $("state").textContent = "locked: click Start sound"; $("start").classList.add("primary"); }
  if (m.type === "audio_unlocked") { $("state").textContent = "on"; $("start").classList.remove("primary"); }
  log($("frameLog"), m.type + (m.seat_id ? " " + m.seat_id : "") + (m.utterance_id ? " " + m.utterance_id.slice(0, 8) : "") + (m.reason ? " (" + m.reason + ")" : ""));
});
// the page asks again once it is loaded, in case its first message came before this listener was ready
frame.addEventListener("load", () => { frame.contentWindow.postMessage({ type: "audio_status" }, HUB); });
$("start").addEventListener("click", () => frame.contentWindow.postMessage({ type: "unlock" }, HUB)); // from the click handler, to the hub's origin only
const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
$("say").addEventListener("submit", (e) => { e.preventDefault(); const text = $("text").value.trim(); if (text) post("/say", { seat: $("seat").value, text, emotion: $("emotion").value || undefined }); });
$("cancel").addEventListener("click", () => post("/cancel"));
$("dialRange").addEventListener("input", (e) => $("needle").setAttribute("transform", "rotate(" + e.target.value + " 220 210)"));
new EventSource("/events").onmessage = (e) => log($("driverLog"), e.data);
</script></body></html>`;
}

const readJson = (req: IncomingMessage) =>
  new Promise<Record<string, unknown>>((ok) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        ok(JSON.parse(body || "{}"));
      } catch {
        ok({});
      }
    });
  });

/**
 * Serve the stand-in page on `port` (0 for any), driving the hub at `hubWs` with one driver per seat. `hubOrigin` is where the hub's page is.
 * Resolves once the page is up, so the caller can tell the hub who may frame it (`frameAncestors`): pass `hostOrigin` back through `onOrigin`.
 */
export async function startEmbedDemo(o: { hubWs: string; hubOrigin: string; port: number; token?: string; host?: string }): Promise<EmbedDemo> {
  const host = o.host ?? "127.0.0.1";
  const listeners = new Set<(line: string) => void>();
  const said = (line: string) => listeners.forEach((l) => l(line));
  let origin = "";
  const drivers = new Map<string, HubClient>();
  const lastLine = new Map<string, string>();
  const driverFor = async (seat: string): Promise<HubClient> => {
    let d = drivers.get(seat);
    if (d && !d.isClosed) return d;
    d = await HubClient.connect({ url: o.hubWs, token: o.token, role: "driver", seats: [{ seat_id: seat }], client: "vikaki-embed-demo" });
    drivers.set(seat, d);
    void (async () => {
      for (let m: Message | undefined; (m = await d.next(60 * 60_000)); ) {
        if (m.type === "speech_started" || m.type === "speech_finished" || m.type === "speech_interrupted" || m.type === "error") {
          const id = "utterance_id" in m && m.utterance_id ? ` ${String(m.utterance_id).slice(0, 8)}` : "";
          said(`${seat}: ${m.type}${id}${"reason" in m && m.reason ? ` (${m.reason})` : ""}${m.type === "error" ? ` ${m.message}` : ""}`);
        }
      }
    })();
    return d;
  };
  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (req.method === "GET" && path === "/") return void res.writeHead(200, { "content-type": "text/html" }).end(hostPage(o.hubOrigin, origin));
      if (req.method === "GET" && path === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        res.flushHeaders(); // the stream is open now, not at the first event
        const l = (line: string) => res.write(`data: ${line}\n\n`);
        listeners.add(l);
        req.on("close", () => listeners.delete(l));
        return;
      }
      if (req.method === "POST" && path === "/say") {
        const b = await readJson(req);
        const seat = SEATS.find((s) => s === b.seat);
        const text = typeof b.text === "string" ? b.text.slice(0, 500) : "";
        if (!seat || !text) return void res.writeHead(400).end("seat-1 or seat-2, and some text");
        const id = `demo-${randomUUID().slice(0, 8)}`;
        lastLine.set(seat, id);
        (await driverFor(seat)).send(make("utterance", { seat_id: seat, utterance_id: id, text, ...(typeof b.emotion === "string" ? { emotion: b.emotion } : {}) }));
        return void res.writeHead(204).end();
      }
      if (req.method === "POST" && path === "/cancel") {
        for (const seat of SEATS) {
          const d = drivers.get(seat);
          if (d && !d.isClosed) d.send(make("cancel", {})); // an id-less cancel stops only that driver's own lines
        }
        return void res.writeHead(204).end();
      }
      res.writeHead(404).end();
    })().catch(() => res.headersSent || res.writeHead(500).end());
  });
  await new Promise<void>((ok, fail) => (server.once("error", fail), server.listen(o.port, host, ok)));
  origin = `http://${host}:${(server.address() as AddressInfo).port}`;
  // both drivers up front, so the first line is not slowed by a connection
  await Promise.all(SEATS.map(driverFor));
  return {
    origin,
    close: () =>
      new Promise<void>((ok) => {
        for (const d of drivers.values()) d.close?.();
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}
