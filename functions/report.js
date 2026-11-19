import {database} from '../lib/statistics.js';
import {checkPin, installedPin, newSession, newToken, owner, sessionToken, tokenCookie} from '../lib/report-auth.js';

const formCookie = '__Host-ds_form';
const excludeCookie = 'ds_ignore=1; Path=/; Secure; SameSite=Lax; Max-Age=34560000';
const baseHeaders = {
  'Cache-Control':'private, no-store', 'Referrer-Policy':'same-origin', 'X-Robots-Tag':'noindex, nofollow',
  'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
};
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]);
}
function form(request, {message='', status=200} = {}) {
  const nonce = tokenCookie(request, formCookie) || newToken();
  const headers = new Headers({...baseHeaders, 'Content-Type':'text/html; charset=utf-8'});
  headers.append('Set-Cookie', excludeCookie);
  headers.append('Set-Cookie', formCookie + '=' + nonce + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=7200');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Private report | David Streek</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f7f6f2;color:#252923;font:16px/1.5 Inter,Arial,sans-serif}main{max-width:32rem;margin:auto;padding:clamp(24px,6vw,52px) 22px}a{color:inherit}h1{font-size:clamp(36px,8vw,52px);line-height:1.08;letter-spacing:-.05em;margin:1rem 0 1.5rem}label{display:block;margin-bottom:.3rem}input,button{font:inherit;border:1px solid #777a74;border-radius:4px;padding:.65rem .8rem}input[type=password]{width:100%;background:white}button{background:#252923;color:white;border-color:#252923;cursor:pointer;margin-top:1rem}p{margin:.6rem 0 1rem}input:focus-visible,button:focus-visible{outline:2px solid currentColor;outline-offset:3px}</style></head>
<body><main><a href="/">David Streek</a><h1>Private report</h1>
${message ? '<p role="status">'+escapeHtml(message)+'</p>' : ''}
<form method="post" action="/report">
<input type="hidden" name="form" value="${nonce}">
<label for="pin">PIN</label>
<input id="pin" type="password" name="pin" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="current-password" required>
<button type="submit">Open report</button></form>
</main></body></html>`;
  return new Response(request.method === 'HEAD' ? null : html, {status, headers});
}
function dashboard(session) {
  const headers = new Headers({...baseHeaders, Location:'/studio-report'});
  headers.append('Set-Cookie', excludeCookie);
  if (session) headers.append('Set-Cookie', session);
  return new Response(null, {status:303, headers});
}
async function readForm(request) {
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded') return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let text = '', size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); return null; }
    text += decoder.decode(value, {stream:true});
  }
  return new URLSearchParams(text + decoder.decode());
}
export async function onRequest({request, env}) {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' || request.method === 'HEAD') {
      await installedPin(await database(env));
      if (sessionToken(request) && await owner(await database(env), request)) return dashboard();
      return form(request);
    }
    if (request.method !== 'POST') return form(request, {status:405});
    const fields = await readForm(request);
    const cookie = tokenCookie(request, formCookie);
    const origin = request.headers.get('Origin');
    const foreignOrigin = origin && origin !== 'null' && origin !== url.origin;
    if (!fields || !cookie || fields.get('form') !== cookie || foreignOrigin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
      return form(request, {message:'Please reopen the report page in this browser and try again.', status:403});
    }
    const db = await database(env);
    const result = await checkPin(db, request, fields.get('pin') ?? fields.get('password') ?? '');
    if (result.status === 200) return dashboard(await newSession(db));
    return form(request, result);
  } catch {
    return form(request, {status:503, message:'The report is temporarily unavailable. Please try again shortly.'});
  }
}
