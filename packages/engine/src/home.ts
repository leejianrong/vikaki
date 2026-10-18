// The hub's landing page (VIK-117): every demo as a link, so nobody has to remember a URL with parameters. It asks the hub who is seated
// (`personas.json`) to make the links, and holds no other logic.
import { demos } from "./home-demos.ts";
import { el } from "./ui/dom.ts";
import "./ui/material.ts";
import "./ui/home.css";

interface Persona {
  name: string;
  style?: string;
}

const list: Persona[] = await fetch("/avatar/personas.json")
  .then((r) => (r.ok ? (r.json() as Promise<Persona[]>) : []))
  .catch(() => []);

const root = document.getElementById("home")!;
root.append(
  el("header", {}, el("h1", { className: "display-small", textContent: "Vikaki" }), el("p", { className: "body-large", textContent: "Cartoon avatars that speak, from a voice, from text, or from a language model. Pick a demo." })),
  el("section", { ariaLabel: "Demos" }, ...demos(list.length).map((d) => el("a", { className: "demo", href: d.href }, el("h2", { className: "title-large", textContent: d.title }), el("p", { className: "body-medium", textContent: d.about })))),
);
if (list.length > 0) {
  root.append(
    el(
      "section",
      { ariaLabel: "Characters" },
      el("h2", { className: "title-medium", textContent: "The characters" }),
      el("p", { className: "body-medium", textContent: "Each one has a page of their own that shows only them." }),
      el("ul", { className: "characters" }, ...list.map((p) => el("li", {}, el("a", { className: "chip", href: `/avatar?persona=${encodeURIComponent(p.name)}&live=1`, textContent: p.name, title: p.style ?? "" })))),
    ),
  );
}
root.append(
  el(
    "section",
    { ariaLabel: "Play poker" },
    el("h2", { className: "title-medium", textContent: "Play poker" }),
    el("p", { className: "body-medium", textContent: "The table fills when the players sit down. In another terminal, in the repository:" }),
    el("pre", {}, el("code", { textContent: "make poker                                          # real models (OpenRouter key in examples/poker/.env)\nmake poker POKER_ARGS=\"--fake-llm --hands 5\"        # scripted players, free" })),
  ),
);
