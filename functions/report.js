// A plain HTML entrance for mobile browsers, including browsers with scripts disabled.
import { onRequest as reportApi } from './api/report.js';
import { sameOrigin } from '../lib/statistics.js';

const preferences = 'ds_ignore=1; Path=/; Secure; SameSite=Lax; Max-Age=34560000';
const baseHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Set-Cookie': preferences
};
function page(message, controls, status = 200) {
  const escaped = message.replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Private report | David Streek</title>
<style>:root{color-scheme:light;font:16px/1.5 Inter,Arial,sans-serif;background:#f7f6f2;color:#252923}main{max-width:38rem;margin:auto;padding:clamp(18px,5vw,56px)}h1{font-size:clamp(36px,7vw,54px);line-height:1.08;letter-spacing:-.05em}a{color:inherit}input{font:inherit;padding:.6em;width:9em;letter-spacing:.12em;margin:.4em 0}label{display:block}button{font:inherit;background:#252923;color:white;padding:.75em 1.1em;border:0;border-radius:4px;cursor:pointer}</style>
</head><body><main><a href="/">David Streek</a><h1>Private report</h1>
<p role="status">${escaped}</p>${controls}</main></body></html>`;
  return new Response(html, { status, headers:{...baseHeaders,'Content-Type':'text/html; charset=utf-8'} });
}
const emailForm = '<form method="post" action="/report"><button name="action" value="email">Email my sign-in code</button></form>';
const codeForm = '<form method="post" action="/report"><label for="code">Sign-in code</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" maxlength="8" required> <button name="action" value="verify">Sign in</button></form>';
const dashboard = '<p><a href="/studio-report">Open the dashboard</a></p>';
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const excluded = /(?:^|;\s*)ds_ignore=1(?:;|$)/.test(request.headers.get('Cookie') || '');
  if (request.method === 'GET' || request.method === 'HEAD') {
    if (!excluded && !url.searchParams.has('check')) {
      return new Response(null,{status:303,headers:{...baseHeaders,Location:'/report?check=1'}});
    }
    if (!excluded) return page('This browser could not save your exclusion. Allow cookies for davidstreek.com in this browser, then check again.', '<p><a href="/report">Check exclusion again</a></p>');
    return page('This browser is excluded from portfolio statistics.', emailForm + codeForm + dashboard);
  }
  if (request.method !== 'POST') return page('Open the report to continue.',dashboard,405);
  if (!sameOrigin(request)) return page('Open the report to request a code.',dashboard,403);
  if (!excluded) return page('Check that this browser is excluded before requesting your code.', '<a href="/report">Check exclusion</a>',409);
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded')
    return page('Open the sign-in page to continue.', emailForm, 415);
  let data;
  const reader = request.body?.getReader();
  let text='', size=0;
  if (reader) {
    const decoder = new TextDecoder();
    for (;;) {
      const {value,done}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>256) {await reader.cancel();return page('Please use the sign-in form.', emailForm,413);}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  }
  const fields = new URLSearchParams(text);
  if (fields.get('action')==='verify' || fields.has('code')) data={action:'verify-code',code:fields.get('code')};
  else data={action:'email'};
  const result = await reportApi({...context,request:new Request(new URL('/api/report',url),{
    method:'POST', headers:{Origin:url.origin,'Content-Type':'application/json',Cookie:request.headers.get('Cookie') || ''}, body:JSON.stringify(data)
  })});
  const cookie=result.headers.get('Set-Cookie');
  if (data.action==='verify-code' && result.ok && cookie) {
    return new Response(null,{status:303,headers:{...baseHeaders,Location:'/studio-report','Set-Cookie':cookie}});
  }
  const feedback=await result.json();
  const out=page(feedback.message || 'Please try again.', codeForm + '<p></p>' + emailForm, result.status);
  if(cookie) out.headers.append('Set-Cookie',cookie);
  return out;
}
