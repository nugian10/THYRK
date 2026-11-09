// claim-common.js — shared helpers for the THYRK repost-claim API.
// Zero npm dependencies. Runs on Vercel Node functions and locally.
// Secrets come ONLY from environment variables; nothing secret is ever
// logged or returned to the client.

'use strict';
const crypto = require('crypto');
const eth = require('./eth');

const TOKEN_ADDRESS = '0x3b8747d067b2ed8565330667128260c2a4954300';
const NFT_ADDRESS = '0xeff20913f99fd153da1b27bd96401089d3323bb8';
const CHAIN_ID = 56;
const REPOST_REWARD = 100n * 10n ** 18n; // 100 $THYRK
const REPOST_BUDGET = 77777n * 10n ** 18n;
const BSC_RPC_URLS = [
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.defibit.io/',
  'https://bsc-dataseed1.ninicoin.io/',
];
const X_API = 'https://api.x.com/2';
const ALLOWED_ORIGINS = ['https://thyrk.fun', 'https://www.thyrk.fun', 'https://thyrk.vercel.app'];

// ---------------------------------------------------------------- config
function getConfig() {
  const env = process.env;
  const required = [
    'X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_BEARER_TOKEN', 'OFFICIAL_POST_ID',
    'CLAIMER_PRIVATE_KEY', 'GITHUB_CLAIMS_TOKEN', 'SESSION_SECRET',
  ];
  const missing = required.filter((k) => !env[k]);
  return {
    missing,
    configured: missing.length === 0,
    xClientId: env.X_CLIENT_ID || '',
    xClientSecret: env.X_CLIENT_SECRET || '',
    xBearerToken: env.X_BEARER_TOKEN || '',
    officialPostId: env.OFFICIAL_POST_ID || '',
    claimerKey: env.CLAIMER_PRIVATE_KEY || '',
    githubToken: env.GITHUB_CLAIMS_TOKEN || '',
    githubRepo: env.GITHUB_CLAIMS_REPO || 'nugian10/THYRK-claims',
    sessionSecret: env.SESSION_SECRET || '',
    redirectUri: env.X_REDIRECT_URI || 'https://thyrk.fun/claim.html',
    rpcUrl: env.BSC_RPC_URL || BSC_RPC_URLS[0],
    tokenAddress: env.TOKEN_ADDRESS || TOKEN_ADDRESS,
    apiBase: env.CLAIM_API_BASE || 'https://thyrk.vercel.app',
  };
}

