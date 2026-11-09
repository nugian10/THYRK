# THYRK: mint skill

For Binance Agentic Wallet agents. Mint THYRK knight NFTs (THYRK) on BNB
Chain for your user. THYRK is a 7,777-token collection of original 16-bit
pixel knight characters: Common 4,000 (777 free + 3,223 paid), Rare 2,500,
Epic 1,000, Legendary 277. Plus Divine: 77 unique 1-of-1 knights, NOT
mintable — only redeemed with $THYRK. Site: https://thyrk.fun/

## Contracts (BNB Chain, chain id 56)

- THYRK NFT (THYRK): 0x0000000000000000000000000000000000000000 —
  PLACEHOLDER, NOT DEPLOYED YET. Do NOT attempt any mint transaction
  until the THYRK site shows a real deployed contract address.
- $THYRK token: NOT DEPLOYED YET either. No $THYRK exists today. Do NOT
  attempt any redeem, token-mint, upgrade, burn or claim call until the
  site publishes a real $THYRK token contract address.
- SPACE ID Agent ID registry: 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F
- Owner: Binance Agentic Wallet 0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7
- Revenue: the same Agentic Wallet. Mint payments are forwarded directly
  to it in the same transaction (they never sit in the contract).

## Facts

- Supply: 7,777 mintable NFTs, token IDs 1 to 7,777, drawn from a
  shuffled deck (deckHash() selector 0x8830dea2). Common, Rare and Epic
  each have 5 designs; Legendary is trait-random (base knight plus
  helmet, weapon, cape, aura and shield combined). Divine token IDs
  7778 to 7854, revealed only to the owner — never shown on the site.
- Mint: `mint(uint256 quantity, bool useFree)` (selector 0x67f68fac).
  One call mints `quantity` knights (1 to 30, up to the wallet's
  remaining limit) — bulk mint in a single transaction. `useFree=true`
  spends the wallet's one free mint on the highest-priced slot in the
  batch. Send exactly the quoted total value; any overpayment is
  refunded automatically by the contract.
- Price ladder per wallet: mint #1-10: 0.0002 BNB, #11-20: 0.0004 BNB,
  #21-30: 0.0008 BNB. Max 30 mints per wallet, max total 0.014 BNB.
  NEVER hardcode a price. Read priceFor(wallet) (selector 0xf12a7add)
  for the next single mint, or quoteBulk(wallet, quantity, useFree)
  (selector 0xe0d4f0ea) for the exact total of a bulk mint — it returns
  (totalPrice, freeSlot). currentPrice() (selector 0x9d1b464a) is the
  caller's next-mint price. Show the exact amount in the wallet
  confirmation before signing. The price is NEVER shown on the site —
  the agent reads it from the contract at mint time.
- Free mint: 777 total, Common ONLY, 1 per wallet, first come first
  served. The free mint is the wallet's CHOICE — it is not
  automatically the first mint. The wallet may use it at any point
  within its 30 mints. A free mint earns no $THYRK at mint time, but
  the Common card can be burned for 20 $THYRK. Check freeUsed(wallet)
  (selector 0x2626c4bf) and freeMintsRemaining() (0x8868b9ff).
- Eligibility is enforced on-chain: the calling wallet must hold a
  SPACE ID Agent ID — holdsAgentId(wallet) (selector 0x11213086) must
  be true. The call must come from the wallet directly; contract calls
  are rejected (NoContracts). There is no owner allowlist. Minting is
  owner-controlled: mintActive() (selector 0x25fd90f3) must be true.
- Paid mint earns 20 $THYRK per mint. Token mints draw from the 7,000
  non-free supply, count toward the wallet's 30 max and advance the
  price ladder, but pay no BNB and earn no 20 $THYRK bonus.
- Marketplace royalty: ERC-2981, 5% to the creator (the Agentic Wallet
  above). Owner and revenue are the same wallet, so owner actions can
  only be done from the Agentic Wallet via the user's Binance agent.
- Artwork and metadata are public at
  https://raw.githubusercontent.com/nugian10/THYRK/main/collection/metadata/
  (base URI). rarityOf(tokenId) (selector 0xdd3b5f9a) returns 0 Common,
  1 Rare, 2 Epic, 3 Legendary, 4 Divine.

## $THYRK (max supply 777,777)

- Earn: paid mint +20 per mint; burn Common 20 / Rare 50 / Epic 120 /
  Legendary 300. A free Common also burns for 20. Divine cannot burn.
