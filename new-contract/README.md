# THYRK — Replacement NFT Contract

New `ThyrkNFT` contract replacing v1
(`0xeff20913f99fd153da1b27bd96401089d3323bb8`, CLOSED, final 21 mints).
Same name/symbol **THYRK** — no "v2" label anywhere. Same artwork,
same deck, same baseURI, same `$THYRK` token (reused, no new token).

**Nothing in this folder deploys to any live network.** The deploy
script only prints the plan. Deployment is manual, by Bryan from
My Wallet.

## What changed vs v1

| Rule | v1 | This contract |
|---|---|---|
| Free mint | Choice (`useFree` flag), Common only, 777 total | **Automatic**: first `mint()` call per wallet includes 1 free mint; no flag, no total cap |
| Free draw | Common only | **Full deck incl. Legendary** — same draw as paid (Bryan, 23:30 WIB 9 Nov 2026: free Legendary is a lure; Divine sits above Legendary) |
| Free-mint bonus | 0 $THYRK | **20 $THYRK**, like a paid mint |
| Price ladder | #1–10: 0.0002, #11–20: 0.0004, #21–30: 0.0008 | #1 **FREE** (automatic), #2–10: 0.0002, #11–20: 0.0004, #21–30: 0.0008 |
| Bulk 30 cost | 0.014 BNB (0.0132 with free on the most expensive slot) | **0.0138 BNB** (1 free + 29 paid; free is the FIRST slot) |
| Owner / revenue | Both = Agentic Wallet | Owner = **My Wallet** `0x0262e8e5E4584D8AB840fD950a6E2E0A414d4097`, revenue + 5% royalty = **Agentic** `0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7` |
| Repost | (reward lived in the token) | **No repost logic anywhere** in this contract |
| Free-mint reserve | Paid draws protected 777 Commons | Gone — no reserved free supply |

## Unchanged from v1

Supply 7,777 (Common 4,000 / Rare 2,500 / Epic 1,000 / Legendary 277),
Divine 77 separate (IDs 7,778–7,854, redeem-only), max 30/wallet,
bulk up to 30 in 1 tx, SPACE ID Agent ID gate
(registry `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`), NoContracts,
burn Common 20 / Rare 50 / Epic 120 / Legendary 300 (Divine cannot
burn; free-minted tokens burn for their tier reward), Divine redeem
1,500 $THYRK FCFS, token-mint 100 $THYRK = 1 mint max 3/wallet
(no BNB, no 20 bonus, counts to the 30 cap), upgrade 3 Common + 50
→ Rare, 3 Rare + 100 → Epic, 3 Epic + 200 → Legendary (stops at
Legendary; output not counted to the 30 cap), `mintActive` default
false, royalty 5% (ERC-2981) to Agentic, direct payment forwarding.

## Resolved ambiguities (also documented in the contract header)

- **Token-mint does NOT consume the free mint.** The free mint
  applies on the first `mint()` (BNB) call only.
- **Ladder position is by total `mintCount`** (all mints incl.
  token-mints). E.g. 3 token-mints → first `mint()` call is still
  free; the next paid slot costs `priceForCount(4)` = 0.0002 BNB.
- **`priceFor(wallet)` returns 0 while the free mint is unused**
  (the next mint costs 0); `quoteBulk(wallet, quantity)` returns
  the exact batch price with the free slot at batch index 0
  (`freeSlot = 0`, or `type(uint256).max` once used).
- **The free slot is the FIRST slot of the batch**, never the most
  expensive one — that is what makes bulk-30 cost 0.0138 BNB.
- **End-of-deck edge case: GONE.** The free draw uses the full
  deck, so a free mint can draw whatever remains — including a
  Legendary when only Legendaries are left. No `NoDrawableToken`
  case for free mints; the only end-of-supply revert is `SoldOut`.
  (The earlier edge case existed only under the reversed
  NEVER-Legendary rule; it disappeared with that rule on
  23:30 WIB 9 Nov 2026.)

## Files

- `contracts/ThyrkNFT.sol` — the new contract (only production file)
- `contracts/ThyrkToken.sol` — copy of the v1 token source, **test-only**
  (mainnet reuses the deployed `0x3b8747d067b2ed8565330667128260c2a4954300`)
