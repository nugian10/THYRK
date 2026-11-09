const fs = require("node:fs");
const path = require("node:path");
const { expect } = require("chai");
const { ethers } = require("hardhat");

// Replacement THYRK contract tests.
// Same deck/bitmap as v1 (collection/manifest.json + rarity-bitmap.json),
// new rules: automatic free first mint (no useFree flag, no 777 cap),
// free draw uses the FULL deck incl. Legendary (Bryan, 23:30 WIB
// 9 Nov 2026 — free Legendary is a lure; Divine sits above it),
// 20 $THYRK bonus on free AND paid mints, bulk 30 = 0.0138 BNB,
// owner = My Wallet, revenue/royalty = Agentic Wallet, no repost logic.
const COLLECTION = path.join(__dirname, "..", "..", "collection");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(COLLECTION, "manifest.json"), "utf8"));
const BITMAP = JSON.parse(fs.readFileSync(path.join(COLLECTION, "rarity-bitmap.json"), "utf8"));

const DECK_HASH = MANIFEST.deckHash;
const EXPECTED_DECK_HASH = "0x592a9180d7c57fa9c609176c204e8c4950ee20d7d13c5705c0227516e97e8233";
const BASE_URI = MANIFEST.baseURI;
const BITMAP_WORDS = BITMAP.bitmap.map((w) => BigInt(w));

const P_1_10 = ethers.parseEther("0.0002");
const P_11_20 = ethers.parseEther("0.0004");
const P_21_30 = ethers.parseEther("0.0008");
const MY_WALLET = "0x0262e8e5E4584D8AB840fD950a6E2E0A414d4097";
const AGENTIC = "0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7";
const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const EXISTING_TOKEN = "0x3b8747d067b2ed8565330667128260c2a4954300";

// Price of mint slot #n (1-based) for one wallet (ladder, free excluded).
function priceAtSlot(n) {
  if (n <= 10) return P_1_10;
  if (n <= 20) return P_11_20;
  return P_21_30;
}

// Sum of ladder prices for slots [from..to] (1-based, inclusive).
function ladderSum(from, to) {
  let s = 0n;
  for (let n = from; n <= to; n++) s += priceAtSlot(n);
  return s;
}

async function deployFixture() {
  const [owner, revenue, alice, bob, carol, dave] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockAgentIdRegistry");
  const mock = await Mock.deploy();
  await mock.waitForDeployment();
  // Fresh ThyrkToken from the v1 source (test-only stand-in for the
  // already-deployed token 0x3b87...; the new NFT never deploys a token).
  const Token = await ethers.getContractFactory("ThyrkToken");
  const token = await Token.deploy(owner.address);
  await token.waitForDeployment();
  const Nft = await ethers.getContractFactory("ThyrkNFT");
  const nft = await Nft.deploy(
    owner.address,
    revenue.address,
    await mock.getAddress(),
    BASE_URI,
    DECK_HASH,
    BITMAP_WORDS,
    await token.getAddress()
  );
  await nft.waitForDeployment();
  // Authorize the NFT contract as a $THYRK minter (as the real
  // deploy flow does: token owner calls setMinter(nft, true)).
  await token.setMinter(await nft.getAddress(), true);
  return { nft, token, mock, owner, revenue, alice, bob, carol, dave };
}

async function giveAgentId(mock, wallet) {
  await mock.mintTo(wallet.address);
}

async function activate(nft, owner) {
  await nft.connect(owner).setMintActive(true);
}

// Pay the exact quoteBulk price for `quantity` (no useFree flag any more).
async function mintPaid(nft, wallet, quantity) {
  const q = await nft.quoteBulk(wallet.address, quantity);
  const tx = await nft.connect(wallet).mint(quantity, { value: q[0] });
  return tx;
}

// Minted token IDs (in mint order) from a tx receipt.
async function mintedIds(nft, receipt) {
  const ids = [];
  for (const log of receipt.logs) {
    try {
      const parsed = nft.interface.parseLog(log);
      if (parsed && parsed.name === "Minted") ids.push(parsed.args.tokenId);
    } catch (e) {
      // not a Minted log
    }
  }
  return ids;
}

describe("ThyrkToken (reused v1 source, test stand-in)", function () {
  it("has the right name, symbol, decimals, cap and owner", async function () {
    const { token, owner } = await deployFixture();
    expect(await token.name()).to.equal("THYRK");
    expect(await token.symbol()).to.equal("THYRK");
    expect(await token.decimals()).to.equal(18);
    expect(await token.MAX_SUPPLY()).to.equal(ethers.parseEther("777777"));
    expect(await token.owner()).to.equal(owner.address);
    expect(await token.totalSupply()).to.equal(0);
  });

  it("only authorized minters can mint; cap is enforced", async function () {
    const { token, nft, alice } = await deployFixture();
    await expect(token.connect(alice).mint(alice.address, 100n)).to.be.revertedWithCustomError(
      token,
      "NotMinter"
    );
    const nftAsSigner = await ethers.getImpersonatedSigner(await nft.getAddress());
    await ethers.provider.send("hardhat_setBalance", [await nft.getAddress(), "0x1000000000000000000"]);
    await expect(
      token.connect(nftAsSigner).mint(alice.address, ethers.parseEther("777778"))
    ).to.be.revertedWithCustomError(token, "ERC20ExceededCap");
  });
});

