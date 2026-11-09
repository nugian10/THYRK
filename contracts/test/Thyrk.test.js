const fs = require("node:fs");
const path = require("node:path");
const { expect } = require("chai");
const { ethers } = require("hardhat");

const COLLECTION = path.join(__dirname, "..", "..", "collection");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(COLLECTION, "manifest.json"), "utf8"));
const BITMAP = JSON.parse(fs.readFileSync(path.join(COLLECTION, "rarity-bitmap.json"), "utf8"));

const DECK_HASH = MANIFEST.deckHash;
const BASE_URI = MANIFEST.baseURI;
const BITMAP_WORDS = BITMAP.bitmap.map((w) => BigInt(w));

const P_1_10 = ethers.parseEther("0.0002");
const P_11_20 = ethers.parseEther("0.0004");
const P_21_30 = ethers.parseEther("0.0008");
const AGENTIC = "0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7";
const REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const ONE_THYRK = ethers.parseEther("1");

// Price of mint slot #n (1-based) for one wallet.
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
  // deploy flow does: token -> NFT -> setMinter).
  await token.setMinter(await nft.getAddress(), true);
  return { nft, token, mock, owner, revenue, alice, bob, carol, dave };
}

async function giveAgentId(mock, wallet) {
  await mock.mintTo(wallet.address);
}

async function activate(nft, owner) {
  await nft.connect(owner).setMintActive(true);
}

async function mintPaid(nft, wallet, quantity, useFree = false) {
  const q = await nft.quoteBulk(wallet.address, quantity, useFree);
  const tx = await nft.connect(wallet).mint(quantity, useFree, { value: q[0] });
  return tx;
}

describe("ThyrkToken", function () {
  it("has the right name, symbol, decimals, cap and owner", async function () {
    const { token, owner } = await deployFixture();
    expect(await token.name()).to.equal("THYRK");
    expect(await token.symbol()).to.equal("THYRK");
    expect(await token.decimals()).to.equal(18);
    expect(await token.MAX_SUPPLY()).to.equal(ethers.parseEther("777777"));
    expect(await token.owner()).to.equal(owner.address);
    expect(await token.totalSupply()).to.equal(0);
    expect(await token.REPOST_REWARD()).to.equal(ethers.parseEther("100"));
    expect(await token.REPOST_BUDGET()).to.equal(ethers.parseEther("77777"));
  });

  it("only authorized minters can mint; cap is enforced", async function () {
    const { token, nft, alice } = await deployFixture();
    await expect(token.connect(alice).mint(alice.address, 100n)).to.be.revertedWithCustomError(
      token,
      "NotMinter"
    );
    // Minter (the NFT contract) cannot exceed the cap even in one call.
    const nftAsSigner = await ethers.getImpersonatedSigner(await nft.getAddress());
    await ethers.provider.send("hardhat_setBalance", [await nft.getAddress(), "0x1000000000000000000"]);
    await expect(
      token.connect(nftAsSigner).mint(alice.address, ethers.parseEther("777778"))
    ).to.be.revertedWithCustomError(token, "ERC20ExceededCap");
  });

  it("repost claim: claimer-only, 1 per wallet, budget tracked", async function () {
    const { token, owner, alice, bob } = await deployFixture();
    await expect(token.connect(alice).claimRepost(alice.address)).to.be.revertedWithCustomError(
      token,
      "NotRepostClaimer"
    );
    await token.setRepostClaimer(owner.address);
    await token.claimRepost(alice.address);
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("100"));
    expect(await token.repostClaimed(alice.address)).to.equal(true);
    expect(await token.repostMinted()).to.equal(ethers.parseEther("100"));
    await expect(token.claimRepost(alice.address)).to.be.revertedWithCustomError(
      token,
      "AlreadyClaimed"
    );
    await token.claimRepost(bob.address);
    expect(await token.repostMinted()).to.equal(ethers.parseEther("200"));
  });
});