- `contracts/mocks/MockAgentIdRegistry.sol` — test-only mock (copy from v1)
- `test/ThyrkNew.test.js` — full suite, **42 tests, all passing**
- `scripts/deploy.js` — print-only deployment plan (deploys nothing)
- `scripts/measure-deploy-gas.js` — local deploy-gas measurement
- `hardhat.config.js`, `package.json` — Hardhat 2.24.3, ethers 6.13.2,
  OpenZeppelin 5.4.0, solc 0.8.24, optimizer runs 200, evmVersion cancun

Deck inputs are read from `../collection/manifest.json` and
`../collection/rarity-bitmap.json` (shared with v1, not copied).
`deckHash` must equal
`0x592a9180d7c57fa9c609176c204e8c4950ee20d7d13c5705c0227516e97e8233`
— verified by the tests and both scripts.

## How to test

```bash
cd ~/workspace/projects/thyrk/new-contract
npm install
npx hardhat compile   # clean, solc 0.8.24
npx hardhat test      # 42 passing
npx hardhat run scripts/measure-deploy-gas.js
npx hardhat run scripts/deploy.js   # prints the plan only
```

Test coverage includes: automatic free first mint (1/wallet,
unlimited total), free draw CAN yield Legendary (300 free draws
across wallets: Common 162 / Rare 100 / Epic 29 / Legendary 9 —
deterministic deck order), bulk-30 pricing = 0.0138 BNB exactly,
20 $THYRK bonus on free AND paid mints, Agent ID gate (reverts
without, works with), NoContracts, max 30/wallet (31st reverts),
burn table (all four tiers + Divine reverts + free Common burns
for 20 + free Rare/Epic burn for tier reward), Divine redeem
(1,500, FCFS, remaining decreases, 77 cap), token-mint (100 token,
no bonus, max 3/wallet, counts to 30 cap, does NOT consume the
free mint), upgrade chain (all three steps, stops at Legendary,
output not counted to cap), royalty 5% to Agentic, owner/revenue
addresses, `mintActive` default false, deckHash match, no repost
logic on the contract.

## Deploy gas (local Hardhat measurement, real deckHash + bitmap)

| Step | gasUsed | @ 0.05 gwei | @ 0.1 gwei | @ 1 gwei |
|---|---|---|---|---|
| ThyrkNFT deploy | 4,809,915 | 0.0002405 BNB | 0.0004810 BNB | 0.0048099 BNB |
| `setMinter(nft, true)` (on existing token) | 47,810 | 0.0000024 BNB | 0.0000048 BNB | 0.0000478 BNB |
| `setMintActive(true)` activation | 29,921 | 0.0000015 BNB | 0.0000030 BNB | 0.0000299 BNB |
| **Total (no token deploy)** | **4,887,646** | **0.0002444 BNB** | **0.0004888 BNB** | **0.0048876 BNB** |

Creation bytecode 15,664 bytes; runtime 13,891 bytes. Top-up
recommendation: ~0.001 BNB in the deployer (My Wallet).

## How to deploy (manual, by Bryan from My Wallet)

1. `npx hardhat run scripts/deploy.js` — check the printed plan
   (constructor args, deckHash, addresses).
2. Deploy **only** `ThyrkNFT` from My Wallet via the deploy page
   (or Hardhat with his own key). Do NOT deploy a new token.
3. Verify source on BscScan (solc 0.8.24, optimizer runs 200, cancun).
4. On the EXISTING $THYRK token
   (`0x3b8747d067b2ed8565330667128260c2a4954300`), call
   `setMinter(<NEW_NFT_ADDRESS>, true)` from the token owner.
   Until then, mint / burn / upgrade revert (NFT is not a minter).
5. Sanity-check on-chain: `deckHash`, `owner()` = My Wallet,
   `revenueWallet()` = Agentic, `royaltyInfo` 5% to Agentic,
   `mintActive()` false, `currentPrice()` for a fresh wallet = 0.
6. ONLY at launch, when Bryan says so: `setMintActive(true)`
   from My Wallet.
7. Update the site config to the NEW NFT address; keep v1 listed
   as closed/final (21 mints) — v1 holders keep their v1 NFTs.