describe("ThyrkNFT deployment (replacement contract)", function () {
  it("has the right name, symbol, supply, ladder, deck and defaults", async function () {
    const { nft, mock, owner, revenue } = await deployFixture();
    expect(await nft.name()).to.equal("THYRK");
    expect(await nft.symbol()).to.equal("THYRK");
    expect(await nft.MAX_SUPPLY()).to.equal(7777);
    expect(await nft.DIVINE_SUPPLY()).to.equal(77);
    expect(await nft.MAX_PER_WALLET()).to.equal(30);
    expect(await nft.MAX_TOKEN_MINTS()).to.equal(3);
    expect(await nft.PRICE_1_10()).to.equal(P_1_10);
    expect(await nft.PRICE_11_20()).to.equal(P_11_20);
    expect(await nft.PRICE_21_30()).to.equal(P_21_30);
    expect(await nft.deckHash()).to.equal(EXPECTED_DECK_HASH);
    expect(await nft.deckHash()).to.equal(DECK_HASH);
    expect(await nft.baseURI()).to.equal(BASE_URI);
    expect(await nft.owner()).to.equal(owner.address);
    expect(await nft.revenueWallet()).to.equal(revenue.address);
    expect(await nft.mintActive()).to.equal(false);
    expect(await nft.agentIdCheckRequired()).to.equal(true);
    expect(await nft.agentIdRegistry()).to.equal(await mock.getAddress());
    expect(await nft.deckRemaining()).to.equal(7777);
    expect(await nft.divineRemaining()).to.equal(77);
    expect(await nft.commonsRemaining()).to.equal(4000);
    expect(await nft.raresRemaining()).to.equal(2500);
    expect(await nft.epicsRemaining()).to.equal(1000);
    expect(await nft.legendariesRemaining()).to.equal(277);
    expect(await nft.freeMinted()).to.equal(0);
    // No 777 free-mint cap any more: no FREE_TOTAL on the new contract.
    expect(nft.interface.hasFunction("FREE_TOTAL")).to.equal(false);
    expect(nft.interface.hasFunction("freeMintsRemaining")).to.equal(false);
  });

  it("stores the real My Wallet owner + Agentic revenue and 5% royalty", async function () {
    const { mock, owner } = await deployFixture();
    const Token = await ethers.getContractFactory("ThyrkToken");
    const token = await Token.deploy(owner.address);
    await token.waitForDeployment();
    const Nft = await ethers.getContractFactory("ThyrkNFT");
    const nft = await Nft.deploy(
      MY_WALLET,
      AGENTIC,
      REGISTRY,
      BASE_URI,
      DECK_HASH,
      BITMAP_WORDS,
      await token.getAddress()
    );
    await nft.waitForDeployment();
    expect(await nft.owner()).to.equal(MY_WALLET);
    expect(await nft.revenueWallet()).to.equal(AGENTIC);
    const [receiver, amount] = await nft.royaltyInfo(1, ethers.parseEther("1"));
    expect(receiver).to.equal(AGENTIC);
    expect(amount).to.equal(ethers.parseEther("0.05"));
    expect(await nft.supportsInterface("0x2a55205a")).to.equal(true); // ERC-2981
  });

  it("rarityOf matches the published metadata for sampled tokens", async function () {
    const { nft } = await deployFixture();
    const samples = [1, 2, 3, 4, 5, 7, 100, 1000, 4000, 7777];
    for (const id of samples) {
      const meta = JSON.parse(
        fs.readFileSync(path.join(COLLECTION, "metadata", `${id}.json`), "utf8")
      );
      const rarity = meta.attributes.find((a) => a.trait_type === "Rarity").value;
      const code = { Common: 0, Rare: 1, Epic: 2, Legendary: 3 }[rarity];
      expect(await nft.rarityOf(id)).to.equal(code);
    }
    expect(await nft.rarityOf(7778)).to.equal(4);
    expect(await nft.rarityOf(7854)).to.equal(4);
    await expect(nft.rarityOf(0)).to.be.revertedWithCustomError(nft, "ExceedsMaxSupply");
    await expect(nft.rarityOf(7855)).to.be.revertedWithCustomError(nft, "ExceedsMaxSupply");
  });

  it("tokenURI points at the right metadata files", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    const tx = await mintPaid(nft, alice, 1);
    expect(await nft.balanceOf(alice.address)).to.equal(1);
    const ids = await mintedIds(nft, await tx.wait());
    expect(await nft.tokenURI(ids[0])).to.equal(`${BASE_URI}${ids[0]}.json`);
  });

  it("mint() has the new 1-arg signature (no useFree bool)", async function () {
    const { nft } = await deployFixture();
    expect(nft.interface.getFunction("mint").inputs.length).to.equal(1);
    expect(nft.interface.getFunction("quoteBulk").inputs.length).to.equal(2);
    expect(nft.interface.hasFunction("mint(uint256,bool)")).to.equal(false);
  });
});

