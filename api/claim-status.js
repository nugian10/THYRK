// GET /api/claim-status — public claim state.
// Query: ?wallet=0x... [&txHash=0x...]
// Returns: { configured, claimsLeft, repostMinted, walletClaimed, xClaimed,
//   txStatus }.
// - configured: false when the backend env vars are missing (claim page
//   shows COMING SOON in that case).
// - If txHash is given, the receipt is checked; on success the registry
//   entry is reconciled (confirmed) — this is the recovery path if the
//   user closed the page before /api/claim finished writing.
'use strict';
const common = require('../lib/claim-common');

module.exports = async (req, res) => {
  common.cors(req, res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'GET') return common.json(res, 405, { error: 'method not allowed' });
  try {
    const cfg = common.getConfig();
    const url = new URL(req.url, 'http://localhost');
    const wallet = (url.searchParams.get('wallet') || '').toLowerCase();
    const txHash = url.searchParams.get('txHash') || '';
    if (!cfg.configured) {
      return common.json(res, 200, { configured: false, claimsLeft: 777, repostMinted: 0 });
    }
    const out = { configured: true };
    try {
      const st = await common.getRepostState(cfg);
      out.repostMinted = Number(st.repostMinted / (10n ** 18n));
      out.claimsLeft = st.claimsLeft;
    } catch (e) {
      console.error('claim-status chain read failed:', e && e.message);
      out.repostMinted = null;
      out.claimsLeft = null;
    }
    if (wallet && /^0x[0-9a-f]{40}$/.test(wallet)) {
      try { out.walletClaimed = await common.walletHasClaimed(cfg, wallet); } catch (e) { out.walletClaimed = null; }
    }
    if (txHash && /^0x[0-9a-f]{64}$/.test(txHash)) {
      try {
        const receipt = await common.getTxReceipt(cfg, txHash);
        out.txStatus = !receipt ? 'pending' : (receipt.status === '0x1' ? 'confirmed' : 'failed');
        if (out.txStatus === 'confirmed' || out.txStatus === 'failed') {
          // Reconcile the registry entry for this tx.
          try {
            await common.updateRegistry(cfg, (data) => {
              const c = (data.claims || []).find((x) => x.txHash && x.txHash.toLowerCase() === txHash.toLowerCase());
              if (c && c.status === 'pending') {
                c.status = out.txStatus;
                if (out.txStatus === 'confirmed') c.confirmedAt = new Date().toISOString();
              }
            });
          } catch (e) { console.error('claim-status reconcile failed:', e && e.message); }
        }
      } catch (e) {
        out.txStatus = null;
      }
    }
    return common.json(res, 200, out);
  } catch (e) {
    console.error('claim-status error:', e && e.message);
    return common.json(res, 500, { error: 'server_error' });
  }
};