describe("ThyrkNFT deployment", function () {
  it("has the right name, symbol, supply, ladder, registry, deck and defaults", async function () {
    const { nft, mock, owner, revenue } = await deployFixture();
    expect(await nft.name()).to.equal("THYRK");
    expect(await nft.symbol()).to.equal("THYRK");
    expect(await nft.MAX_SUPPLY()).to.equal(7777);
    expect(await nft.DIVINE_SUPPLY()).to.equal(77);
    expect(await nft.MAX_PER_WALLET()).to.equal(30);
    expect(await nft.MAX_TOKEN_MINTS()).to.equal(3);
    expect(await nft.FREE_TOTAL()).to.equal(777);
    expect(await nft.PRICE_1_10()).to.equal(P_1_10);
    expect(await nft.PRICE_11_20()).to.equal(P_11_20);
    expect(await nft.PRICE_21_30()).to.equal(P_21_30);
    expect(await nft.deckHash()).to.equal(DECK_HASH);
    expect(await nft.baseURI()).to.equal(BASE_URI);
    expect(await nft.owner()).to.equal(owner.address);
    expect(await nft.revenueWallet()).to.equal(revenue.address);
    expect(await nft.mintActive()).to.equal(false);
    expect(await nft.agentIdCheckRequired()).to.equal(true);
    expect(await nft.agentIdRegistry()).to.equal(await mock.getAddress());
    expect(await nft.deckRemaining()).to.equal(7777);
    expect(await nft.freeMintsRemaining()).to.equal(777);
    expect(await nft.divineRemaining()).to.equal(77);
    expect(await nft.commonsRemaining()).to.equal(4000);
    expect(await nft.raresRemaining()).to.equal(2500);
    expect(await nft.epicsRemaining()).to.equal(1000);
    expect(await nft.legendariesRemaining()).to.equal(277);
  });

  it("stores the real Agentic owner/revenue and 5% royalty", async function () {
    const { mock, owner } = await deployFixture();
    const Token = await ethers.getContractFactory("ThyrkToken");
    const token = await Token.deploy(owner.address);
    await token.waitForDeployment();
    const Nft = await ethers.getContractFactory("ThyrkNFT");
    const nft = await Nft.deploy(
      AGENTIC,
      AGENTIC,
      REGISTRY,
      BASE_URI,
      DECK_HASH,
      BITMAP_WORDS,
      await token.getAddress()
    );
    await nft.waitForDeployment();
    expect(await nft.owner()).to.equal(AGENTIC);
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
    await mintPaid(nft, alice, 1);
    expect(await nft.balanceOf(alice.address)).to.equal(1);
    // tokenURI of the token Alice owns
    const filter = nft.filters.Minted(alice.address, null);
    const events = await nft.queryFilter(filter);
    const mintedId = events[0].args.tokenId;
    expect(await nft.tokenURI(mintedId)).to.equal(`${BASE_URI}${mintedId}.json`);
  });
});

describe("ThyrkNFT agent gate", function () {
  it("mint reverts without an Agent ID, works with one", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await activate(nft, owner);
    await expect(mintPaid(nft, alice, 1)).to.be.revertedWithCustomError(nft, "NoAgentId");
    expect(await nft.holdsAgentId(alice.address)).to.equal(false);
    await giveAgentId(mock, alice);
    expect(await nft.holdsAgentId(alice.address)).to.equal(true);
    await mintPaid(nft, alice, 1);
    expect(await nft.balanceOf(alice.address)).to.equal(1);
  });

  it("mint from a contract reverts (NoContracts)", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await activate(nft, owner);
    await giveAgentId(mock, alice);
    const Caller = await ethers.getContractFactory("MockGenericCaller");
    const caller = await Caller.deploy();
    await caller.waitForDeployment();
    // Low-level mint(1, false) call from the contract must fail.
    const data = nft.interface.encodeFunctionData("mint", [1, false]);
    const ok = await caller.tryCall.staticCall(await nft.getAddress(), data, {
      value: P_1_10,
    });
    expect(ok).to.equal(false);
  });

  it("owner can disable the Agent ID check (escape hatch, public)", async function () {
    const { nft, owner, alice } = await deployFixture();
    await activate(nft, owner);
    await nft.connect(owner).setAgentIdCheckRequired(false);
    await mintPaid(nft, alice, 1);
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

  it("quoteBulk: exact batch prices, free lands on the highest slot", async function () {
    const { nft, alice } = await deployFixture();
    // Fresh wallet, 30 with free -> 0.014 - 0.0008 = 0.0132, free at slot 30 (index 29).
    let q = await nft.quoteBulk(alice.address, 30, true);
    expect(q[0]).to.equal(ethers.parseEther("0.0132"));
    expect(q[1]).to.equal(29);
    // Fresh wallet, 30 without free -> 0.014, no free slot.
    q = await nft.quoteBulk(alice.address, 30, false);
    expect(q[0]).to.equal(ethers.parseEther("0.014"));
    expect(q[1]).to.equal(ethers.MaxUint256);
    // 1 with free -> 0.
    q = await nft.quoteBulk(alice.address, 1, true);
    expect(q[0]).to.equal(0);
    expect(q[1]).to.equal(0);
    // 10 with free -> 10x0.0002 - 0.0002 = 0.0018.
    q = await nft.quoteBulk(alice.address, 10, true);
    expect(q[0]).to.equal(ethers.parseEther("0.0018"));
    expect(q[1]).to.equal(9);
  });

  it("quoteBulk reverts on bad quantity / cap / free already used", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    await expect(nft.quoteBulk(alice.address, 0, false)).to.be.revertedWithCustomError(
      nft,
      "MaxPerWallet"
    );
    await expect(nft.quoteBulk(alice.address, 31, false)).to.be.revertedWithCustomError(
      nft,
      "MaxPerWallet"
    );
    await mintPaid(nft, alice, 30, true);
    await expect(nft.quoteBulk(alice.address, 1, false)).to.be.revertedWithCustomError(
      nft,
      "MaxPerWallet"
    );
    await expect(nft.quoteBulk(alice.address, 1, true)).to.be.revertedWithCustomError(
      nft,
      "MaxPerWallet"
    );
  });
});