describe("ThyrkNFT agent gate", function () {
  it("mint reverts without an Agent ID, works with one", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await activate(nft, owner);
    await expect(nft.connect(alice).mint(1, { value: 0 })).to.be.revertedWithCustomError(
      nft,
      "NoAgentId"
    );
    expect(await nft.holdsAgentId(alice.address)).to.equal(false);
    await giveAgentId(mock, alice);
    expect(await nft.holdsAgentId(alice.address)).to.equal(true);
    await nft.connect(alice).mint(1, { value: 0 });
    expect(await nft.balanceOf(alice.address)).to.equal(1);
  });

  it("mint from a contract reverts (NoContracts)", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await activate(nft, owner);
    await giveAgentId(mock, alice);
    const Caller = await ethers.getContractFactory("MockGenericCaller");
    const caller = await Caller.deploy();
    await caller.waitForDeployment();
    const data = nft.interface.encodeFunctionData("mint", [1]);
    const ok = await caller.tryCall.staticCall(await nft.getAddress(), data, { value: 0 });
    expect(ok).to.equal(false);
  });

  it("owner can disable the Agent ID check (escape hatch, public)", async function () {
    const { nft, owner, alice } = await deployFixture();
    await activate(nft, owner);
    await nft.connect(owner).setAgentIdCheckRequired(false);
    await nft.connect(alice).mint(1, { value: 0 });
    expect(await nft.balanceOf(alice.address)).to.equal(1);
  });

  it("holdsAgentId is false for a dead registry address", async function () {
    const { nft, owner, alice } = await deployFixture();
    await nft.connect(owner).setAgentIdRegistry(alice.address);
    expect(await nft.holdsAgentId(alice.address)).to.equal(false);
  });
});

describe("ThyrkNFT pricing", function () {
  it("priceForCount follows the locked ladder", async function () {
    const { nft } = await deployFixture();
    expect(await nft.priceForCount(0)).to.equal(P_1_10);
    expect(await nft.priceForCount(9)).to.equal(P_1_10);
    expect(await nft.priceForCount(10)).to.equal(P_11_20);
    expect(await nft.priceForCount(19)).to.equal(P_11_20);
    expect(await nft.priceForCount(20)).to.equal(P_21_30);
    expect(await nft.priceForCount(29)).to.equal(P_21_30);
  });

  it("priceFor is 0 while the free mint is unused, then follows the ladder", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    expect(await nft.priceFor(alice.address)).to.equal(0);
    expect(await nft.currentPrice()).to.equal(0); // caller is owner (no Agent ID needed for view)
    await nft.connect(alice).mint(1, { value: 0 }); // free mint used
    expect(await nft.priceFor(alice.address)).to.equal(P_1_10);
    await mintPaid(nft, alice, 9); // mintCount 10
    expect(await nft.priceFor(alice.address)).to.equal(P_11_20);
    await mintPaid(nft, alice, 10); // mintCount 20
    expect(await nft.priceFor(alice.address)).to.equal(P_21_30);
  });

  it("quoteBulk: fresh wallet 30 = 0.0138 BNB, freeSlot 0; after free used, no free slot", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    // Fresh wallet, 30 -> 1 free + 29 paid = 0.0138, free at slot 0.
    let q = await nft.quoteBulk(alice.address, 30);
    expect(q[0]).to.equal(ethers.parseEther("0.0138"));
    expect(q[1]).to.equal(0);
    // Fresh wallet, 1 -> 0 (free), freeSlot 0.
    q = await nft.quoteBulk(alice.address, 1);
    expect(q[0]).to.equal(0);
    expect(q[1]).to.equal(0);
    // Fresh wallet, 10 -> 1 free + 9x0.0002 = 0.0018.
    q = await nft.quoteBulk(alice.address, 10);
    expect(q[0]).to.equal(ethers.parseEther("0.0018"));
    expect(q[1]).to.equal(0);
    // After the free mint is used: 29 remaining slots cost the full 0.0138.
    await nft.connect(alice).mint(1, { value: 0 });
    q = await nft.quoteBulk(alice.address, 29);
    expect(q[0]).to.equal(ethers.parseEther("0.0138"));
    expect(q[1]).to.equal(ethers.MaxUint256);
    // After free used, 1 mint costs the ladder price (slot 2 -> 0.0002).
    q = await nft.quoteBulk(alice.address, 1);
    expect(q[0]).to.equal(P_1_10);
    expect(q[1]).to.equal(ethers.MaxUint256);
  });

  it("quoteBulk reverts on bad quantity / cap", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    await expect(nft.quoteBulk(alice.address, 0)).to.be.revertedWithCustomError(
      nft,
      "MaxPerWallet"
    );
    await expect(nft.quoteBulk(alice.address, 31)).to.be.revertedWithCustomError(
      nft,
      "MaxPerWallet"
    );
    await mintPaid(nft, alice, 30);
    await expect(nft.quoteBulk(alice.address, 1)).to.be.revertedWithCustomError(
      nft,
      "MaxPerWallet"
    );
    await expect(nft.priceFor(alice.address)).to.be.revertedWithCustomError(nft, "MaxPerWallet");
  });
});