- Spend: redeem 1 Divine for 1,500 $THYRK (77 max, first come first
  served); mint with $THYRK: 100 $THYRK = 1 mint, max 3 per wallet
  ever; upgrade 3 Common + 50 $THYRK = 1 Rare, 3 Rare + 100 $THYRK =
  1 Epic, 3 Epic + 200 $THYRK = 1 Legendary. Upgrade STOPS at
  Legendary — a Legendary can NEVER be upgraded to Divine.
- Repost the official THYRK post on X for 100 $THYRK, max 1 per wallet
  and 1 per X account, budget 77,777 $THYRK (max 777 wallets).
  Official X: https://x.com/thyrk_ (@thyrk_). Claims are NOT open yet
  — the official post to repost has not been published, and the claim
  system does not exist yet.
- $THYRK feature pages (rules only, buttons disabled until the token
  contract is deployed): redeem a Divine at /redeem.html, mint with
  $THYRK at /token-mint.html, upgrades at /upgrade.html, claim $THYRK
  for reposting at /claim.html, burn knights at /burn.html.
- $THYRK is spent via burnFrom, so the wallet must first approve the
  NFT contract to spend its $THYRK: approve() (selector 0x095ea7b3)
  on the token contract, spender = NFT contract, amount = the cost.
  Check allowance() (0xdd62ed3e) before calling.

## Read first

- totalSupply(), selector 0x18160ddd. If it returns 7777, the
  collection is sold out (Divine excluded: divineRemaining()
  0x739f6b19 tracks the 77 Divine separately).
- mintActive(), selector 0x25fd90f3. If false, minting is not open yet.
- holdsAgentId(your wallet), selector 0x11213086 plus your wallet
  address padded to 32 bytes. If false, the wallet cannot mint.
- mintCount(your wallet), selector 0xed9ec888 plus your wallet address
  padded to 32 bytes. If it is 30, the wallet has reached its limit.
- freeUsed(your wallet), selector 0x2626c4bf plus your wallet address
  padded to 32 bytes. If false, the wallet still has its free mint
  and may choose to use it on this mint.
- tokenMints(your wallet), selector 0xe03feb69 plus your wallet
  address padded to 32 bytes. If it is 3, the wallet has used all its
  $THYRK token mints.
- priceFor(your wallet), selector 0xf12a7add plus your wallet address
  padded to 32 bytes. That is the exact value to send for the next
  single mint. For bulk, use quoteBulk() instead.
- deckDrawn() (0xd3e0d31f) / deckRemaining() (0xc434f97d) show how many
  deck tokens have been drawn / are left.

## Flow, per mint

1. Check mintActive() is true, totalSupply() is below 7,777,
   holdsAgentId() is true, and mintCount() is below 30.
2. Ask the user whether to use their free mint on this mint (if still
   available) or to pay. A free mint always gives Common only. For a
   bulk mint, ask the quantity too (1 to 30, within the remaining
   limit) and whether to include the free mint in the batch.
3. Read quoteBulk(wallet, quantity, useFree) and build the call: to
   the NFT contract, value exactly the quoted totalPrice (0 if the
   whole batch is free, which only happens for a single free mint),
   calldata for mint(quantity, useFree) with the quantity and useFree
   arguments ABI-encoded after selector 0x67f68fac.
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

## $THYRK flows (only after the token contract is deployed)

- Mint with $THYRK: approve the NFT contract to spend 100 $THYRK per
  mint, then call mintWithToken(quantity) (selector 0xb3eaff8b) with
  quantity 1 to 3 and value 0 — sending BNB with this call reverts.
  Agent ID is required, like any mint.
- Burn: call burn(tokenId) (selector 0x42966c68) on a token the wallet
  owns. Burning is permanent — the NFT is gone forever. The $THYRK
  reward is minted to the wallet automatically.
- Redeem Divine: call redeemDivine() (selector 0xd34489a5) after
  approving 1,500 $THYRK. The Divine token ID is assigned in redeem
  order (7778 first). No Agent ID is needed for redeem.
- Upgrade: approve the $THYRK fee first, then call
  upgrade(tokenId1, tokenId2, tokenId3) (selector 0xfe1538d4) with
  three token IDs the wallet owns, all of the same tier (Common, Rare
  or Epic only). The three inputs are burned and the output is drawn
  from the deck at the next tier. No Agent ID is needed for upgrade.
  Upgrade outputs do not count toward the wallet's 30 mint cap.
