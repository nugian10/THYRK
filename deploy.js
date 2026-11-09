// THYRK — browser-wallet deploy page logic (owner tool).
// Uses ONLY the connected browser wallet (MetaMask / injected
// provider) to sign. This page NEVER asks for, accepts, or
// handles a seed phrase or private key. Every transaction
// needs the user's explicit click + wallet confirmation.
//
// Deploys TWO contracts in order: ThyrkToken first, then
// ThyrkNFT (which needs the token address). The deployer wallet
// pays gas ONLY — the owner of both contracts is Bryan's My Wallet,
// passed as a constructor argument, while mint payments and the
// 5% royalty go to the Binance Agentic Wallet (revenue). Steps 5–6
// (setMinter, activate) are owner-only: they run in-page when the
// connected wallet IS the owner (My Wallet), and the page shows
// the exact manual call otherwise.
//
// Requires ethers v6 (UMD build) loaded from CDN before this
// file, and thyrk-artifact.json (ABI + bytecode + rarity bitmap)
// next to deploy.html. See scripts/sync-deploy-artifact.py.
(function () {
  "use strict";

  // ---- Locked deployment parameters (verified against
  // contracts/ThyrkToken.sol, contracts/ThyrkNFT.sol,
  // collection/manifest.json, collection/rarity-bitmap.json
  // and scripts/deploy.js — do not change here) ----
  var OWNER = "0x0262e8e5E4584D8AB840fD950a6E2E0A414d4097"; // Bryan's My Wallet (owner of BOTH contracts)
  var REVENUE = "0x89c37649Ba3BAA9E1ce028612b7DE4e9c3a947B7"; // Binance Agentic Wallet (revenue only)
  var REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F"; // SPACE ID Agent ID registry
  var BASE_URI = "https://raw.githubusercontent.com/nugian10/THYRK/main/collection/metadata/";
  var DECK_HASH = "0x592a9180d7c57fa9c609176c204e8c4950ee20d7d13c5705c0227516e97e8233"; // seed 0x544859524b
  var BSC_CHAIN_ID = 56n;
  var BSC_CHAIN_HEX = "0x38";
  var MEASURED_TOKEN_GAS = 893465; // hardhat measurement (Nov 2026)
  var MEASURED_NFT_GAS = 4952067; // hardhat measurement incl. 61-word bitmap (Nov 2026)
  var MEASURED_SETMINTER_GAS = 47810; // hardhat measurement
  var MEASURED_ACTIVATE_GAS = 29832; // hardhat measurement for setMintActive(true)
  var BNB_IDR_REF = 12229764; // reference rate only, for the estimate display

  // ---- State ----
  var provider = null;
  var signer = null;
  var account = null;
  var artifact = null; // { token: {abi, bytecode}, nft: {abi, bytecode}, rarityBitmap, deckHash }
  var tokenAddress = null;
  var nftAddress = null;

  // ---- DOM helpers ----
  function $(id) { return document.getElementById(id); }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }
  function show(id) { var el = $(id); if (el) el.classList.remove("hidden"); }
  function hide(id) { var el = $(id); if (el) el.classList.add("hidden"); }
  function setStep(n, state) {
    var el = $("step-" + n);
    if (!el) return;
    el.classList.remove("todo", "active", "done", "blocked");
    el.classList.add(state);
  }
  function note(msg, kind) {
    var el = $("note");
    if (!el) return;
    el.textContent = msg;
    el.className = "note-box " + (kind || "info");
    show("note");
  }
  function bscscanTx(hash) { return "https://bscscan.com/tx/" + hash; }
  function bscscanAddr(addr) { return "https://bscscan.com/address/" + addr; }
  function fmtBnb(wei) {
    try { return ethers.formatEther(wei); } catch (e) { return "?"; }
  }
  function fmtIdr(bnbWei) {
    try {
      var bnb = parseFloat(ethers.formatEther(bnbWei));
      return "Rp " + Math.round(bnb * BNB_IDR_REF).toLocaleString("en-US");
    } catch (e) { return "—"; }
  }
  function isOwner() {
    return !!(account && account.toLowerCase() === OWNER.toLowerCase());
  }

  // ---- Page boot: load artifact, check for a wallet ----
  async function boot() {
    setStep(1, "active");
    if (typeof ethers === "undefined") {
      note("Could not load ethers.js from the CDN. Check your internet connection and reload the page.", "error");
      return;
    }
    try {
      var res = await fetch("thyrk-artifact.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      artifact = await res.json();
      if (!artifact || !artifact.token || !artifact.nft ||
          !artifact.token.abi || !artifact.token.bytecode ||
          !artifact.nft.abi || !artifact.nft.bytecode ||
          !Array.isArray(artifact.rarityBitmap) || artifact.rarityBitmap.length !== 61) {
        throw new Error("artifact file is missing token/nft abi/bytecode or the 61-word bitmap");
      }
      if (artifact.deckHash && artifact.deckHash.toLowerCase() !== DECK_HASH.toLowerCase()) {
        throw new Error("artifact deckHash does not match the locked DECK_HASH — do not deploy");
      }
      setText("artifact-status", "Loaded — ThyrkToken (" + artifact.token.abi.length +
        " ABI entries) + ThyrkNFT (" + artifact.nft.abi.length +
        " ABI entries, bitmap " + artifact.rarityBitmap.length + " words)");
    } catch (e) {
      note("Could not load thyrk-artifact.json (" + e.message + "). " +
        "If you opened this file directly from disk, open it through a web server " +
        "instead (or through the deployed site) — browsers block local file loading. " +
        "Nothing has been sent anywhere.", "error");
      return;
    }
    if (!window.ethereum) {
      note("No browser wallet found. Install MetaMask (or another injected wallet), " +
        "then reload this page. This page will never ask for your seed phrase or private key.", "error");
      return;
    }
    window.ethereum.on("accountsChanged", function () { connect({ silent: true }); });
    window.ethereum.on("chainChanged", function () { connect({ silent: true }); });
    setText("wallet-status", "Wallet detected. Click “Connect Wallet”.");
  }

  // ---- Step 1: connect + chain check ----
  async function connect(opts) {
    opts = opts || {};
    try {
      provider = new ethers.BrowserProvider(window.ethereum);
      var accounts = await provider.send("eth_requestAccounts", []);
      if (!accounts || accounts.length === 0) throw new Error("no account returned");
      account = ethers.getAddress(accounts[0]);
      signer = await provider.getSigner();
      setText("wallet-status", "Connected: " + account + " (pays gas only — owner is My Wallet)");
      setText("wallet-address", account);
      show("wallet-address-row");
      await checkChain();
    } catch (e) {
      if (!opts.silent) note("Wallet connection failed: " + (e && e.message ? e.message : e), "error");
    }
  }

  async function checkChain() {
    var net = await provider.getNetwork();
    if (net.chainId === BSC_CHAIN_ID) {
      setText("chain-status", "BNB Smart Chain (chain 56) ✓");
      hide("switch-row");
      setStep(1, "done");
      setStep(2, "active");
      await refreshEstimate();
      return true;
    }
    setText("chain-status", "Wrong network: chain " + net.chainId.toString() +
      " — these contracts deploy ONLY on BNB Smart Chain (56).");
    show("switch-row");
    setStep(1, "blocked");
    note("You are on the wrong network. Click “Switch to BNB Smart Chain” and confirm in your wallet.", "warn");
    return false;
  }

  async function switchChain() {
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: BSC_CHAIN_HEX }]);
      await checkChain();
    } catch (e) {
      if (e && e.code === 4902) {
        try {
          await provider.send("wallet_addEthereumChain", [{
            chainId: BSC_CHAIN_HEX,
            chainName: "BNB Smart Chain",
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: ["https://bsc-dataseed.binance.org/"],
            blockExplorerUrls: ["https://bscscan.com"]
          }]);
          await checkChain();
        } catch (e2) {
          note("Could not add BNB Smart Chain to your wallet: " + (e2 && e2.message ? e2.message : e2), "error");
        }
      } else {
        note("Network switch failed: " + (e && e.message ? e.message : e), "error");
      }
    }
  }

  // ---- Step 2: cost estimate (live gas price + measured gas) ----
  async function refreshEstimate() {
    if (!provider || !artifact) return;
    setText("estimate-status", "Estimating…");
    try {
      var fee = await provider.getFeeData();
      var gasPrice = fee.gasPrice || fee.maxFeePerGas;
      if (!gasPrice) throw new Error("no gas price from network");
      var gasPriceGwei = ethers.formatUnits(gasPrice, "gwei");
      setText("gas-price", parseFloat(gasPriceGwei).toFixed(4) + " gwei");

      var totalGas = MEASURED_TOKEN_GAS + MEASURED_NFT_GAS;
      var costWei = gasPrice * BigInt(totalGas);
      setText("gas-estimate", totalGas.toLocaleString("en-US") + " gas (measured reference: token " +
        MEASURED_TOKEN_GAS.toLocaleString("en-US") + " + NFT " +
        MEASURED_NFT_GAS.toLocaleString("en-US") + ")");
      setText("cost-bnb", fmtBnb(costWei) + " BNB");
      setText("cost-idr", fmtIdr(costWei) + " (approx., at Rp " +
        BNB_IDR_REF.toLocaleString("en-US") + " / BNB)");
      setText("estimate-status", "Estimate ready. Measured deploy gas was " +
        MEASURED_TOKEN_GAS.toLocaleString("en-US") + " (token) + " +
        MEASURED_NFT_GAS.toLocaleString("en-US") + " (NFT) ≈ 0.000297 BNB / ≈ Rp 3,622 at 0.05 gwei. " +
        "setMinter is a separate small transaction afterwards, measured at " +
        MEASURED_SETMINTER_GAS.toLocaleString("en-US") + " gas; activation (setMintActive) " +
        MEASURED_ACTIVATE_GAS.toLocaleString("en-US") + " gas.");
      setStep(2, "done");
      setStep(3, "active");
    } catch (e) {
      setText("estimate-status", "Estimate failed: " + (e && e.message ? e.message : e));
      note("Could not estimate the deployment cost: " + (e && e.message ? e.message : e) +
        ". Check your connection and try “Refresh estimate”.", "error");
    }
    updateButtons();
  }

  function updateButtons() {
    var ready = !!(provider && signer && account && artifact);
    var tb = $("deploy-token-btn");
    if (tb) tb.disabled = !ready || !!tokenAddress;
    var nb = $("deploy-nft-btn");
    if (nb) nb.disabled = !(ready && tokenAddress && !nftAddress);
    var sb = $("setminter-btn");
    if (sb) sb.disabled = !(ready && tokenAddress && nftAddress && isOwner());
    var ab = $("activate-btn");
    if (ab) ab.disabled = !(ready && nftAddress && isOwner());
  }

  function updateMinterStep() {
    var badge = $("minter-badge");
    if (!tokenAddress || !nftAddress) {
      badge.textContent = "Waiting for both deploys";
      badge.className = "badge2";
      hide("minter-owner-row");
      hide("minter-agent-row");
      return;
    }
    if (isOwner()) {
      badge.textContent = "Owner connected ✓ — you can run this step here";
      badge.className = "badge2 ok";
      show("minter-owner-row");
      hide("minter-agent-row");
    } else {
      badge.textContent = "Owner NOT connected — connect My Wallet to run it here";
      badge.className = "badge2 bad";
      hide("minter-owner-row");
      show("minter-agent-row");
      setText("minter-call", "ThyrkToken(" + tokenAddress + ").setMinter(" + nftAddress + ", true)");
    }
    updateButtons();
  }

  // ---- Step 3: deploy token ----
  async function deployToken() {
    if (!provider || !signer || !account || !artifact) {
      note("Connect a wallet on BNB Smart Chain first.", "warn");
      return;
    }
    var btn = $("deploy-token-btn");
    btn.disabled = true;
    setText("deploy-token-status", "Sending token deployment transaction… confirm it in your wallet.");
    try {
      var factory = new ethers.ContractFactory(artifact.token.abi, artifact.token.bytecode, signer);
      var contract = await factory.deploy(OWNER);
      var tx = contract.deploymentTransaction();
      setText("deploy-token-tx", tx.hash);
      $("deploy-token-tx-link").href = bscscanTx(tx.hash);
      show("deploy-token-tx-row");
      setText("deploy-token-status", "Transaction sent. Waiting for confirmation on BNB Smart Chain…");
      await contract.waitForDeployment();
      tokenAddress = await contract.getAddress();
      setText("token-address", tokenAddress);
      $("token-address-link").href = bscscanAddr(tokenAddress);
      show("token-deployed-row");
      setText("deploy-token-status", "Deployed ✓ — $THYRK token is live at " + tokenAddress +
        ". Owner is My Wallet.");
      setStep(3, "done");
      setStep(4, "active");
      $("nft-token-address").value = tokenAddress;
      note("Token deployed! Next: deploy the NFT contract (step 4).", "ok");
    } catch (e) {
      btn.disabled = false;
      setText("deploy-token-status", "Deployment failed or was rejected in your wallet: " +
        (e && e.message ? e.message : e));
      note("Token deployment did not complete: " + (e && e.message ? e.message : e) +
        ". No contract was deployed. You can try again.", "error");
    }
    updateButtons();
  }

  // ---- Step 4: deploy NFT ----
  async function deployNft() {
    if (!tokenAddress) {
      note("Deploy the $THYRK token first (step 3).", "warn");
      return;
    }
    var addr = $("nft-token-address").value.trim();
    if (!ethers.isAddress(addr)) {
      note("The token address is not valid.", "error");
      return;
    }
    var btn = $("deploy-nft-btn");
    btn.disabled = true;
    setText("deploy-nft-status", "Sending NFT deployment transaction… confirm it in your wallet.");
    try {
      var factory = new ethers.ContractFactory(artifact.nft.abi, artifact.nft.bytecode, signer);
      var contract = await factory.deploy(
        OWNER, REVENUE, REGISTRY, BASE_URI, DECK_HASH, artifact.rarityBitmap, addr
      );
      var tx = contract.deploymentTransaction();
      setText("deploy-nft-tx", tx.hash);
      $("deploy-nft-tx-link").href = bscscanTx(tx.hash);
      show("deploy-nft-tx-row");
      setText("deploy-nft-status", "Transaction sent. Waiting for confirmation on BNB Smart Chain…");
      await contract.waitForDeployment();
      nftAddress = await contract.getAddress();
      setText("nft-address", nftAddress);
      $("nft-address-link").href = bscscanAddr(nftAddress);
      $("nft-verify-link").href = bscscanAddr(nftAddress);
      show("nft-deployed-row");
      setText("deploy-nft-status", "Deployed ✓ — ThyrkNFT is live at " + nftAddress +
        ". Minting is still OFF (mintActive = false) until you activate it below.");
      setStep(4, "done");
      setStep(5, "active");
      $("activate-address").value = nftAddress;
      await refreshActivateEstimate();
      updateMinterStep();
      note("NFT deployed! Next: setMinter (step 5) — owner-only, run it here from My Wallet.", "ok");
    } catch (e) {
      btn.disabled = false;
      setText("deploy-nft-status", "Deployment failed or was rejected in your wallet: " +
        (e && e.message ? e.message : e));
      note("NFT deployment did not complete: " + (e && e.message ? e.message : e) +
        ". No contract was deployed. You can try again.", "error");
    }
    updateButtons();
  }

  // ---- Step 5: setMinter (owner only) ----
  async function setMinter() {
    if (!isOwner()) {
      note("Only the owner wallet (My Wallet) can call setMinter. Connect My Wallet to run it here.", "error");
      return;
    }
    if (!tokenAddress || !nftAddress) {
      note("Deploy both contracts first.", "warn");
      return;
    }
    var btn = $("setminter-btn");
    btn.disabled = true;
    setText("setminter-status", "Sending setMinter(nft, true)… confirm it in your wallet.");
    try {
      var c = new ethers.Contract(tokenAddress, artifact.token.abi, signer);
      var tx = await c.setMinter(nftAddress, true);
      setText("setminter-tx", tx.hash);
      $("setminter-tx-link").href = bscscanTx(tx.hash);
      show("setminter-tx-row");
      setText("setminter-status", "Transaction sent. Waiting for confirmation…");
      await tx.wait();
      var ok = await c.minters(nftAddress);
      if (ok) {
        setText("setminter-status", "Minter set ✓ — the NFT contract can now mint $THYRK rewards.");
        setStep(5, "done");
        setStep(6, "active");
        note("Minter set! Next: activate minting (step 6) — only when Bryan lifts the launch hold.", "ok");
      } else {
        setText("setminter-status", "Transaction confirmed but minters(nft) is still false. Check BscScan.");
        btn.disabled = false;
      }
    } catch (e) {
      btn.disabled = false;
      setText("setminter-status", "setMinter failed or was rejected in your wallet: " +
        (e && e.message ? e.message : e));
      note("setMinter did not complete: " + (e && e.message ? e.message : e) + ". You can try again.", "error");
    }
  }

  // ---- Step 6: activate mint (owner only) ----
  async function refreshActivateEstimate() {
    var addr = $("activate-address").value.trim();
    var btn = $("activate-btn");
    btn.disabled = true;
    if (!addr || !ethers.isAddress(addr)) {
      setText("activate-estimate", "Enter the deployed contract address first.");
      return;
    }
    if (!provider) {
      setText("activate-estimate", "Connect your wallet first.");
      return;
    }
    if (!isOwner()) {
      setText("activate-estimate", "Activation is owner-only: the connected wallet is not My Wallet. " +
        "Connect My Wallet to run it here — setMintActive(true) on " + addr + ".");
      return;
    }
    try {
      var fee = await provider.getFeeData();
      var gasPrice = fee.gasPrice || fee.maxFeePerGas;
      var gas = null;
      try {
        var c = new ethers.Contract(addr, artifact.nft.abi, signer);
        gas = await c.setMintActive.estimateGas(true);
      } catch (e) { gas = null; }
      var gasUsed = gas ? Number(gas) : MEASURED_ACTIVATE_GAS;
      var costWei = gasPrice * BigInt(gasUsed);
      setText("activate-estimate", "Estimated: " + gasUsed.toLocaleString("en-US") + " gas ≈ " +
        fmtBnb(costWei) + " BNB (" + fmtIdr(costWei) + " approx.) at " +
        parseFloat(ethers.formatUnits(gasPrice, "gwei")).toFixed(4) + " gwei" +
        (gas ? "" : " — measured reference, live estimate unavailable") + ".");
      btn.disabled = false;
    } catch (e) {
      setText("activate-estimate", "Estimate failed: " + (e && e.message ? e.message : e));
    }
  }

  async function activate() {
    var addr = $("activate-address").value.trim();
    if (!ethers.isAddress(addr)) {
      note("The contract address is not valid.", "error");
      return;
    }
    if (!isOwner()) {
      note("Only the owner wallet (My Wallet) can activate minting.", "error");
      return;
    }
    var btn = $("activate-btn");
    btn.disabled = true;
    setText("activate-status", "Sending setMintActive(true)… confirm it in your wallet.");
    try {
      var c = new ethers.Contract(addr, artifact.nft.abi, signer);
      var tx = await c.setMintActive(true);
      setText("activate-tx", tx.hash);
      $("activate-tx-link").href = bscscanTx(tx.hash);
      show("activate-tx-row");
      setText("activate-status", "Transaction sent. Waiting for confirmation…");
      await tx.wait();
      var onChain = await c.mintActive();
      if (onChain) {
        setText("activate-status", "Minting is now ACTIVE ✓ — mintActive = true. The collection is live.");
        setStep(6, "done");
        show("done-box");
        note("Done — minting is live. Next: update the site with the contract addresses " +
          "and announce the launch (only after Bryan lifts the public launch hold).", "ok");
      } else {
        setText("activate-status", "Transaction confirmed but mintActive is still false. Check BscScan.");
        btn.disabled = false;
      }
    } catch (e) {
      btn.disabled = false;
      setText("activate-status", "Activation failed or was rejected in your wallet: " +
        (e && e.message ? e.message : e));
      note("Activation did not complete: " + (e && e.message ? e.message : e) + ". You can try again.", "error");
    }
  }

  function copyText(text, btn) {
    var done = function () { if (btn) { btn.textContent = "Copied ✓"; setTimeout(function () { btn.textContent = "Copy"; }, 2000); } };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  // ---- Wire up buttons once the DOM is ready ----
  document.addEventListener("DOMContentLoaded", function () {
    $("connect-btn").addEventListener("click", function () { connect(); });
    $("switch-btn").addEventListener("click", switchChain);
    $("refresh-estimate-btn").addEventListener("click", refreshEstimate);
    $("deploy-token-btn").addEventListener("click", deployToken);
    $("deploy-nft-btn").addEventListener("click", deployNft);
    $("setminter-btn").addEventListener("click", setMinter);
    $("activate-btn").addEventListener("click", activate);
    $("refresh-activate-btn").addEventListener("click", refreshActivateEstimate);
    $("activate-address").addEventListener("input", refreshActivateEstimate);
    $("nft-token-address").addEventListener("input", updateButtons);
    $("copy-token-btn").addEventListener("click", function () {
      copyText(tokenAddress || "", this);
    });
    $("copy-nft-btn").addEventListener("click", function () {
      copyText(nftAddress || "", this);
    });
    $("copy-minter-call-btn").addEventListener("click", function () {
      copyText($("minter-call").textContent, this);
    });
    boot();
  });
})();
