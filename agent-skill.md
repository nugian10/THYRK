# THYRK: mint skill

> STATUS: NEW CONTRACT NOT YET DEPLOYED — minting is NOT YET OPEN.
> Do NOT attempt to mint. The new THYRK NFT contract has been built
> and tested, but it has not been deployed to BNB Chain yet and
> mintActive is not on. This skill describes the NEW contract so an
> agent is ready the moment it deploys. Until then, every mint, burn,
> redeem, upgrade and token-mint call will fail — there is no live NFT
> contract to call.

For Binance Agentic Wallet agents. Mint THYRK knight NFTs (THYRK) on BNB
Chain for your user. THYRK is a 7,777-token collection of original
knight characters: Common 4,000, Rare 2,500, Epic 1,000, Legendary 277.
Plus Divine: 77 unique 1-of-1 knights, NOT mintable — only redeemed
with $THYRK. Site: https://thyrk.fun/

## Contracts (BNB Chain, chain id 56)

- THYRK NFT (THYRK): 0x0000000000000000000000000000000000000000 —
  TODO: FILL AFTER DEPLOY. The new contract is NOT yet deployed.
  Do not use any other address as the NFT contract.
- $THYRK token: 0x3b8747d067b2ed8565330667128260c2a4954300 — DEPLOYED
  (BscScan: https://bscscan.com/address/0x3b8747d067b2ed8565330667128260c2a4954300).
  No $THYRK exists yet (totalSupply is 0) — it is earned by mints
  and burns once the new NFT contract is live. The new NFT contract
  must be set as a minter on the token contract (setMinter) before
  any mint, burn, redeem, upgrade or token-mint can work.
- SPACE ID Agent ID registry: 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F
- Owner: Bryan's My Wallet 0x0262e8e5E4584D8AB840fD950a6E2E0A414d4097
- Revenue: Binance Agentic Wallet 0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7. Mint payments are forwarded directly
  to it in the same transaction (they never sit in the contract).

## Facts

- Supply: 7,777 mintable NFTs, token IDs 1 to 7,777, drawn from a
  shuffled deck (deckHash() selector 0x8830dea2, deckHash
  0x592a9180d7c57fa9c609176c204e8c4950ee20d7d13c5705c0227516e97e8233).
  Common, Rare and Epic each have 5 designs; Legendary is trait-random
  (base knight plus helmet, weapon, cape, aura and shield combined).
  Divine token IDs 7778 to 7854, revealed only to the owner — never
  shown on the site.
- Mint: `mint(uint256 quantity)` (selector 0xa0712d68). One call mints
  `quantity` knights (1 to 30, up to the wallet's remaining limit) —
  bulk mint in a single transaction. There is no free-mint argument:
  the free mint is AUTOMATIC. Send exactly the quoted total value;
  any overpayment is refunded automatically by the contract.
- Price ladder per wallet: mint #1 FREE, #2-10: 0.0002 BNB, #11-20:
  0.0004 BNB, #21-30: 0.0008 BNB. Max 30 mints per wallet, max total
  0.0138 BNB for a full 30-mint batch (1 free + 29 paid). NEVER
  hardcode a price. Read priceFor(wallet) (selector 0xf12a7add)
  for the next single mint, or quoteBulk(wallet, quantity)
  (selector 0x86c2a4f0) for the exact total of a bulk mint — it
  returns (totalPrice, freeSlot). currentPrice() (selector 0x9d1b464a)
  is the caller's next-mint price. Show the exact amount in the wallet
  confirmation before signing. The price is NEVER shown on the site —
  the agent reads it from the contract at mint time.
- Free mint: the FIRST mint of each wallet is FREE, automatically —
  1 per wallet, no total cap, no choice to make and nothing to pass
  in the call. The free mint draws from the FULL deck, exactly like a
  paid mint: it can draw any rarity, INCLUDING Legendary. The free
  mint earns the FULL 20 $THYRK bonus, same as a paid mint. Check
  freeUsed(wallet) (selector 0x2626c4bf): false means the wallet's
  first mint will be free. freeMinted() (selector 0xd10a1a2b) counts
  how many free mints have been used in total.
- Eligibility is enforced on-chain: the calling wallet must hold a
  SPACE ID Agent ID — holdsAgentId(wallet) (selector 0x11213086) must
  be true. The call must come from the wallet directly; contract calls
  are rejected (NoContracts). There is no owner allowlist. Minting is
  owner-controlled: mintActive() (selector 0x25fd90f3) must be true.
- Every mint earns 20 $THYRK — free mints and paid mints alike.
  Token mints (mint with $THYRK) are the exception: they pay no BNB
  and earn NO 20 $THYRK bonus. Token mints draw from the full deck,
  count toward the wallet's 30 max, and advance the price ladder.
- Marketplace royalty: ERC-2981, 5% to the creator (the Agentic Wallet,
  the revenue wallet above). Owner actions (setMintActive, setMinter)
  are done from My Wallet, the owner wallet above.
- Artwork and metadata are public at
  https://raw.githubusercontent.com/nugian10/THYRK/main/collection/metadata/
  (base URI). rarityOf(tokenId) (selector 0xdd3b5f9a) returns 0 Common,
  1 Rare, 2 Epic, 3 Legendary, 4 Divine.

## $THYRK (max supply 777,777)

- Earn: every mint +20 per mint (free AND paid); burn Common 20 /
  Rare 50 / Epic 120 / Legendary 300. Divine cannot burn.
- Spend: redeem 1 Divine for 1,500 $THYRK (77 max, first come first
  served); mint with $THYRK: 100 $THYRK = 1 mint, max 3 per wallet
  ever; upgrade 3 Common + 50 $THYRK = 1 Rare, 3 Rare + 100 $THYRK =
  1 Epic, 3 Epic + 200 $THYRK = 1 Legendary. Upgrade STOPS at
  Legendary — a Legendary can NEVER be upgraded to Divine.
- $THYRK feature pages (rules only, buttons disabled until $THYRK
  exists): redeem a Divine at /redeem.html, mint with $THYRK at
  /token-mint.html, upgrades at /upgrade.html, burn knights at
  /burn.html.
- $THYRK is spent via burnFrom, so the wallet must first approve the
  NFT contract to spend its $THYRK: approve() (selector 0x095ea7b3)
  on the token contract, spender = NFT contract, amount = the cost.
  Check allowance() (0xdd62ed3e) before calling.

## Read first

- totalSupply(), selector 0x18160ddd. If it returns 7777, the
  collection is sold out (Divine excluded: divineRemaining()
  0x739f6b19 tracks the 77 Divine separately).
- mintActive(), selector 0x25fd90f3. If false, minting is closed — do
  not mint. (It is false now: the new contract is not deployed yet.)
- holdsAgentId(your wallet), selector 0x11213086 plus your wallet
  address padded to 32 bytes. If false, the wallet cannot mint.
- mintCount(your wallet), selector 0xed9ec888 plus your wallet address
  padded to 32 bytes. If it is 30, the wallet has reached its limit.
- freeUsed(your wallet), selector 0x2626c4bf plus your wallet address
  padded to 32 bytes. If false, the wallet's first mint is free and
  happens automatically.
- tokenMints(your wallet), selector 0xe03feb69 plus your wallet
  address padded to 32 bytes. If it is 3, the wallet has used all its
  $THYRK token mints.
- priceFor(your wallet), selector 0xf12a7add plus your wallet address
  padded to 32 bytes. That is the exact value to send for the next
  single mint. For bulk, use quoteBulk() instead.
- deckDrawn() (0xd3e0d31f) / deckRemaining() (0xc434f97d) show how many
  deck tokens have been drawn / are left.

## Flow, per mint (NOT YET OPEN — do not use until the new contract is deployed and mintActive is true)

Minting is not open yet. Do NOT call mint() — there is no live
contract to call. The steps below describe how minting will work
once the new contract is deployed and activated.

1. Check mintActive() is true, totalSupply() is below 7,777,
   holdsAgentId() is true, and mintCount() is below 30.
2. Ask the user how many knights to mint (1 to 30, within the
   remaining limit). If freeUsed() is false, the first mint in the
   batch is free automatically and can draw any rarity including
   Legendary — no choice to make, no extra argument.
3. Read quoteBulk(wallet, quantity) and build the call: to the NFT
   contract, value exactly the quoted totalPrice (0 if the whole
   batch is free, which only happens for a single first mint),
   calldata for mint(quantity) with the quantity ABI-encoded after
   selector 0xa0712d68.
4. Preview with the Binance CLI (baw contract-call preview), show the
   preview to the user including the exact price, and on their
   confirmation execute with the requestId from the preview.
5. Verify on-chain: totalSupply() rose by the quantity minted and
   mintCount() rose by the same. Read tokenURI(tokenId) (selector
   0xc87b56dd) and rarityOf(tokenId) to report the knight's name,
   rarity and traits. On BscScan, confirm ownerOf(tokenId) is the
   user's wallet.

Repeat as needed, up to 30 mints per wallet. Do not mint without the
user's confirmation of the exact price shown in the wallet preview.

## $THYRK flows (once the new NFT contract is deployed and set as a minter on the token — note no $THYRK exists until the first mints/burns)

- Mint with $THYRK: approve the NFT contract to spend 100 $THYRK per
  mint, then call mintWithToken(quantity) (selector 0xb3eaff8b) with
  quantity 1 to 3 and value 0 — sending BNB with this call reverts.
  Agent ID is required, like any mint. Token mints earn NO $THYRK
  bonus.
- Burn: call burn(tokenId) (selector 0x42966c68) on a token the wallet
  owns. Burning is permanent — the NFT is gone forever. The $THYRK
  reward is minted to the wallet automatically. Divine cannot burn.
- Redeem Divine: call redeemDivine() (selector 0xd34489a5) after
  approving 1,500 $THYRK. The Divine token ID is assigned in redeem
  order (7778 first). No Agent ID is needed for redeem.
- Upgrade: approve the $THYRK fee first, then call
  upgrade(tokenId1, tokenId2, tokenId3) (selector 0xfe1538d4) with
  three token IDs the wallet owns, all of the same tier (Common, Rare
  or Epic only). The three inputs are burned and the output is drawn
  from the deck at the next tier. No Agent ID is needed for upgrade.
  Upgrade outputs do not count toward the wallet's 30 mint cap.
