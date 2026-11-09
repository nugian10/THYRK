// Measure the replacement THYRK NFT deployment gas on the local
// Hardhat network. Deploys the NFT with the REAL deckHash + rarity
// bitmap + baseURI (mock registry + a fresh test ThyrkToken as the
// token stand-in), then the owner-only setMinter(nft, true) and the
// setMintActive(true) activation tx, so the total top-up can be
// computed. Run: npx hardhat run scripts/measure-deploy-gas.js
//
// NOTE: the $THYRK token is ALREADY deployed on mainnet
// (0x3b8747d067b2ed8565330667128260c2a4954300) and is REUSED —
// no token deploy gas is needed in production. The fresh token
// deployed here exists only so setMinter gas can be measured
// locally; on mainnet setMinter is a single owner tx on the
// EXISTING token contract.
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

function costRows(label, gasUsed) {
  for (const gwei of ["0.05", "0.1", "1"]) {
    const costWei = gasUsed * ethers.parseUnits(gwei, "gwei");
    console.log(`${label} at ${gwei} gwei: ${ethers.formatEther(costWei)} BNB`);
  }
}

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "collection", "manifest.json"), "utf8")
  );
  const bitmapDoc = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "collection", "rarity-bitmap.json"), "utf8")
  );
  if (bitmapDoc.deckHash !== manifest.deckHash) {
    throw new Error("bitmap deckHash != manifest deckHash — STOP.");
  }
  if (bitmapDoc.bitmap.length !== 61) {
    throw new Error(`rarity bitmap must have 61 words, got ${bitmapDoc.bitmap.length}`);
  }
  const deckHash = manifest.deckHash;
  const rarityBitmap = bitmapDoc.bitmap;
  const baseURI = "https://raw.githubusercontent.com/nugian10/THYRK/main/collection/metadata/";
  const EXISTING_TOKEN = "0x3b8747d067b2ed8565330667128260c2a4954300";

  const [owner, revenue] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockAgentIdRegistry");
  const mock = await Mock.deploy();
  await mock.waitForDeployment();

  // --- Test-only fresh token (stand-in for the existing mainnet token) ---
  const TokenFactory = await ethers.getContractFactory("ThyrkToken");
  const token = await TokenFactory.deploy(owner.address);
  const tokenReceipt = await token.deploymentTransaction().wait();
  await token.waitForDeployment();
  console.log("ThyrkToken (TEST STAND-IN ONLY — mainnet reuses", EXISTING_TOKEN + ")");
  console.log("  deploy gasUsed:", tokenReceipt.gasUsed.toString(), "(NOT needed on mainnet)");

  // --- ThyrkNFT (replacement contract, real deckHash + bitmap) ---
  const NftFactory = await ethers.getContractFactory("ThyrkNFT");
  const nft = await NftFactory.deploy(
    owner.address,
    revenue.address,
    await mock.getAddress(),
    baseURI,
    deckHash,
    rarityBitmap,
    await token.getAddress()
  );
  const nftReceipt = await nft.deploymentTransaction().wait();
  await nft.waitForDeployment();
  const nftAddress = await nft.getAddress();
  console.log("ThyrkNFT deploy gasUsed:", nftReceipt.gasUsed.toString());
  costRows("ThyrkNFT deploy", nftReceipt.gasUsed);
  const nftArt = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "artifacts", "contracts", "ThyrkNFT.sol", "ThyrkNFT.json"),
      "utf8"
    )
  );
  console.log("ThyrkNFT creation bytecode bytes:", (nftArt.bytecode.length - 2) / 2);
  console.log("ThyrkNFT runtime bytecode bytes:", (nftArt.deployedBytecode.length - 2) / 2);
  console.log("deckHash on-chain:", await nft.deckHash());
  console.log("deckHash expected:", deckHash);
  console.log("match:", (await nft.deckHash()) === deckHash);
  console.log("owner:", await nft.owner());
  console.log("revenueWallet:", await nft.revenueWallet());
  console.log("mintActive:", await nft.mintActive());
  console.log("rarityOf(1) (bitmap check):", await nft.rarityOf(1));

  // --- setMinter(nft, true) on the token (owner-only) ---
  const minterTx = await token.connect(owner).setMinter(nftAddress, true);
  const minterReceipt = await minterTx.wait();
  console.log("setMinter gasUsed:", minterReceipt.gasUsed.toString());
  costRows("setMinter", minterReceipt.gasUsed);

  // --- Activation tx: setMintActive(true), paid by the owner. ---
  const actTx = await nft.connect(owner).setMintActive(true);
  const actReceipt = await actTx.wait();
  console.log("activation (setMintActive) gasUsed:", actReceipt.gasUsed.toString());
  costRows("activation", actReceipt.gasUsed);

  const total = nftReceipt.gasUsed + minterReceipt.gasUsed + actReceipt.gasUsed;
  console.log("TOTAL (NFT deploy + setMinter + activation) gas:", total.toString());
  costRows("TOTAL (no token deploy — token already exists)", total);
  console.log("Top-up recommendation: siapkan ~0.001 BNB di wallet deployer (My Wallet).");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