// ---------------------------------------------------------------- http utils
function cors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 200000) req.destroy(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// ---------------------------------------------------------------- sessions
// Short-lived HMAC-signed token: { xUserId, xUsername, reposted, jti, iat, exp }.
// No server-side session store. 15-minute expiry.
function signSession(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return body + '.' + sig;
}
function verifySession(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expect = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(unb64url(body).toString('utf8')); } catch (e) { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (!payload.xUserId || !payload.jti || !payload.exp) return null;
  if (Date.now() > payload.exp * 1000) return null;
  return payload;
}
function newSession(cfg, xUserId, xUsername, reposted) {
  const now = Math.floor(Date.now() / 1000);
  return signSession({
    xUserId: String(xUserId), xUsername: xUsername || '',
    reposted: !!reposted, jti: crypto.randomBytes(16).toString('hex'),
    iat: now, exp: now + 15 * 60,
  }, cfg.sessionSecret);
}

// ---------------------------------------------------------------- BSC RPC
async function rpcCall(method, params, rpcUrl) {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(rpcUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body, signal: ctrl.signal,
    });
    const j = await r.json();
    if (j.error) throw new Error('rpc error: ' + (j.error.message || JSON.stringify(j.error)));
    return j.result;
  } finally { clearTimeout(t); }
}
async function rpc(method, params, cfg) {
  const urls = [cfg.rpcUrl, ...BSC_RPC_URLS.filter((u) => u !== cfg.rpcUrl)];
  let lastErr;
  for (const u of urls) {
    try { return await rpcCall(method, params, u); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all BSC RPC endpoints failed');
}
function ethCall(to, data, cfg) {
  return rpc('eth_call', [{ to, data }, 'latest'], cfg);
}
function selector(sig) {
  return '0x' + eth.keccak256(Buffer.from(sig, 'ascii')).subarray(0, 4).toString('hex');
}
function encodeAddressArg(addr) {
  return eth.hexToBytes(addr).toString('hex').padStart(64, '0');
}
async function getRepostState(cfg) {
  const [claimedMinted, budget] = await Promise.all([
    ethCall(cfg.tokenAddress, selector('repostMinted()'), cfg),
    ethCall(cfg.tokenAddress, selector('REPOST_BUDGET()'), cfg),
  ]);
  return {
    repostMinted: BigInt(claimedMinted),
    budget: BigInt(budget),
    claimsLeft: Number((BigInt(budget) - BigInt(claimedMinted)) / REPOST_REWARD),
  };
}
async function walletHasClaimed(cfg, wallet) {
  const data = selector('repostClaimed(address)') + encodeAddressArg(wallet);
  const r = await ethCall(cfg.tokenAddress, data, cfg);
  return BigInt(r) !== 0n;
}
async function getClaimerNonce(cfg, claimerAddress) {
  const n = await rpc('eth_getTransactionCount', [claimerAddress, 'pending'], cfg);
  return BigInt(n);
}
async function sendRawTx(cfg, rawTx) {
  return rpc('eth_sendRawTransaction', [rawTx], cfg);
}
async function getTxReceipt(cfg, txHash) {
  return rpc('eth_getTransactionReceipt', [txHash], cfg);
}

// ---------------------------------------------------------------- GitHub registry
// Private repo (default nugian10/THYRK-claims), file claims.json:
// { version:1, claims:[{xUserId,xUsername,wallet,txHash,amount,status,createdAt,confirmedAt}],
//   reposters:{ postId, userIds:[...], updatedAt } }
// Claims are the 1-per-X-account record (the 1-per-wallet rule is enforced
// on-chain by ThyrkToken.repostClaimed). Pending entries (status:'pending',
// createdAt within 10 min) block a second claim for the same X account
// while a claim tx is in flight.
const REGISTRY_PATH = 'claims.json';
const PENDING_TTL_MS = 10 * 60 * 1000;

function emptyRegistry() {
  return { version: 1, claims: [], reposters: { postId: null, userIds: [], updatedAt: 0 } };
}
function ghHeaders(cfg) {
  return {
    Authorization: 'Bearer ' + cfg.githubToken,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'thyrk-claim-backend',
  };
}
async function readRegistry(cfg) {
  const url = `https://api.github.com/repos/${cfg.githubRepo}/contents/${REGISTRY_PATH}`;
  const r = await fetch(url, { headers: ghHeaders(cfg) });
  if (r.status === 404) return { data: emptyRegistry(), sha: null };
  if (!r.ok) throw new Error('github read failed: HTTP ' + r.status);
  const j = await r.json();
  const data = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
  if (!data || typeof data !== 'object' || !Array.isArray(data.claims)) return { data: emptyRegistry(), sha: j.sha };
  if (!data.reposters) data.reposters = { postId: null, userIds: [], updatedAt: 0 };
  return { data, sha: j.sha };
}
async function writeRegistry(cfg, data, sha) {
  const url = `https://api.github.com/repos/${cfg.githubRepo}/contents/${REGISTRY_PATH}`;
  const body = {
    message: 'claim registry update',
    content: Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64'),
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, { method: 'PUT', headers: { ...ghHeaders(cfg), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (!r.ok) throw new Error('github write failed: HTTP ' + r.status);
  return { conflict: false };
}
// Merge-aware registry update with one retry on SHA conflict.
async function updateRegistry(cfg, mutate) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, sha } = await readRegistry(cfg);
    mutate(data);
    const r = await writeRegistry(cfg, data, sha);
    if (!r.conflict) return data;
  }
  throw new Error('registry write conflict after retries');
}
function findClaimByX(data, xUserId) {
  const now = Date.now();
  return (data.claims || []).find((c) => {
    if (String(c.xUserId) !== String(xUserId)) return false;
    if (c.status === 'confirmed') return true;
    if (c.status === 'pending' && now - new Date(c.createdAt).getTime() < PENDING_TTL_MS) return true;
    return false;
  }) || null;
}

// ---------------------------------------------------------------- X API
async function xFetch(cfg, path, opts) {
  const url = X_API + path;
  const headers = { Authorization: 'Bearer ' + (opts.bearer || cfg.xBearerToken) };
  const r = await fetch(url, { method: opts.method || 'GET', headers });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch (e) { /* non-JSON error */ }
  if (r.status === 429) {
    const reset = r.headers.get('x-rate-limit-reset');
    const err = new Error('x api rate limited');
    err.code = 'X_RATE_LIMITED';
    err.resetAt = reset ? Number(reset) * 1000 : Date.now() + 15 * 60 * 1000;
    throw err;
  }
  if (!r.ok) {
    const err = new Error('x api error: HTTP ' + r.status + ' ' + (j && j.detail ? j.detail : text.slice(0, 200)));
    err.code = 'X_API_ERROR';
    err.status = r.status;
    throw err;
  }
  return j;
}
// Fetch the full set of user IDs who reposted the official post, using the
// app Bearer token (no per-user token needed). Paginated, 100 per page.
// Cost (pay-per-use): $0.010 per user returned, deduped within a 24h UTC
// window by X. Returns { postId, userIds, updatedAt }. The caller persists
// the result into the registry (see getReposters).
async function refreshReposters(cfg) {
  const postId = cfg.officialPostId;
  let ids = [];
  let token = null;
  for (let page = 0; page < 20; page++) { // 20 pages x 100 = 2,000 reposters max
    let path = `/tweets/${encodeURIComponent(postId)}/retweeted_by?max_results=100`;
    if (token) path += '&pagination_token=' + encodeURIComponent(token);
    const j = await xFetch(cfg, path, {});
    for (const u of (j.data || [])) ids.push(String(u.id));
    token = j.meta && j.meta.next_token ? j.meta.next_token : null;
    if (!token) break;
  }
  return { postId, userIds: [...new Set(ids)], updatedAt: Date.now() };
}
// Returns { set: Set<string>, refreshed: bool, freshData: object|null }.
// The caller persists freshData into the registry when refreshed === true.
async function getReposters(cfg, registry, maxAgeMs) {
  const cached = registry && registry.reposters;
  const fresh = cached && cached.postId === cfg.officialPostId
    && Array.isArray(cached.userIds)
    && (Date.now() - (cached.updatedAt || 0) < (maxAgeMs || 15 * 60 * 1000));
  if (fresh) return { set: new Set(cached.userIds.map(String)), refreshed: false, freshData: null };
  const set = await refreshReposters(cfg);
  return { set: new Set(set.userIds.map(String)), refreshed: true, freshData: set };
}

// ---------------------------------------------------------------- claim message
function claimMessage(wallet, xUserId, xUsername, jti, expIso) {
  return [
    'THYRK repost claim',
    '',
    'I claim 100 $THYRK for reposting the official THYRK post.',
    'Wallet: ' + wallet,
    'X: @' + xUsername + ' (' + xUserId + ')',
    'Session: ' + jti,
    'Expires: ' + expIso,
  ].join('\n');
}

module.exports = {
  TOKEN_ADDRESS, NFT_ADDRESS, CHAIN_ID, REPOST_REWARD, REPOST_BUDGET,
  getConfig, cors, json, readJsonBody, b64url, unb64url,
  signSession, verifySession, newSession,
  rpc, ethCall, selector, encodeAddressArg,
  getRepostState, walletHasClaimed, getClaimerNonce, sendRawTx, getTxReceipt,
  emptyRegistry, readRegistry, writeRegistry, updateRegistry, findClaimByX,
  PENDING_TTL_MS,
  xFetch, refreshReposters, getReposters,
  claimMessage,
};
