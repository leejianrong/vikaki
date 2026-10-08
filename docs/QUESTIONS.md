# Questions

Statuses: `DECIDED` (user answered) · `ASSUMED` (default taken, correct it if wrong) · `FORK` (waiting on the user) · `DEFERRED` (not needed this milestone).

Sources: [initial-chat.md](initial-chat.md) and the games brief (`agent-game-framework/docs/AVATAR-PROJECT-BRIEF.md`).

## Open forks

None. Round 1 closed 2026-10-07.

## Register

| ID | Question | Status | Answer or default | Landed |
|----|----------|--------|-------------------|--------|
| Q1 | Milestone 1 primary user and order | DECIDED | Human mic-only call first, LLM driver in slice 2. The games brief prefers output-first, so the protocol follows its shapes from V1 to keep that path cheap | PLAN, ADR-0001 |
| Q2 | Runtime and OS | DECIDED | Ubuntu-first CLI plus local server, container-capable, also runs on Windows. Call machine is Windows | ADR-0003 |
| Q3 | Can software be installed on the call machine, and where are calls joined | DECIDED | Yes, software can be installed, and calls are joined in the browser. Whether extensions are allowed, and whether Meet/Teams/Zoom web accept a substituted camera, is unverified | PLAN §Open risks, V1 |
| Q4 | Avatar format and renderer | DECIDED | Stylised VRM, Three.js and three-vrm | ADR-0002 |
| Q5 | Licence | DECIDED | Apache-2.0 | ADR-0004 |
| Q6 | M1 scope | DECIDED | SaaS, use cases 2 and 3 out of M1, but documented | PLAN §Deferred and recorded |
| Q7 | Control protocol | ASSUMED | Versioned WebSocket JSON matching the games brief | ADR-0001 |
| Q8 | Lip-sync library | DECIDED | wLipSync, with wawa-lipsync as fallback, after the V1.3 spike | ADR-0007, docs/spikes/lipsync.md |
| Q9 | Body language from a mic only | ASSUMED | Prosody-driven only in M1 | PLAN §Assumed defaults |
| Q10 | Privacy of human mode | ASSUMED | Fully local, no network call, mic audio never leaves the page | PLAN R6 |
| Q11 | State and storage | ASSUMED | Plain files and a JSONL event log, no database | PLAN §Implementation decisions |
| Q12 | Concurrency | ASSUMED | One driver at a time, second gets `driver_busy` | PLAN §Implementation decisions, V2 |
| Q13 | Failure behaviour | ASSUMED | Fall back to idle and emit `error`, never a frozen frame | PLAN §Implementation decisions |
| Q14 | Interfaces | ASSUMED | Page, WebSocket and CLI share one hub and one write path | PLAN §Shape |
| Q15 | Stack and delivery | ASSUMED | TypeScript monorepo, Node, Vite, no Electron. Browser extension for web meetings, OBS then window share as fallbacks. Language rationale recorded after Jian asked why not Python or Go | ADR-0003, ADR-0006 |
| Q32 | Visual direction | DECIDED | Cartoon-first, cute. No realism or human mimicry. Photoreal renderers are non-goals | ADR-0005 |
| Q34 | 2D renderers | DECIDED | Allowed alongside VRM. VRM stays the default and the board order is unchanged | ADR-0008 |
| Q35 | Mouth fallback under strict CSP | DECIDED | Amplitude-only mouth when wLipSync is blocked; reported as `mouthKind` | ADR-0009 |
| Q33 | Doodle avatars | DEFERRED | User-drawn face plus a mouth doodle per vowel, animated by a 2D sprite renderer. Post-M1 idea, needs the renderer interface seam | PLAN §Deferred and recorded |
| Q16 | Measurable targets | ASSUMED | Mouth-to-audio offset under 100 ms, 30 fps on a mid laptop, time to first audio and first frame reported with 1.5 s as a local target | SLICES V1, V2 |
| Q17 | Versioning | ASSUMED | `protocol_version` on every message, migrations deferred | ADR-0001 |
| Q18 | Ready Player Me | DECIDED | Rejected, service ended 2026-01-31 | ADR-0002 |
| Q19 | Emotion vocabulary | ASSUMED | Seven: neutral, happy, smug, worried, surprised, sad, angry. Unknown falls back to neutral | PLAN, V3 |
| Q20 | Persona ownership | ASSUMED | This project owns `personas.yaml`, games refer to a name only | PLAN, V3 |
| Q21 | Rendered seats per machine | ASSUMED | One page per seat, one seat in M1, audio-only for unwatched seats | V4 |
| Q22 | TTS engine | DECIDED | Kokoro (Apache-2.0) as an optional on-demand engine; FakeTts for tests; Piper rejected (GPL-3.0). Measured about 1.6 s to a first short sentence on CPU | ADR-0010, docs/tts.md |
| Q23 | Does the game wait for speech | DEFERRED | Game-side per-game setting. We only emit events | PLAN §Deferred |
| Q24 | Do humans see their own avatar | DEFERRED | In mic mode the page is the preview. Multi-viewer decision belongs to the game side | PLAN §Deferred |
| Q25 | STT and `human_utterance` | DEFERRED | After M1 | PLAN §Deferred |
| Q26 | Native speech-to-speech models | DEFERRED | Protocol must still allow text beside audio | PLAN §Deferred |
| Q27 | Hosted or neural avatar renderers | DEFERRED | Swappable renderer later, not M1 | PLAN §Deferred |
| Q29 | Hosting seams | ASSUMED | Optional `session_id`, driver auth token, stateless env-configured hub, URL assets, usage counters | ADR-0001 |
| Q30 | LLM control surface | DECIDED | An LLM drives the avatar over MCP (and text events). Multi-avatar poker spectator view follows M1 | PLAN, V2 |
| Q31 | Local viewing | DECIDED | Avatar must be watchable locally as a live video feed: browser page in V1, MJPEG stream via `vikaki stream` in V4 | PLAN R10, V4 |
| Q28 | Secrets | ASSUMED | None in human mode. TTS API keys, if used, come from environment variables and are never logged or committed | PLAN |

## Coverage

| Category | Covered by |
|----------|-----------|
| Primary user and actors | Q1, Q12 |
| Scope boundary | Q6, Q25, Q27 |
| Data model and identity | Q7, Q20 |
| State and storage | Q11 |
| Concurrency and conflict | Q12 |
| Interfaces and contracts | Q7, Q14, Q23 |
| Failure behaviour | Q13 |
| External dependencies | Q4, Q8, Q18, Q22 |
| Runtime and deployment | Q2, Q3, Q15, Q21 |
| Measurable success | Q16 |
| Security and secrets | Q10, Q28 |
| Versioning and migration | Q17 |
