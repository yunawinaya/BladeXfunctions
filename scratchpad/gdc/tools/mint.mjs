// mintToken(identity.json): a short-lived DEV BladeX token for a REAL user, minted the way runas.mjs mints it (sudu-dealer-api's
// SaasTokenProvider claim set, HS256 with the DEV BLADE_JWT_SECRET from sudu-dealer-api/.env, read at call time). For when the
// sudu-lowcode CLI's own session cannot refresh (its sumes-cli server answered 404 on every /api route on 10-22; user's call to use
// this for publishing). The secret and the token are never printed or written. DEV only: refuses an .env not paired with dev.mes.
import fs from 'node:fs';
import crypto from 'node:crypto';

export const DEV_BASE = 'https://dev.mes.sudu.ai/api';

export function mintToken(idFile, seconds = 900) {
  const env = {};
  for (const line of fs.readFileSync('/Users/yunawinaya/Developer/sudu-dealer-api/.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  if ((env.BLADE_BASE_URL || '').replace(/\/+$/, '') !== 'https://dev.mes.sudu.ai') throw new Error('sudu-dealer-api/.env is not paired with dev.mes: refusing');
  if (!env.BLADE_JWT_SECRET) throw new Error('BLADE_JWT_SECRET not set in sudu-dealer-api/.env');
  const who = JSON.parse(fs.readFileSync(idFile, 'utf8'));
  for (const k of ['tenant_id', 'user_id', 'account', 'dept_id', 'role_id', 'first_lv_dept_id']) if (!who[k]) throw new Error('identity lacks ' + k);
  const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: 'bladex.cn', aud: ['bladex'], token_type: 'access_token', client_id: 'saber3', tenant_id: who.tenant_id, user_id: who.user_id,
    account: who.account, user_name: who.account, nick_name: who.account, real_name: who.account, dept_id: who.dept_id, role_id: who.role_id,
    detail: { type: 'web', first_lv_dept_id: Number(who.first_lv_dept_id) }, nbf: now, iat: now, exp: now + seconds,
  };
  const unsigned = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(claims);
  return { token: unsigned + '.' + crypto.createHmac('sha256', env.BLADE_JWT_SECRET).update(unsigned).digest('base64url'), who: who };
}
