// Measure THYRK deployment gas on the local Hardhat network.
// Deploys BOTH contracts with the REAL deckHash + rarity bitmap +
// baseURI, then the owner-only setMinter(nft, true) and the
// setMintActive(true) activation tx, so the total top-up (deploy +
// minter setup + activation) can be computed.
// Run: npx hardhat run scripts/measure-deploy-gas.js
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

const BNB_IDR = 12_229_764; // 1 BNB in IDR (CoinGecko, checked 9 Nov 2026)

function costRows(label, gasUsed) {
  for (const gwei of ["0.05", "0.1", "1"]) {
    const costWei = gasUsed * ethers.parseUnits(gwei, "gwei");
    const costBnb = Number(ethers.formatEther(costWei));
    console.log(
      `${label} at ${gwei} gwei: ${ethers.formatEther(costWei)} BNB (~Rp ${Math.round(
        costBnb * BNB_IDR
      ).toLocaleString("id-ID")})`
    );
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

  const [owner, revenue] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockAgentIdRegistry");
  const mock = await Mock.deploy();
  await mock.waitForDeployment();

  // --- ThyrkToken ---
  const TokenFactory = await ethers.getContractFactory("contracts/ThyrkToken.sol:ThyrkToken");
  const token = await TokenFactory.deploy(owner.address);
  const tokenReceipt = await token.deploymentTransaction().wait();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("ThyrkToken deploy gasUsed:", tokenReceipt.gasUsed.toString());
  costRows("ThyrkToken deploy", tokenReceipt.gasUsed);
  const tokenArt = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "artifacts", "contracts", "ThyrkToken.sol", "ThyrkToken.json"),
      "utf8"
    )
  );
  console.log("ThyrkToken creation bytecode bytes:", (tokenArt.bytecode.length - 2) / 2);
  console.log("ThyrkToken runtime bytecode bytes:", (tokenArt.deployedBytecode.length - 2) / 2);

  // --- ThyrkNFT (real deckHash + bitmap) ---
  const NftFactory = await ethers.getContractFactory("contracts/ThyrkNFT.sol:ThyrkNFT");
  const nft = await NftFactory.deploy(
    owner.address,
    revenue.address,
    await mock.getAddress(),
    baseURI,
    deckHash,
    rarityBitmap,
    tokenAddress
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

  const total = tokenReceipt.gasUsed + nftReceipt.gasUsed + minterReceipt.gasUsed + actReceipt.gasUsed;
  console.log("TOTAL (token + NFT + setMinter + activation) gas:", total.toString());
  costRows("TOTAL", total);
  const at005 = total * ethers.parseUnits("0.05", "gwei");
  console.log("TOTAL at 0.05 gwei in BNB:", ethers.formatEther(at005));
  console.log("Top-up recommendation: siapkan ~0.001 BNB di wallet deployer (My Wallet).");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
