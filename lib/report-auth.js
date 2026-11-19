const sessionName = '__Host-ds_report';
const sessionSeconds = 30 * 86400;
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

const readSetting = (db,key) => db.prepare('SELECT value FROM report_settings WHERE key=?').bind(key).first('value');
const bytes = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

export async function installedPin(db) {
  const stored = await readSetting(db,'report-pin-v1');
  if (stored) return stored;
  const wrap = await readSetting(db,'report-pin-wrap');
  if (!wrap) {
    const concurrent = await readSetting(db,'report-pin-v1');
    if (concurrent) return concurrent;
    throw new Error('Report PIN configuration missing');
  }
  const algorithm = {name:'RSA-OAEP',hash:'SHA-256'};
  const key = await crypto.subtle.importKey('pkcs8',bytes(JSON.parse(wrap).privateKey),algorithm,false,['decrypt']);
  const plain = await crypto.subtle.decrypt(algorithm,key,bytes('V9DBlj47flVllZdEe0VaOrseDPiJQuuYoapkU0ZbKoZkQhyzY/h6Lavkxa5q5VDmlI+wdClUWf0/+WuapUDjIB1C3Y3y/lFThOufDjEqWj16L6f+uqq7z6i6KRJ5HEHmUaYl1OQ2OD++EBR43aXz7TRk/8Q5wEvxm0QddQPT/23tWOhJmCMRfLZtznTpoEWr/iU0sEm+MTj3sEve69rCBPljxjlgorzJqWAjSJIEr2NRAiy8lfcVn7mMcf0NiklkF6nBDWaXVgwsruBFc654t6GlM8RIE0Z/8pVPQHK7sinLRsIQIs8dJfseqaGwZ3e8txO/T1EUcrkpk87ydJsFMQ=='));
  const verifier = new TextDecoder().decode(plain);
  if (!/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(verifier)) throw new Error('Invalid report configuration');
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO report_settings(key,value) VALUES('report-pin-v1',?)").bind(verifier),
    db.prepare("DELETE FROM report_settings WHERE key IN ('report-pin-wrap','password-v1')")
  ]);
  return verifier;
}

export async function checkPin(db, request, pin) {
  const invalid = {status:401, message:'Incorrect PIN. Please try again.'};
  if (!/^[0-9]{4}$/.test(pin)) return invalid;
  const [salt, expected] = (await installedPin(db)).split(':');
  const bucket = await digest(salt + ':' + (request.headers.get('CF-Connecting-IP') || 'unknown'));
  const now = Date.now();
  const attempt = (key,max) => db.prepare(`INSERT INTO report_attempts(bucket,tries,expires) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET tries=tries+1 WHERE tries<?`).bind(key, now+900000, max);
  const [,local,total] = await db.batch([
    db.prepare('DELETE FROM report_attempts WHERE expires<=?').bind(now),
    attempt(bucket,5), attempt('report-pin-total',10)
  ]);
  if (!local.meta.changes || !total.meta.changes) return {status:429,message:'Too many attempts. Please try again in 15 minutes.'};
  if (!equalHex(await passwordHash(pin, salt), expected)) return invalid;
  await db.prepare("DELETE FROM report_attempts WHERE bucket IN (?, 'report-pin-total')").bind(bucket).run();
  return {status:200};
}
