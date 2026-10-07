const params = new URLSearchParams(location.search);
const hud = document.getElementById("hud");
if (hud && params.get("hud") === "0") hud.hidden = true;

// V1.2 replaces this placeholder with the Three.js + three-vrm scene.
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (ctx) {
  canvas.width = 640;
  canvas.height = 480;
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