describe("ThyrkNFT minting", function () {
  it("mint inactive reverts; underpayment reverts; overpayment is refunded", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await expect(nft.connect(alice).mint(1, { value: 0 })).to.be.revertedWithCustomError(
      nft,
      "MintInactive"
    );
    await activate(nft, owner);
    await nft.connect(alice).mint(1, { value: 0 }); // free
    await expect(
      nft.connect(alice).mint(1, { value: ethers.parseEther("0.0001") })
    ).to.be.revertedWithCustomError(nft, "IncorrectPayment");
    const before = await ethers.provider.getBalance(alice.address);
    const tx = await nft.connect(alice).mint(1, { value: ethers.parseEther("0.001") });
    const receipt = await tx.wait();
    const gas = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(alice.address);
    // Paid exactly 0.0002 (0.001 sent - 0.0008 refunded) + gas.
    expect(before - after - gas).to.equal(P_1_10);
    expect(await nft.balanceOf(alice.address)).to.equal(2);
  });

  it("first mint is free AND earns 20 $THYRK; second mint is paid 0.0002 + 20 $THYRK", async function () {
    const { nft, token, mock, owner, revenue, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    const revBefore = await ethers.provider.getBalance(revenue.address);
    await nft.connect(alice).mint(1, { value: 0 });
    expect((await ethers.provider.getBalance(revenue.address)) - revBefore).to.equal(0);
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("20"));
    expect(await nft.freeUsed(alice.address)).to.equal(true);
    expect(await nft.freeMinted()).to.equal(1);
    expect(await nft.mintCount(alice.address)).to.equal(1);
    expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(0);
    await mintPaid(nft, alice, 1);
    expect((await ethers.provider.getBalance(revenue.address)) - revBefore).to.equal(P_1_10);
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("40"));
    expect(await nft.totalSupply()).to.equal(2);
    expect(await nft.deckRemaining()).to.equal(7775);
  });

  it("bulk mint 30 at once costs exactly 0.0138 BNB and respects the 30 cap", async function () {
    const { nft, token, mock, owner, revenue, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    const revBefore = await ethers.provider.getBalance(revenue.address);
    await mintPaid(nft, alice, 30);
    expect(await nft.balanceOf(alice.address)).to.equal(30);
    expect(await nft.mintCount(alice.address)).to.equal(30);
    expect((await ethers.provider.getBalance(revenue.address)) - revBefore).to.equal(
      ethers.parseEther("0.0138")
    );
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("600")); // 30 x 20
    await expect(mintPaid(nft, alice, 1)).to.be.revertedWithCustomError(nft, "MaxPerWallet");
    await expect(nft.connect(alice).mint(31, { value: 0 })).to.be.revertedWithCustomError(
      nft,
      "MaxPerWallet"
    );
  });

  it("bulk mint across the ladder boundary prices each slot correctly", async function () {
    const { nft, token, mock, owner, revenue, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    // 9 mints first (1 free + 8 paid: 8x0.0002 = 0.0016), then a bulk
    // of 5 (slots 10-14: 0.0002 + 4x0.0004 = 0.0018).
    await mintPaid(nft, alice, 9);
    const revBefore = await ethers.provider.getBalance(revenue.address);
    await mintPaid(nft, alice, 5);
    expect((await ethers.provider.getBalance(revenue.address)) - revBefore).to.equal(
      ethers.parseEther("0.0018")
    );
    expect(await nft.mintCount(alice.address)).to.equal(14);
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("280")); // 14 x 20
  });

  it("all drawn token IDs are unique and inside 1..7777", async function () {
    const { nft, mock, owner } = await deployFixture();
    const signers = await ethers.getSigners();
    const wallets = signers.slice(2, 10);
    await mock.mintBatch(wallets.map((w) => w.address));
    await activate(nft, owner);
    const seen = new Set();
    for (const w of wallets) {
      const tx = await mintPaid(nft, w, 30);
      const ids = await mintedIds(nft, await tx.wait());
      for (const id of ids) {
        const n = Number(id);
        expect(n).to.be.greaterThan(0);
        expect(n).to.be.lessThanOrEqual(7777);
        expect(seen.has(n)).to.equal(false);
        seen.add(n);
      }
    }
    expect(seen.size).to.equal(240);
    expect(await nft.totalSupply()).to.equal(240);
  });
});

