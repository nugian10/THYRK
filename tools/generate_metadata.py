#!/usr/bin/env python3
"""THYRK Batch 4 — metadata + manifest deck + deckHash generator.

Builds the deterministic mint deck for token IDs 1-7,777, computes deckHash,
and writes all metadata JSON files (7,777 mintable + 77 Divine).

Deck method (documented here and in manifest.json):
  * Deck entries are built in fixed order: all Common (5 designs x 800
    editions), then Rare (5 x 500), then Epic (5 x 200), then Legendary
    (design index 1-277, one each). Total 4,000 + 2,500 + 1,000 + 277 = 7,777.
  * The list is shuffled with Python random.Random(SEED).shuffle(), where
    SEED = 0x544859524b ("THYRK" in ASCII hex). random.shuffle() is a
    Fisher-Yates shuffle driven by the Mersenne Twister PRNG, so the deck
    is fully deterministic and reproducible from the seed alone.
  * Edition numbers ("N of 800" etc.) are assigned per design in deck order:
    the first time a design appears in the shuffled deck it is edition 1,
    the second time edition 2, and so on.

deckHash encoding (documented here and in manifest.json):
  * For each token in deck order (token ID 1 first), encode 3 bytes:
      byte 0 : rarity code  (0=Common, 1=Rare, 2=Epic, 3=Legendary)
      bytes 1-2 : design index, big-endian uint16
        (Common/Rare/Epic: 1-5; Legendary: 1-277)
  * Concatenate all 7,777 x 3 = 23,331 bytes and take keccak256.
  * keccak256 comes from eth-hash (pip install "eth-hash[pycryptodome]"),
    falling back to Crypto.Hash.keccak if eth-hash is unavailable.

Design mapping (Batch 1 — DO NOT guess, these are the approved names):
  Common: 1=Crimson, 2=Shadow, 3=Golden, 4=Forest, 5=Blood
  Rare:   1=Crimson, 2=Shadow, 3=Golden, 4=Forest, 5=Blood
  Epic:   1=Shadow,  2=Crimson, 3=Golden, 4=Forest, 5=Blood

Legendary traits come from legendary-traits.json (fields: base, aura,
hue_degrees, bg_tint). Legendary 1-7 are the approved originals and have
no trait fields in that file; their traits are assigned here from their
source-file names (see LEGENDARY_ORIGINALS below).

Divine traits come from divine-batch-D1.json .. D4.json (divine 016-077).
Divine 001-015 traits are derived from their approved source-file names
in EXISTING-FILES.md (see DIVINE_FIRST_15 below) — pose/weapon/helmet/
wings/theme as described by those names.

Outputs:
  collection/metadata/1.json .. 7777.json
  collection/metadata/divine-1.json .. divine-77.json
  collection/manifest.json

Usage:
  python3 generate_metadata.py [--verify-only]
  --verify-only : rebuild the deck + deckHash in memory and compare with
                  manifest.json, without writing any metadata files.
"""

import json
import random
import sys
from pathlib import Path

SEED = 0x544859524b  # "THYRK" in ASCII hex
COLLECTION = Path(__file__).resolve().parent.parent
IMAGES = COLLECTION / "images"
METADATA = COLLECTION / "metadata"
MANIFEST = COLLECTION / "manifest.json"

CHAIN_ID = 56
IMAGE_BASE = "https://raw.githubusercontent.com/nugian10/THYRK/main/collection/images/"
METADATA_BASE = "https://raw.githubusercontent.com/nugian10/THYRK/main/collection/metadata/"

RARITY_CODE = {"Common": 0, "Rare": 1, "Epic": 2, "Legendary": 3}
DESIGNS = {
    "Common": {1: "Crimson", 2: "Shadow", 3: "Golden", 4: "Forest", 5: "Blood"},
    "Rare":   {1: "Crimson", 2: "Shadow", 3: "Golden", 4: "Forest", 5: "Blood"},
    "Epic":   {1: "Shadow",  2: "Crimson", 3: "Golden", 4: "Forest", 5: "Blood"},
}
EDITIONS = {"Common": 800, "Rare": 500, "Epic": 200}

DESCRIPTION = "THYRK — 7,777 knight NFTs on BNB Chain. 16-bit pixel art."
DIVINE_DESCRIPTION = (
    "THYRK — 7,777 knight NFTs on BNB Chain. 16-bit pixel art. "
    "Divine — 1 of 77, redeemable only with 1,500 $THYRK."
)

