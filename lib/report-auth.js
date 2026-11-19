const sessionName = '__Host-ds_report';
const sessionSeconds = 30 * 86400;
const setupDigest = '53e5d7649c45ef97fe0773532c7a4621c963dbde4dde1e07d6a9676e6a47fc29';
const setupDeadline = Date.parse('2026-11-26T23:59:59Z');
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async text => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));

export function tokenCookie(request, name) {
  const cookies = (request.headers.get('Cookie') || '').split(';').map(cookie => cookie.trim());
  const value = cookies.find(cookie => cookie.startsWith(name + '='))?.slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}

export const sessionToken = request => tokenCookie(request, sessionName);
export const sessionCookie = (value, age) =>
  sessionName + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + age;

export async function owner(db, request) {
  const value = sessionToken(request);
  return !!value && !!await db.prepare('SELECT 1 FROM report_sessions WHERE digest=? AND expires>?')
    .bind(await digest(value), Date.now()).first();
}

export async function newSession(db) {
  const session = newToken();
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM report_sessions WHERE expires<=?').bind(now),
    db.prepare('INSERT INTO report_sessions(digest,expires) VALUES(?,?)')
      .bind(await digest(session), now + sessionSeconds * 1000)
  ]);
  return sessionCookie(session, sessionSeconds);
}

function equalHex(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:encoder.encode(salt), iterations:100000}, key, 256);
  return hex(new Uint8Array(bits));
}

export const savedPassword = db => db.prepare("SELECT value FROM report_settings WHERE key='password-v1'").first('value');

export async function choosePassword(db, invitation, password) {
  if (Date.now() > setupDeadline || !/^[a-f0-9]{64}$/.test(invitation) ||
      !equalHex(await digest(invitation), setupDigest))
    return {status:403, message:'Open your private password setup link to choose a password.'};
  if (password.length < 12 || password.length > 256)
    return {status:400, message:'Choose a password between 12 and 256 characters.'};
  const salt = newToken();
  const stored = salt + ':' + await passwordHash(password, salt);
  const result = await db.prepare("INSERT OR IGNORE INTO report_settings(key,value) VALUES('password-v1',?)")
    .bind(stored).run();
  if (!result.meta.changes) return {status:409, message:'Your password is already set. Sign in with it below.'};
  return {status:200};
}

export async function checkPassword(db, request, password) {
  const stored = await savedPassword(db);
  const invalid = {status:401, message:'That password didn’t match. Please try again.'};
  if (!stored || !password || password.length > 256) return invalid;
  const [salt, expected] = stored.split(':');
  // Temporarily limit guesses from the same connection without recording its address.
  const bucket = await digest(salt + ':' + (request.headers.get('CF-Connecting-IP') || 'unknown'));
  const now = Date.now();
  const [,attempt] = await db.batch([
    db.prepare('DELETE FROM report_attempts WHERE expires<=?').bind(now),
    db.prepare(`INSERT INTO report_attempts(bucket,tries,expires) VALUES(?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET tries=tries+1 WHERE tries<8`).bind(bucket, now+600000)
  ]);
  if (!attempt.meta.changes) return {status:429, message:'Too many attempts. Please try again in ten minutes.'};
  if (!equalHex(await passwordHash(password, salt), expected)) return invalid;
  await db.prepare('DELETE FROM report_attempts WHERE bucket=?').bind(bucket).run();
  return {status:200};
}
