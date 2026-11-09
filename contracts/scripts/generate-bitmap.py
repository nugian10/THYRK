#!/usr/bin/env python3
"""THYRK — rarity bitmap generator + deckHash verifier.

Builds the on-chain rarity bitmap from the deterministic deck
(collection/tools/generate_metadata.py) and verifies the deckHash.

Bitmap layout (2 bits per token, token IDs 1..7777):
  word w (0..60) holds token IDs w*128+1 .. w*128+128
  token t -> word (t-1)//128, bit offset ((t-1)%128)*2
  rarity codes: 0=Common, 1=Rare, 2=Epic, 3=Legendary
  7777 tokens -> 15554 bits -> 61 uint256 words.

Why a bitmap: the mint deck is shuffled, so rarity is NOT a function
of the token ID range. The contract needs rarityOf(tokenId) on-chain
for: free-mint Common-only enforcement, burn rewards per rarity,
upgrade tier validation, and the free-reserve invariant
(commonsRemaining >= freeMintsRemaining). The bitmap is derived
entirely from the published manifest deck, so anyone can rebuild it
from the seed alone and check it matches the constructor argument.
The deckHash (keccak256 of the 3-byte/token deck encoding) remains
the deck commitment; the bitmap is a compact index of the same deck.

Outputs:
  collection/rarity-bitmap.json  { words: [61 hex uint256], ... }

Usage:
  python3 generate-bitmap.py [--verify-only]
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
COLLECTION = Path.home() / "workspace" / "projects" / "thyrk" / "collection"
sys.path.insert(0, str(COLLECTION / "tools"))

from generate_metadata import build_deck, deck_hash, RARITY_CODE  # noqa: E402

MAX_SUPPLY = 7777
WORDS = 61
EXPECTED_DECK_HASH = "0x592a9180d7c57fa9c609176c204e8c4950ee20d7d13c5705c0227516e97e8233"


def build_bitmap(deck):
    words = [0] * WORDS
    for token_id, (rarity, _design) in enumerate(deck, start=1):
        code = RARITY_CODE[rarity]
        idx = (token_id - 1) // 128
        off = ((token_id - 1) % 128) * 2
        words[idx] |= code << off
    return words


def bitmap_rarity(words, token_id):
    idx = (token_id - 1) // 128
    off = ((token_id - 1) % 128) * 2
    return (words[idx] >> off) & 0x3


def main():
    verify_only = "--verify-only" in sys.argv
    deck = build_deck()
    assert len(deck) == MAX_SUPPLY, len(deck)
    dh = deck_hash(deck)
    print(f"recomputed deckHash: {dh}")
    print(f"manifest deckHash:   {EXPECTED_DECK_HASH}")
    assert dh == EXPECTED_DECK_HASH, "deckHash MISMATCH — deck changed!"
    counts = {r: sum(1 for x in deck if x[0] == r) for r in RARITY_CODE}
    print(f"counts: {counts}")
    assert counts == {"Common": 4000, "Rare": 2500, "Epic": 1000, "Legendary": 277}, counts

    words = build_bitmap(deck)
    # Round-trip check against the metadata files on disk.
    meta = COLLECTION / "metadata"
    checked = 0
    for token_id in range(1, MAX_SUPPLY + 1):
        m = json.load(open(meta / f"{token_id}.json"))
        rarity = next(
            a["value"] for a in m["attributes"] if a["trait_type"] == "Rarity"
        )
        assert bitmap_rarity(words, token_id) == RARITY_CODE[rarity], token_id
        checked += 1
    print(f"bitmap verified against {checked} metadata files on disk")

    out = {
        "project": "THYRK",
        "deckHash": dh,
        "seed": "0x544859524b",
        "words": len(words),
        "encoding": "2 bits per token, tokenId 1..7777, word (t-1)//128, offset ((t-1)%128)*2, codes 0=Common 1=Rare 2=Epic 3=Legendary",
        "bitmap": ["0x" + format(w, "064x") for w in words],
    }
    if verify_only:
        print("verify-only: bitmap OK, not writing")
        return
    target = COLLECTION / "rarity-bitmap.json"
    target.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {target} ({len(words)} words)")


if __name__ == "__main__":
    main()
