// Embed mode (`?embed=1`, VIK-64): the page is an iframe inside a game's own page, so it draws the avatars and nothing else. No HUD, no
// pot or board strip, no name plates, no transcript, and a transparent background so the host page shows through. `&bg=<hex>` still
// paints a solid colour; `&names=1` and `&captions=1` bring back the name plates and the transcript strip for a host that wants them.

export interface EmbedOptions {
  /** `?embed=1`. */
  embed: boolean;
  /** The name plates under the avatars (`&names=1`). Only in embed mode: the table page always shows them otherwise. */
  names: boolean;
  /** The transcript strip (`&captions=1`). Same rule. */
  captions: boolean;
  /** The corner status line. Off in embed mode unless `&hud=1`; elsewhere on unless `&hud=0`. */
  hud: boolean;
}

export function parseEmbed(params: URLSearchParams): EmbedOptions {
  const embed = params.get("embed") === "1";
  return {
    embed,
    names: !embed || params.get("names") === "1",
    captions: !embed || params.get("captions") === "1",
    hud: embed ? params.get("hud") === "1" : params.get("hud") !== "0",
  };
}

/**
 * Make the document see-through. An iframe is only transparent if its colour scheme matches the one of the page around it: a document that
 * asks for `light dark` on a dark system, framed by a light page, gets an opaque backdrop. So embed mode drops the page's own scheme.
 */
export function makeTransparent(doc: Document): void {
  doc.querySelector('meta[name="color-scheme"]')?.remove();
  doc.documentElement.classList.add("embed");
}
