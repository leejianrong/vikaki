// The page's entry. `?render=off` is the audio-only page: it plays a persona's speech and reports events to the driver, but loads no
// scene, avatar or lip-sync code and draws nothing, so a seat nobody is looking at costs almost nothing. `?seats=` is the table page: several avatars in one scene, one per seat. Everything else is the avatar page.
const query = new URLSearchParams(location.search);
if (query.get("render") === "off") await import("./audio-page.ts");
else if (query.has("seats")) await import("./table-page.ts"); // several avatars on one scene, one per seat
else await import("./avatar-page.ts");

export {};