# Legendary 1-7: approved originals, no trait fields in legendary-traits.json.
# Traits assigned from their source-file names (EXISTING-FILES.md).
LEGENDARY_ORIGINALS = {
    1: {"base": "knight-0",       "aura": "gold",   "hue_degrees": 0,   "bg_tint": "dark-green"},
    2: {"base": "knight-0",       "aura": "purple", "hue_degrees": 300, "bg_tint": "dark-purple"},
    3: {"base": "knight-0",       "aura": "blue",   "hue_degrees": 240, "bg_tint": "dark-blue"},
    4: {"base": "red-fire",       "aura": "red",    "hue_degrees": 0,   "bg_tint": "dark-purple"},
    5: {"base": "blue-lightning",  "aura": "blue",   "hue_degrees": 240, "bg_tint": "dark-blue"},
    6: {"base": "purple-shadow",   "aura": "purple", "hue_degrees": 300, "bg_tint": "dark-purple"},
    7: {"base": "gold-holy",       "aura": "gold",   "hue_degrees": 60,  "bg_tint": "dark-green"},
}

# Divine 001-015: traits derived from approved source-file names
# (EXISTING-FILES.md). Divine 016-077 come from divine-batch-D*.json.
DIVINE_FIRST_15 = {
    1:  {"pose": "standing heroic, sword raised", "weapon": "glowing blue-gold sword",
         "helmet": "golden crown helmet", "wings": "large white angel wings",
         "theme": "gold-blue divine knight, halo rings + crown"},
    2:  {"pose": "standing heroic, sword raised in blessing", "weapon": "holy glowing sword",
         "helmet": "golden halo crown helmet", "wings": "large white angel wings",
         "theme": "white and silver holy armor, halo"},
    3:  {"pose": "standing heroic, sword raised", "weapon": "celestial gold sword",
         "helmet": "golden crown helmet", "wings": "large golden angel wings",
         "theme": "gold celestial armor, halo rings"},
    4:  {"pose": "standing heroic, sword raised", "weapon": "glowing blue sword",
         "helmet": "golden crown helmet", "wings": "large white angel wings",
         "theme": "blue and gold angel armor, halo"},
    5:  {"pose": "standing heroic, sword raised", "weapon": "emerald glowing sword",
         "helmet": "golden crown helmet", "wings": "large white angel wings",
         "theme": "emerald green seraph armor, halo"},
    6:  {"pose": "standing heroic, sword raised", "weapon": "flaming phoenix sword",
         "helmet": "golden crown helmet", "wings": "large red-gold phoenix wings",
         "theme": "red and gold phoenix armor, halo"},
    7:  {"pose": "standing heroic, sword raised", "weapon": "nature sword",
         "helmet": "golden crown helmet", "wings": "large green-tipped angel wings",
         "theme": "green nature armor, emerald gems, halo"},
    8:  {"pose": "standing heroic, sword raised", "weapon": "royal purple sword",
         "helmet": "golden crown helmet", "wings": "large white angel wings",
         "theme": "purple royal armor, amethyst gems, halo"},
    9:  {"pose": "standing heroic, sword raised", "weapon": "silver holy sword",
         "helmet": "golden crown helmet", "wings": "large white angel wings",
         "theme": "white and silver armor, halo"},
    10: {"pose": "spear held upright, heroic stance", "weapon": "long golden spear",
         "helmet": "golden crown helmet", "wings": "large white angel wings",
         "theme": "gold-blue spear hero, halo"},
    11: {"pose": "dynamic dual-wield stance, both swords raised, correct grip",
         "weapon": "dual glowing swords", "helmet": "golden crown helmet",
         "wings": "large white angel wings", "theme": "gold-blue dual-blade hero, halo"},
    12: {"pose": "standing guard, war hammer held low", "weapon": "massive golden war hammer",
         "helmet": "golden crown helmet", "wings": "large white angel wings",
         "theme": "gold-blue hammer guardian, halo"},
    13: {"pose": "longbow drawn, aiming forward", "weapon": "golden longbow, glowing arrow",
         "helmet": "golden crown helmet", "wings": "large white angel wings",
         "theme": "gold-blue divine archer, halo"},
    14: {"pose": "standing heroic, single sword raised, other hand empty",
         "weapon": "single red sword", "helmet": "golden crown helmet",
         "wings": "large white angel wings", "theme": "red and gold divine knight, halo"},
    15: {"pose": "standing heroic, single sword held at side", "weapon": "single red sword",
         "helmet": "golden crown helmet", "wings": "large white angel wings",
         "theme": "red and gold divine knight, halo"},
}


