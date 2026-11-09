// POST /api/x-auth-callback — finish X OAuth 2.0 (PKCE) login.
// Body: { code, codeVerifier, state, expectedState }.
// Exchanges the code for a user token, reads the user's id + username
// (GET /2/users/me), checks whether they reposted the official post
// (cached retweeted_by sweep), and issues a 15-minute HMAC session token.
// The X access token is discarded immediately — it is never stored.
'use strict';
const common = require('../lib/claim-common');

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
    const { code, codeVerifier, state, expectedState } = body;
    if (!code || !codeVerifier || !state || state !== expectedState) {
      return common.json(res, 400, { error: 'bad_request', message: 'Invalid or expired login attempt. Please try again.' });
    }
    // 1. Exchange the code for tokens (Basic auth with client id + secret).
    const basic = Buffer.from(cfg.xClientId + ':' + cfg.xClientSecret).toString('base64');
    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + basic,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text().catch(() => '');
      console.error('x token exchange failed:', tokenRes.status, t.slice(0, 200));
      return common.json(res, 400, { error: 'x_auth_failed', message: 'X login failed. Please try again.' });
    }
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      return common.json(res, 400, { error: 'x_auth_failed', message: 'X login failed. Please try again.' });
    }
    // 2. Who is this user? (User: Read, $0.010 per call on pay-per-use.)
    const me = await common.xFetch(cfg, '/users/me', { bearer: tokens.access_token });
    const xUserId = String(me.data && me.data.id);
    const xUsername = me.data && me.data.username ? String(me.data.username) : '';
    if (!xUserId) {
      return common.json(res, 502, { error: 'x_api_error', message: 'Could not read your X profile. Please try again.' });
    }
    // 3. Did they repost the official post? (cached sweep, see lib.)
    let reposted = false;
    try {
      const { data: registry } = await common.readRegistry(cfg);
      const { set, refreshed, freshData } = await common.getReposters(cfg, registry);
      reposted = set.has(xUserId);
      if (refreshed && freshData) {
        try {
          await common.updateRegistry(cfg, (d) => { d.reposters = freshData; });
        } catch (e) { console.error('reposter cache persist failed:', e && e.message); }
      }
    } catch (e) {
      if (e.code === 'X_RATE_LIMITED') {
        return common.json(res, 429, { error: 'x_rate_limited', message: 'X is busy right now. Please try again in a few minutes.' });
      }
      console.error('repost check failed:', e && e.message);
      return common.json(res, 502, { error: 'x_api_error', message: 'Could not check your repost right now. Please try again.' });
    }
    // 4. Issue the session token (the X access token is discarded).
    const session = common.newSession(cfg, xUserId, xUsername, reposted);
    return common.json(res, 200, { session, xUserId, xUsername, reposted });
  } catch (e) {
    console.error('x-auth-callback error:', e && e.message);
    return common.json(res, 500, { error: 'server_error' });
  }
};
