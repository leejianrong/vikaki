// What the landing page offers (VIK-117), apart from the page so it can be tested without a browser.

/** How many seats the poker links ask for: one per character the hub has, between 2 and 8 (a table of 3 with none). */
export function seatCount(personas: number): number {
  return personas >= 2 ? Math.min(personas, 8) : 3;
}

export interface Demo {
  title: string;
  about: string;
  href: string;
}

/** The demos, in the order a visitor most likely wants them. */
export function demos(personas: number): Demo[] {
  const n = seatCount(personas);
  return [
    { title: "Poker table", about: "The characters round a felt table, with the panel of hands, chances, chat and private thoughts. Start the players with the command below.", href: `/avatar?seats=${n}&view=table` },
    { title: "Poker, in a row", about: "The same table as a simple row of avatars with the cards on plates.", href: `/avatar?seats=${n}` },
    { title: "Say something", about: "Type a line and hear it said, with the timeline of what the voice did.", href: "/avatar?demo=speech&live=1" },
    { title: "Compare the mouths", about: "The same Say something page, with the mouth that follows the phonemes the voice spoke (hybrid). Add &mouth=audio for the old mouth, or &mouth=phoneme. Needs the hub started with --phonemes: make demo-mouth does.", href: "/avatar?demo=speech&live=1&mouth=hybrid" },
    { title: "Microphone", about: "Speak, and the avatar's mouth follows your voice.", href: "/avatar?demo=1" },
  ];
}
