# Build status

What is built, by slice. The board is Pandan board 35 ("Vikaki"); the build order is [SLICES.md](SLICES.md). Where this and the code disagree, trust the code and fix this page.

| Slice | State |
| --- | --- |
| V1 Mic to avatar to a real call | V1.1 to V1.6 and V1.10 done: scaffold, VRM avatar, lip-sync spike (wLipSync, ADR-0007), mic to lip sync, blink and sway, demo page, Meet extension (tested against a stand-in page only). V1.7 to V1.9 need a human on the real call machine. |
| V2 LLM text driver and MCP | Done: protocol, hub, TTS, speech pipeline, lifecycle and cancel, CLI `say` / `cancel` / `replay` and the event log, timing, `vikaki mcp` ([mcp.md](mcp.md)), test plan. |
| V3 Emotions and personas | V3.1 done: the seven emotions as a pose plus manga symbols ([ADR-0015](adr/0015-emotions-as-pose-and-manga-symbols.md)). V3.2 done: the thinking pose. V3.3 done: personas ([personas.md](personas.md)). V3.4 done: head nods, lifts and blinks answering the mic voice. V3.5 done: one page per persona, two looks (Cookieman and Snowy). V3.6 done: the test plan. V3 is done. |
| V4 Headless, container, MJPEG feed | V4.3 done: the audio-only page (`?render=off`, [personas.md](personas.md)). V4.2 done: `serve --headless` ([headless.md](headless.md)). V4.4 done: `vikaki stream`, an MJPEG feed ([stream.md](stream.md)). Next: Docker, CI and docs. |
| Observability | Phases 0 to 2 done: honest speech demo, install-voice, doctor, debug recorder, speech-or-buzz gate, timeline dock, karaoke ([observability.md](observability.md)). Phoneme lip sync (phase 3) is deferred: the mouth is passable. |
