# Build status

What is built, by slice. The board is Pandan board 35 ("Vikaki"); the build order is [SLICES.md](SLICES.md). Where this and the code disagree, trust the code and fix this page.

| Slice | State |
| --- | --- |
| V1 Mic to avatar to a real call | V1.1 to V1.6 and V1.10 done: scaffold, VRM avatar, lip-sync spike (wLipSync, ADR-0007), mic to lip sync, blink and sway, demo page, Meet extension (tested against a stand-in page only). V1.7 to V1.9 need a human on the real call machine. |
| V2 LLM text driver and MCP | Done: protocol, hub, TTS, speech pipeline, lifecycle and cancel, CLI `say` / `cancel` / `replay` and the event log, timing, `vikaki mcp` ([mcp.md](mcp.md)), test plan. |
| V3 Emotions and personas | Not started. `set_emotion` is accepted today but has no visible effect until V3.1. |
| V4 Headless, container, MJPEG feed | Not started. |
| Observability | Phases 0 to 2 done: honest speech demo, install-voice, doctor, debug recorder, speech-or-buzz gate, timeline dock, karaoke ([observability.md](observability.md)). Phoneme lip sync (phase 3) is deferred: the mouth is passable. |
