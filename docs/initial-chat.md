# Vikaki: Initial Discussion

Background conversation that led to the Vikaki project (*video* + *kaki*, Malay for "friend"): a live text/voice-to-avatar video tool.

## Contents

1. [Existing solutions for a mic-only avatar](#1-existing-solutions-for-a-mic-only-avatar)
2. [A generic text/voice-to-avatar tool, and how to build it](#2-a-generic-textvoice-to-avatar-tool-and-how-to-build-it)
3. [Business viability and market gaps](#3-business-viability-and-market-gaps)
4. [Use cases, open-source strategy and go-to-market](#4-use-cases-open-source-strategy-and-go-to-market)

---

## 1. Existing solutions for a mic-only avatar

### Prompt

> I usually have to join video calls like Zoom and Google Meet, but I am not allowed to use my webcam due to security reasons. However, I want to be able to have some graphic or avatar on my video call instead of my live webcam feed, so that it feels more interactive for the person I am calling. Ideally, the avatar should have human-like body language and mannerisms, and it would be nice if it could move its mouth (and/or hands, body) to match what I'm saying. Are there solutions out there currently?

### Response

Yes, solutions exist, but your specific setup (being **restricted from turning on your webcam**) determines which category of tools will work for you.

When security policies block webcam access, standard tracking tools (which track your real-time face and hands via camera) won't work. You will need **audio-driven (voice-to-face)** or **virtual camera** solutions that animate strictly from your microphone input.

#### Category 1: Voice-driven virtual cameras (no camera needed)

These run on your desktop as a standalone application. They take your spoken microphone audio, synthesize face and lip movements in real time, and output the animation as a **virtual webcam feed** that you can select inside Zoom or Google Meet.

- **xpression camera (Voice2Face mode)**
  - **How it works:** Loads any single image (a portrait of yourself, an artwork, or a cartoon) and animates it in real time with AI. Its *Voice2Face* feature animates the face, lips and head movement purely from your microphone input, without needing your actual webcam.
  - **Integration:** Appears as "xpression camera" in your Zoom or Google Meet video input settings.
- **VTube Studio / Animaze (VTuber software)**
  - **How it works:** Widely used by virtual streamers, these platforms support 2D or 3D avatars. They typically rely on webcams for eye-tracking, but both support **audio-based lip sync** (viseme mapping). Your mouth moves in sync with your speech, and idle gestures (blinking, swaying) keep the avatar natural without a camera.
  - **Integration:** Both output through a built-in virtual camera driver directly into Zoom and Meet.

#### Category 2: Built-in platform avatars (camera-off support)

If you prefer not to install third-party virtual camera software, the meeting platforms themselves offer built-in character options.

- **Zoom Cartoon Avatars (camera off)**
  - Zoom offers stylized cartoon avatars. Unlike Zoom's *Realistic AI Avatars* (which require camera access), **Cartoon Avatars** still display your visual persona when your camera is off, which is friendlier than a static profile picture.

#### Category 3: Enterprise AI real-time agents

If your goal is to have an AI avatar represent you or interact during enterprise calls, dedicated interactive avatar APIs can participate directly in meeting rooms:

- **HeyGen Interactive Avatar for Zoom:** Integrates an AI representative into Zoom calls that can speak, emote and interact naturally.
- **LemonSlice / Anam.ai:** Ultra-low-latency, real-time, audio-driven human avatars with natural body language, head movements and hand expressions, designed for interactive video streaming.

#### Important technical and security considerations

1. **Virtual camera restrictions:** Some strict corporate networks disable virtual camera drivers (such as OBS or xpression camera) alongside physical webcams. Verify that your system lets you select third-party virtual cameras in Zoom/Meet settings.
2. **Body language and hands:** Full-body tracking (such as hand gestures) typically requires a camera feed. Audio-driven options focus mainly on realistic facial movement, head tilts, blinking, and natural idle movement driven by sound amplitude and cadence.

---

## 2. A generic text/voice-to-avatar tool, and how to build it

### Prompt: generic text/voice-to-avatar

> I want a generic text OR voice to avatar live video tool. I want to be able to use it as a human, but in the future I want to extend it to LLMs that output text, so I can converse with an LLM and have the LLM appear as an avatar, with audio and movements (body, hands, face, mouth moving according to audio). What do you think? Are there existing tools like that currently, and if not, how would I go about building it myself?

### Response: tools and build blueprint

Yes, this ecosystem exists and is growing rapidly. The architecture you are describing is a **real-time streaming avatar pipeline** (using WebRTC for sub-second video latency).

Because you want to start as a **human driver** and move to an **LLM driver**, the **avatar renderer must be decoupled from the brain/audio source**.

### Existing tools and commercial platforms

If you want ready-made APIs and infrastructure that handle real-time lipsync, body movement and WebRTC video streaming out of the box:

#### 1. Developer avatar platforms (API-first)

- **Anam.ai:** Low-latency (~180 ms) real-time streaming avatars. Their JavaScript SDK lets you send text or audio streams to render an avatar in real time. You can plug in your own voice (via microphone) or pipe in an LLM + text-to-speech (TTS) pipeline.
- **Tavus (Conversational Video Interface / Phoenix model):** Ultra-realistic digital twins with full-face rendering and gestures. Supports "bring your own LLM/audio", so you can pass raw audio or text scripts and stream back live video.
- **HeyGen LiveAvatar / Interactive Avatar API:** Generates real-time WebRTC streams. You can send `repeat` / `speak` commands containing text (from an LLM) or pass dynamic audio frames.

#### 2. Open-source and client-side SDKs

- **Mascot Bot SDK / OpenAI Realtime Avatar:** A lightweight frontend alternative using 2D/vector models (e.g. Rive). It intercepts WebRTC/WebSocket audio streams (from your microphone or OpenAI's Realtime API) and generates real-time lip-sync and body gestures locally in the browser.

### How to build it yourself (architecture blueprint)

To build one platform that supports both **Human Mode** (mic → avatar) and **LLM Mode** (LLM → TTS → avatar), structure the system into three decoupled layers:

```text
[ Mode 1: Human ] ---> Mic Audio -------------------+
                                                    |
[ Mode 2: LLM ]   ---> LLM Text ---> TTS Audio -----+---> [ Audio-to-Expression / Viseme Engine ]
                                                                             |
                                                                             v
                                                               [ 2D/3D Mesh or Neural Render Engine ]
                                                                             |
                                                                             v
                                                                   [ WebRTC Video Stream ]
```

#### Step 1: Input and audio ingestion layer

- **Human mode:** Capture raw audio from your microphone with `MediaRecorder` or the Web Audio API.
- **LLM mode:** Pass user input to an LLM (OpenAI, Claude, or a local vLLM). Stream the output text directly into a fast TTS engine (ElevenLabs, Deepgram or Cartesia) to generate chunked audio buffers.

#### Step 2: Lipsync and gesture engine (the core)

Convert raw audio buffers into **visemes** (mouth shapes for specific sounds) and **blendshapes** (facial muscle parameters for expressions, eyes and eyebrows).

- **3D / mesh approach (Three.js / Babylon.js):** Use **OVR LipSync**, **uLipSync**, or **Rive audio-driven mouth morphing**, combined with a 3D model (such as a Ready Player Me avatar) loaded as glTF.
- **Neural / 2D diffusion approach:** Run an open-source audio-to-video inference model such as **LivePortrait**, **SadTalker** or **Wav2Lip**, feeding it audio chunks to generate frames dynamically.

#### Step 3: Idle and body movement layer

Static mouths look unnatural. Add procedural noise or skeletal animation hooks:

- **Procedural eye blinking and micro-gestures:** A random timer for blinking (every 3-5 seconds) and slight head tilt/nodding driven by audio pitch and amplitude.
- **Hand and body gestures:** For 3D avatars, trigger pre-baked gesture animations (e.g. `explain_left_hand`, `nod_agree`) based on text keywords or sound intensity.

#### Step 4: Streaming and virtual camera delivery

To use the avatar inside video calls (Zoom, Google Meet) or browser-based calls:

- **In-browser / WebRTC:** Pipe the canvas output (`canvas.captureStream()`) into a WebRTC peer connection.
- **Desktop virtual camera:** If running locally in Python or C++, send rendered frames to a virtual webcam loopback driver (e.g. `pyvirtualcam` or OBS Virtual Camera) so Zoom recognizes it as your primary video source.

### Recommended development path

1. **Start with 3D WebGL (Three.js + Ready Player Me):** It needs less GPU compute than full AI video diffusion, renders locally in real time at 60 fps, and works well with audio-driven blendshapes.
2. **Hook up your microphone:** Build the audio-to-viseme parser first so you can drive the avatar with your own voice.
3. **Swap the audio source:** Replace the microphone stream with an LLM + TTS audio stream. The avatar engine won't know the difference and will animate identically.

---

## 3. Business viability and market gaps

### Prompt: business standpoint

> Let's switch gears a bit and talk about the business standpoint. How established are the current tools? Can I enter the market and make money? What kind of gaps are there?

### Response: market analysis

The **real-time AI avatar and digital human market** is moving from early innovation into rapid commercial expansion, estimated as a multi-billion-dollar market growing at over 30% annually. It is structurally split in two, which creates specific business opportunities:

- **Pre-recorded / async video (mature):** Dominated by HeyGen, Synthesia and D-ID, which focus on synthetic video generation (marketing, corporate training, localized sales videos). Competing directly here requires massive capital.
- **Real-time interactive streaming (emerging):** Tavus, Anam.ai and HeyGen LiveAvatar offer APIs with sub-300 ms video latency over WebRTC. The infrastructure layer is establishing itself quickly, but **the application layer is wide open.**

### Can you enter the market and make money?

Yes, but **not by building a generic "avatar API."**

Building foundational AI rendering models from scratch requires millions in capital and heavy GPU infrastructure. The profitable path is **verticalized, workflow-integrated SaaS applications** built on low-level avatar APIs (or lightweight WebGL/3D local rendering engines).

API providers sell raw infrastructure for $0.09 to $0.35 per streamed minute, while verticalized enterprise solutions can command contract values above $100k a year by solving a specific business problem end to end.

### Key gaps and commercial opportunities

#### 1. The cost and latency disconnect (client-side vs. cloud)

- **The gap:** Top-tier solutions rely on server-side GPU neural rendering (e.g. LivePortrait, diffusion models) streamed over WebRTC. This can cost up to ~$20/hour per active stream in GPU compute, and an idle user on a call still burns GPU.
- **The opportunity:** Build lightweight **hybrid/client-side render engines** (WebGL, Three.js, or local WASM/ONNX inference). Driving 3D meshes locally from voice visemes takes rendering cost to near zero ($0/min), enabling consumer-friendly subscription pricing.

#### 2. Native spatial and platform integrations

- **The gap:** Most live avatar platforms render inside a browser widget. Seamless integration into native meeting environments (a silent virtual camera or bot that joins Zoom, Google Meet or Microsoft Teams with zero setup) remains fragmented and user-unfriendly.
- **The opportunity:** A plug-and-play desktop/virtual camera driver designed for corporate employees, remote workers and multilingual presenters who need visual privacy without losing presence.

#### 3. Deep non-verbal communication (body language and micro-expressions)

- **The gap:** Current interactive APIs focus almost entirely on lip-sync accuracy and facial movement. They lack believable, context-aware hand gestures, posture shifts, emotional micro-expressions and active-listening behaviors (nodding, leaning in, looking thoughtful while processing text).
- **The opportunity:** A specialized **"gesture and sentiment layer"** that intercepts LLM output or voice audio, analyzes pitch, cadence and semantic intent, and triggers synchronized body language.

#### 4. High-trust vertical solutions

- **The gap:** Regulated industries (healthcare, wealth management, high-ticket retail, corporate recruiting) cannot use generic "cool" avatars because of compliance, privacy (HIPAA/SOC 2) and brand-safety requirements.
- **The opportunity:** Hyper-specialized AI representatives for regulated industries, such as an AI medical intake agent, a 24/7 digital wealth advisor or an interactive employee onboarding persona, bundled with compliance audit trails and workflow tools.

---

## 4. Use cases, open-source strategy and go-to-market

### Prompt: use cases and open-source model

> Personally, I have a few use cases right now:
>
> 1. The use case I mentioned above: a human in a video call, with mic enabled but webcam disabled.
> 2. I have an app where multiple agents are orchestrated as teams (typically software teams), and they should present the software app to me over a video call (or some sort of demo). I want the agent presenting to me to have a voice and potentially an avatar video.
> 3. I am working on another project where LLMs can play interactive games with humans. Think Codenames, Wavelength, Catan, and even poker, where talking and body language is a big part of the game.
> 4. Finally, I want to think about how to get adoption for this project and where the business is. I'm happy to work on an open-source project that people can self-host, and to get money by providing a platform (paid SaaS) on top of my open-source engine/core.
>
> Thoughts? Let's discuss.

### Response: architecture and go-to-market

Your use cases map directly to an **open-core business model** (similar to GitLab, Supabase or LiveKit).

#### Analysis of your use cases

| Use case | Technical requirements | Feasibility and best approach |
| --- | --- | --- |
| **1. Mic-only virtual webcam** | Ultra-low latency (<100 ms), local audio processing, OS-level virtual camera loopback. | **Easiest.** Run a local client app (Electron/Tauri) that takes mic input, computes visemes/blendshapes, and streams to `pyvirtualcam` or WebRTC. |
| **2. Multi-agent software demo** | Multi-stream orchestration, state-driven animations ("screencast", "talking", "idle"), screen sharing. | **Medium.** Combine a headless browser for the app demo with a WebRTC audio/avatar overlay stream for each agent persona. |
| **3. Interactive games (bluffing, body language)** | Micro-gestures (eyebrow raises, smirks, nods), intent-driven gesture triggering from LLM text/audio. | **Hardest.** Lip-sync isn't enough. You need a **gesture state machine** fed by LLM function calls (e.g. `set_expression("bluffing_smirk")`). |

Use case 4 (adoption and business) is covered in the sections below.

### The architecture: open-source engine + paid SaaS

To make this commercializable, decouple the **rendering engine** (open source) from the **orchestration and infrastructure platform** (paid cloud).

```text
+-------------------------------------------------------------------+
|                     Open Source Engine (Core)                     |
|                                                                   |
|  [ Audio / TTS ] ---> [ Viseme / Blendshape Engine ]              |
|                                |                                  |
|  [ LLM Intent ]  ---> [ Gesture State Machine ]                   |
|                                |                                  |
|                                v                                  |
|                [ 3D WebGL / Canvas Renderer ]                     |
|                                |                                  |
|                                v                                  |
|                    [ WebRTC / Virtual Cam ]                       |
+-------------------------------------------------------------------+
                                 ^
                                 | (API connections)
+-------------------------------------------------------------------+
|                      Paid Platform (SaaS)                         |
|                                                                   |
|  * Multi-agent orchestration and room routing                     |
|  * Low-latency WebRTC SFU / managed streaming infrastructure      |
|  * Voice cloning and high-speed TTS API keys                      |
|  * Agent personality and avatar asset management                  |
+-------------------------------------------------------------------+
```

#### What goes in the open-source engine

- **Local WebGL/3D avatar renderer:** Supports glTF / Ready Player Me avatars with standardized blendshapes.
- **Audio-to-viseme mapper:** Processes local mic input or TTS audio buffer streams in real time.
- **Basic gesture and expression protocol:** A JSON spec mapping game states or LLM tags (e.g. `<smile intensity="0.8"/>`) to skeletal animations.
- **Virtual camera and WebRTC output:** Desktop driver loopback or web stream output.

#### What goes in the paid SaaS (cloud platform)

- **Managed streaming infrastructure:** Low-latency WebRTC SFU (selective forwarding unit) media servers. Hosting video streams for dozens of concurrent AI agents gets expensive and complex for non-technical users.
- **Multi-agent orchestration (use case 2):** Room management, floor control (who speaks when) and synthetic video composition (mixing screen shares with avatar video).
- **Game session state server (use case 3):** Turn tracking, hidden state management (for Catan/poker) and emotion-intent routing to avatars.
- **Zero-setup web SDK:** Embeddable widgets for developers who want an avatar agent in their app in a few lines of JavaScript.

### Go-to-market and monetization strategy

1. **Target developer communities first:** Build for developers creating AI RPGs, virtual streamers or autonomous agent teams (CrewAI, AutoGen, LangChain users). They need avatar output for their agents but don't want to build WebGL or WebRTC pipelines from scratch.
2. **Launch as "LiveKit for avatars":** Position the open-source repo as the universal protocol and client library for audio-reactive avatars.
3. **Monetize via cloud and usage tiers:**
   - **Self-hosted (free):** Single-user desktop app (use case 1) or a self-hosted server running local WebGL streams.
   - **SaaS Pro ($29-$99/mo):** Hosted WebRTC streams, managed multi-agent orchestration and pre-built avatar assets.
   - **Enterprise (custom):** Dedicated GPU instances for neural rendering models (LivePortrait, SadTalker), custom voice clones, and HIPAA/SOC 2 compliance.

### Technical blueprint to get started

Build a prototype that unifies use cases 1 and 3:

1. **Avatar standard:** Use **Ready Player Me (RPM)** glTF avatars with the standard ARKit blendshapes (52 facial targets).
2. **Audio-to-face:** Implement a lightweight client-side viseme processor (e.g. *OVR LipSync* or *uLipSync* compiled to WASM).
3. **Control protocol:** Define a simple WebSocket JSON payload for both human and LLM drivers:

```json
{
  "audio_chunk": "base64_pcm_data",
  "expression": "suspicious",
  "gesture": "tilt_head_left",
  "intensity": 0.75
}
```

This ensures the same rendering engine handles a human talking into a mic or an LLM playing a game of Catan.