def keccak256(data: bytes) -> bytes:
    """keccak256 via eth-hash, falling back to pycryptodome."""
    try:
        from eth_hash.auto import keccak
        return keccak(data)
    except ImportError:
        from Crypto.Hash import keccak as _keccak
        return _keccak.new(digest_bits=256, data=data).digest()


def build_deck():
    """Deterministic deck: list of (rarity, design_index), token ID = position+1."""
    deck = []
    for rarity in ("Common", "Rare", "Epic"):
        for design in range(1, 6):
            deck.extend([(rarity, design)] * EDITIONS[rarity])
    deck.extend([("Legendary", i) for i in range(1, 278)])
    assert len(deck) == 7777, f"deck size {len(deck)} != 7777"
    random.Random(SEED).shuffle(deck)  # Fisher-Yates, seeded Mersenne Twister
    return deck


def deck_hash(deck):
    """keccak256 of 3 bytes per token: rarity code + design index (uint16 BE)."""
    encoded = bytearray()
    for rarity, design in deck:
        encoded.append(RARITY_CODE[rarity])
        encoded += design.to_bytes(2, "big")
    assert len(encoded) == 7777 * 3
    return "0x" + keccak256(bytes(encoded)).hex()


def load_legendary_traits():
    traits = json.loads((COLLECTION / "legendary-traits.json").read_text())
    out = {}
    for idx in range(1, 278):
        entry = traits[str(idx)]
        if all(k in entry for k in ("base", "aura", "hue_degrees", "bg_tint")):
            out[idx] = {k: entry[k] for k in ("base", "aura", "hue_degrees", "bg_tint")}
        else:
            out[idx] = LEGENDARY_ORIGINALS[idx]  # approved originals 1-7
    return out


def load_divine_traits():
    out = dict(DIVINE_FIRST_15)
    for batch in ("D1", "D2", "D3", "D4"):
        data = json.loads((COLLECTION / f"divine-batch-{batch}.json").read_text())
        files = data.get("images") or data.get("files")
        for fname, t in files.items():
            n = int(fname.replace("divine-", "").replace(".webp", ""))
            out[n] = {k: t[k] for k in ("pose", "weapon", "helmet", "wings", "theme")}
    assert len(out) == 77, f"divine traits {len(out)} != 77"
    assert sorted(out) == list(range(1, 78)), "divine trait indices not 1-77"
    return out


def image_file(rarity, design):
    if rarity == "Legendary":
        return f"legendary-{design:03d}.webp"
    return f"{rarity.lower()}-{design}.webp"


def build_metadata(deck, leg_traits, div_traits):
    """Return dict: filename -> metadata dict. Token ID = deck position + 1."""
    files = {}
    edition_counter = {}
    for token_id, (rarity, design) in enumerate(deck, start=1):
        if rarity in EDITIONS:
            key = (rarity, design)
            edition_counter[key] = edition_counter.get(key, 0) + 1
            edition = edition_counter[key]
            attrs = [
                {"trait_type": "Rarity", "value": rarity},
                {"trait_type": "Design", "value": DESIGNS[rarity][design]},
                {"trait_type": "Edition", "value": f"{edition} of {EDITIONS[rarity]}"},
            ]
        else:  # Legendary
            t = leg_traits[design]
            attrs = [
                {"trait_type": "Rarity", "value": "Legendary"},
                {"trait_type": "Base", "value": t["base"]},
                {"trait_type": "Aura", "value": t["aura"]},
                {"trait_type": "Hue", "value": t["hue_degrees"]},
                {"trait_type": "Background Tint", "value": t["bg_tint"]},
            ]
        fname = image_file(rarity, design)
        files[f"{token_id}.json"] = {
            "name": f"THYRK #{token_id}",
            "description": DESCRIPTION,
            "image": IMAGE_BASE + fname,
            "attributes": attrs,
        }
    for n in range(1, 78):
        t = div_traits[n]
        files[f"divine-{n}.json"] = {
            "name": f"THYRK Divine #{n}",
            "description": DIVINE_DESCRIPTION,
            "image": IMAGE_BASE + f"divine-{n:03d}.webp",
            "attributes": [
                {"trait_type": "Rarity", "value": "Divine"},
                {"trait_type": "Pose", "value": t["pose"]},
                {"trait_type": "Weapon", "value": t["weapon"]},
                {"trait_type": "Helmet", "value": t["helmet"]},
                {"trait_type": "Wings", "value": t["wings"]},
                {"trait_type": "Theme", "value": t["theme"]},
            ],
        }
    return files


