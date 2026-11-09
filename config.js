/* THYRK site config — single source of truth for contract addresses.
   NOTE: pages currently keep their addresses inline and are NOT rewired
   to load this file. Keep this file in sync with the inline addresses
   in mint.html, check.html and live-count.js. */
var THYRK_CONFIG = {
  // BNB Chain mainnet.
  CHAIN_ID: 56,
  // New ThyrkNFT contract — deployed 10 Nov 2026.
  NFT_ADDRESS: "0x4D90fFC3075FB8897EDFf6d7c6269c906664a20e",
  // $THYRK token (reused from the earlier deploy, already live).
  TOKEN_ADDRESS: "0x3b8747d067b2ed8565330667128260c2a4954300",
  // SPACE ID Agent ID registry (agent-only gate).
  AGENT_ID_REGISTRY: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
  // Royalty receiver (5%).
  ROYALTY_RECEIVER: "0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7",
  // Contract owner.
  OWNER: "0x0262e8e5E4584D8AB840fD950a6E2E0A414d4097",
  // Deck commitment (must match the deployed contract).
  DECK_HASH: "0x592a9180d7c57fa9c609176c204e8c4950ee20d7d13c5705c0227516e97e8233",
  MAX_SUPPLY: 7777,
  MAX_PER_WALLET: 30
};
if (typeof module !== "undefined" && module.exports) module.exports = THYRK_CONFIG;