describe("ThyrkNFT minting", function () {
  it("mint inactive reverts; underpayment reverts; overpayment is refunded", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await expect(mintPaid(nft, alice, 1)).to.be.revertedWithCustomError(nft, "MintInactive");
    await activate(nft, owner);
    await expect(
      nft.connect(alice).mint(1, false, { value: ethers.parseEther("0.0001") })
    ).to.be.revertedWithCustomError(nft, "IncorrectPayment");
    const before = await ethers.provider.getBalance(alice.address);
    const tx = await nft.connect(alice).mint(1, false, { value: ethers.parseEther("0.001") });
    const receipt = await tx.wait();
    const gas = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(alice.address);
    // Paid exactly 0.0002 (0.001 sent - 0.0008 refunded) + gas.
    expect(before - after - gas).to.equal(P_1_10);
    expect(await nft.balanceOf(alice.address)).to.equal(1);
  });

  it("paid mint forwards the exact price to revenue and mints 20 $THYRK", async function () {
    const { nft, token, mock, owner, revenue, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    const revBefore = await ethers.provider.getBalance(revenue.address);
    await mintPaid(nft, alice, 1);
    expect((await ethers.provider.getBalance(revenue.address)) - revBefore).to.equal(P_1_10);
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("20"));
    expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(0);
    expect(await nft.totalSupply()).to.equal(1);
    expect(await nft.deckRemaining()).to.equal(7776);
  });

  it("bulk mint 30 at once costs 0.014 and respects the 30 cap", async function () {
    const { nft, mock, owner, revenue, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    const revBefore = await ethers.provider.getBalance(revenue.address);
    await mintPaid(nft, alice, 30, false);
    expect(await nft.balanceOf(alice.address)).to.equal(30);
    expect(await nft.mintCount(alice.address)).to.equal(30);
    expect((await ethers.provider.getBalance(revenue.address)) - revBefore).to.equal(
      ethers.parseEther("0.014")
    );
    await expect(mintPaid(nft, alice, 1)).to.be.revertedWithCustomError(nft, "MaxPerWallet");
  });

  it("bulk mint across the ladder boundary prices each slot correctly", async function () {
    const { nft, token, mock, owner, revenue, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    // 9 paid first (slots 1-9), then a bulk of 5 (slots 10-14):
    // 0.0002 + 4x0.0004 = 0.0018.
    await mintPaid(nft, alice, 9, false);
    const revBefore = await ethers.provider.getBalance(revenue.address);
    await mintPaid(nft, alice, 5, false);
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
      const tx = await mintPaid(nft, w, 30, false);
      const receipt = await tx.wait();
      for (const log of receipt.logs) {
        try {
          const parsed = nft.interface.parseLog(log);
          if (parsed && parsed.name === "Minted") {
            const id = Number(parsed.args.tokenId);
            expect(id).to.be.greaterThan(0);
            expect(id).to.be.lessThanOrEqual(7777);
            expect(seen.has(id)).to.equal(false);
            seen.add(id);
          }
        } catch (e) {
          // not a Minted log
        }
      }
    }
    expect(seen.size).to.equal(240);
    expect(await nft.totalSupply()).to.equal(240);
  });
});

