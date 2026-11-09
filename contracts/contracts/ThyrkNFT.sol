// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ============================================================
// THYRK — knight-themed NFT collection
// ERC-721, BNB Smart Chain Mainnet (Chain ID 56)
// ------------------------------------------------------------
// Modelled on the proven Zigzoo v2 pattern (agent-only mint,
// SPACE ID Agent ID gate, gacha deck, direct payment
// forwarding), with THYRK's own rules:
//
// - Supply 7,777 mintable. Token IDs 1-7,777, drawn from a
//   deterministic shuffled deck (see THE DECK below).
//   No reveal: the drawn token is final at mint.
// - Rarity (mintable): Common 4,000 / Rare 2,500 / Epic 1,000
//   / Legendary 277. Divine 77 is SEPARATE (token IDs
//   7,778-7,854): never mintable for BNB, only by redeeming
//   1,500 $THYRK (see $THYRK below).
// - PRICE LADDER PER WALLET, based on how many that wallet
//   has already minted (mintCount), LOCKED in the contract
//   (no owner function may change it):
//     mint #1-10  : 0.0002 BNB each
//     mint #11-20 : 0.0004 BNB each
//     mint #21-30 : 0.0008 BNB each
//     mint #31+   : REVERTS (max 30 per wallet)
//   30 paid mints cost 0.014 BNB in total. The ladder is
//   NEVER shown on the site; the agent reads quoteBulk /
//   priceFor / currentPrice before minting.
//   Overpayment is refunded to the minter in the same call;
//   underpayment reverts.
// - BULK MINT: mint(quantity, useFree) mints 1-30 tokens in
//   ONE transaction. Price = the sum of the ladder prices
//   for the paid slots in that batch.
// - FREE MINT — a CHOICE, not an automatic first mint:
//   1 per wallet, 777 in total, first-come first-served,
//   Common ONLY (never Rare / Epic / Legendary), whenever
//   the wallet chooses to use it. It consumes one of the
//   wallet's 30 slots. In a bulk mint the free mint is
//   applied to the HIGHEST-priced slot in the batch, so
//   bulk-30-with-free costs 0.0132 BNB (not 0.0138).
//   A single free mint used at slot #1 costs 0 BNB; used
//   at slot #21-30 it saves 0.0008 BNB. Free mints earn
//   0 $THYRK at mint time, but a free Common CAN be burned
//   for 20 $THYRK like a paid Common.
// - Agent-only enforced ON-CHAIN by a SPACE ID Agent ID
//   check: the minter must hold a SPACE ID .ai Agent ID
//   NFT (registry 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F,
//   the public registry also used by Zigzoo / OOBIX).
//   hasAgentId uses a low-level staticcall on purpose: a
//   high-level balanceOf call to an address with no code
//   returns empty data, and the ABI decoder reverts on
//   empty returndata OUTSIDE try/catch.
// - Calls from contracts are rejected (NoContracts) for
//   mint functions.
// - currentPrice() returns the price of the CALLER's next
//   mint; priceFor(wallet) returns the price of that
//   wallet's next mint; quoteBulk(wallet, quantity,
//   useFree) returns the exact BNB for a whole batch plus
//   which slot the free mint lands on. An agent must NEVER
//   hardcode a price.
//
// THE DECK — hash-only design (cheap deploy):
//   The full 7,777-entry deck is NEVER stored on-chain.
//   deckHash = keccak256 of the deck encoding (per token,
//   in token-ID order: 1 byte rarity code + 2 bytes design
//   index, big-endian; 7,777 x 3 = 23,331 bytes), built
//   from seed 0x544859524b ("THYRK" in ASCII hex) by a
//   Fisher-Yates shuffle. The deck, the seed and the
//   deckHash are published off-chain (collection/
//   manifest.json), so anyone can rebuild the deck and
//   verify deckHash.
//   The draw is a lazy Fisher-Yates shuffle seeded by
//   deckHash, executed on-chain one draw at a time over
//   a SINGLE shared pool of all 7,777 tokens:
//     draw #d (1-based), remaining = 7777 - d + 1
//     j = uint256(keccak256(deckHash, d)) % remaining
//     tokenId = valueAt(j); then swap position j with
//     position (remaining - 1) in the sparse map
//     _swapped (unset entry means identity: position i
//     holds tokenId i+1).
//   Because each draw removes its token from the pool,
//   drawn token IDs are unique by construction and all
//   7,777 are drawn exactly once when the pool empties:
//   777 free mints (all Common) + 7,000 paid / token
//   mints / upgrade outputs. The draw order is fully
//   deterministic given deckHash, so anyone can replay
//   it off-chain and know the whole order in advance —
//   the deck is transparent, not secret.
//   HONEST LIMITS: (1) the draw is deterministic
//   pseudo-randomness from a public seed — it is NOT
//   VRF / provably fair randomness; anyone who knows
//   the seed can compute the draw order in advance.
//   (2) The deck is fixed at deploy (deckHash is
//   immutable) and cannot be reshuffled afterwards.
//   (3) On-chain, only the deckHash commitment plus a
//   compact 2-bit-per-token rarity bitmap are stored;
//   verifying a single past draw means replaying the
//   shuffle off-chain from the published seed.
//
// THE RARITY BITMAP — why it exists:
//   The deck is shuffled, so rarity is NOT a function of
//   the token ID range. The contract still needs to know
//   a token's rarity on-chain, for exactly three things:
//   (a) a free mint must draw a Common and must not
//   consume a deck slot that could have been Rare / Epic
//   / Legendary; (b) burn rewards differ per rarity;
//   (c) upgrades must verify the three input NFTs share
//   one tier. The bitmap packs rarity as 2 bits per
//   token (61 uint256 words for 7,777 tokens), is built
//   from the published deck by scripts/generate-bitmap.py,
//   and is passed to the constructor. Anyone can rebuild
//   it from the seed and check it matches. It is an
//   index of the deck, not a second deck: the deckHash
//   remains the single deck commitment.
//   Free-mint reserve invariant (enforced on-chain):
//   commonsRemaining >= freeMintsRemaining() at all
//   times. Paid draws are forbidden from taking a Common
//   once commonsRemaining == freeMintsRemaining(), so
//   all 777 free mints stay claimable until claimed.
//
// $THYRK — spent and earned here (see ThyrkToken.sol):
//   Paid mint: +20 $THYRK per paid mint (free: 0).
//   Burn NFT: Common 20 / Rare 50 / Epic 120 / Legendary
//   300 $THYRK (free Common also 20; Divine cannot burn).
//   Redeem Divine: 1,500 $THYRK -> 1 Divine (77 max, FCFS).
//   Token mint: 100 $THYRK -> 1 mint, max 3 per wallet.
//   It draws from the 7,000 non-free supply, counts toward
//   the wallet's 30 max and advances the ladder, but pays
//   no BNB and earns no 20 $THYRK bonus.
//   Upgrade: 3 Common + 50 -> 1 Rare; 3 Rare + 100 -> 1
//   Epic; 3 Epic + 200 -> 1 Legendary. Inputs are burned,
//   the $THYRK is burned, the output is drawn from the
//   deck (a token of the target tier). Upgrade STOPS at
//   Legendary — Legendary can NEVER be upgraded to Divine.
//   Upgrade outputs do not count toward the wallet's 30
//   (the inputs already counted when they were minted).
//   All $THYRK spent here is BURNED (burnFrom).
//
// OWNER / REVENUE — BOTH the same wallet:
//   Owner = revenue = Bryan's Binance Agentic Wallet
//   0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7.
//   Consequence: owner actions can ONLY be done from the
//   Agentic Wallet via Bryan's Binance agent, NOT from a
//   browser wallet. Deploy from the Agentic Wallet so it
//   is the owner.
//   Funds: each PAID mint forwards the exact price
//   DIRECTLY to the revenue wallet inside the same mint()
//   call. Mint payments NEVER sit in this contract, and
//   no withdraw step is needed for them. Any overpayment
//   is refunded to the minter in the same call.
//   withdraw() exists only as a safety valve for funds
//   that arrive outside mint() (e.g. force-sent BNB).
//   Marketplace royalty: ERC-2981, 5%, receiver = the
//   Agentic Wallet above.
//
// ESCAPE HATCH (documented, on-chain, visible):
//   agentIdCheckRequired defaults to true. The owner
//   can turn the Agent ID check off
//   (setAgentIdCheckRequired(false)) or point it at
//   a different registry (setAgentIdRegistry).
//   Turning it off makes minting permissionless
//   on-chain and agent-only in the UI only. Do not
//   hide such a change.
//
// This contract is SOURCE-VERIFIABLE on BscScan.
// It is NOT an independent audit — keep that
// disclosure on the site.
// ============================================================

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./ThyrkToken.sol";