def main():
    verify_only = "--verify-only" in sys.argv
    deck = build_deck()
    dh = deck_hash(deck)
    counts = {r: sum(1 for x in deck if x[0] == r) for r in RARITY_CODE}
    assert counts == {"Common": 4000, "Rare": 2500, "Epic": 1000, "Legendary": 277}, counts

    if verify_only:
        manifest = json.loads(MANIFEST.read_text())
        ok = manifest["deckHash"] == dh and manifest["seed"] == f"0x{SEED:X}"
        print(f"recomputed deckHash: {dh}")
        print(f"manifest deckHash:   {manifest['deckHash']}")
        print("VERIFY:", "MATCH" if ok else "MISMATCH")
        return 0 if ok else 1

    leg_traits = load_legendary_traits()
    div_traits = load_divine_traits()
    files = build_metadata(deck, leg_traits, div_traits)

    # every referenced image must exist
    missing = set()
    for meta in files.values():
        img = IMAGES / meta["image"].rsplit("/", 1)[-1]
        if not img.is_file():
            missing.add(img.name)
    assert not missing, f"missing images: {sorted(missing)}"

    METADATA.mkdir(parents=True, exist_ok=True)
    for name, meta in files.items():
        (METADATA / name).write_text(json.dumps(meta, indent=2) + "\n")

    manifest = {
        "project": "THYRK",
        "chain": CHAIN_ID,
        "chainName": "BNB Chain",
        "seed": f"0x{SEED:X}",
        "seedNote": "0x544859524b = ASCII 'THYRK'",
        "deckHash": dh,
        "totalMintable": 7777,
        "totalDivine": 77,
        "totalFiles": 7777 + 77,
        "counts": {
            "Common": {"total": 4000, "designs": 5, "editionsPerDesign": 800},
            "Rare": {"total": 2500, "designs": 5, "editionsPerDesign": 500},
            "Epic": {"total": 1000, "designs": 5, "editionsPerDesign": 200},
            "Legendary": {"total": 277, "designs": 277, "editionsPerDesign": 1},
            "Divine": {"total": 77, "designs": 77, "editionsPerDesign": 1},
        },
        "baseURI": METADATA_BASE,
        "imageBaseURI": IMAGE_BASE,
        "deckMethod": (
            "Deck built in fixed order (Common 5 designs x 800, Rare 5 x 500, "
            "Epic 5 x 200, Legendary design 1-277), then shuffled with "
            "Python random.Random(0x544859524b).shuffle() — a Fisher-Yates "
            "shuffle driven by the Mersenne Twister PRNG. Token ID = deck "
            "position + 1. Edition numbers are assigned per design in deck "
            "order (first occurrence = edition 1). Re-running "
            "generate_metadata.py reproduces the exact same deck."
        ),
        "deckHashEncoding": (
            "Per token in deck order (token ID 1 first), 3 bytes: byte 0 = "
            "rarity code (0=Common, 1=Rare, 2=Epic, 3=Legendary); bytes 1-2 = "
            "design index as big-endian uint16 (Common/Rare/Epic: 1-5; "
            "Legendary: 1-277). Concatenate all 7,777 x 3 = 23,331 bytes and "
            "take keccak256. keccak256 from eth-hash (pip install "
            '"eth-hash[pycryptodome]"), fallback Crypto.Hash.keccak.'
        ),
        "files": {
            "metadata": "metadata/1.json .. 7777.json (mintable) + "
                        "metadata/divine-1.json .. divine-77.json (Divine, "
                        "token-only redeem, not in the mint deck)",
            "images": "images/common-N.webp / rare-N.webp / epic-N.webp "
                      "(N=1-5), legendary-NNN.webp (001-277), "
                      "divine-NNN.webp (001-077)",
            "sources": "legendary-traits.json (Legendary traits), "
                       "divine-batch-D1.json .. D4.json (Divine 016-077 traits), "
                       "EXISTING-FILES.md (Divine 001-015 source names)",
        },
        "notes": [
            "Divine is NOT part of the mint deck and NOT part of deckHash; "
            "Divine is redeemable only with 1,500 $THYRK (1 of 77).",
            "Legendary 1-7 are the approved originals; their traits in "
            "metadata are assigned from their source-file names in "
            "generate_metadata.py (LEGENDARY_ORIGINALS).",
            "Divine 001-015 traits are derived from their approved "
            "source-file names in EXISTING-FILES.md "
            "(generate_metadata.py DIVINE_FIRST_15).",
            "All images are 1600x1600 WebP pixel art.",
        ],
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"deckHash: {dh}")
    print(f"counts: {counts}")
    print(f"metadata files written: {len(files)} "
          f"({sum(1 for k in files if k.startswith('divine'))} divine + "
          f"{len(files) - 77} mintable)")
    print(f"manifest: {MANIFEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
