// POST /api/x-auth-start — begin X OAuth 2.0 (PKCE) login.
// Returns { authUrl, state, codeVerifier } for the frontend to store in
// sessionStorage and redirect the user to X. No secrets are returned.
'use strict';
const crypto = require('crypto');
const common = require('../lib/claim-common');

module.exports = async (req, res) => {
  common.cors(req, res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return common.json(res, 405, { error: 'method not allowed' });
  try {
    const cfg = common.getConfig();
    if (!cfg.xClientId) {
      return common.json(res, 503, { error: 'not_configured', message: 'Claim system is not connected yet.' });
    }
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = common.b64url(crypto.randomBytes(32));
    const challenge = common.b64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.xClientId,
      redirect_uri: cfg.redirectUri,
      scope: 'tweet.read users.read offline.access',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return common.json(res, 200, {
      authUrl: 'https://x.com/i/oauth2/authorize?' + params.toString(),
      state,
      codeVerifier,
    });
  } catch (e) {
    console.error('x-auth-start error:', e && e.message);
    return common.json(res, 500, { error: 'server_error' });
  }
};
