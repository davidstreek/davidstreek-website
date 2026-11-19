import {sameOrigin,response,readJSON} from '../../lib/statistics.js';
export async function onRequestPost({request}) {
  if (!sameOrigin(request)) return response({},403);
  let data;
  try {data=await readJSON(request,64);} catch {return response({},400);}
  if(typeof data?.exclude!=='boolean')return response({},400);
  const value=data.exclude?'1':'';
  return response({excluded:data.exclude},200,{'Set-Cookie':'ds_ignore='+value+'; Secure; SameSite=Lax; Path=/; Max-Age='+(data.exclude?34560000:0)});
}
