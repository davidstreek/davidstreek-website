import {database, response, sameOrigin, ignored, isActive, validEvent, add, readJSON} from '../../lib/statistics.js';

export async function onRequestGet({request,env}) {
  if (ignored(request) || !env.PORTFOLIO_STATS) return response({enabled:false});
  try { return response({enabled:await isActive(await database(env))}); }
  catch { return response({enabled:false},503); }
}

export async function onRequestPost({request,env}) {
  if (!sameOrigin(request)) return response({},403);
  if (ignored(request) || !env.PORTFOLIO_STATS) return response({accepted:false});
  let rows;
  try { rows=await readJSON(request); } catch { return response({},400); }
  if (!Array.isArray(rows) || !rows.length || rows.length>64 || !rows.every(validEvent)) return response({},400);
  const db=await database(env);
  if (!await isActive(db)) return response({accepted:false});
  if (rows.some(([metric])=>metric==='visit')) {
    const country=request.cf?.country;
    // Only retain a broad UK area, with all overseas visits in one group.
    const region=country==='GB' ? ({ENG:'England',SCT:'Scotland',WLS:'Wales',NIR:'Northern Ireland'}[request.cf?.regionCode] || 'UK') : country ? 'Outside UK' : 'Unknown';
    rows.push(['area',region,0,1]);
  }
  await add(db,rows);
  return response({accepted:true});
}
