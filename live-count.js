/* THYRK live counters — totalSupply + freeMintsRemaining, read from the NFT
   contract with a client-side eth_call to a public BSC RPC.
   Counts only; never shows prices. Fails soft: shows a dash and retries. */
(function () {
  var NFT = "0xeff20913f99fd153da1b27bd96401089d3323bb8";
  var RPCS = [
    "https://bsc-dataseed.binance.org/",
    "https://bsc-dataseed1.defibit.io/",
    "https://bsc-dataseed1.ninicoin.io/"
  ];
  var SEL_MINTED = "0x18160ddd"; // totalSupply()
  var SEL_FREE = "0x8868b9ff"; // freeMintsRemaining()
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
  }
  if (document.querySelector("[data-live]")) {
    refresh();
    setInterval(refresh, REFRESH_MS);
  }
})();
