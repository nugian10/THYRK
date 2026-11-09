// THYRK replacement NFT — DEPLOYMENT PLAN (print-only).
//
// This script ONLY prints the deployment plan. It does NOT deploy
// anything and makes NO network calls, so it is safe to run any
// time:  npx hardhat run scripts/deploy.js
//
// Actual deployment is MANUAL by Bryan from My Wallet
// (0x0262e8e5E4584D8AB840fD950a6E2E0A414d4097), via the deploy
// page (like the v1 deploy) or Hardhat with his own key.
// NEVER paste a private key in chat.
//
// What is deployed: ONLY the new ThyrkNFT contract. The $THYRK
// token is REUSED from v1 (0x3b8747d067b2ed8565330667128260c2a4954300,
// cap 777,777, totalSupply still 0) — no new token contract.
//
// Deck (hash-only design): the NFT stores ONLY deckHash =
// 0x592a9180d7c57fa9c609176c204e8c4950ee20d7d13c5705c0227516e97e8233
// (seed 0x544859524b, keccak256 of the 23,331-byte deck encoding) plus
// a 61-word rarity bitmap built from the published deck
// (collection/rarity-bitmap.json). This script verifies before
// printing: bitmap deckHash == manifest deckHash, bitmap has
// exactly 61 words, deckHash != ZeroHash.
// Minting stays OFF after deploy (mintActive false) — the owner
// turns it on with setMintActive(true) only at launch.
// Owner is Bryan's My Wallet 0x0262e8e5E4584D8AB840fD950a6E2E0A414d4097;
// revenue + royalty receiver is the Binance Agentic Wallet
// 0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7.
// See contracts/ThyrkNFT.sol header for the full spec.
const fs = require("node:fs");
const path = require("node:path");

const OWNER_WALLET = "0x0262e8e5E4584D8AB840fD950a6E2E0A414d4097"; // Bryan's My Wallet
const AGENTIC_WALLET = "0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7"; // Binance Agentic Wallet (revenue + royalty)
const EXISTING_TOKEN = "0x3b8747d067b2ed8565330667128260c2a4954300"; // $THYRK (v1, REUSED)
const DEFAULT_AGENT_ID_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const DEFAULT_BASE_URI = "https://raw.githubusercontent.com/nugian10/THYRK/main/collection/metadata/";
const EXPECTED_DECK_HASH = "0x592a9180d7c57fa9c609176c204e8c4950ee20d7d13c5705c0227516e97e8233";
const EXPECTED_SEED = "0x544859524b";

async function main() {
  const owner = process.env.OWNER_ADDRESS || OWNER_WALLET;
  const revenue = process.env.REVENUE_WALLET || AGENTIC_WALLET;
  const agentIdRegistry = process.env.AGENT_ID_REGISTRY || DEFAULT_AGENT_ID_REGISTRY;
  const baseURI = process.env.BASE_URI || DEFAULT_BASE_URI;
  const tokenAddress = process.env.THYRK_TOKEN_ADDRESS || EXISTING_TOKEN;

  // --- Verify the deck inputs before printing anything. ---
  const manifestPath = path.join(__dirname, "..", "..", "collection", "manifest.json");
  const bitmapPath = path.join(__dirname, "..", "..", "collection", "rarity-bitmap.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest.json not found: ${manifestPath}`);
  if (!fs.existsSync(bitmapPath)) throw new Error(`rarity-bitmap.json not found: ${bitmapPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const bitmapDoc = JSON.parse(fs.readFileSync(bitmapPath, "utf8"));
  const deckHash = manifest.deckHash || EXPECTED_DECK_HASH;
  if (deckHash !== EXPECTED_DECK_HASH) {
    throw new Error(`manifest deckHash ${deckHash} != expected ${EXPECTED_DECK_HASH} — STOP.`);
  }
  if (bitmapDoc.deckHash !== deckHash) {
    throw new Error(`bitmap deckHash ${bitmapDoc.deckHash} != manifest deckHash ${deckHash} — STOP.`);
  }
  if (!Array.isArray(bitmapDoc.bitmap) || bitmapDoc.bitmap.length !== 61) {
    throw new Error(`rarity bitmap must have exactly 61 words, got ${bitmapDoc.bitmap?.length} — STOP.`);
  }
  if (!baseURI.endsWith("/")) {
    throw new Error("BASE_URI harus diakhiri '/' dan menunjuk folder metadata");
  }
  if (!deckHash || deckHash === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    throw new Error("DECK_HASH kosong / ZeroHash — deploy ditolak.");
  }

  console.log("=== THYRK replacement NFT — DEPLOYMENT PLAN (nothing deployed) ===");
  console.log("Network: BNB Smart Chain Mainnet (56)");
  console.log("Contract: ThyrkNFT (new contract, replaces v1 0xeff20913f99fd153da1b27bd96401089d3323bb8)");
  console.log("  name/symbol: THYRK / THYRK (same as v1 — no 'v2' label anywhere)");
  console.log("");
  console.log("Constructor arguments (in order):");
  console.log("  1. initialOwner      :", owner, "(My Wallet)");
  console.log("  2. revenueWallet     :", revenue, "(Agentic Wallet)");
  console.log("  3. agentIdRegistry   :", agentIdRegistry, "(SPACE ID)");
  console.log("  4. baseURI           :", baseURI);
  console.log("  5. deckHash          :", deckHash);
  console.log("     deck seed         :", manifest.seed || EXPECTED_SEED);
  console.log("  6. rarityBitmap      : 61 words from collection/rarity-bitmap.json (verified above)");
  console.log("  7. thyrkToken        :", tokenAddress, "(EXISTING $THYRK, reused — do NOT deploy a new token)");
  console.log("");
  console.log("Expected on-chain state right after deploy:");
  console.log("  MAX_SUPPLY 7777 | DIVINE_SUPPLY 77 | MAX_PER_WALLET 30 | MAX_TOKEN_MINTS 3");
  console.log("  Price ladder: mint #1 FREE (automatic) | #2-10 0.0002 | #11-20 0.0004 | #21-30 0.0008 BNB");
  console.log("  Bulk 30 = 0.0138 BNB | mint bonus 20 $THYRK (free AND paid) | royalty 5% to Agentic");
  console.log("  mintActive false | agentIdCheckRequired true");
  console.log("  Deploy gas (local estimate): run npx hardhat run scripts/measure-deploy-gas.js");
  console.log("");
  console.log("POST-DEPLOY STEPS (in order, all by the owner from My Wallet):");
  console.log("  1. Verify source on BscScan (solc 0.8.24, optimizer runs 200, evmVersion cancun).");
  console.log("  2. On the EXISTING $THYRK token contract, call:");
  console.log(`       ThyrkToken(${tokenAddress}).setMinter(<NEW_NFT_ADDRESS>, true)`);
  console.log("     Until this is done, every mint / burn / upgrade WILL REVERT (NFT is not a minter).");
  console.log("     (Do NOT call setMinter on any other token address; do NOT deploy a new token.)");
  console.log("  3. Sanity-check on-chain: deckHash, owner (= My Wallet), revenueWallet (= Agentic),");
  console.log("     royaltyInfo (5% to Agentic), mintActive false, currentPrice for a fresh wallet = 0.");
  console.log("  4. ONLY at launch (when Bryan says so): setMintActive(true) from My Wallet.");
  console.log("  5. Update the site config to the NEW NFT address; keep the v1 contract address");
  console.log("     listed as closed/final (21 mints) — v1 holders keep their v1 NFTs.");
  console.log("=== END OF PLAN — nothing was deployed by this script ===");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
