// POST /api/x-recheck — re-check the repost for an existing session.
// Body: { session }. Used when the user reposted AFTER logging in.
// Refreshes the reposter cache if stale, then re-issues the session token
// with the updated reposted flag.
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
    const session = common.verifySession(body.session, cfg.sessionSecret);
    if (!session) {
      return common.json(res, 401, { error: 'bad_session', message: 'Your X login expired. Please connect X again.' });
    }
    const { data: registry } = await common.readRegistry(cfg);
    const { set, refreshed, freshData } = await common.getReposters(cfg, registry);
    const reposted = set.has(String(session.xUserId));
    if (refreshed && freshData) {
      try {
        await common.updateRegistry(cfg, (d) => { d.reposters = freshData; });
      } catch (e) { console.error('reposter cache persist failed:', e && e.message); }
    }
    const newSession = common.newSession(cfg, session.xUserId, session.xUsername, reposted);
    return common.json(res, 200, { session: newSession, xUserId: session.xUserId, xUsername: session.xUsername, reposted });
  } catch (e) {
    if (e.code === 'X_RATE_LIMITED') {
      return common.json(res, 429, { error: 'x_rate_limited', message: 'X is busy right now. Please try again in a few minutes.' });
    }
    console.error('x-recheck error:', e && e.message);
    return common.json(res, 500, { error: 'server_error' });
  }
};
