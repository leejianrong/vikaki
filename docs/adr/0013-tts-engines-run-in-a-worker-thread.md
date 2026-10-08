# ADR-0013: Text-to-speech engines run in a worker thread

- Status: Accepted
- Date: 2026-10-08
- Deciders: Jian, Claude (KAN-1957)

## Context

The timeline view showed that the page reported `speech_started` at 1.6 s but the driver was told at 3.0 s. While Kokoro made the next sentence, the server's event loop stalled for up to 1.8 s (p99 50 ms), and the hub relays every message on that loop. So `speech_started` reached the driver late, and a driver's `cancel` would have waited out the stall too. The cancel tests used `FakeTts`, which does not block, so they could not see it.

## Decision

- `WorkerTts` (`packages/tts`) runs any engine in a worker thread and presents the `Tts` interface. `KokoroTts` uses it by default (`inProcess: true` runs it in the main thread, for measuring only).
- The engine is a plain JavaScript module exporting `create(options)`, because a worker thread cannot load TypeScript here. Kokoro's loading and generating code moved to `kokoro-core.mjs`, shared by both paths.
- Audio is handed back chunk by chunk with the buffers transferred, not copied. Aborting a request tells the worker and ends the iterator at once; an engine that cannot stop part-way (Kokoro) finishes the sentence and the result is dropped.
- `close()` waits for work in progress (up to 10 s) before stopping the worker. Killing Kokoro's thread while the ONNX runtime is running aborts the whole process (`terminate called after throwing Napi::Error`), which would break the clean Ctrl+C exit. The CLI closes the engine as part of its shutdown.
- Tests use a deliberately blocking engine: in-process it delays relays beyond 300 ms (a control test proves the check can see a stall), behind `WorkerTts` it does not.

## Measured with the real voice

| | Server event-loop stall | Driver told `started` after the page | Cancel, page to driver |
| --- | --- | --- | --- |
| In-process | up to 1,681 ms | 1,227 ms later | n/a |
| Worker | up to 17 ms | 9 ms later | 33 ms, then 11 ms |

## Alternatives considered

| Option | Why not |
| --- | --- |
| Make the hub reply faster another way (a second thread for sockets) | Moves the problem: the hub and the speech engine share state |
| Split Kokoro's work into smaller pieces with `setImmediate` | It is inside `kokoro-js` and the ONNX runtime, not our code |
| A child process | Heavier (a second copy of everything, IPC with copies); a worker transfers buffers and shares the install |
| Leave it, document it | A slow voice would keep delaying cancel, which the product promises is quick |

## Consequences

Buys a hub that stays responsive whatever the engine does, and makes `cancel` and the `speech_*` events trustworthy with a real voice. Costs a second thread and a little start-up (the model loads in the worker), a copy of Kokoro's loading code in plain JavaScript, and a wait of up to one sentence on shutdown when a cancelled sentence is still being made. A cancelled sentence still occupies the CPU until it finishes; true cancellation would need the engine to support it.

## Update: cancelling a sentence with the real voice (KAN-1961)

Measured with `scripts/probe-cancel-cost.ts` (Kokoro on this machine's CPU): a sentence cannot be interrupted once `generate()` has started, so cancelling one 300 ms in delayed the first audio of the next line from 1.0 s to 2.9 s (60 characters), 5.0 s (120) and 7.4 s (200): the next line waited behind the abandoned one, and in fact ran beside it, which slowed both. Three changes:

- **Pieces.** A sentence is made in pieces of about 70 characters (a cut after punctuation may run to about 87), cut at semicolons, colons and dashes first, then commas, then before a conjunction, then at a space (`split-text.mjs`). An abort lands between pieces and costs at most one.
- **Padding.** Each `generate()` call pads its audio with about half a second of quiet at both ends; joined as they came, a sentence had pauses of 0.7 to 0.9 s mid-way (found with `scripts/probe-split-quality.ts`, not by ear). The padding is trimmed at joins (the line's own start and end are left as made) and a pause that suits the cut is put back: 0.3 s after a semicolon or colon, 0.25 s after a comma, 0.05 s elsewhere. Join pauses are now 0.29 to 0.34 s, the same as ordinary commas.
- **One at a time, and let the loop turn.** The worker handles one request at a time (an abort applies while a request waits, so one cancelled in the queue never reaches the engine), and yields to its event loop between pieces and before each request: a message to a worker is only handled when its loop turns, and Kokoro's work holds the thread and is awaited by microtasks, so without the yield the abort was not seen until every piece had been made.

Result: the line after a cancel waits for the piece in progress, not the sentence: 2.8 s (60 characters), 3.1 s (120), 3.1 s (200). Restarting the worker instead was ruled out: a second Kokoro load in the same process fails (the native runtime does not load twice). I could not listen to the result; the instrument checks are the speech-or-buzz classification, the pauses and the spectrogram.
