/* THYRK manual actions — shared by redeem.html, token-mint.html,
   upgrade.html and burn.html. Lets a visitor connect their own wallet
   and call the contracts directly (burn, redeem Divine, upgrade,
   mint with $THYRK). The BNB mint stays agent-only: this file NEVER
   calls mint(uint256).
   Uses ethers v6 (UMD build from the CDN, loaded before this file,
   same as deploy.html). Reads go through public BSC RPCs (no wallet
   needed); writes go through the connected injected wallet. */
(function () {
  "use strict";
  /* t(): translated string via i18n.js when loaded, else the English
     fallback passed inline (fb). Vars like {n} are substituted. */
  function t(k, fb, vars) {
    if (window.THYRK_T) return window.THYRK_T(k, vars);
    var s = fb;
    if (vars) for (var n in vars) s = s.split("{" + n + "}").join(String(vars[n]));
    return s;
  }


  var NFT = "0x4D90fFC3075FB8897EDFf6d7c6269c906664a20e";
  var TOKEN = "0x3b8747d067b2ed8565330667128260c2a4954300";
  var CHAIN_ID = 56;
  var RPCS = [
    "https://bsc-dataseed.binance.org/",
    "https://bsc-dataseed1.defibit.io/",
    "https://bsc-dataseed1.ninicoin.io/"
  ];

  /* Minimal ABIs — function names and signatures taken from
     new-contract/contracts/ThyrkNFT.sol and the $THYRK token. */
  var NFT_ABI = [
    "function burn(uint256 tokenId)",
    "function redeemDivine()",
    "function upgrade(uint256 tokenId1, uint256 tokenId2, uint256 tokenId3)",
    "function mintWithToken(uint256 quantity)",
    "function rarityOf(uint256 tokenId) view returns (uint8)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function holdsAgentId(address wallet) view returns (bool)",
    "function tokenMints(address) view returns (uint256)",
    "function divineRemaining() view returns (uint256)",
    "function divineMinted() view returns (uint256)",
    "function mintActive() view returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "event Upgraded(address indexed upgrader, uint256 indexed tokenId, uint8 rarity, uint256 cost)",
    "event DivineRedeemed(address indexed redeemer, uint256 indexed tokenId, uint256 cost)",
    "event Burned(address indexed burner, uint256 indexed tokenId, uint8 rarity, uint256 reward)"
  ];
  var TOKEN_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)"
  ];

  var readProvider = null;
  var signer = null;
  var account = null;

  function shortAddr(a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : "—"; }
  function errMsg(e) {
    if (!e) return "Unknown error.";
    return e.reason || e.message || String(e);
  }
  function txAnchor(hash) {
    return '<a href="https://bscscan.com/tx/' + hash + '" target="_blank" rel="noopener">' + t("manual.view_bscscan", "View on BscScan") + '</a>';
  }
  function fmtThyrk(wei) {
    try { return (BigInt(wei) / 1000000000000000000n).toString(); }
    catch (e) { return "—"; }
  }
  async function withTimeout(p, ms) {
    var t;
    var timeout = new Promise(function (_, rej) {
      t = setTimeout(function () { rej(new Error("timed out")); }, ms);
    });
    try { return await Promise.race([p, timeout]); }
    finally { clearTimeout(t); }
  }

  async function getReadProvider() {
    if (typeof ethers === "undefined") {
      throw new Error(t("manual.lib_missing", "The wallet library did not load — check your connection and refresh this page."));
    }
    if (readProvider) return readProvider;
    for (var i = 0; i < RPCS.length; i++) {
      try {
        var p = new ethers.JsonRpcProvider(RPCS[i], CHAIN_ID);
        await withTimeout(p.getBlockNumber(), 8000);
        readProvider = p;
        return p;
      } catch (e) { /* try the next RPC */ }
    }
    throw new Error(t("manual.no_chain", "Could not reach BNB Chain — check your connection and try again."));
  }

  async function nftRead() { return new ethers.Contract(NFT, NFT_ABI, await getReadProvider()); }
  async function tokenRead() { return new ethers.Contract(TOKEN, TOKEN_ABI, await getReadProvider()); }

  async function getSigner() {
    if (!signer) throw new Error(t("manual.connect_first", "Connect your wallet first."));
    return signer;
  }
  async function nftWrite() { return new ethers.Contract(NFT, NFT_ABI, await getSigner()); }
  async function tokenWrite() { return new ethers.Contract(TOKEN, TOKEN_ABI, await getSigner()); }

  /* Connect the injected wallet (MetaMask / Binance Wallet) on BNB Chain.
     Returns the connected address, or null. Updates every
     [data-manual-wallet] status line on the page. */
  async function connect(statusFn) {
    if (typeof ethers === "undefined") {
      if (statusFn) statusFn(t("manual.lib_missing", "The wallet library did not load — check your connection and refresh this page."));
      return null;
    }
    if (typeof window.ethereum === "undefined") {
      if (statusFn) statusFn(t("manual.no_wallet", "No wallet found — install MetaMask or Binance Wallet, then refresh this page."));
      return null;
    }
    try {
      var provider = new ethers.BrowserProvider(window.ethereum);
      var accounts = await provider.send("eth_requestAccounts", []);
      if (!accounts || !accounts.length) throw new Error(t("manual.no_account", "No account selected."));
      var net = await provider.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID) {
        try {
          await provider.send("wallet_switchEthereumChain", [{ chainId: "0x38" }]);
        } catch (e) {
          if (statusFn) statusFn(t("manual.switch_chain", "Please switch your wallet to BNB Smart Chain (chain 56) and try again."));
          return null;
        }
        provider = new ethers.BrowserProvider(window.ethereum);
      }
      signer = await provider.getSigner();
      account = await signer.getAddress();
      var els = document.querySelectorAll("[data-manual-wallet]");
      for (var i = 0; i < els.length; i++) els[i].textContent = t("manual.connected", "Connected: {addr}.", { addr: shortAddr(account) });
      return account;
    } catch (e) {
      if (statusFn) statusFn(t("manual.connect_fail", "Could not connect wallet: {err}", { err: errMsg(e) }));
      return null;
    }
  }

  /* Approve the NFT contract to spend `amount` $THYRK (wei) if the
     current allowance is short. Sends one approval transaction and
     waits for it. Returns true when the allowance covers the amount. */
  async function ensureAllowance(amount, statusFn) {
    var t = await tokenWrite();
    var allow = await t.allowance(account, NFT);
    if (allow >= amount) return true;
    if (statusFn) statusFn(t("manual.approving", "Approving $THYRK for the NFT contract — confirm it in your wallet."));
    var tx = await t.approve(NFT, amount);
    if (statusFn) statusFn(t("manual.approval_sent", "Approval sent — waiting for confirmation…"));
    await tx.wait();
    return true;
  }

  window.THYRK_MANUAL = {
    NFT: NFT,
    TOKEN: TOKEN,
    CHAIN_ID: CHAIN_ID,
    NFT_ABI: NFT_ABI,
    TOKEN_ABI: TOKEN_ABI,
    connect: connect,
    account: function () { return account; },
    nftRead: nftRead,
    tokenRead: tokenRead,
    nftWrite: nftWrite,
    tokenWrite: tokenWrite,
    ensureAllowance: ensureAllowance,
    shortAddr: shortAddr,
    errMsg: errMsg,
    txAnchor: txAnchor,
    fmtThyrk: fmtThyrk
  };
})();
