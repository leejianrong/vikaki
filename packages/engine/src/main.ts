// The page's entry. `?render=off` is the audio-only page: it plays a persona's speech and reports events to the driver, but loads no
// scene, avatar or lip-sync code and draws nothing, so a seat nobody is looking at costs almost nothing. Everything else is the avatar page.
const audioOnly = new URLSearchParams(location.search).get("render") === "off";
if (audioOnly) await import("./audio-page.ts");
else await import("./avatar-page.ts");

export {};
