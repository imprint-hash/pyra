#!/usr/bin/env python3
"""Generate the ambient bed under the Pyra demo.

Synthesised rather than sourced: a licence-free track that suits a 75-second
dev demo is more trouble to find than to build, and building it means the
cues can land exactly on the scene boundaries.

The bed is deliberately dull — a drone, a slow swell, and a soft tick at each
cut. Anything with a melody competes with the captions for attention, and the
captions are carrying the argument.

    python3 tools/make_bed.py out.wav
"""

from __future__ import annotations

import math
import struct
import sys
import wave

RATE = 48_000
SECONDS = 75.05
FPS = 30

# Scene boundaries in frames, from src/Pyra.tsx. A tick here marks each cut.
CUTS = [0, 150, 540, 1050, 1500, 1950]

# A minor ninth, low and wide. Held under speech it reads as tension without
# ever suggesting a tune.
DRONE = [55.00, 82.41, 110.00, 164.81]


def envelope(t: float) -> float:
    """Fade in at the top, out at the tail, and breathe slowly in between."""
    fade_in = min(1.0, t / 2.5)
    fade_out = min(1.0, max(0.0, (SECONDS - t) / 3.0))
    breath = 0.82 + 0.18 * math.sin(2 * math.pi * t / 19.0)
    return fade_in * fade_out * breath


def tick(t: float) -> float:
    """A short filtered blip on each scene change, felt more than heard."""
    out = 0.0
    for frame in CUTS:
        start = frame / FPS
        dt = t - start
        if 0 <= dt < 0.45:
            decay = math.exp(-dt * 11.0)
            out += decay * (
                0.55 * math.sin(2 * math.pi * 220.0 * dt)
                + 0.30 * math.sin(2 * math.pi * 330.0 * dt)
            )
    return out


def sample(t: float) -> float:
    # Slight detune per voice so the drone moves instead of sitting still.
    body = sum(
        math.sin(2 * math.pi * (f + 0.12 * i) * t) / (i + 2)
        for i, f in enumerate(DRONE)
    )

    # A quiet pulse at roughly one bar every four seconds gives the eye
    # something to cut against without becoming a beat.
    pulse = 0.10 * math.sin(2 * math.pi * 0.25 * t) * math.sin(2 * math.pi * 110.0 * t)

    return envelope(t) * (0.16 * body + pulse) + 0.09 * tick(t)


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "bed.wav"
    total = int(RATE * SECONDS)

    with wave.open(path, "w") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)

        frames = bytearray()
        for n in range(total):
            t = n / RATE
            v = sample(t)
            # Soft clip rather than hard, so a peak never spits.
            v = math.tanh(v * 1.6) * 0.55
            # Widen very slightly: the right channel lags by a fraction.
            vr = math.tanh(sample(max(0.0, t - 0.004)) * 1.6) * 0.55
            frames += struct.pack("<hh", int(v * 32767), int(vr * 32767))
        w.writeframes(bytes(frames))

    print(f"wrote {path}: {SECONDS:.2f}s, {total} frames")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