contract ThyrkNFT is ERC721, ERC721Royalty, Ownable, ReentrancyGuard {
    using Strings for uint256;

    // ---------- rarity codes (bitmap + rarityOf) ----------
    uint8 public constant RARITY_COMMON = 0;
    uint8 public constant RARITY_RARE = 1;
    uint8 public constant RARITY_EPIC = 2;
    uint8 public constant RARITY_LEGENDARY = 3;
    uint8 public constant RARITY_DIVINE = 4;

    // ---------- supply ----------
    uint256 public constant MAX_SUPPLY = 7777;
    uint256 public constant DIVINE_SUPPLY = 77;
    uint256 public constant DIVINE_START_ID = 7778; // Divine: 7778-7854
    uint256 public constant MAX_PER_WALLET = 30;
    uint256 public constant MAX_TOKEN_MINTS = 3;
    uint256 public constant FREE_TOTAL = 777;

    // ---------- pricing (locked, no setter exists) ----------
    uint256 public constant PRICE_1_10 = 0.0002 ether;
    uint256 public constant PRICE_11_20 = 0.0004 ether;
    uint256 public constant PRICE_21_30 = 0.0008 ether;

    // ---------- $THYRK amounts (18 decimals, locked) ----------
    uint256 public constant MINT_BONUS = 20 ether;
    uint256 public constant TOKEN_MINT_COST = 100 ether;
    uint256 public constant REDEEM_DIVINE_COST = 1500 ether;
    uint256 public constant BURN_COMMON = 20 ether;
    uint256 public constant BURN_RARE = 50 ether;
    uint256 public constant BURN_EPIC = 120 ether;
    uint256 public constant BURN_LEGENDARY = 300 ether;
    uint256 public constant UPGRADE_TO_RARE = 50 ether;
    uint256 public constant UPGRADE_TO_EPIC = 100 ether;
    uint256 public constant UPGRADE_TO_LEGENDARY = 200 ether;

    /// @notice Marketplace royalty: 5% = 500 basis points.
    uint96 public constant ROYALTY_BPS = 500;

    /// @notice SPACE ID .ai Agent ID NFT on BNB Smart Chain.
    /// Public registry used by Zigzoo / OOBIX and others.
    address public constant DEFAULT_AGENT_ID_REGISTRY =
        0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    bool public mintActive;
    /// @notice Immutable: no setter exists. Owner AND revenue
    /// are the same Agentic Wallet (see header).
    address public immutable revenueWallet;
    address public agentIdRegistry;
    bool public agentIdCheckRequired = true;

    /// @notice keccak256 commitment of the deck, set once via
    /// the constructor argument. The full deck is never stored
    /// on-chain — see THE DECK above.
    bytes32 public immutable deckHash;

    /// @notice The $THYRK token contract. Set once in the
    /// constructor (deploy ThyrkToken first). Mint bonuses
    /// and burn rewards are minted through it; redeem /
    /// token-mint / upgrade costs are burned through it.
    ThyrkToken public immutable thyrkToken;

    string private _baseTokenURI;

    /// @dev Rarity bitmap: 2 bits per token ID (1..7777),
    /// 61 uint256 words. word (t-1)/128, offset ((t-1)%128)*2.
    /// Built from the published deck (see header + script).
    uint256[61] private _rarityBitmap;

    /// @dev Undrawn tokens left in the shared Fisher-Yates
    /// pool. Starts at 7777; every deck draw (paid, free,
    /// token-mint, upgrade output) decrements it by exactly 1.
    uint256 private _remaining = MAX_SUPPLY;
    /// @dev Global draw counter: seeds every draw so no two
    /// draws share a seed, even inside one bulk mint.
    uint256 private _drawIndex;
    /// @dev Sparse Fisher-Yates swap map: _swapped[i] =
    /// tokenId now held at pool position i, or 0 = unset
    /// (identity: position i holds tokenId i+1).
    mapping(uint256 => uint256) private _swapped;

    /// @dev Undrawn tokens of each rarity left in the pool.
    /// Decremented by _takeAt on every deck draw.
    uint256 public commonsRemaining = 4000;
    uint256 public raresRemaining = 2500;
    uint256 public epicsRemaining = 1000;
    uint256 public legendariesRemaining = 277;

    /// @dev Free mints used so far (max 777).
    uint256 public freeMinted;
    /// @dev Divine redeemed so far (max 77).
    uint256 public divineMinted;
    /// @dev NFTs burned so far (for totalSupply accounting).
    uint256 public burnedCount;

    /// @dev On-chain mint seed per token.
    mapping(uint256 => bytes32) public tokenSeed;
    /// @dev Mints per wallet — this IS the price ladder
    /// counter and the 30-per-wallet cap. Enforced.
    /// Counts BNB mints + token mints, NOT upgrades or
    /// Divine redeems (those are transformations / claims).
    mapping(address => uint256) public mintCount;
    /// @dev Token mints (100 $THYRK) used per wallet (max 3).
    mapping(address => uint256) public tokenMints;
    /// @dev Whether a wallet already used its 1 free mint.
    mapping(address => bool) public freeUsed;

    event Minted(
        address indexed minter,
        uint256 indexed tokenId,
        uint256 price,
        uint8 rarity,
        bytes32 seed,
        bool viaToken
    );
    event Burned(
        address indexed burner,
        uint256 indexed tokenId,
        uint8 rarity,
        uint256 reward
    );
    event DivineRedeemed(
        address indexed redeemer,
        uint256 indexed tokenId,
        uint256 cost
    );
    event Upgraded(
        address indexed upgrader,
        uint256 indexed tokenId,
        uint8 rarity,
        uint256 cost
    );
    event DeckCommitted(bytes32 indexed deckHash);
    event MintActiveChanged(bool active);
    event BaseURIUpdated(string baseURI);
    event AgentIdRegistryUpdated(address indexed agentIdRegistry);
    event AgentIdCheckChanged(bool required);
    event Withdrawn(address indexed revenueWallet, uint256 amount);

    error MintInactive();
    error ExceedsMaxSupply();
    error SoldOut();
    error IncorrectPayment(uint256 expected, uint256 received);
    error InvalidAddress();
    error NoFunds();
    error NoAgentId();
    error NoContracts();
    error MaxPerWallet();
    error PaymentForwardFailed();
    error RefundFailed();
    error FreeAlreadyUsed();
    error FreeExhausted();
    error TokenMintLimit();
    error DivineExhausted();
    error InvalidUpgrade();
    error BurnDivineNotAllowed();
    error NotTokenOwner();
    error NoDrawableToken();

    constructor(
        address initialOwner,
        address revenueWallet_,
        address agentIdRegistry_,
        string memory baseURI_,
        bytes32 deckHash_,
        uint256[61] memory rarityBitmap_,
        address thyrkToken_
    ) ERC721("THYRK", "THYRK") Ownable(initialOwner) {
        if (
            initialOwner == address(0) ||
            revenueWallet_ == address(0) ||
            agentIdRegistry_ == address(0) ||
            thyrkToken_ == address(0)
        ) {
            revert InvalidAddress();
        }

        revenueWallet = revenueWallet_;
        agentIdRegistry = agentIdRegistry_;
        _baseTokenURI = baseURI_;
        deckHash = deckHash_;
        thyrkToken = ThyrkToken(thyrkToken_);
        for (uint256 i = 0; i < 61; i++) {
            _rarityBitmap[i] = rarityBitmap_[i];
        }
        _setDefaultRoyalty(revenueWallet_, ROYALTY_BPS);
        emit DeckCommitted(deckHash_);
    }

    // ---------- supply / pricing / deck (read-only, for UI + agents) ----------

    /// @notice Deck tokens drawn so far (paid + free + token
    /// mints + upgrade outputs). 7777 - deckRemaining().
    function deckDrawn() public view returns (uint256) {
        return MAX_SUPPLY - _remaining;
    }

    /// @notice Undrawn tokens left in the deck pool.
    function deckRemaining() public view returns (uint256) {
        return _remaining;
    }

    /// @notice Current existing NFTs: drawn + Divine - burned.
    function totalSupply() public view returns (uint256) {
        return deckDrawn() + divineMinted - burnedCount;
    }

    /// @notice Free mints still claimable (777 total).
    function freeMintsRemaining() public view returns (uint256) {
        return FREE_TOTAL - freeMinted;
    }

    /// @notice Divine still redeemable (77 total).
    function divineRemaining() public view returns (uint256) {
        return DIVINE_SUPPLY - divineMinted;
    }

    /// @notice Price of a wallet's Nth mint (count = how many
    /// that wallet has ALREADY minted). Slot #1-10 -> 0.0002,
    /// #11-20 -> 0.0004, #21-30 -> 0.0008.
    /// Pure: does not enforce the 30 cap (priceFor does).
    function priceForCount(uint256 count) public pure returns (uint256) {
        if (count < 10) return PRICE_1_10;
        if (count < 20) return PRICE_11_20;
        return PRICE_21_30;
    }

    /// @notice Price of `wallet`'s next mint. Reverts
    /// MaxPerWallet once the wallet has minted 30.
    function priceFor(address wallet) public view returns (uint256) {
        uint256 count = mintCount[wallet];
        if (count >= MAX_PER_WALLET) revert MaxPerWallet();
        return priceForCount(count);
    }

    /// @notice Price of the CALLER's next mint. Reverts
    /// SoldOut when the deck is empty, MaxPerWallet when
    /// the caller has minted 30 already.
    /// The agent reads this and sends that value (or
    /// more — any excess is refunded) with mint().
    function currentPrice() public view returns (uint256) {
        if (_remaining == 0) revert SoldOut();
        return priceFor(msg.sender);
    }

    /// @notice Exact BNB for a bulk mint, and which batch
    /// slot the free mint lands on (0-based within the
    /// batch). freeSlot = type(uint256).max when useFree
    /// is false. The free mint always lands on the
    /// HIGHEST-priced slot in the batch (the last one at
    /// that price). Reverts on the same conditions as
    /// mint(): bad quantity, MaxPerWallet, FreeAlreadyUsed,
    /// FreeExhausted, SoldOut.
    function quoteBulk(address wallet, uint256 quantity, bool useFree)
        external
        view
        returns (uint256 totalPrice, uint256 freeSlot)
    {
        return _quoteBulk(wallet, quantity, useFree);
    }

    function _quoteBulk(address wallet, uint256 quantity, bool useFree)
        internal
        view
        returns (uint256 totalPrice, uint256 freeSlot)
    {
        if (quantity == 0 || quantity > MAX_PER_WALLET) revert MaxPerWallet();
        uint256 count = mintCount[wallet];
        if (count + quantity > MAX_PER_WALLET) revert MaxPerWallet();
        if (_remaining < quantity) revert SoldOut();
        if (useFree) {
            if (freeUsed[wallet]) revert FreeAlreadyUsed();
            if (freeMinted >= FREE_TOTAL) revert FreeExhausted();
        }
        uint256 maxPrice;
        freeSlot = type(uint256).max;
        for (uint256 i = 0; i < quantity; i++) {
            uint256 p = priceForCount(count + i);
            totalPrice += p;
            if (useFree && p >= maxPrice) {
                maxPrice = p;
                freeSlot = i;
            }
        }
        if (useFree) {
            totalPrice -= maxPrice;
        }
    }

    /// @notice Rarity of a token ID: 0 Common, 1 Rare,
    /// 2 Epic, 3 Legendary, 4 Divine. Divine is token IDs
    /// 7778-7854. Pure function of the deck bitmap for
    /// 1-7777; works for unminted tokens too.
    function rarityOf(uint256 tokenId) public view returns (uint8) {
        if (tokenId == 0 || tokenId > DIVINE_START_ID + DIVINE_SUPPLY - 1) {
            revert ExceedsMaxSupply();
        }
        if (tokenId > MAX_SUPPLY) return RARITY_DIVINE;
        uint256 word = _rarityBitmap[(tokenId - 1) / 128];
        uint256 offset = ((tokenId - 1) % 128) * 2;
        return uint8((word >> offset) & 0x3);
    }

    /// @notice True when `wallet` holds at least one SPACE ID
    /// .ai Agent ID NFT in the configured registry. A registry
    /// that does not answer like an ERC-721 returns false
    /// instead of reverting, so a bad registry address can
    /// never brick reads — it only blocks minting.
    /// Implemented with a low-level staticcall on purpose: a
    /// high-level balanceOf call to an address with no code
    /// returns empty data, and the ABI decoder reverts on
    /// empty returndata OUTSIDE try/catch. The low-level call
    /// returns ok=false / short data instead, which we map
    /// to false here.
    function holdsAgentId(address wallet) public view returns (bool) {
        if (agentIdRegistry == address(0)) return false;
        (bool ok, bytes memory data) = agentIdRegistry.staticcall(
            abi.encodeWithSelector(IERC721.balanceOf.selector, wallet)
        );
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (uint256)) > 0;
    }

    // ---------- the draw (lazy Fisher-Yates, hash-only) ----------

    /// @dev Token ID currently held at pool position `i`
    /// (0-based). Unset map entry = identity (i + 1).
    function _valueAt(uint256 i) internal view returns (uint256) {
        uint256 v = _swapped[i];
        return v == 0 ? i + 1 : v;
    }

    /// @dev Take the token at pool position `pos`: swap it
    /// with the last undrawn position and shrink the pool
    /// by one. Decrements the rarity counter of the taken
    /// token. Caller must guarantee pos < _remaining.
    function _takeAt(uint256 pos) internal returns (uint256 tokenId) {
        tokenId = _valueAt(pos);
        uint256 last = _valueAt(_remaining - 1);
        if (pos != _remaining - 1) {
            _swapped[pos] = last;
        }
        _remaining--;
        uint8 r = rarityOf(tokenId);
        if (r == RARITY_COMMON) commonsRemaining--;
        else if (r == RARITY_RARE) raresRemaining--;
        else if (r == RARITY_EPIC) epicsRemaining--;
        else legendariesRemaining--;
    }

    /// @dev Scan the pool from `start` (wrapping) for the
    /// first position whose token matches: rarity == `want`,
    /// or (when `anyNonCommon`) any rarity != Common.
    /// Returns (position, found). Bounded by _remaining
    /// steps, so it always terminates.
    function _findFrom(uint256 start, uint8 want, bool anyNonCommon)
        internal
        view
        returns (uint256 pos, bool found)
    {
        uint256 remaining = _remaining;
        for (uint256 k = 0; k < remaining; k++) {
            uint256 p = (start + k) % remaining;
            uint8 r = rarityOf(_valueAt(p));
            if (anyNonCommon ? r != RARITY_COMMON : r == want) {
                return (p, true);
            }
        }
        return (0, false);
    }

    /// @dev Draw one token for a PAID / token mint: lazy
    /// Fisher-Yates over the shared pool. If the drawn
    /// token is Common while every remaining Common is
    /// reserved for free mints (commonsRemaining ==
    /// freeMintsRemaining), the draw scans forward for a
    /// non-Common instead, so the 777 free mints stay
    /// claimable until claimed.
    function _drawMain() internal returns (uint256) {
        if (_remaining == 0) revert SoldOut();
        uint256 j = uint256(keccak256(abi.encodePacked(deckHash, _drawIndex))) % _remaining;
        _drawIndex++;
        uint256 tokenId = _valueAt(j);
        if (
            rarityOf(tokenId) == RARITY_COMMON &&
            freeMintsRemaining() > 0 &&
            commonsRemaining == freeMintsRemaining()
        ) {
            (uint256 pos, bool found) = _findFrom(j, 0, true);
            if (!found) revert NoDrawableToken();
            return _takeAt(pos);
        }
        return _takeAt(j);
    }

    /// @dev Draw one token for a FREE mint: scan the shared
    /// pool from a pseudo-random start for the next Common
    /// and take it. The free-mint reserve invariant
    /// (commonsRemaining >= freeMintsRemaining) guarantees
    /// one exists. Consumes exactly one pool slot, and
    /// that slot is always a Common.
    function _drawFree() internal returns (uint256) {
        if (freeMinted >= FREE_TOTAL) revert FreeExhausted();
        uint256 start = uint256(
            keccak256(abi.encodePacked(deckHash, _drawIndex, "FREE"))
        ) % _remaining;
        _drawIndex++;
        (uint256 pos, bool found) = _findFrom(start, RARITY_COMMON, false);
        if (!found) revert NoDrawableToken();
        freeMinted++;
        return _takeAt(pos);
    }

    /// @dev Draw one token of a specific tier (for upgrades):
    /// scan the shared pool from a pseudo-random start for
    /// the next token of that tier and take it. Reverts when
    /// none of that tier remains in the pool.
    function _drawTier(uint8 want) internal returns (uint256) {
        if (want == RARITY_COMMON && commonsRemaining == 0) revert NoDrawableToken();
        if (want == RARITY_RARE && raresRemaining == 0) revert NoDrawableToken();
        if (want == RARITY_EPIC && epicsRemaining == 0) revert NoDrawableToken();
        if (want == RARITY_LEGENDARY && legendariesRemaining == 0) revert NoDrawableToken();
        uint256 start = uint256(
            keccak256(abi.encodePacked(deckHash, _drawIndex, "TIER", want))
        ) % _remaining;
        _drawIndex++;
        (uint256 pos, bool found) = _findFrom(start, want, false);
        if (!found) revert NoDrawableToken();
        return _takeAt(pos);
    }

    /// @dev Mint one drawn token to `to` with its on-chain
    /// seed, and emit the Minted event. Shared by mint(),
    /// mintWithToken() and upgrade().
    function _mintDrawn(address to, uint256 tokenId, uint256 price, bool viaToken) internal {
        bytes32 seed = keccak256(
            abi.encodePacked(blockhash(block.number - 1), to, tokenId)
        );
        tokenSeed[tokenId] = seed;
        // _mint (not _safeMint): the receiver is always an
        // EOA for mint(), and the owner for upgrade/redeem
        // (an EOA in practice; a contract owner that cannot
        // receive would have failed its own mint first).
        _mint(to, tokenId);
        emit Minted(to, tokenId, price, rarityOf(tokenId), seed, viaToken);
    }

    // ---------- minting ----------

    /// @notice Mint `quantity` THYRK (1-30) in ONE
    /// transaction. Set `useFree` to spend the wallet's
    /// 1 free mint on the highest-priced slot in this
    /// batch (free = Common only, 1 per wallet, 777 total).
    /// Requires, in order: mint active; caller is not a
    /// contract; caller holds an Agent ID (unless the
    /// check is disabled); quantity within 1-30 and the
    /// wallet's 30 cap; deck has enough tokens left;
    /// msg.value covers the batch price from quoteBulk.
    /// PAYMENT FLOW: paid mints forward the exact batch
    /// price DIRECTLY to the revenue wallet in this same
    /// call — it never sits in this contract. Any
    /// overpayment is refunded to the minter in this same
    /// call. If either transfer fails, the whole mint
    /// reverts, so no token is ever minted without payment
    /// landing. Each PAID mint also mints 20 $THYRK to the
    /// minter (the free slot earns 0).
    function mint(uint256 quantity, bool useFree) external payable nonReentrant {
        if (!mintActive) revert MintInactive();
        if (msg.sender.code.length > 0) revert NoContracts();
        if (agentIdCheckRequired && !holdsAgentId(msg.sender)) revert NoAgentId();

        (uint256 totalPrice, uint256 freeSlot) = _quoteBulk(msg.sender, quantity, useFree);
        if (msg.value < totalPrice) revert IncorrectPayment(totalPrice, msg.value);

        for (uint256 i = 0; i < quantity; i++) {
            bool isFree = useFree && (i == freeSlot);
            uint256 tokenId = isFree ? _drawFree() : _drawMain();
            mintCount[msg.sender]++;
            if (isFree) {
                freeUsed[msg.sender] = true;
            } else {
                thyrkToken.mint(msg.sender, MINT_BONUS);
            }
            _mintDrawn(msg.sender, tokenId, isFree ? 0 : priceForCount(mintCount[msg.sender] - 1), false);
        }

        if (totalPrice > 0) {
            (bool ok, ) = revenueWallet.call{value: totalPrice}("");
            if (!ok) revert PaymentForwardFailed();
        }
        uint256 excess = msg.value - totalPrice;
        if (excess > 0) {
            (bool rok, ) = msg.sender.call{value: excess}("");
            if (!rok) revert RefundFailed();
        }
    }

    /// @notice Mint `quantity` THYRK (1-3) with $THYRK
    /// instead of BNB: 100 $THYRK per mint. Max 3 per
    /// wallet, ever. These mints draw from the 7,000
    /// non-free supply, count toward the wallet's 30 max
    /// and advance the ladder number, but pay no BNB and
    /// earn no 20 $THYRK bonus. The caller must approve
    /// this contract to spend their $THYRK first.
    /// Agent ID is required, like any mint. No BNB may be
    /// sent with this call.
    function mintWithToken(uint256 quantity) external payable nonReentrant {
        if (!mintActive) revert MintInactive();
        if (msg.sender.code.length > 0) revert NoContracts();
        if (agentIdCheckRequired && !holdsAgentId(msg.sender)) revert NoAgentId();
        if (msg.value != 0) revert IncorrectPayment(0, msg.value);
        if (quantity == 0 || quantity > MAX_TOKEN_MINTS) revert TokenMintLimit();
        if (tokenMints[msg.sender] + quantity > MAX_TOKEN_MINTS) revert TokenMintLimit();
        if (mintCount[msg.sender] + quantity > MAX_PER_WALLET) revert MaxPerWallet();
        if (_remaining < quantity) revert SoldOut();

        thyrkToken.burnFrom(msg.sender, TOKEN_MINT_COST * quantity);
        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = _drawMain();
            mintCount[msg.sender]++;
            tokenMints[msg.sender]++;
            _mintDrawn(msg.sender, tokenId, 0, true);
        }
    }

    // ---------- $THYRK features ----------

    /// @notice Burn one NFT the caller owns for $THYRK:
    /// Common 20 / Rare 50 / Epic 120 / Legendary 300.
    /// A free Common burns for 20, same as a paid Common.
    /// Burning is permanent — the NFT is gone forever and
    /// does NOT return to the deck. Divine cannot be burned.
    function burn(uint256 tokenId) external nonReentrant {
        if (_ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        uint8 r = rarityOf(tokenId);
        if (r == RARITY_DIVINE) revert BurnDivineNotAllowed();
        uint256 reward = r == RARITY_COMMON
            ? BURN_COMMON
            : r == RARITY_RARE
                ? BURN_RARE
                : r == RARITY_EPIC
                    ? BURN_EPIC
                    : BURN_LEGENDARY;
        _burn(tokenId);
        burnedCount++;
        thyrkToken.mint(msg.sender, reward);
        emit Burned(msg.sender, tokenId, r, reward);
    }

    /// @notice Redeem 1 Divine NFT for 1,500 $THYRK. Divine
    /// is never mintable for BNB. 77 total, first-come
    /// first-served. The 1,500 $THYRK is burned. Divine
    /// token IDs are 7,778-7,854, in redeem order.
    function redeemDivine() external nonReentrant {
        if (divineMinted >= DIVINE_SUPPLY) revert DivineExhausted();
        thyrkToken.burnFrom(msg.sender, REDEEM_DIVINE_COST);
        divineMinted++;
        uint256 tokenId = DIVINE_START_ID + divineMinted - 1;
        _mintDrawn(msg.sender, tokenId, 0, false);
        emit DivineRedeemed(msg.sender, tokenId, REDEEM_DIVINE_COST);
    }

    /// @notice Upgrade 3 NFTs of one tier into 1 NFT of the
    /// next tier: 3 Common + 50 $THYRK -> 1 Rare;
    /// 3 Rare + 100 $THYRK -> 1 Epic; 3 Epic + 200 $THYRK
    /// -> 1 Legendary. The 3 input NFTs are burned and the
    /// $THYRK is burned. The output is drawn from the deck
    /// (a token of the target tier). Upgrade STOPS at
    /// Legendary — Legendary can NEVER be upgraded to
    /// Divine. Upgrade outputs do not count toward the
    /// wallet's 30 mint cap (the inputs already counted).
    function upgrade(uint256 tokenId1, uint256 tokenId2, uint256 tokenId3)
        external
        nonReentrant
    {
        if (
            _ownerOf(tokenId1) != msg.sender ||
            _ownerOf(tokenId2) != msg.sender ||
            _ownerOf(tokenId3) != msg.sender
        ) revert NotTokenOwner();
        uint8 r = rarityOf(tokenId1);
        if (
            r != rarityOf(tokenId2) ||
            r != rarityOf(tokenId3) ||
            r > RARITY_EPIC
        ) revert InvalidUpgrade();
        uint256 cost = r == RARITY_COMMON
            ? UPGRADE_TO_RARE
            : r == RARITY_RARE
                ? UPGRADE_TO_EPIC
                : UPGRADE_TO_LEGENDARY;
        thyrkToken.burnFrom(msg.sender, cost);
        _burn(tokenId1);
        _burn(tokenId2);
        _burn(tokenId3);
        burnedCount += 3;
        uint256 tokenId = _drawTier(r + 1);
        _mintDrawn(msg.sender, tokenId, 0, false);
        emit Upgraded(msg.sender, tokenId, r + 1, cost);
    }

    // ---------- metadata ----------

    function baseURI() public view returns (string memory) {
        return _baseTokenURI;
    }

    /// @notice tokenURI = baseURI + tokenId + ".json" for
    /// mintable tokens (1-7,777), and baseURI + "divine-N"
    /// + ".json" for Divine (7,778-7,854, N = tokenId-7777).
    /// The base URI must end with "/" and point at the
    /// folder holding those files, e.g.
    /// https://raw.githubusercontent.com/nugian10/THYRK/main/collection/metadata/
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert ERC721NonexistentToken(tokenId);
        if (tokenId > MAX_SUPPLY) {
            return string.concat(_baseTokenURI, "divine-", (tokenId - MAX_SUPPLY).toString(), ".json");
        }
        return string.concat(_baseTokenURI, tokenId.toString(), ".json");
    }

    // ---------- owner-only administration ----------

    function setMintActive(bool active) external onlyOwner {
        mintActive = active;
        emit MintActiveChanged(active);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    /// @notice Point the Agent ID check at a different registry
    /// (e.g. if SPACE ID migrates the .ai NFT contract).
    function setAgentIdRegistry(address agentIdRegistry_) external onlyOwner {
        if (agentIdRegistry_ == address(0)) revert InvalidAddress();
        agentIdRegistry = agentIdRegistry_;
        emit AgentIdRegistryUpdated(agentIdRegistry_);
    }

    /// @notice Turn the on-chain Agent ID check on/off.
    /// Turning it OFF makes minting permissionless on-chain and
    /// agent-only in the UI only. The change is public
    /// on-chain via this event — do not hide it.
    function setAgentIdCheckRequired(bool required) external onlyOwner {
        agentIdCheckRequired = required;
        emit AgentIdCheckChanged(required);
    }

    /// @notice Safety valve only: send any balance that
    /// arrived OUTSIDE mint() (e.g. force-sent BNB) to the
    /// revenue wallet. Owner-only. Mint payments are
    /// forwarded directly by mint() and never accumulate
    /// here, so in normal operation this reverts NoFunds.
    function withdraw() external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NoFunds();
        (bool ok, ) = revenueWallet.call{value: amount}("");
        if (!ok) revert("Withdraw failed");
        emit Withdrawn(revenueWallet, amount);
    }

    /// @notice ERC-721 + ERC-2981 interface support.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Royalty)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