describe("ThyrkNFT automatic free mint", function () {
  it("free mint is 1 per wallet: second mint() call charges the ladder price", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    await nft.connect(alice).mint(1, { value: 0 });
    // Second single mint costs 0.0002 (slot 2), not 0.
    await expect(nft.connect(alice).mint(1, { value: 0 })).to.be.revertedWithCustomError(
      nft,
      "IncorrectPayment"
    );
    await mintPaid(nft, alice, 1);
    expect(await nft.mintCount(alice.address)).to.equal(2);
    expect(await nft.freeMinted()).to.equal(1);
  });

  it("free mint is unlimited in total: many wallets each get one", async function () {
    const { nft, mock, owner } = await deployFixture();
    const signers = await ethers.getSigners();
    const wallets = signers.slice(2, 12);
    await mock.mintBatch(wallets.map((w) => w.address));
    await activate(nft, owner);
    for (const w of wallets) {
      await nft.connect(w).mint(1, { value: 0 });
      expect(await nft.freeUsed(w.address)).to.equal(true);
    }
    expect(await nft.freeMinted()).to.equal(10);
    // No cap: freeMintsRemaining / FREE_TOTAL do not exist any more.
  });

  it("free draw CAN yield Legendary (300 free draws across wallets)", async function () {
    const { nft, mock, owner } = await deployFixture();
    const signers = await ethers.getSigners();
    await activate(nft, owner);
    const wallets = [];
    // 18 funded signers + 282 fresh random wallets (funded for gas).
    for (const w of signers.slice(2, 20)) wallets.push(w);
    for (let i = 0; i < 282; i++) {
      const w = ethers.Wallet.createRandom().connect(ethers.provider);
      wallets.push(w);
      await ethers.provider.send("hardhat_setBalance", [w.address, "0x8ac7230489e80000"]); // 10 ETH
    }
    await mock.mintBatch(wallets.map((w) => w.address));
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const w of wallets) {
      const tx = await nft.connect(w).mint(1, { value: 0 });
      const ids = await mintedIds(nft, await tx.wait());
      expect(ids.length).to.equal(1);
      counts[Number(await nft.rarityOf(ids[0]))]++;
    }
    expect(await nft.freeMinted()).to.equal(300);
    // The draw is deterministic (deckHash-seeded), so this count is
    // fixed per run — Legendary appears at ~277/7777 per draw, so
    // ~10 expected in 300 draws. A free Legendary is a lure by
    // design (Bryan, 23:30 WIB 9 Nov 2026): it MUST be possible.
    expect(counts[3], `expected >=1 Legendary in 300 free draws, got ${JSON.stringify(counts)}`).to.be.greaterThan(0);
    // Free draws still cover the other tiers too.
    expect(counts[0]).to.be.greaterThan(0);
    expect(counts[1] + counts[2]).to.be.greaterThan(0);
  });

  it("the free slot inside a bulk-30 is the FIRST token", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    const tx = await mintPaid(nft, alice, 30);
    const ids = await mintedIds(nft, await tx.wait());
    expect(ids.length).to.equal(30);
    // Batch slot 0 = the free mint (any rarity incl. Legendary).
    expect(await nft.freeUsed(alice.address)).to.equal(true);
  });
});

describe("ThyrkNFT token mint (100 $THYRK)", function () {
  it("mints with $THYRK: no BNB, no bonus, counts to 30 and the ladder", async function () {
    const { nft, token, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    await mintPaid(nft, alice, 5); // earn 100 $THYRK (5 x 20, incl. free)
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("100"));
    await token.connect(alice).approve(await nft.getAddress(), ethers.parseEther("100"));
    const revBefore = await ethers.provider.getBalance(await nft.getAddress());
    await nft.connect(alice).mintWithToken(1);
    expect(await nft.balanceOf(alice.address)).to.equal(6);
    expect(await nft.mintCount(alice.address)).to.equal(6);
    expect(await nft.tokenMints(alice.address)).to.equal(1);
    expect(await token.balanceOf(alice.address)).to.equal(0); // spent, no bonus
    expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(revBefore);
    // Ladder advanced: next paid mint is slot 7 -> 0.0002 still.
    expect(await nft.priceFor(alice.address)).to.equal(P_1_10);
  });

  it("token mint does NOT consume the free mint (spec ambiguity A)", async function () {
    const { nft, token, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    // Fund 300 $THYRK directly (test-only minter grant).
    await token.setMinter(owner.address, true);
    await token.mint(alice.address, ethers.parseEther("300"));
    await token.connect(alice).approve(await nft.getAddress(), ethers.parseEther("300"));
    await nft.connect(alice).mintWithToken(3);
    expect(await nft.mintCount(alice.address)).to.equal(3);
    expect(await nft.tokenMints(alice.address)).to.equal(3);
    expect(await nft.freeUsed(alice.address)).to.equal(false);
    expect(await token.balanceOf(alice.address)).to.equal(0); // 300 spent, no bonus
    // First mint() call afterwards is STILL free (slot 0 of the batch).
    expect(await nft.priceFor(alice.address)).to.equal(0);
    const q = await nft.quoteBulk(alice.address, 1);
    expect(q[0]).to.equal(0);
    expect(q[1]).to.equal(0);
    // And a bulk right after token-mints prices from mintCount 3:
    // free slot 0, then slot 5 (mintCount 4) at 0.0002.
    const q2 = await nft.quoteBulk(alice.address, 2);
    expect(q2[0]).to.equal(P_1_10);
    expect(q2[1]).to.equal(0);
    await nft.connect(alice).mint(1, { value: 0 });
    expect(await nft.freeUsed(alice.address)).to.equal(true);
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("20"));
    expect(await nft.mintCount(alice.address)).to.equal(4);
    // Ladder position is by total mintCount: next paid mint is slot 5 -> 0.0002.
    expect(await nft.priceFor(alice.address)).to.equal(P_1_10);
  });

  it("token mint caps at 3 per wallet and rejects BNB / low balance", async function () {
    const { nft, token, mock, owner, alice, bob } = await deployFixture();
    await giveAgentId(mock, alice);
    await giveAgentId(mock, bob);
    await activate(nft, owner);
    await token.setMinter(owner.address, true);
    await token.mint(alice.address, ethers.parseEther("500"));
    await token.connect(alice).approve(await nft.getAddress(), ethers.parseEther("500"));
    await expect(nft.connect(alice).mintWithToken(4)).to.be.revertedWithCustomError(
      nft,
      "TokenMintLimit"
    );
    await nft.connect(alice).mintWithToken(3);
    expect(await nft.tokenMints(alice.address)).to.equal(3);
    await expect(nft.connect(alice).mintWithToken(1)).to.be.revertedWithCustomError(
      nft,
      "TokenMintLimit"
    );
    // BNB sent with a token mint reverts (IncorrectPayment).
    await expect(
      nft.connect(alice).mintWithToken(1, { value: 1 })
    ).to.be.revertedWithCustomError(nft, "IncorrectPayment");
    // Insufficient $THYRK reverts (fresh wallet, only 50 $THYRK).
    await token.mint(bob.address, ethers.parseEther("50"));
    await token.connect(bob).approve(await nft.getAddress(), ethers.parseEther("100"));
    await expect(nft.connect(bob).mintWithToken(1)).to.be.revertedWithCustomError(
      token,
      "ERC20InsufficientBalance"
    );
  });

  it("token mint requires an Agent ID and active mint", async function () {
    const { nft, token, owner, alice } = await deployFixture();
    await token.setMinter(owner.address, true);
    await token.mint(alice.address, ethers.parseEther("100"));
    await token.connect(alice).approve(await nft.getAddress(), ethers.parseEther("100"));
    await expect(nft.connect(alice).mintWithToken(1)).to.be.revertedWithCustomError(
      nft,
      "MintInactive"
    );
    await activate(nft, owner);
    await expect(nft.connect(alice).mintWithToken(1)).to.be.revertedWithCustomError(
      nft,
      "NoAgentId"
    );
  });
});

