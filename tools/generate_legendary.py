#!/usr/bin/env python3
"""THYRK Legendary Batch 2 — trait-combination generator.

Generates legendary-008.webp .. legendary-277.webp (270 new images) from the
5 approved base Legendary images, using 3 trait axes:

  base     : 5 bases (legendary-001, -004, -005, -006, -007)
  hue      : 6 hue rotations (0, 60, 120, 180, 240, 300 degrees)
  aura     : 6 aura colours (red, blue, purple, gold, green, cyan) — soft
             radial ring glow around the knight, screen blend
  bg_tint  : 3 dark background tints (dark-blue, dark-purple, dark-green) —
             dark pixels shifted toward the tint colour

Combination space: 5 x 6 x 6 x 3 = 540. 270 unique combos are picked with a
fixed seed 0x544859524b ("THYRK" in ASCII hex) so the run is deterministic
and reproducible.

Hue rotation is done in HSV space (PIL), which preserves saturation and
value — colours change hue only, so nothing gets over-saturated. The
result is blended 90% rotated / 10% original to keep a hint of the base
palette and avoid a fully alien look on extreme rotations.

Aura is a soft ring (peak ~45% of half-size, sigma ~22%) screen-blended at
max 0.35 strength, so the knight itself is never washed out.

Background tint only touches dark pixels (luminance < 70) and blends them
45% toward the tint colour, so the knight's bright armour is untouched.

Outputs:
  ~/workspace/projects/thyrk/collection/images/legendary-008..277.webp
  ~/workspace/projects/thyrk/collection/legendary-traits.json

Usage:
  python3 generate_legendary.py [--test N] [--out-dir DIR]
  --test N  : generate only N samples into /tmp/thyrk-test/ for visual QA
"""

import argparse
import hashlib
import json
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SEED = 0x544859524b  # "THYRK" in ASCII hex
COLLECTION = Path(__file__).resolve().parent.parent
IMAGES = COLLECTION / "images"
MANIFEST = COLLECTION / "legendary-traits.json"

BASES = {
    "legendary-001": "knight-0",
    "legendary-004": "red-fire",
    "legendary-005": "blue-lightning",
    "legendary-006": "purple-shadow",
    "legendary-007": "gold-holy",
}

HUES = [0, 60, 120, 180, 240, 300]

AURAS = {
    "red": (255, 60, 50),
    "blue": (70, 140, 255),
    "purple": (170, 90, 255),
    "gold": (255, 200, 80),
    "green": (80, 255, 120),
    "cyan": (70, 230, 255),
}

BG_TINTS = {
    "dark-blue": (16, 24, 64),
    "dark-purple": (40, 16, 64),
    "dark-green": (12, 48, 32),
}

# Approved originals 001-007 (from EXISTING-FILES.md)
APPROVED_ORIGINALS = {
    1: "legendary-knight-0",
    2: "legendary-alt-attributes-0",
    3: "legendary-no-bg-random-0",
    4: "legendary-red-fire-0",
    5: "legendary-blue-lightning-0",
    6: "legendary-purple-shadow-0",
    7: "legendary-gold-holy-0",
}


def hue_rotate(img: Image.Image, degrees: int) -> Image.Image:
    """Rotate hue in HSV space; blend 90% rotated / 10% original."""
    if degrees % 360 == 0:
        return img.copy()
    hsv = np.asarray(img.convert("HSV"), dtype=np.int16)
    shift = int(round(degrees / 360.0 * 255))
    hsv[..., 0] = (hsv[..., 0] + shift) % 256
    rotated = Image.fromarray(hsv.astype(np.uint8), mode="HSV").convert("RGB")
    return Image.blend(img, rotated, 0.90)


