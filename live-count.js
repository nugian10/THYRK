/* THYRK live counters — totalSupply + freeMintsRemaining + divineRemaining,
   read from the NFT contract, and $THYRK totalSupply from the token
   contract, with client-side eth_call calls to a public BSC RPC.
   Also reads mintActive() to label the mint status: MINT CLOSED when
   false. Minting closed 9 Nov 2026 (21 of 7,777 minted); the counters
   below keep reading the final on-chain values.
   Counts only; never shows prices. Fails soft: shows a dash and retries. */
(function () {
  var NFT = "0xeff20913f99fd153da1b27bd96401089d3323bb8";
  var TOKEN = "0x3b8747d067b2ed8565330667128260c2a4954300";
  var RPCS = [
    "https://bsc-dataseed.binance.org/",
    "https://bsc-dataseed1.defibit.io/",
    "https://bsc-dataseed1.ninicoin.io/"
  ];
  var SEL_MINTED = "0x18160ddd"; // totalSupply()
  var SEL_FREE = "0x8868b9ff"; // freeMintsRemaining()
  var SEL_DIVINE = "0x739f6b19"; // divineRemaining()
  var SEL_ACTIVE = "0x25fd90f3"; // mintActive()
  var SEL_THYRK = "0x18160ddd"; // totalSupply() on the token (18 decimals)
  var REFRESH_MS = 30000;

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
  function refresh() {
    callFirstRpc(NFT, SEL_MINTED).then(function (v) { setText("minted", v.toString()); }).catch(function () { /* keep dash, retry next round */ });
    callFirstRpc(NFT, SEL_FREE).then(function (v) { setText("free", v.toString()); }).catch(function () { /* keep dash, retry next round */ });
    callFirstRpc(NFT, SEL_DIVINE).then(function (v) { setText("divine", v.toString()); }).catch(function () { /* keep dash, retry next round */ });
    callFirstRpc(NFT, SEL_ACTIVE).then(function (v) { setText("status", v === 0n ? "MINT CLOSED" : "MINT IS LIVE"); }).catch(function () { /* keep the default text, retry next round */ });
    callFirstRpc(TOKEN, SEL_THYRK).then(function (v) { setText("thyrk", (v / 1000000000000000000n).toString()); }).catch(function () { /* keep dash, retry next round */ });
  }
  if (document.querySelector("[data-live]")) {
    refresh();
    setInterval(refresh, REFRESH_MS);
  }
})();
