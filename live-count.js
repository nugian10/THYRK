/* THYRK live counters — totalSupply + divineRemaining, read from the
   NFT contract, and $THYRK totalSupply from the token contract, with
   client-side eth_call calls to a public BSC RPC. Also reads
   mintActive() to label the mint status.
   The new NFT contract is deployed at
   0x4D90fFC3075FB8897EDFf6d7c6269c906664a20e and minting is LIVE
   (mintActive is true, activated 10 Nov 2026). The counters read
   live from the contract; the status reads MINT IS LIVE. The
   $THYRK token is already deployed, so its supply keeps reading
   live. The minted counter is TRULY LIVE: totalSupply() is polled
   every 3 seconds (one BSC block) so a new mint shows up within
   ~3-5 seconds. The slow-changing values (divine remaining, mint
   status, $THYRK supply) still refresh every 30 seconds.
   Counts only; never shows prices. Fails soft: shows a dash and retries. */
(function () {
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
  var NOT_DEPLOYED = /^0x0{40}$/.test(NFT);
  var RPCS = [
    "https://bsc-dataseed.binance.org/",
    "https://bsc-dataseed1.defibit.io/",
    "https://bsc-dataseed1.ninicoin.io/"
  ];
  var SEL_MINTED = "0x18160ddd"; // totalSupply()
  var SEL_DIVINE = "0x739f6b19"; // divineRemaining()
  var SEL_ACTIVE = "0x25fd90f3"; // mintActive()
  var SEL_THYRK = "0x18160ddd"; // totalSupply() on the token (18 decimals)
  var REFRESH_MS = 30000; // slow values: divine, status, $THYRK
  var LIVE_MS = 3000; // minted counter: one BSC block, truly live

  function callRpc(url, to, data) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", params: [{ to: to, data: data }, "latest"], id: 1 })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || typeof j.result !== "string") throw new Error("bad rpc result");
      return BigInt(j.result);
    });
  }
  function callFirstRpc(to, data) {
    var chain = Promise.reject(new Error("no rpc"));
    RPCS.forEach(function (url) { chain = chain.catch(function () { return callRpc(url, to, data); }); });
    return chain;
  }
  function setText(kind, value) {
    var els = document.querySelectorAll('[data-live="' + kind + '"]');
    for (var i = 0; i < els.length; i++) els[i].textContent = value;
  }
  function refreshMinted() {
    // Fast live poll: only totalSupply(), every 3s, so the minted
    // counter moves within ~one block of a new mint landing.
    if (NOT_DEPLOYED) { setText("minted", "–"); return; }
    callFirstRpc(NFT, SEL_MINTED).then(function (v) { setText("minted", v.toString()); }).catch(function () { /* keep dash, retry next round */ });
  }
  function refresh() {
    if (NOT_DEPLOYED) {
      // Zero-address guard (not expected now that the contract is
      // deployed): show dashes and make no NFT contract calls.
      setText("minted", "–");
      setText("divine", "–");
      setText("status", t("status.not_open", "MINT NOT YET OPEN"));
    } else {
      refreshMinted();
      // Optimistic status in the current language: the badge's static
      // default text is Japanese, so without this the badge stays
      // Japanese in EN/ZH mode until the RPC below returns (or forever
      // if it fails). The mintActive() call corrects it if the mint
      // is actually closed.
      setText("status", t("status.live", "MINT IS LIVE"));
      callFirstRpc(NFT, SEL_DIVINE).then(function (v) { setText("divine", v.toString()); }).catch(function () { /* keep dash, retry next round */ });
      callFirstRpc(NFT, SEL_ACTIVE).then(function (v) { setText("status", v === 0n ? t("status.not_open", "MINT NOT YET OPEN") : t("status.live", "MINT IS LIVE")); }).catch(function () { /* keep the default text, retry next round */ });
    }
    callFirstRpc(TOKEN, SEL_THYRK).then(function (v) { setText("thyrk", (v / 1000000000000000000n).toString()); }).catch(function () { /* keep dash, retry next round */ });
  }
  /* i18n.js calls this on language switch so the mint status
     re-renders in the new language without waiting for the 30s tick. */
  window.THYRK_LIVE_REFRESH = refresh;
  if (document.querySelector("[data-live]")) {
    refresh();
    setInterval(refreshMinted, LIVE_MS);
    setInterval(refresh, REFRESH_MS);
  }
})();
