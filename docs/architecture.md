# Architecture

How the pieces fit. Solid boxes exist today; dashed boxes are planned (slice in brackets). Protocol details: [protocol.md](protocol.md). Decisions: [adr/](adr/).

```mermaid
flowchart LR
  subgraph drivers["Drivers: decide what is said (one at a time)"]
    LLM["LLM client<br/>(Claude Code, ...)"]
    MCP["vikaki mcp<br/>say / set_emotion / cancel / set_persona<br/>[V2.8]"]:::planned
    SAY["vikaki say / replay<br/>[V2.6]"]:::planned
    GAME["a game or script<br/>(any WebSocket client)"]
  end
  CTL["vikaki cancel<br/>controller: may only cancel<br/>[V2.6]"]:::planned

  subgraph server["vikaki serve (Node)"]
    HUB["Hub /ws<br/>validates, enforces roles,<br/>one driver, many viewers"]
    SPEECH["SpeechEngine<br/>sentence chunker, queue, cancel"]
    TTS["Tts engine<br/>FakeTts or Kokoro<br/>(worker thread)"]
    REC["DebugRecorder<br/>wav, spectrogram, metrics"]
    LOG["JSONL event log<br/>[V2.6]"]:::planned
    HTTP["HTTP: avatar page, /avatar"]
  end

  subgraph viewers["Viewers: play what the hub sends"]
    PAGE["Avatar page (browser)<br/>Three.js + VRM, lip sync,<br/>timeline dock, karaoke"]
    EXT["Meeting extension<br/>virtual camera in Meet"]
    HEAD["Headless renderer + MJPEG feed<br/>[V4]"]:::planned
  end

  LLM -- "MCP over stdio" --> MCP
  MCP -- "driver over WebSocket" --> HUB
  SAY -- "driver" --> HUB
  GAME -- "driver" --> HUB
  CTL -- "cancel" --> HUB

  HUB <--> SPEECH
  SPEECH --> TTS
  SPEECH --> REC
  HUB --> LOG
  HUB -- "utterance, cancel, audio (PCM)" --> PAGE
  PAGE -- "speech_started / finished / interrupted" --> HUB
  HUB -- "speech events, errors" --> MCP
  HTTP --> PAGE
  PAGE -- "canvas as camera" --> EXT
  PAGE -.-> HEAD

  MIC["Microphone"] -- "mic mode: no hub needed" --> PAGE

  classDef planned stroke-dasharray: 5 5,fill:none;
```

## Where MCP fits

`vikaki mcp` is just another **driver**. An LLM client starts it as a stdio subprocess; it speaks MCP to the client and the ordinary protocol to the hub. Nothing in the hub or the page knows an LLM is involved, so a `say` tool call produces the same event sequence as `vikaki say` (tested in V2.9).

- It connects to a hub that is already running (`vikaki mcp --port 8787`), so the page you are watching is the one it drives.
- It takes the single driver slot on the first tool call. While it holds it, `vikaki say` or a game gets `driver_busy`. `vikaki cancel` still works, because a controller is not a driver.
- `say` returns after the avatar finishes (or is interrupted), with the outcome and time to first audio.
- `set_emotion` and `set_persona` set session defaults that are stamped onto later `utterance` messages. Persona picks the voice now; emotion shows once V3.1 lands.

## One utterance, end to end

```mermaid
sequenceDiagram
  participant D as Driver (MCP / CLI / game)
  participant H as Hub + SpeechEngine
  participant P as Avatar page
  D->>H: utterance (text or deltas)
  H->>P: utterance
  H->>H: chunk into sentences, synthesise
  H-->>P: audio slices (PCM)
  P->>D: speech_started (via hub)
  P->>P: play audio, lip sync from the same signal
  P->>D: speech_finished (via hub)
  Note over D,P: cancel at any point: hub aborts synthesis,<br/>page stops, driver gets speech_interrupted
```

With no page connected, the hub plays the speech clock itself and sends the same events, so a driver never waits on a face that is not there.
