"""A small OpenAI-style speech server over Chatterbox (VIK-143), for a RunPod pod.

POST /v1/audio/speech {"input": "...", "exaggeration": 0.5, "cfg_weight": 0.5} -> raw 16-bit mono PCM at the model's rate (24 kHz).
GET  /health -> {"ready": true, "sample_rate": 24000, "device": "cuda"}

One request at a time (a lock): the GPU makes one piece at a time anyway, and queueing fairly beats two slow ones. The bearer token comes from the
environment variable VIKAKI_TTS_TOKEN; if it is unset the server takes no key (for a server on your own machine). `--fake` makes a tone instead of loading
the model, so the route and the adapter can be tried on a CPU with no download. Chatterbox puts a Perth watermark in every clip it makes; it is left on.
"""
import argparse
import hmac
import os
import threading
import time

import numpy as np
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

TOKEN = os.environ.get("VIKAKI_TTS_TOKEN", "")
LOCK = threading.Lock()
app = FastAPI()
state = {"model": None, "rate": 24000, "device": "cpu", "fake": False, "loaded_ms": 0.0}


class SpeechRequest(BaseModel):
    input: str
    voice: str | None = None
    exaggeration: float = 0.5
    cfg_weight: float = 0.5
    temperature: float = 0.8
    response_format: str = "pcm"
    model_config = {"extra": "ignore"}  # `model`, `instructions` and the rest of an OpenAI-style body


def load(fake: bool) -> None:
    started = time.time()
    state["fake"] = fake
    if fake:
        return
    import torch
    from chatterbox.tts import ChatterboxTTS

    state["device"] = "cuda" if torch.cuda.is_available() else "cpu"
    state["model"] = ChatterboxTTS.from_pretrained(device=state["device"])
    state["rate"] = state["model"].sr
    # The first generation is slow (kernels compile); pay for it here, not on the first real line.
    state["model"].generate("Ready to play, everyone.")
    state["loaded_ms"] = (time.time() - started) * 1000


def make(req: SpeechRequest) -> np.ndarray:
    if state["fake"]:
        n = int(state["rate"] * max(0.2, len(req.input) * 0.06))
        t = np.arange(n) / state["rate"]
        return (0.2 * np.sin(2 * np.pi * (180 + 80 * req.exaggeration) * t)).astype(np.float32)
    wav = state["model"].generate(req.input, exaggeration=req.exaggeration, cfg_weight=req.cfg_weight, temperature=req.temperature)
    return wav.squeeze().detach().cpu().numpy().astype(np.float32)


def check(authorization: str | None) -> None:
    if TOKEN and not hmac.compare_digest(authorization or "", f"Bearer {TOKEN}"):
        raise HTTPException(status_code=401, detail="bad or missing key")


@app.get("/health")
def health():
    return {"ready": state["fake"] or state["model"] is not None, "sample_rate": state["rate"], "device": state["device"], "load_ms": round(state["loaded_ms"])}


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest, authorization: str | None = Header(default=None)):
    check(authorization)
    text = req.input.strip()
    if not text or len(text) > 600:
        raise HTTPException(status_code=400, detail="input must be 1 to 600 characters (the adapter sends pieces of about 200)")
    with LOCK:
        started = time.time()
        wav = make(req)
        ms = round((time.time() - started) * 1000)
    pcm = (np.clip(wav, -1, 1) * 32767).astype("<i2").tobytes()
    return Response(pcm, media_type="audio/L16", headers={"X-Generate-Ms": str(ms), "X-Sample-Rate": str(state["rate"])})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--fake", action="store_true")
    a = ap.parse_args()
    load(a.fake)
    print(f"server: ready on :{a.port} (fake={a.fake}, device={state['device']})", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=a.port, log_level="warning")
