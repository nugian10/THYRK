// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ============================================================
// $THYRK — the THYRK utility token (BEP-20 / ERC-20)
// BNB Smart Chain Mainnet (Chain ID 56)
// ------------------------------------------------------------
// - Name "THYRK", symbol "THYRK", 18 decimals.
// - Max supply 777,777, enforced on-chain by ERC20Capped.
//   NOTHING may mint above the cap, from any source.
//   The 151,900 reserve is NEVER pre-minted to anyone.
// - How $THYRK is created (all amounts fixed):
//     paid mint      : 20 $THYRK per paid mint (via ThyrkNFT)
//     burn NFT       : Common 20 / Rare 50 / Epic 120 / Legendary 300
//                      (a free Common also burns for 20)
//     X repost       : 100 $THYRK, max 1 per wallet,
//                      total budget 77,777 (max 777 wallets)
// - How $THYRK is spent (all spent token is BURNED):
//     redeem Divine  : 1,500 $THYRK -> 1 Divine NFT (77 max)
//     token mint     : 100 $THYRK -> 1 mint (max 3 per wallet)
//     upgrade        : 3 Common + 50 -> 1 Rare
//                      3 Rare + 100 -> 1 Epic
//                      3 Epic + 200 -> 1 Legendary
// - Minting is restricted to authorized minters (the ThyrkNFT
//   contract, and later the X-repost claim contract). The owner
//   manages the minter list; the owner itself cannot mint.
// - The X-repost claim system (X API verification) does not
//   exist yet. claimRepost() is ready for it: the owner points
//   repostClaimer at the claim contract once it exists, and the
//   claim contract calls claimRepost(wallet) after verifying
//   the repost off-chain. 1 claim per wallet, budget enforced.
// - Owner = Bryan's Binance Agentic Wallet
//   0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7.
//   Deploy this contract FIRST, then ThyrkNFT with this
//   contract's address, then call setMinter(nft, true).
//
// This contract is SOURCE-VERIFIABLE on BscScan.
// It is NOT an independent audit — keep that disclosure.
// ============================================================

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ThyrkToken is ERC20, ERC20Burnable, ERC20Capped, Ownable {
    /// @notice Hard cap: 777,777 $THYRK. Enforced by ERC20Capped
    /// on every mint. Max creatable from mint+burn is 548,100,
    /// plus repost 77,777 = 625,877; the remaining 151,900 is
    /// RESERVE and is never minted by this contract.
    uint256 public constant MAX_SUPPLY = 777777 ether;

    /// @notice X repost reward: 100 $THYRK = exactly 1 token mint.
    uint256 public constant REPOST_REWARD = 100 ether;
    /// @notice Repost budget: 77,777 $THYRK = max 777 wallets.
    uint256 public constant REPOST_BUDGET = 77777 ether;

    /// @notice Addresses allowed to mint (ThyrkNFT, and later
    /// the X-repost claim contract). Managed by the owner.
    mapping(address => bool) public minters;

    /// @notice The claim-system contract allowed to call
    /// claimRepost(). Set by the owner once the X API claim
    /// system exists. Until then it is address(0) and no
    /// repost can be claimed.
    address public repostClaimer;

    /// @notice $THYRK minted via repost claims so far.
    uint256 public repostMinted;
    /// @notice Wallets that already claimed the repost reward.
    mapping(address => bool) public repostClaimed;

    event MinterSet(address indexed minter, bool allowed);
    event RepostClaimerSet(address indexed claimer);
    event RepostClaimed(address indexed wallet, uint256 amount);

    error NotMinter();
    error NotRepostClaimer();
    error AlreadyClaimed();
    error RepostBudgetExhausted();

    constructor(address initialOwner)
        ERC20("THYRK", "THYRK")
        ERC20Capped(MAX_SUPPLY)
        Ownable(initialOwner)
    {}

    /// @notice Cap enforcement: ERC20Capped checks totalSupply
    /// + value <= cap on every mint (via _update).
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Capped)
    {
        super._update(from, to, value);
    }

    /// @notice Authorize / revoke a minter (ThyrkNFT, and later
    /// the X-repost claim contract if it mints directly).
    /// Owner-only.
    function setMinter(address minter, bool allowed) external onlyOwner {
        minters[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    /// @notice Mint $THYRK to `to`. Only authorized minters
    /// (ThyrkNFT for paid-mint bonuses and burn rewards).
    /// The cap is enforced by ERC20Capped.
    function mint(address to, uint256 amount) external {
        if (!minters[msg.sender]) revert NotMinter();
        _mint(to, amount);
    }

    /// @notice Point the repost claim at the claim-system
    /// contract (set once the X API verification exists).
    /// Owner-only.
    function setRepostClaimer(address claimer) external onlyOwner {
        repostClaimer = claimer;
        emit RepostClaimerSet(claimer);
    }

    /// @notice Pay the X-repost reward (100 $THYRK) to `to`.
    /// Called by the claim system AFTER it verifies via the
    /// X API that `to`'s X account reposted the official
    /// THYRK post. Max 1 per wallet, total budget 77,777.
    function claimRepost(address to) external {
        if (msg.sender != repostClaimer) revert NotRepostClaimer();
        if (repostClaimed[to]) revert AlreadyClaimed();
        if (repostMinted + REPOST_REWARD > REPOST_BUDGET)
            revert RepostBudgetExhausted();
        repostClaimed[to] = true;
        repostMinted += REPOST_REWARD;
        _mint(to, REPOST_REWARD);
        emit RepostClaimed(to, REPOST_REWARD);
    }
}
