#!/usr/bin/env node
/**
 * THYRK — off-chain replay of the on-chain deck draw.
 *
 * Mirrors contracts/ThyrkNFT.sol EXACTLY (same formulas, same
 * order of operations) and simulates full-deck scenarios in
 * plain JS, so the deck logic can be verified without minting
 * 7,777 tokens on-chain:
 *   - every token ID is drawn exactly once (no duplicates)
 *   - all 777 free mints draw a Common, and the free reserve
 *     invariant (commonsRemaining >= freeMintsRemaining) holds
 *   - rarity totals end at Common 4000 / Rare 2500 / Epic 1000
 *     / Legendary 277
 *   - upgrade draws always return the requested tier
 *
 * Usage:
 *   node scripts/verify-deck.js
 *
 * The same replay logic is what anyone can use to verify a past
 * draw off-chain from the published deckHash + bitmap.
 */
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

const COLLECTION = path.join(__dirname, "..", "..", "collection");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(COLLECTION, "manifest.json"), "utf8"));
const BITMAP = JSON.parse(fs.readFileSync(path.join(COLLECTION, "rarity-bitmap.json"), "utf8"));

const DECK_HASH = MANIFEST.deckHash;
const MAX_SUPPLY = 7777;
const FREE_TOTAL = 777;

const RARITY = { COMMON: 0, RARE: 1, EPIC: 2, LEGENDARY: 3 };
const RARITY_NAME = ["Common", "Rare", "Epic", "Legendary"];

// ---- bitmap (same layout as the contract) ----
const WORDS = BITMAP.bitmap.map((w) => BigInt(w));
function rarityOf(tokenId) {
  const word = WORDS[Math.floor((tokenId - 1) / 128)];
  const off = BigInt(((tokenId - 1) % 128) * 2);
  return Number((word >> off) & 3n);
}

// ---- deck simulator: mirrors ThyrkNFT.sol ----
class Deck {
  constructor() {
    this.remaining = MAX_SUPPLY;
    this.drawIndex = 0;
    this.swapped = new Map();
    this.counts = { 0: 4000, 1: 2500, 2: 1000, 3: 277 };
    this.freeMinted = 0;
    this.drawn = new Set();
  }
  freeMintsRemaining() {
    return FREE_TOTAL - this.freeMinted;
  }
  valueAt(i) {
    return this.swapped.has(i) ? this.swapped.get(i) : i + 1;
  }
  takeAt(pos) {
    const tokenId = this.valueAt(pos);
    const last = this.valueAt(this.remaining - 1);
    if (pos !== this.remaining - 1) this.swapped.set(pos, last);
    this.remaining--;
    this.counts[rarityOf(tokenId)]--;
    if (this.drawn.has(tokenId)) throw new Error(`DUPLICATE token ${tokenId}`);
    this.drawn.add(tokenId);
    return tokenId;
  }
  findFrom(start, want, anyNonCommon) {
    const remaining = this.remaining;
    for (let k = 0; k < remaining; k++) {
      const p = (start + k) % remaining;
      const r = rarityOf(this.valueAt(p));
      if (anyNonCommon ? r !== RARITY.COMMON : r === want) return p;
    }
    return -1;
  }
  drawMain() {
    if (this.remaining === 0) throw new Error("SoldOut");
    const j = Number(
      BigInt(
        ethers.solidityPackedKeccak256(["bytes32", "uint256"], [DECK_HASH, this.drawIndex])
      ) % BigInt(this.remaining)
    );
    this.drawIndex++;
    const tokenId = this.valueAt(j);
    if (
      rarityOf(tokenId) === RARITY.COMMON &&
      this.freeMintsRemaining() > 0 &&
      this.counts[RARITY.COMMON] === this.freeMintsRemaining()
    ) {
      const pos = this.findFrom(j, 0, true);
      if (pos < 0) throw new Error("NoDrawableToken (main, scarce)");
      return this.takeAt(pos);
    }
    return this.takeAt(j);
  }
  drawFree() {
    if (this.freeMinted >= FREE_TOTAL) throw new Error("FreeExhausted");
    const start = Number(
      BigInt(
        ethers.solidityPackedKeccak256(
          ["bytes32", "uint256", "bytes"],
          [DECK_HASH, this.drawIndex, ethers.toUtf8Bytes("FREE")]
        )
      ) % BigInt(this.remaining)
    );
    this.drawIndex++;
    const pos = this.findFrom(start, RARITY.COMMON, false);
    if (pos < 0) throw new Error("NoDrawableToken (free)");
    this.freeMinted++;
    const tokenId = this.takeAt(pos);
    if (rarityOf(tokenId) !== RARITY.COMMON) throw new Error(`free drew ${RARITY_NAME[rarityOf(tokenId)]}!`);
    return tokenId;
  }
  drawTier(want) {
    if (this.counts[want] === 0) throw new Error(`NoDrawableToken (tier ${want})`);
    const start = Number(
      BigInt(
        ethers.solidityPackedKeccak256(
          ["bytes32", "uint256", "bytes", "uint8"],
          [DECK_HASH, this.drawIndex, ethers.toUtf8Bytes("TIER"), want]
        )
      ) % BigInt(this.remaining)
    );
    this.drawIndex++;
    const pos = this.findFrom(start, want, false);
    if (pos < 0) throw new Error("NoDrawableToken (tier)");
    const tokenId = this.takeAt(pos);
    if (rarityOf(tokenId) !== want) throw new Error("tier draw mismatch");
    return tokenId;
  }
  checkInvariant(where) {
    if (this.counts[RARITY.COMMON] < this.freeMintsRemaining()) {
      throw new Error(`INVARIANT BROKEN at ${where}: commons ${this.counts[0]} < free remaining ${this.freeMintsRemaining()}`);
    }
  }
}

