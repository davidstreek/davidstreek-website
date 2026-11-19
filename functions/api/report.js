import {database, response, sameOrigin, readJSON, ukDay} from '../../lib/statistics.js';
import {catalog} from '../../lib/catalog.js';

const cookieName='__Host-ds_report';
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const sessionCookie=(value,age)=>cookieName+'='+value+'; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age='+age;
async function owner(db,req) {
  const value=(req.headers.get('Cookie') || '').match(/(?:^|;\s*)__Host-ds_report=([0-9a-f]{64})(?:;|$)/)?.[1];
  return value && await db.prepare('SELECT 1 AS yes FROM report_sessions WHERE digest=? AND expires>?').bind(await digest(value),Date.now()).first();
}
const lifetime = 15 * 60 * 1000;
const challengeCookie = '__Host-ds_challenge';
const getChallenge = request =>
  (request.headers.get('Cookie') || '').match(/(?:^|;\s*)__Host-ds_challenge=([0-9a-f]{64})(?:;|$)/)?.[1];
const codeCookie = value =>
  challengeCookie+'='+value+'; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800';

async function emailCode(env, db, request) {
  if (!env.RESEND_API_KEY || !env.ENQUIRY_FROM || !env.ENQUIRY_TO)
    return response({message:'Report sign-in email is not configured.'},503);
  const now = Date.now();
  const challenge = getChallenge(request) || token();
  const browser = await digest(challenge);
  const random = crypto.getRandomValues(new Uint32Array(1))[0];
  const code = String(random % 100000000).padStart(8,'0');
  const hash = await digest(challenge + ':' + code);
  const [,claim] = await db.batch([
    db.prepare('DELETE FROM report_codes WHERE issued<?').bind(now-lifetime),
    db.prepare(`INSERT INTO report_codes(browser,issued,digest,attempts)
      SELECT ?,?,?,0 WHERE NOT EXISTS (SELECT 1 FROM report_codes WHERE issued>=?)
      ON CONFLICT(browser) DO UPDATE SET issued=excluded.issued,digest=excluded.digest,attempts=0
      `).bind(browser,now,hash,now-120000)
  ]);
  if (!claim.meta.changes) {
    const active = await db.prepare('SELECT 1 AS active FROM report_codes WHERE browser=?').bind(browser).first();
    return active ? response({message:'Use the code most recently emailed to your website enquiry inbox. You can request another after two minutes.'})
      : response({message:'A code was requested recently. Please try again in two minutes.'},429);
  }
  try {
    const mail = await fetch('https://api.resend.com/emails',{
      method:'POST', headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
      signal:AbortSignal.timeout(8000),
      body:JSON.stringify({from:env.ENQUIRY_FROM,to:[env.ENQUIRY_TO],subject:'Your portfolio report sign-in code',
        text:'Your sign-in code is '+code+'.\n\nReturn to the browser where you requested it and enter these eight digits. The code expires in 15 minutes.'})
    });
    if (!mail.ok) throw new Error('mail');
  } catch {
    await db.prepare('DELETE FROM report_codes WHERE browser=? AND digest=?').bind(browser,hash).run();
    return response({message:'The code could not be emailed. Please try again.'},502);
  }
  return response({message:'Check your website enquiry inbox for the eight-digit code. Enter it here within 15 minutes.'},200,{'Set-Cookie':codeCookie(challenge)});
}

async function verifyCode(db, request, code) {
  const challenge = getChallenge(request);
  if (!challenge || typeof code!=='string' || !/^\d{8}$/.test(code))
    return response({message:'Enter the eight-digit code in the browser where you requested it.'},400);
  const browser = await digest(challenge);
  const hash = await digest(challenge + ':' + code);
  const now = Date.now();
  const [claim] = await db.batch([
    db.prepare('DELETE FROM report_codes WHERE browser=? AND digest=? AND issued>? AND attempts<5')
      .bind(browser,hash,now-lifetime),
    db.prepare('UPDATE report_codes SET attempts=attempts+1 WHERE browser=? AND attempts<5').bind(browser)
  ]);
  if (!claim.meta.changes)
    return response({message:'That code was incorrect, expired or already used. Check the latest email or request a new code.'},401);
  return createSession(db);
}

async function createSession(db) {
  const session=token();
  await db.batch([db.prepare('DELETE FROM report_sessions WHERE expires<=?').bind(Date.now()),
    db.prepare('INSERT INTO report_sessions VALUES(?,?)').bind(await digest(session),Date.now()+2592000000)]);
  return response({ok:true},200,{'Set-Cookie':sessionCookie(session,2592000)});
}
export async function onRequest({request,env}) {
  if (!env.PORTFOLIO_STATS) return response({message:'Reporting is awaiting its database connection.'},503);
  try {
    const db=await database(env);
    if (request.method==='POST') {
      if (!sameOrigin(request)) return response({},403);
      let data; try {data=await readJSON(request,4096);} catch {return response({},400);}
      if (data?.action==='email') return await emailCode(env,db,request);
      if (data?.action==='verify-code') return await verifyCode(db,request,data.code);
      if (data?.action==='login' && /^[a-f0-9]{64}$/.test(data.key)) {
        const claim=await db.prepare("DELETE FROM report_settings WHERE key='link' AND substr(value,15)=? AND CAST(substr(value,1,13) AS INTEGER)>? RETURNING key")
          .bind(await digest(data.key),Date.now()-900000).first();
        if (!claim) return response({message:'This sign-in link has expired or has already been used.'},401);
        return await createSession(db);
      }
      if (!await owner(db,request)) return response({},401);
      if (data.action==='start') {
        if (!/(?:^|;\s*)ds_ignore=1(?:;|$)/.test(request.headers.get('Cookie') || '')) return response({message:'Exclude this browser before starting.'},409);
        await db.prepare("INSERT OR IGNORE INTO report_settings(key,value) VALUES('since',?)").bind(ukDay()).run();
        return response({ok:true});
      }
      if (data.action==='logout') {
        const value=request.headers.get('Cookie').match(/__Host-ds_report=([0-9a-f]{64})/)[1];
        await db.prepare('DELETE FROM report_sessions WHERE digest=?').bind(await digest(value)).run();
        return response({ok:true},200,{'Set-Cookie':sessionCookie('',0)});
      }
      return response({},400);
    }
    if (request.method!=='GET') return response({},405);
    if (!await owner(db,request)) return response({},401);
    const query=new URL(request.url).searchParams;
    const from=query.get('from')||ukDay(),to=query.get('to')||ukDay();
    const valid=d=>/^\d{4}-\d\d-\d\d$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10)===d;
    if (!valid(from)||!valid(to)||from>to||Date.parse(to)-Date.parse(from)>365*86400000) return response({message:'Choose a period of up to one year.'},400);
    const [since,rows]=await Promise.all([db.prepare("SELECT value FROM report_settings WHERE key='since'").first('value'),
      db.prepare('SELECT day,metric,item,pos,n FROM totals WHERE day BETWEEN ? AND ? ORDER BY day').bind(from,to).all()]);
    return response({catalog,since,rows:rows.results,from,to});
  } catch {return response({message:'Reporting is temporarily unavailable.'},503);}
}
