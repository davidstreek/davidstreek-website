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
async function emailLink(env,db,request) {
  if (!env.RESEND_API_KEY || !env.ENQUIRY_TO || !env.ENQUIRY_FROM) return response({message:'Report sign-in email is not configured.'},503);
  const now=Date.now(),value=token(),hashed=await digest(value);
  // Keep a valid outstanding email usable while limiting sends to the owner.
  const claimed=await db.prepare("INSERT INTO report_settings(key,value) VALUES('link',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(substr(report_settings.value,1,13) AS INTEGER)<?")
    .bind(now+'|'+hashed,now-300000).run();
  if (claimed.meta.changes) {
    try {
      const mail=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),
        body:JSON.stringify({from:env.ENQUIRY_FROM,to:[env.ENQUIRY_TO],subject:'Your portfolio report sign-in link',text:'Open this link in the browser you use to review your website. It is valid for 15 minutes.\n\nhttps://davidstreek.com/studio-report#key='+value})});
      if (!mail.ok) throw new Error('mail');
    } catch {
      await db.prepare("DELETE FROM report_settings WHERE key='link' AND value=?").bind(now+'|'+hashed).run();
      return response({message:'The sign-in email could not be sent. Please try again.'},502);
    }
  }
  return response({message:'Check the website enquiry inbox for your sign-in link. A recently sent link is valid for 15 minutes.'});
}
export async function onRequest({request,env}) {
  if (!env.PORTFOLIO_STATS) return response({message:'Reporting is awaiting its database connection.'},503);
  try {
    const db=await database(env);
    if (request.method==='POST') {
      if (!sameOrigin(request)) return response({},403);
      let data; try {data=await readJSON(request,4096);} catch {return response({},400);}
      if (data?.action==='email') return emailLink(env,db,request);
      if (data?.action==='login' && /^[a-f0-9]{64}$/.test(data.key)) {
        const claim=await db.prepare("DELETE FROM report_settings WHERE key='link' AND substr(value,15)=? AND CAST(substr(value,1,13) AS INTEGER)>? RETURNING key")
          .bind(await digest(data.key),Date.now()-900000).first();
        if (!claim) return response({message:'This sign-in link has expired or has already been used.'},401);
        const session=token();
        await db.batch([db.prepare('DELETE FROM report_sessions WHERE expires<=?').bind(Date.now()),
          db.prepare('INSERT INTO report_sessions VALUES(?,?)').bind(await digest(session),Date.now()+2592000000)]);
        return response({ok:true},200,{'Set-Cookie':sessionCookie(session,2592000)});
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
