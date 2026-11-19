import {database, response, sameOrigin, readJSON, ukDay} from '../../lib/statistics.js';
import {catalog} from '../../lib/catalog.js';

import {digest, owner, sessionCookie, sessionToken} from '../../lib/report-auth.js';

export async function onRequest({request,env}) {
  if (!env.PORTFOLIO_STATS) return response({message:'Reporting is awaiting its database connection.'},503);
  try {
    const db=await database(env);
    if (request.method==='POST') {
      const origin = request.headers.get('Origin');
      const sameSiteFetch = request.headers.get('Sec-Fetch-Site') === 'same-origin' && (!origin || origin === 'null');
      if (!sameOrigin(request) && !sameSiteFetch) return response({},403);
      let data; try {data=await readJSON(request,4096);} catch {return response({},400);}
      if (!await owner(db,request)) return response({},401);
      if (data.action==='start') {
        if (!/(?:^|;\s*)ds_ignore=1(?:;|$)/.test(request.headers.get('Cookie') || '')) return response({message:'Exclude this browser before starting.'},409);
        await db.prepare("INSERT OR IGNORE INTO report_settings(key,value) VALUES('since',?)").bind(ukDay()).run();
        return response({ok:true});
      }
      if (data.action==='logout') {
        const value=sessionToken(request);
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
