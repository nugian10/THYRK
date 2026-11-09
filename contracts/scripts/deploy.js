// Deploy THYRK to BNB Mainnet (56).
//
// Usage (from the contracts folder):
//   npx hardhat test                # all tests must pass first
//   npx hardhat run scripts/deploy.js --network bsc   # MAINNET, real BNB
//
// TWO contracts, in order:
//   1. ThyrkToken ($THYRK, ERC-20, cap 777,777) — owner = My Wallet.
//   2. ThyrkNFT (ERC-721, 7,777 + 77 Divine) — constructor needs the
//      token address, so the token MUST be deployed first.
//
// Then (owner-only, on the token): setMinter(nftAddress, true), so the
// NFT contract can mint the 20 $THYRK paid-mint bonus / burn rewards.
// This script does that automatically when the deployer IS the owner;
// otherwise it prints the exact call for the owner (My Wallet, e.g. via
// the deploy page) to run after deploy.
//
// Deck (hash-only design): the NFT stores ONLY deckHash =
// 0x592a9180d7c57fa9c609176c204e8c4950ee20d7d13c5705c0227516e97e8233
// (seed 0x544859524b, keccak256 of the 23,331-byte deck encoding) plus
// a 61-word rarity bitmap built from the published deck
// (collection/rarity-bitmap.json). The script verifies before deploying:
//   - bitmap deckHash == manifest deckHash
//   - bitmap has exactly 61 words
//   - deckHash != ZeroHash
// Minting stays OFF after deploy (mintActive false) — the owner turns
// it on with setMintActive(true) only at launch.
// Owner is Bryan's My Wallet 0x0262e8e5E4584D8AB840fD950a6E2E0A414d4097;
// revenue is the Binance Agentic Wallet
// 0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7. The deployer pays gas
// only; the deployer address does NOT have to be the owner — but
// deploying from My Wallet is the normal path (then setMinter runs
// automatically).
// NEVER paste a private key in chat. Deploy needs Bryan's own wallet
// signature (his Binance agent / deploy page), like previous projects.
// See contracts/ThyrkNFT.sol and contracts/ThyrkToken.sol headers.
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

const OWNER_WALLET = "0x0262e8e5E4584D8AB840fD950a6E2E0A414d4097"; // Bryan's My Wallet
const AGENTIC_WALLET = "0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7"; // Binance Agentic Wallet (revenue)
const DEFAULT_AGENT_ID_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const DEFAULT_BASE_URI = "https://raw.githubusercontent.com/nugian10/THYRK/main/collection/metadata/";
const EXPECTED_DECK_HASH = "0x592a9180d7c57fa9c609176c204e8c4950ee20d7d13c5705c0227516e97e8233";
const EXPECTED_SEED = "0x544859524b";

