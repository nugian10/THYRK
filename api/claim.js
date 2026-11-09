// POST /api/claim — pay the 100 $THYRK repost reward.
// Body: { session, wallet, message, signature }.
// 1. Verify the HMAC session (must say reposted=true, not expired).
// 2. Verify the wallet signature on the claim message (proves the caller
//    owns the wallet, and binds wallet + X account + session together).
// 3. Enforce 1-per-X-account (registry) and 1-per-wallet + budget
//    (on-chain, ThyrkToken.claimRepost).
// 4. Write a PENDING registry entry, send claimRepost() from the claimer
//    wallet, wait for the receipt (up to ~40s), then confirm the entry.
//    If the receipt is not seen in time, the frontend polls
//    /api/claim-status, which reconciles the entry.
'use strict';
const eth = require('../lib/eth');
const common = require('../lib/claim-common');

const RECEIPT_POLL_MS = 40000;
const RECEIPT_POLL_INTERVAL_MS = 2000;

module.exports = async (req, res) => {
  common.cors(req, res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return common.json(res, 405, { error: 'method not allowed' });
  try {
    const cfg = common.getConfig();
    if (!cfg.configured) {
      return common.json(res, 503, { error: 'not_configured', message: 'Claim system is not connected yet.' });
    }
    const body = await common.readJsonBody(req);
    const session = common.verifySession(body.session, cfg.sessionSecret);
    if (!session) {
      return common.json(res, 401, { error: 'bad_session', message: 'Your X login expired. Please connect X again.' });
    }
    if (!session.reposted) {
      return common.json(res, 403, { error: 'not_reposted', message: 'No repost found for your X account yet. Repost the official post, then check again.' });
    }
    const wallet = typeof body.wallet === 'string' ? body.wallet : '';
    if (!eth.isAddress(wallet)) {
      return common.json(res, 400, { error: 'bad_wallet', message: 'Invalid wallet address.' });
    }
    const checksumWallet = eth.toChecksumAddress(wallet);
    const message = typeof body.message === 'string' ? body.message : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    if (!message || !signature) {
      return common.json(res, 400, { error: 'bad_request', message: 'Missing signature. Please sign the claim message with your wallet.' });
    }
    // The message must bind this wallet + X account + session together.
    if (!message.includes(checksumWallet) && !message.includes(wallet.toLowerCase())) {
      return common.json(res, 400, { error: 'bad_message', message: 'Claim message does not match your wallet.' });
    }
    if (!message.includes(String(session.xUserId)) || !message.includes(session.jti)) {
      return common.json(res, 400, { error: 'bad_message', message: 'Claim message does not match your X login.' });
    }
    if (!eth.verifyPersonalSig(message, signature, checksumWallet)) {
      return common.json(res, 403, { error: 'bad_signature', message: 'Signature does not match your wallet.' });
    }

    // 1-per-X-account (registry) — includes live PENDING entries.
    const { data: registry } = await common.readRegistry(cfg);
    const existing = common.findClaimByX(registry, session.xUserId);
    if (existing) {
      return common.json(res, 409, {
        error: 'already_claimed',
        message: existing.status === 'confirmed'
          ? 'This X account already claimed 100 $THYRK.'
          : 'A claim for this X account is already in progress. Please wait a minute and check the status.',
        txHash: existing.txHash || null,
      });
    }
    // 1-per-wallet + budget (on-chain).
    if (await common.walletHasClaimed(cfg, checksumWallet)) {
      return common.json(res, 409, { error: 'already_claimed', message: 'This wallet already claimed 100 $THYRK.' });
    }
    const state = await common.getRepostState(cfg);
    if (state.claimsLeft <= 0) {
      return common.json(res, 410, { error: 'budget_exhausted', message: 'The repost budget (77,777 $THYRK) is used up. Claims are closed.' });
    }

    // Claimer wallet (server-side; key in env var, never leaves the server).
    const claimerKey = eth.hexToBytes(cfg.claimerKey);
    const claimerAddress = eth.privToAddress(claimerKey);
    if (process.env.CLAIMER_ADDRESS && process.env.CLAIMER_ADDRESS.toLowerCase() !== claimerAddress.toLowerCase()) {
      console.error('claimer key does not match CLAIMER_ADDRESS env var');
      return common.json(res, 500, { error: 'server_error', message: 'Claimer wallet is misconfigured.' });
    }
    // Build the claimRepost(wallet) tx.
    const calldata = eth.claimRepostCalldata(checksumWallet);
    const [nonce, gasPriceHex, balanceHex] = await Promise.all([
      common.getClaimerNonce(cfg, claimerAddress),
      common.rpc('eth_gasPrice', [], cfg),
      common.rpc('eth_getBalance', [claimerAddress, 'latest'], cfg),
    ]);
    const gasPrice = BigInt(gasPriceHex);
    let gasLimit;
    try {
      const est = await common.rpc('eth_estimateGas', [{ from: claimerAddress, to: cfg.tokenAddress, data: calldata }, 'latest'], cfg);
      gasLimit = (BigInt(est) * 120n) / 100n;
      if (gasLimit < 100000n) gasLimit = 100000n;
    } catch (e) {
      console.error('claim estimateGas failed:', e && e.message);
      return common.json(res, 400, { error: 'tx_reverted', message: 'The claim transaction would fail on-chain. Your wallet or X account may already have claimed.' });
    }
    if (BigInt(balanceHex) < gasPrice * gasLimit) {
      console.error('claimer wallet out of BNB for gas:', claimerAddress);
      return common.json(res, 503, { error: 'claimer_out_of_gas', message: 'The claim service is out of gas funds. Please try again later.' });
    }
    // Write the PENDING entry first, so a second claim for the same X
    // account is blocked while this tx is in flight.
    const createdAt = new Date().toISOString();
    await common.updateRegistry(cfg, (data) => {
      data.claims = data.claims || [];
      data.claims.push({
        xUserId: String(session.xUserId), xUsername: session.xUsername,
        wallet: checksumWallet, txHash: null, amount: '100',
        status: 'pending', createdAt,
      });
    });

    const rawTx = eth.signLegacyTx({
      nonce, gasPrice, gasLimit,
      to: cfg.tokenAddress, value: 0n, data: calldata, chainId: common.CHAIN_ID,
    }, claimerKey);
    let txHash;
    try {
      txHash = await common.sendRawTx(cfg, rawTx);
    } catch (e) {
      console.error('claim sendRawTransaction failed:', e && e.message);
      await common.updateRegistry(cfg, (data) => {
        const c = (data.claims || []).find((x) => x.xUserId === String(session.xUserId) && x.status === 'pending');
        if (c) c.status = 'failed';
      }).catch(() => {});
      return common.json(res, 502, { error: 'tx_send_failed', message: 'Could not send the claim transaction. Please try again.' });
    }
    await common.updateRegistry(cfg, (data) => {
      const c = (data.claims || []).find((x) => x.xUserId === String(session.xUserId) && x.status === 'pending');
      if (c) c.txHash = txHash;
    }).catch(() => {});

    // Wait for the receipt (bounded; the frontend polls claim-status after).
    const deadline = Date.now() + RECEIPT_POLL_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, RECEIPT_POLL_INTERVAL_MS));
      let receipt = null;
      try { receipt = await common.getTxReceipt(cfg, txHash); } catch (e) { /* retry */ }
      if (receipt) {
        const ok = receipt.status === '0x1';
        await common.updateRegistry(cfg, (data) => {
          const c = (data.claims || []).find((x) => x.txHash && x.txHash.toLowerCase() === txHash.toLowerCase());
          if (c) {
            c.status = ok ? 'confirmed' : 'failed';
            if (ok) c.confirmedAt = new Date().toISOString();
          }
        }).catch(() => {});
        if (ok) {
          return common.json(res, 200, {
            status: 'confirmed', txHash,
            bscscan: 'https://bscscan.com/tx/' + txHash,
            amount: '100', wallet: checksumWallet,
          });
        }
        return common.json(res, 502, { error: 'tx_reverted', message: 'The claim transaction failed on-chain.', txHash });
      }
    }
    return common.json(res, 202, {
      status: 'pending', txHash,
      bscscan: 'https://bscscan.com/tx/' + txHash,
      message: 'Transaction sent. Check the status on this page — it confirms within a minute.',
    });
  } catch (e) {
    console.error('claim error:', e && e.message);
    return common.json(res, 500, { error: 'server_error' });
  }
};
