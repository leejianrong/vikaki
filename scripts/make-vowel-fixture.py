#!/usr/bin/env python3
"""Generate packages/e2e/fixtures/vowel-aa.wav: 1.5 s silence, 2 s synthetic "aah", 1.5 s silence.

Formant synthesis (impulse train through three resonators), so the fixture is our own work
with no licensing question. Chromium plays it as a fake microphone in the e2e tests.
"""
import math, struct, sys, wave

RATE = 16000
F0 = 120.0
FORMANTS = [(800, 90), (1200, 110), (2600, 160)]  # (centre Hz, bandwidth Hz) for "aah"


def resonate(x, freq, bw):
    r = math.exp(-math.pi * bw / RATE)
    a1, a2 = 2 * r * math.cos(2 * math.pi * freq / RATE), -r * r
    y, y1, y2 = [], 0.0, 0.0
    for s in x:
        v = s + a1 * y1 + a2 * y2
        y.append(v)
        y2, y1 = y1, v
    return y


def vowel(seconds):
    n = int(seconds * RATE)
    x = [0.0] * n
    phase = 0.0
    for i in range(n):
        f = F0 * (1 + 0.01 * math.sin(2 * math.pi * 5 * i / RATE))  # slight vibrato
        phase += f / RATE
        if phase >= 1:
            phase -= 1
            x[i] = 1.0
    for freq, bw in FORMANTS:
        x = resonate(x, freq, bw)
    peak = max(abs(v) for v in x) or 1
    fade = int(0.05 * RATE)
    return [v / peak * 0.3 * min(1, i / fade, (n - i) / fade) for i, v in enumerate(x)]


samples = [0.0] * int(1.5 * RATE) + vowel(2.0) + [0.0] * int(1.5 * RATE)
out = sys.argv[1] if len(sys.argv) > 1 else "packages/e2e/fixtures/vowel-aa.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))
print("wrote", out, f"{len(samples) / RATE:.1f}s")