async function main() {
  const network = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();
  const owner = process.env.OWNER_ADDRESS || OWNER_WALLET;
  const revenue = process.env.REVENUE_WALLET || AGENTIC_WALLET;
  const agentIdRegistry = process.env.AGENT_ID_REGISTRY || DEFAULT_AGENT_ID_REGISTRY;
  const baseURI = process.env.BASE_URI || DEFAULT_BASE_URI;

  // --- Verify the deck inputs before deploying anything. ---
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
  const rarityBitmap = bitmapDoc.bitmap;
  console.log("deck verified: manifest + bitmap deckHash match:", deckHash);
  console.log("deck seed:", manifest.seed || EXPECTED_SEED, "| bitmap words:", rarityBitmap.length);

  if (!ethers.isAddress(owner)) throw new Error("OWNER_ADDRESS tidak valid");
  if (!ethers.isAddress(revenue)) throw new Error("REVENUE_WALLET tidak valid");
  if (!ethers.isAddress(agentIdRegistry)) throw new Error("AGENT_ID_REGISTRY tidak valid");
  if (!baseURI.endsWith("/")) {
    throw new Error("BASE_URI harus diakhiri '/' dan menunjuk folder metadata");
  }
  if (!deckHash || deckHash === ethers.ZeroHash) {
    throw new Error("DECK_HASH kosong / ZeroHash — deploy ditolak.");
  }

  console.log("Network:", network.name, "chainId:", Number(network.chainId));
  console.log("Deployer (bayar gas):", deployer.address);
  console.log("Owner (My Wallet):", owner);
  console.log("Revenue wallet (Agentic):", revenue);
  console.log("Agent ID registry:", agentIdRegistry);
  console.log("Base URI:", baseURI);
  if (Number(network.chainId) === 56) {
    console.log("!!! MAINNET — BNB SUNGGUHAN, deploy tidak bisa dibatalkan. Periksa alamat di atas sekali lagi.");
  }

  // --- 1. Deploy ThyrkToken first. ---
  const TokenFactory = await ethers.getContractFactory("contracts/ThyrkToken.sol:ThyrkToken");
  const token = await TokenFactory.deploy(owner);
  const tokenTx = await token.deploymentTransaction().wait();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("ThyrkToken deployed:", tokenAddress);
  console.log("ThyrkToken deploy gas used:", tokenTx.gasUsed.toString());
  console.log("  name:", await token.name(), "| symbol:", await token.symbol());
  console.log("  cap:", ethers.formatEther(await token.cap()), "$THYRK");
  console.log("  owner:", await token.owner());
  console.log("  BscScan:", `https://bscscan.com/address/${tokenAddress}`);

  // --- 2. Deploy ThyrkNFT (needs the token address). ---
  const NftFactory = await ethers.getContractFactory("contracts/ThyrkNFT.sol:ThyrkNFT");
  const nft = await NftFactory.deploy(
    owner,
    revenue,
    agentIdRegistry,
    baseURI,
    deckHash,
    rarityBitmap,
    tokenAddress
  );
  const nftTx = await nft.deploymentTransaction().wait();
  await nft.waitForDeployment();
  const nftAddress = await nft.getAddress();
  console.log("ThyrkNFT deployed:", nftAddress);
  console.log("ThyrkNFT deploy gas used:", nftTx.gasUsed.toString());
  for (const gwei of ["0.05", "0.1", "1"]) {
    const total = (tokenTx.gasUsed + nftTx.gasUsed) * ethers.parseUnits(gwei, "gwei");
    console.log(`Both deploys at ${gwei} gwei:`, ethers.formatEther(total), "BNB");
  }
  console.log("MAX_SUPPLY:", (await nft.MAX_SUPPLY()).toString());
  console.log("MAX_PER_WALLET:", (await nft.MAX_PER_WALLET()).toString());
  console.log("FREE_MINTS_TOTAL:", (await nft.FREE_MINTS_TOTAL()).toString());
  console.log("DIVINE_SUPPLY:", (await nft.DIVINE_SUPPLY()).toString());
  console.log("currentPrice(0 mints):", ethers.formatEther(await nft.currentPrice()), "BNB");
  console.log("deckHash on-chain:", await nft.deckHash());
  console.log("token on-chain:", await nft.token());
  console.log("mintActive:", await nft.mintActive());
  console.log("agentIdCheckRequired:", await nft.agentIdCheckRequired());
  console.log("BscScan:", `https://bscscan.com/address/${nftAddress}`);

  // --- 3. setMinter(nft, true) on the token (owner-only). ---
  if (deployer.address.toLowerCase() === owner.toLowerCase()) {
    const setTx = await token.setMinter(nftAddress, true);
    await setTx.wait();
    console.log("setMinter(nft, true) done by deployer (owner). NFT is a minter:",
      await token.minters(nftAddress));
  } else {
    console.log("Deployer is NOT the token owner, so setMinter was NOT called.");
    console.log("OWNER (My Wallet) MUST RUN — e.g. via the deploy page https://thyrk.fun/deploy.html:");
    console.log(`  ThyrkToken(${tokenAddress}).setMinter(${nftAddress}, true)`);
    console.log("Until then, paid mints / burns / upgrades WILL REVERT (NFT is not a minter).");
  }

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `thyrk-${Number(network.chainId)}.json`);
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        network: network.name,
        chainId: Number(network.chainId),
        tokenAddress,
        nftAddress,
        owner,
        revenueWallet: revenue,
        agentIdRegistry,
        baseURI,
        deckHash,
        deckSeed: manifest.seed || EXPECTED_SEED,
        rarityBitmapWords: rarityBitmap.length,
        maxSupply: 7777,
        divineSupply: 77,
        maxPerWallet: 30,
        freeMintsTotal: 777,
        priceLadder: { mint1to10: "0.0002", mint11to20: "0.0004", mint21to30: "0.0008" },
        mintActive: false,
        agentIdCheckRequired: true,
        tokenDeployGasUsed: tokenTx.gasUsed.toString(),
        nftDeployGasUsed: nftTx.gasUsed.toString(),
        minterSet: deployer.address.toLowerCase() === owner.toLowerCase(),
      },
      null,
      2
    )
  );
  console.log("Saved:", out);
  console.log("Langkah berikut: verifikasi source kedua kontrak di BscScan, lalu setMintActive(true) HANYA saat launch (setelah public launch hold dicabut Bryan).");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