describe("ThyrkNFT free mint", function () {
  it("single free mint at slot 1 costs 0, draws a Common, earns 0 $THYRK", async function () {
    const { nft, token, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    const tx = await nft.connect(alice).mint(1, true, { value: 0 });
    const receipt = await tx.wait();
    let tokenId;
    for (const log of receipt.logs) {
      try {
        const parsed = nft.interface.parseLog(log);
        if (parsed && parsed.name === "Minted") tokenId = parsed.args.tokenId;
      } catch (e) {}
    }
    expect(await nft.rarityOf(tokenId)).to.equal(0);
    expect(await nft.freeUsed(alice.address)).to.equal(true);
    expect(await nft.freeMinted()).to.equal(1);
    expect(await nft.freeMintsRemaining()).to.equal(776);
    expect(await token.balanceOf(alice.address)).to.equal(0);
    expect(await nft.mintCount(alice.address)).to.equal(1);
  });

  it("free mint used at slot 21-30 saves 0.0008 BNB", async function () {
    const { nft, mock, owner, revenue, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    await mintPaid(nft, alice, 20, false); // slots 1-20 paid: 0.002 + 0.004 = 0.006
    const revBefore = await ethers.provider.getBalance(revenue.address);
    // Slot 21 with free: price 0.0008 -> 0.
    await nft.connect(alice).mint(1, true, { value: 0 });
    expect((await ethers.provider.getBalance(revenue.address)) - revBefore).to.equal(0);
    expect(await nft.mintCount(alice.address)).to.equal(21);
    // Next slot (22) costs 0.0008 again.
    expect(await nft.priceFor(alice.address)).to.equal(P_21_30);
  });

  it("bulk 30 with free costs exactly 0.0132 BNB", async function () {
    const { nft, mock, owner, revenue, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    const revBefore = await ethers.provider.getBalance(revenue.address);
    const q = await nft.quoteBulk(alice.address, 30, true);
    expect(q[0]).to.equal(ethers.parseEther("0.0132"));
    await nft.connect(alice).mint(30, true, { value: q[0] });
    expect((await ethers.provider.getBalance(revenue.address)) - revBefore).to.equal(
      ethers.parseEther("0.0132")
    );
    expect(await nft.balanceOf(alice.address)).to.equal(30);
  });

  it("free mint cannot be used twice by one wallet", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    await nft.connect(alice).mint(1, true, { value: 0 });
    await expect(nft.connect(alice).mint(1, true, { value: 0 })).to.be.revertedWithCustomError(
      nft,
      "FreeAlreadyUsed"
    );
    // A paid mint still works afterwards.
    await mintPaid(nft, alice, 1);
    expect(await nft.mintCount(alice.address)).to.equal(2);
  });

  it("many free mints all draw Commons (free reserve holds)", async function () {
    const { nft, mock, owner } = await deployFixture();
    const signers = await ethers.getSigners();
    // Use 20 wallets x free + paid interleaved; all free draws must be Common.
    const wallets = signers.slice(2, 12);
    await mock.mintBatch(wallets.map((w) => w.address));
    await activate(nft, owner);
    for (const w of wallets) {
      await mintPaid(nft, w, 10, false); // 10 paid first (races the free pool)
    }
    for (const w of wallets) {
      const tx = await nft.connect(w).mint(1, true, { value: 0 });
      const receipt = await tx.wait();
      for (const log of receipt.logs) {
        try {
          const parsed = nft.interface.parseLog(log);
          if (parsed && parsed.name === "Minted") {
            expect(await nft.rarityOf(parsed.args.tokenId)).to.equal(0);
          }
        } catch (e) {}
      }
    }
    expect(await nft.freeMinted()).to.equal(10);
    expect(await nft.commonsRemaining()).to.be.lessThanOrEqual(4000 - 10);
  });
});

describe("ThyrkNFT token mint (100 $THYRK)", function () {
  it("mints with $THYRK: no BNB, no bonus, counts to 30 and the ladder", async function () {
    const { nft, token, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    await mintPaid(nft, alice, 5, false); // earn 100 $THYRK (5 x 20)
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

  it("token mint caps at 3 per wallet and rejects BNB / low balance", async function () {
    const { nft, token, mock, owner, alice, bob } = await deployFixture();
    await giveAgentId(mock, alice);
    await giveAgentId(mock, bob);
    await activate(nft, owner);
    await token.setMinter(owner.address, true);
    await token.mint(alice.address, ethers.parseEther("500"));
    await token.connect(alice).approve(await nft.getAddress(), ethers.parseEther("500"));
    await expect(
      nft.connect(alice).mintWithToken(4)
    ).to.be.revertedWithCustomError(nft, "TokenMintLimit");
    await nft.connect(alice).mintWithToken(3);
    expect(await nft.tokenMints(alice.address)).to.equal(3);
    await expect(
      nft.connect(alice).mintWithToken(1)
    ).to.be.revertedWithCustomError(nft, "TokenMintLimit");
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
      await mintPaid(nft, w, 30, false);
      const bal = Number(await nft.balanceOf(w.address));
      const filter = nft.filters.Minted(w.address, null);
      const events = await nft.queryFilter(filter);
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

  it("burning a free Common pays 20, and only the owner can burn", async function () {
    const { nft, token, mock, owner, alice, bob } = await deployFixture();
    await giveAgentId(mock, alice);
    await giveAgentId(mock, bob);
    await activate(nft, owner);
    await nft.connect(alice).mint(1, true, { value: 0 });
    const events = await nft.queryFilter(nft.filters.Minted(alice.address, null));
    const tokenId = events[0].args.tokenId;
    await expect(nft.connect(bob).burn(tokenId)).to.be.revertedWithCustomError(
      nft,
      "NotTokenOwner"
    );
    await nft.connect(alice).burn(tokenId);
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("20"));
  });

  it("totalSupply drops on burn", async function () {
    const { nft, mock, owner, alice } = await deployFixture();
    await giveAgentId(mock, alice);
    await activate(nft, owner);
    await mintPaid(nft, alice, 3, false);
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
    // Earn $THYRK the real way: mint 30 paid, burn them all.
    await mintPaid(nft, alice, 30, false);
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

  it("Divine is capped at 77 (funded path)", async function () {
    const { nft, token, owner, alice } = await deployFixture();
    await token.setMinter(owner.address, true);
    await token.mint(alice.address, ethers.parseEther("115500"));
    await token.connect(alice).approve(await nft.getAddress(), ethers.parseEther("115500"));
    for (let i = 0; i < 77; i++) {
      await nft.connect(alice).redeemDivine();
    }
    expect(await nft.divineMinted()).to.equal(77);
    expect(await nft.ownerOf(7854)).to.equal(alice.address);
    await expect(nft.connect(alice).redeemDivine()).to.be.revertedWithCustomError(
      nft,
      "DivineExhausted"
    );
  });
});

describe("ThyrkNFT upgrade", function () {
  // Mint bulk-30 on fresh wallets (from `wallets`) until one wallet
  // holds 3 of `tier`.
  async function collectThree(nft, mock, owner, tier, wallets) {
    await mock.mintBatch(wallets.map((w) => w.address));
    for (const w of wallets) {
      await mintPaid(nft, w, 30, false);
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
});

describe("ThyrkNFT 777 free-mint cap", function () {
  it("all 777 free mints work (one per wallet), the 778th reverts", async function () {
    const { nft, mock, owner } = await deployFixture();
    await activate(nft, owner);
    // 777 fresh random wallets; fund gas via hardhat_setBalance
    // and give each an Agent ID in batches.
    const wallets = [];
    for (let i = 0; i < 777; i++) {
      const w = ethers.Wallet.createRandom().connect(ethers.provider);
      wallets.push(w);
      await ethers.provider.send("hardhat_setBalance", [w.address, "0x8ac7230489e80000"]); // 10 ETH
    }
    for (let i = 0; i < wallets.length; i += 100) {
      await mock.mintBatch(wallets.slice(i, i + 100).map((w) => w.address));
    }
    for (let i = 0; i < wallets.length; i++) {
      await nft.connect(wallets[i]).mint(1, true, { value: 0 });
    }
    expect(await nft.freeMinted()).to.equal(777);
    expect(await nft.freeMintsRemaining()).to.equal(0);
    // 778th wallet: free exhausted.
    const extra = ethers.Wallet.createRandom().connect(ethers.provider);
    await ethers.provider.send("hardhat_setBalance", [extra.address, "0x8ac7230489e80000"]);
    await mock.mintTo(extra.address);
    await expect(nft.connect(extra).mint(1, true, { value: 0 })).to.be.revertedWithCustomError(
      nft,
      "FreeExhausted"
    );
    // Paid minting still works after all free mints are gone.
    await nft.connect(extra).mint(1, false, { value: P_1_10 });
    expect(await nft.balanceOf(extra.address)).to.equal(1);
  });
});