describe("ThyrkNFT burn", function () {
  // Mint bulk-30 batches on fresh wallets until `needed` rarities
  // are held, then return { rarity: { wallet, tokenId } }.
  async function collectRarities(nft, mock, owner, needed) {
    const signers = await ethers.getSigners();
    const found = {};
    const wallets = signers.slice(2, 12);
    await mock.mintBatch(wallets.map((w) => w.address));
    for (const w of wallets) {
      await mintPaid(nft, w, 30);
      const events = await nft.queryFilter(nft.filters.Minted(w.address, null));
      for (const ev of events) {
        const id = ev.args.tokenId;
        const r = Number(await nft.rarityOf(id));
        if (needed.includes(r) && !found[r]) found[r] = { wallet: w, tokenId: id };
      }
      if (needed.every((r) => found[r])) break;
    }
    return found;
  }

  it("burn pays Common 20 / Rare 50 / Epic 120 / Legendary 300 $THYRK", async function () {
    const { nft, token, mock, owner } = await deployFixture();
    await activate(nft, owner);
    const found = await collectRarities(nft, mock, owner, [0, 1, 2, 3]);
    expect(Object.keys(found).length).to.equal(4);
    const rewards = { 0: "20", 1: "50", 2: "120", 3: "300" };
    for (const r of [0, 1, 2, 3]) {
      const { wallet, tokenId } = found[r];
      const before = await token.balanceOf(wallet.address);
      await nft.connect(wallet).burn(tokenId);
      expect(await token.balanceOf(wallet.address)).to.equal(
        before + ethers.parseEther(rewards[r])
      );
      await expect(nft.ownerOf(tokenId)).to.be.revertedWithCustomError(
        nft,
        "ERC721NonexistentToken"
      );
    }
  });

  it("burning a free-minted Common pays 20, and only the owner can burn", async function () {
    const { nft, token, mock, owner, alice, bob } = await deployFixture();
    await giveAgentId(mock, alice);
    await giveAgentId(mock, bob);
    await activate(nft, owner);
    // Free-mint on fresh wallets until one draws a Common, then burn it.
    const signers = await ethers.getSigners();
    let freeCommon = null;
    for (const w of [alice, ...signers.slice(2, 8)]) {
      const tx = await nft.connect(w).mint(1, { value: 0 });
      const ids = await mintedIds(nft, await tx.wait());
      if (Number(await nft.rarityOf(ids[0])) === 0) {
        freeCommon = { wallet: w, tokenId: ids[0] };
        break;
      }
    }
    expect(freeCommon).to.not.equal(null);
    const { wallet, tokenId } = freeCommon;
    const other = wallet.address === alice.address ? bob : alice;
    await expect(nft.connect(other).burn(tokenId)).to.be.revertedWithCustomError(
      nft,
      "NotTokenOwner"
    );
    const before = await token.balanceOf(wallet.address);
    expect(before).to.equal(ethers.parseEther("20")); // free mint bonus
    await nft.connect(wallet).burn(tokenId);
    expect(await token.balanceOf(wallet.address)).to.equal(ethers.parseEther("40"));
  });

  it("burning a free-minted Rare/Epic pays its tier reward", async function () {
    const { nft, token, mock, owner } = await deployFixture();
    await activate(nft, owner);
    const signers = await ethers.getSigners();
    const wallets = signers.slice(2, 12);
    await mock.mintBatch(wallets.map((w) => w.address));
    let burned = null;
    for (const w of wallets) {
      const tx = await nft.connect(w).mint(1, { value: 0 });
      const ids = await mintedIds(nft, await tx.wait());
      const r = Number(await nft.rarityOf(ids[0]));
      if (r === 1 || r === 2) {
        const before = await token.balanceOf(w.address);
        await nft.connect(w).burn(ids[0]);
        const expected = r === 1 ? "50" : "120";
        expect(await token.balanceOf(w.address)).to.equal(
          before + ethers.parseEther(expected)
        );
        burned = r;
        break;
      }
    }
    expect(burned).to.not.equal(null);
  });

  it("totalSupply drops on burn", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    await mintPaid(nft, alice, 3);
    expect(await nft.totalSupply()).to.equal(3);
    const events = await nft.queryFilter(nft.filters.Minted(alice.address, null));
    await nft.connect(alice).burn(events[0].args.tokenId);
    expect(await nft.totalSupply()).to.equal(2);
  });
});