def aura_glow(img: Image.Image, color: tuple) -> Image.Image:
    """Soft radial ring glow around the knight, screen blend, max 0.35."""
    w, h = img.size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2.0, h / 2.0
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (w / 2.0)  # 0 centre .. ~1.41 corner
    # Ring peaking at r=0.45, sigma 0.22, fading to ~0 at centre and edges.
    alpha = 0.35 * np.exp(-((r - 0.45) ** 2) / (2 * 0.22 ** 2))
    alpha = np.clip(alpha, 0.0, 0.35)[..., None].astype(np.float32)
    base = np.asarray(img, dtype=np.float32) / 255.0
    glow = np.asarray(color, dtype=np.float32) / 255.0
    # screen blend: 1 - (1-base)(1-glow), applied by alpha
    screened = 1.0 - (1.0 - base) * (1.0 - glow)
    out = base * (1.0 - alpha) + screened * alpha
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), mode="RGB")


def bg_tint(img: Image.Image, tint: tuple) -> Image.Image:
    """Shift dark pixels (luminance < 70) 45% toward the tint colour."""
    arr = np.asarray(img, dtype=np.float32)
    lum = 0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]
    mask = (lum < 70)[..., None].astype(np.float32)
    tint_arr = np.asarray(tint, dtype=np.float32)
    out = arr * (1.0 - 0.45 * mask) + tint_arr * (0.45 * mask)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), mode="RGB")


def build_traits(img: Image.Image, hue: int, aura: str, bg: str) -> Image.Image:
    img = hue_rotate(img, hue)
    img = aura_glow(img, AURAS[aura])
    img = bg_tint(img, BG_TINTS[bg])
    return img


def pick_combos(n: int = 270):
    """All 540 combos, shuffled with the fixed seed; take the first n."""
    combos = [
        (base, hue, aura, bg)
        for base in BASES
        for hue in HUES
        for aura in AURAS
        for bg in BG_TINTS
    ]
    rng = random.Random(SEED)
    rng.shuffle(combos)
    return combos[:n]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", type=int, default=0,
                    help="generate only N samples into /tmp/thyrk-test/")
    ap.add_argument("--out-dir", default=None)
    args = ap.parse_args()

    combos = pick_combos(270)
    bases = {name: Image.open(IMAGES / f"{name}.webp").convert("RGB")
             for name in BASES}

    if args.test:
        out_dir = Path("/tmp/thyrk-test")
        out_dir.mkdir(parents=True, exist_ok=True)
        # A spread of combos for visual QA: different bases/hues/auras/bgs.
        sample_idx = [0, 1, 50, 100, 150, 200, 269][: args.test]
        for i in sample_idx:
            base, hue, aura, bg = combos[i]
            img = build_traits(bases[base], hue, aura, bg)
            img.save(out_dir / f"sample-{i:03d}_{base}_h{hue}_{aura}_{bg}.webp",
                     format="WEBP", quality=90)
            print(f"sample {i}: base={base} hue={hue} aura={aura} bg={bg}")
        print(f"wrote {len(sample_idx)} samples to {out_dir}")
        return 0

    out_dir = Path(args.out_dir) if args.out_dir else IMAGES
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = {}
    for idx in range(1, 8):
        manifest[str(idx)] = {
            "source_file": APPROVED_ORIGINALS[idx],
            "note": "approved original",
        }

    seen_hashes = set()
    for f in IMAGES.glob("legendary-*.webp"):
        seen_hashes.add(hashlib.sha256(f.read_bytes()).hexdigest())

    for i, (base, hue, aura, bg) in enumerate(combos):
        num = 8 + i
        img = build_traits(bases[base], hue, aura, bg)
        path = out_dir / f"legendary-{num:03d}.webp"
        img.save(path, format="WEBP", quality=90)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in seen_hashes:
            print(f"WARNING: duplicate bytes for legendary-{num:03d}", file=sys.stderr)
        seen_hashes.add(digest)
        manifest[str(num)] = {
            "source_file": f"{base}.webp",
            "base": BASES[base],
            "hue_degrees": hue,
            "aura": aura,
            "bg_tint": bg,
        }
        if (i + 1) % 50 == 0:
            print(f"  ... {i + 1}/270 done")

    with open(MANIFEST, "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"done: 270 files written to {out_dir}")
    print(f"manifest: {MANIFEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
