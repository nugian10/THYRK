# THYRK: mint skill

For Binance Agentic Wallet agents. Mint THYRK knight NFTs (THYRK) on BNB
Chain for your user. THYRK is a 7,777-token collection of original 16-bit
pixel knight characters: Common 4,000 (777 free + 3,223 paid), Rare 2,500,
Epic 1,000, Legendary 277. Plus Divine: 77 unique 1-of-1 knights, NOT
mintable — only redeemed with $THYRK. Site: https://thyrk.fun/

## Contracts (BNB Chain, chain id 56)

- THYRK NFT (THYRK): 0x0000000000000000000000000000000000000000 —
  PLACEHOLDER, NOT DEPLOYED YET. Do NOT attempt any mint transaction until
  the THYRK site shows a real deployed contract address.
- SPACE ID Agent ID registry: 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F
- Owner: Binance Agentic Wallet 0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7
- Revenue: the same Agentic Wallet. Mint payments are forwarded directly
  to it in the same transaction (they never sit in the contract).

## Facts

- Supply: 7,777 mintable NFTs. Max 30 mints per wallet.
- Free mint: 777 total, Common ONLY, 1 per wallet, first come first
  served. The free mint is the wallet's CHOICE — it is not automatically
  the first mint. The wallet may use its free mint at any point within its
  30 mints, and a free mint always gives Common only. A free mint earns
  no $THYRK at mint time, but the Common card can be burned for 20 $THYRK.
- Bulk mint: the contract allows minting several knights in one
  transaction (for example 30 at once), up to the 30-per-wallet limit.
  Use the bulk mint function with a quantity argument; the total value
  is the sum of the per-mint prices for the mints being made.
- Price: NEVER hardcode a price and NEVER show a price from this file.
  Read priceFor(wallet) or currentPrice() on the live contract to get the
  exact price for the next mint. The price depends on how many times the
  wallet has already minted. Show the exact amount in the wallet
  confirmation before signing. Any overpayment is refunded automatically.
- Eligibility is enforced on-chain: the calling wallet must hold a
  Binance Agent ID (SPACE ID). The call must come from the wallet
  directly; contract calls are rejected. There is no owner allowlist.
- Minting is owner-controlled: mintActive() must be true. The draw is a
  shuffled deck; each mint draws the next token. Common, Rare and Epic
  each have 5 designs; Legendary is trait-random (base knight plus
  helmet, weapon, cape, aura and shield combined).
- $THYRK (max supply 777,777): paid mint earns 20 $THYRK. Burn a Common
  for 20, a Rare for 50, an Epic for 120, a Legendary for 300 $THYRK.
  Divine costs 1,500 $THYRK. Redeem mint: 100 $THYRK = 1 mint, max 3 per
  wallet. Upgrades: 3 Common + 50 $THYRK = 1 Rare; 3 Rare + 100 $THYRK =
  1 Epic; 3 Epic + 200 $THYRK = 1 Legendary.
- $THYRK feature pages (rules only, NOT live yet): redeem a Divine at
  /redeem.html, mint with $THYRK at /token-mint.html, upgrades at
  /upgrade.html, claim $THYRK for reposting at /claim.html. The $THYRK
  token contract is NOT deployed yet — no $THYRK exists. Do NOT attempt
  any redeem, token-mint, upgrade or claim call until the site publishes
  a real $THYRK token contract address. Divine redemption is first come
  first served (77 max).
- Official THYRK account on X: https://x.com/thyrk_ (@thyrk_). Repost
  reward: 100 $THYRK, max 1 per wallet and 1 per X account, budget
  77,777 $THYRK (max 777 wallets). Claims are NOT open yet — the
  official post to repost has not been published.
- Marketplace royalty: 5% to the creator (the Agentic Wallet above).

## Read first

- totalSupply(). If it returns 7777, the collection is sold out.
- mintActive(). If false, minting is not open yet.
- holdsAgentId(your wallet). If false, the wallet cannot mint.
- mintCount(your wallet). If it is 30, the wallet has reached its limit.
- freeMintUsed(your wallet) or equivalent. If false, the wallet still has
  its free mint available and may choose to use it on this mint.
- priceFor(your wallet). That is the exact value to send for this mint.

## Flow, per mint

1. Check mintActive() is true, totalSupply() is below 7,777,
   holdsAgentId() is true, and mintCount() is below 30.
2. Ask the user whether to use their free mint on this mint (if still
   available) or to pay. A free mint always gives Common only.
3. Read priceFor(your wallet) and build the call: to the NFT contract,
   value exactly priceFor(your wallet) for a paid mint (0 for a free
   mint), calldata for mint() or the bulk mint function with quantity.
4. Preview with the Binance CLI (baw contract-call preview), show the
   preview to the user including the exact price, and on their
   confirmation execute with the requestId from the preview.
5. Verify on-chain: totalSupply() rose by the quantity minted and
   mintCount() rose by the same. Read tokenURI(tokenId) to report the
   knight's name, rarity and traits.

Repeat as needed, up to 30 mints per wallet. Do not mint without the
user's confirmation of the exact price shown in the wallet preview.