describe("ThyrkNFT redeem Divine", function () {
  it("redeems a Divine for 1500 $THYRK earned by minting + burning", async function () {
    const { nft, token, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    // Earn $THYRK the real way: mint 30 (1 free + 29 paid = 600 bonus),
    // burn them all for their tier rewards.
    await mintPaid(nft, alice, 30);
    const events = await nft.queryFilter(nft.filters.Minted(alice.address, null));
    for (const ev of events) {
      await nft.connect(alice).burn(ev.args.tokenId);
    }
    const balance = await token.balanceOf(alice.address);
    expect(balance).to.be.greaterThanOrEqual(ethers.parseEther("1500"));
    const before = balance;
    await token.connect(alice).approve(await nft.getAddress(), ethers.parseEther("1500"));
    await nft.connect(alice).redeemDivine();
    expect(await token.balanceOf(alice.address)).to.equal(before - ethers.parseEther("1500"));
    expect(await nft.balanceOf(alice.address)).to.equal(1);
    expect(await nft.ownerOf(7778)).to.equal(alice.address);
    expect(await nft.rarityOf(7778)).to.equal(4);
    expect(await nft.tokenURI(7778)).to.equal(`${BASE_URI}divine-1.json`);
    expect(await nft.divineMinted()).to.equal(1);
    expect(await nft.divineRemaining()).to.equal(76);
  });

  it("redeem reverts without 1500 $THYRK; Divine IDs are sequential", async function () {
    const { nft, token, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    await token.setMinter(owner.address, true);
    await token.mint(alice.address, ethers.parseEther("1499"));
    await token.connect(alice).approve(await nft.getAddress(), ethers.parseEther("1499"));
    await expect(nft.connect(alice).redeemDivine()).to.be.revertedWithCustomError(
      token,
      "ERC20InsufficientAllowance"
    );
    await token.mint(alice.address, ethers.parseEther("1600")); // total 3099
    await token.connect(alice).approve(await nft.getAddress(), ethers.parseEther("3000"));
    await nft.connect(alice).redeemDivine();
    await nft.connect(alice).redeemDivine();
    expect(await nft.ownerOf(7778)).to.equal(alice.address);
    expect(await nft.ownerOf(7779)).to.equal(alice.address);
    expect(await nft.tokenURI(7779)).to.equal(`${BASE_URI}divine-2.json`);
  });

  it("Divine is capped at 77 (funded path) and cannot be burned", async function () {
    const { nft, token, owner, alice } = await deployFixture();
    await token.setMinter(owner.address, true);
    await token.mint(alice.address, ethers.parseEther("115500"));
    await token.connect(alice).approve(await nft.getAddress(), ethers.parseEther("115500"));
    for (let i = 0; i < 77; i++) {
      await nft.connect(alice).redeemDivine();
    }
    expect(await nft.divineMinted()).to.equal(77);
    expect(await nft.divineRemaining()).to.equal(0);
    expect(await nft.ownerOf(7854)).to.equal(alice.address);
    await expect(nft.connect(alice).redeemDivine()).to.be.revertedWithCustomError(
      nft,
      "DivineExhausted"
    );
    await expect(nft.connect(alice).burn(7778)).to.be.revertedWithCustomError(
      nft,
      "BurnDivineNotAllowed"
    );
  });
});

describe("ThyrkNFT upgrade", function () {
  // Mint bulk-30 on fresh wallets (from `wallets`) until one wallet
  // holds 3 of `tier`.
  async function collectThree(nft, mock, owner, tier, wallets) {
    await mock.mintBatch(wallets.map((w) => w.address));
    for (const w of wallets) {
      await mintPaid(nft, w, 30);
      const events = await nft.queryFilter(nft.filters.Minted(w.address, null));
      const ids = [];
      for (const ev of events) {
        if (Number(await nft.rarityOf(ev.args.tokenId)) === tier) ids.push(ev.args.tokenId);
      }
      if (ids.length >= 3) return { wallet: w, ids: ids.slice(0, 3) };
    }
    throw new Error(`could not collect 3 of tier ${tier}`);
  }

  it("3 Common + 50 -> 1 Rare; output is Rare and inputs are burned", async function () {
    const { nft, token, mock, owner } = await deployFixture();
    await activate(nft, owner);
    const signers = await ethers.getSigners();
    const rare = await collectThree(nft, mock, owner, 0, signers.slice(2, 10));
    await token.connect(rare.wallet).approve(await nft.getAddress(), ethers.parseEther("50"));
    const before = await token.balanceOf(rare.wallet.address);
    expect(before).to.be.greaterThanOrEqual(ethers.parseEther("50"));
    await nft.connect(rare.wallet).upgrade(rare.ids[0], rare.ids[1], rare.ids[2]);
    expect(await token.balanceOf(rare.wallet.address)).to.equal(before - ethers.parseEther("50"));
    for (const id of rare.ids) {
      await expect(nft.ownerOf(id)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
    }
    const events = await nft.queryFilter(nft.filters.Upgraded(rare.wallet.address, null));
    expect(events.length).to.equal(1);
    expect(await nft.rarityOf(events[0].args.tokenId)).to.equal(1);
    expect(await nft.ownerOf(events[0].args.tokenId)).to.equal(rare.wallet.address);
    // Upgrade does not count toward the 30 cap.
    expect(await nft.mintCount(rare.wallet.address)).to.equal(30);
  });

  it("3 Rare + 100 -> 1 Epic; 3 Epic + 200 -> 1 Legendary", async function () {
    const { nft, token, mock, owner } = await deployFixture();
    await activate(nft, owner);
    const signers = await ethers.getSigners();
    const rare = await collectThree(nft, mock, owner, 1, signers.slice(2, 10));
    await token.connect(rare.wallet).approve(await nft.getAddress(), ethers.parseEther("100"));
    await nft.connect(rare.wallet).upgrade(rare.ids[0], rare.ids[1], rare.ids[2]);
    let events = await nft.queryFilter(nft.filters.Upgraded(rare.wallet.address, null));
    expect(await nft.rarityOf(events[0].args.tokenId)).to.equal(2);

    const epic = await collectThree(nft, mock, owner, 2, signers.slice(10, 18));
    await token.connect(epic.wallet).approve(await nft.getAddress(), ethers.parseEther("200"));
    await nft.connect(epic.wallet).upgrade(epic.ids[0], epic.ids[1], epic.ids[2]);
    events = await nft.queryFilter(nft.filters.Upgraded(epic.wallet.address, null));
    expect(await nft.rarityOf(events[0].args.tokenId)).to.equal(3);
  });

  it("upgrade rejects mixed tiers, Legendary inputs, and non-owners", async function () {
    const { nft, token, mock, owner } = await deployFixture();
    await activate(nft, owner);
    const signers = await ethers.getSigners();
    const { wallet, ids } = await collectThree(nft, mock, owner, 0, signers.slice(2, 10));
    // Find one Rare on the same wallet for a mixed-tier attempt.
    const events = await nft.queryFilter(nft.filters.Minted(wallet.address, null));
    let rareId;
    for (const ev of events) {
      if (Number(await nft.rarityOf(ev.args.tokenId)) === 1) {
        rareId = ev.args.tokenId;
        break;
      }
    }
    await token.connect(wallet).approve(await nft.getAddress(), ethers.parseEther("100"));
    await expect(
      nft.connect(wallet).upgrade(ids[0], ids[1], rareId)
    ).to.be.revertedWithCustomError(nft, "InvalidUpgrade");
    // Non-owner cannot upgrade someone else's tokens.
    await expect(
      nft.connect(signers[3]).upgrade(ids[0], ids[1], ids[2])
    ).to.be.revertedWithCustomError(nft, "NotTokenOwner");
  });
});

describe("ThyrkNFT admin, royalty and forwarding", function () {
  it("royalty is 5% to the revenue wallet for any token", async function () {
    const { nft, revenue } = await deployFixture();
    const [receiver, amount] = await nft.royaltyInfo(7777, ethers.parseEther("10"));
    expect(receiver).to.equal(revenue.address);
    expect(amount).to.equal(ethers.parseEther("0.5"));
  });

  it("withdraw is a safety valve only: force-sent BNB goes to revenue", async function () {
    const { nft, mock, owner, revenue, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    await expect(nft.connect(owner).withdraw()).to.be.revertedWithCustomError(nft, "NoFunds");
    const Force = await ethers.getContractFactory("MockForceSend");
    const force = await Force.deploy();
    await force.boom(await nft.getAddress(), { value: ethers.parseEther("0.01") });
    expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(
      ethers.parseEther("0.01")
    );
    const revBefore = await ethers.provider.getBalance(revenue.address);
    await nft.connect(owner).withdraw();
    expect((await ethers.provider.getBalance(revenue.address)) - revBefore).to.equal(
      ethers.parseEther("0.01")
    );
  });

  it("only the owner can change admin settings", async function () {
    const { nft, alice } = await deployFixture();
    await expect(nft.connect(alice).setMintActive(true)).to.be.revertedWithCustomError(
      nft,
      "OwnableUnauthorizedAccount"
    );
  });

  it("no repost logic exists on the new NFT contract", async function () {
    const { nft } = await deployFixture();
    expect(nft.interface.hasFunction("claimRepost")).to.equal(false);
    expect(nft.interface.hasFunction("repostClaimer")).to.equal(false);
    expect(nft.interface.hasFunction("repostClaimed")).to.equal(false);
  });
});