function summarize(deck, label) {
  const byRarity = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const t of deck.drawn) byRarity[rarityOf(t)]++;
  console.log(
    `  ${label}: drawn=${deck.drawn.size} remaining=${deck.remaining} ` +
      `free=${deck.freeMinted} counts=${JSON.stringify(deck.counts)} ` +
      `drawnByRarity=${JSON.stringify(byRarity)}`
  );
  return byRarity;
}

async function main() {
  console.log(`deckHash: ${DECK_HASH}`);
  console.log(`bitmap words: ${WORDS.length}`);

  // Scenario A: all 777 free mints FIRST, then 7,000 paid draws.
  console.log("Scenario A: 777 free first, then 7000 paid");
  {
    const d = new Deck();
    for (let i = 0; i < 777; i++) {
      d.drawFree();
      d.checkInvariant(`A free ${i}`);
    }
    for (let i = 0; i < 7000; i++) {
      d.drawMain();
      d.checkInvariant(`A paid ${i}`);
    }
    const byRarity = summarize(d, "A final");
    if (d.remaining !== 0) throw new Error("A: pool not empty");
    if (JSON.stringify(byRarity) !== JSON.stringify({ 0: 4000, 1: 2500, 2: 1000, 3: 277 })) {
      throw new Error("A: rarity totals wrong");
    }
    console.log("  A OK: all 7777 unique, rarity totals exact, all free were Common");
  }

  // Scenario B: interleaved — paid mints race ahead of free mints.
  // 3,500 paid draws first (more than the 3,223 paid Commons), then
  // all 777 free, then the rest. This stresses the free reserve.
  console.log("Scenario B: 3500 paid, then 777 free, then rest");
  {
    const d = new Deck();
    for (let i = 0; i < 3500; i++) {
      d.drawMain();
      d.checkInvariant(`B paid-early ${i}`);
    }
    console.log(`  after 3500 paid: commonsRemaining=${d.counts[0]} freeRemaining=${d.freeMintsRemaining()}`);
    for (let i = 0; i < 777; i++) {
      d.drawFree();
      d.checkInvariant(`B free ${i}`);
    }
    for (let i = 0; i < 3500; i++) {
      d.drawMain();
      d.checkInvariant(`B paid-late ${i}`);
    }
    const byRarity = summarize(d, "B final");
    if (d.remaining !== 0) throw new Error("B: pool not empty");
    if (JSON.stringify(byRarity) !== JSON.stringify({ 0: 4000, 1: 2500, 2: 1000, 3: 277 })) {
      throw new Error("B: rarity totals wrong");
    }
    console.log("  B OK: free reserve survived 3500 paid draws first");
  }

  // Scenario C: upgrades mixed in — 50 upgrades to each tier.
  console.log("Scenario C: mixed draws + 50 upgrades per tier");
  {
    const d = new Deck();
    let up = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 2000; i++) d.drawMain();
    for (let i = 0; i < 300; i++) d.drawFree();
    for (const tier of [1, 2, 3]) {
      for (let i = 0; i < 50; i++) {
        d.drawTier(tier);
        up[tier]++;
      }
    }
    for (let i = 0; i < 477; i++) d.drawFree();
    while (d.remaining > 0) d.drawMain();
    const byRarity = summarize(d, "C final");
    if (d.remaining !== 0) throw new Error("C: pool not empty");
    if (JSON.stringify(byRarity) !== JSON.stringify({ 0: 4000, 1: 2500, 2: 1000, 3: 277 })) {
      throw new Error("C: rarity totals wrong");
    }
    console.log(`  C OK: upgrades drew ${JSON.stringify(up)} on-tier tokens, pool still exact`);
  }

  // Scenario D: worst case for the scarce-regime scan — paid draws
  // until commonsRemaining == freeMintsRemaining, then measure the
  // scan length of the next paid draws (gas proxy: positions scanned).
  console.log("Scenario D: scarce-regime scan lengths");
  {
    const d = new Deck();
    // Draw paid until the scarce regime starts (commons == free remaining).
    let n = 0;
    while (!(d.counts[0] === d.freeMintsRemaining() && d.freeMintsRemaining() > 0)) {
      d.drawMain();
      n++;
      if (n > 7777) throw new Error("D: regime never started");
    }
    console.log(`  scarce regime starts after ${n} paid draws: remaining=${d.remaining} commons=${d.counts[0]}`);
    // Measure scan length for the next 20 paid draws by re-running
    // findFrom with a counter.
    let worst = 0;
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const j = Number(
        BigInt(
          ethers.solidityPackedKeccak256(["bytes32", "uint256"], [DECK_HASH, d.drawIndex])
        ) % BigInt(d.remaining)
      );
      // replicate _drawMain scarce path scan length
      let scanned = 0;
      if (rarityOf(d.valueAt(j)) === 0) {
        for (let k = 0; k < d.remaining; k++) {
          scanned++;
          if (rarityOf(d.valueAt((j + k) % d.remaining)) !== 0) break;
        }
      }
      worst = Math.max(worst, scanned);
      total += scanned;
      d.drawMain();
    }
    console.log(`  next 20 paid draws: avg scan ${total / 20}, worst ${worst} positions`);
  }

  console.log("ALL DECK REPLAY SCENARIOS PASSED");
}

main().catch((e) => {
  console.error("REPLAY FAILED:", e);
  process.exit(1);
});
