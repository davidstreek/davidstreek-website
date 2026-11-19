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
<style>:root{color-scheme:light;font:16px/1.5 Inter,Arial,sans-serif;background:#f7f6f2;color:#252923}main{max-width:38rem;margin:auto;padding:clamp(18px,5vw,56px)}h1{font-size:clamp(36px,7vw,54px);line-height:1.08;letter-spacing:-.05em}a{color:inherit}button{font:inherit;background:#252923;color:white;padding:.75em 1.1em;border:0;border-radius:4px;cursor:pointer}</style>
</head><body><main><a href="/">David Streek</a><h1>Private report</h1>
<p role="status">${escaped}</p>${controls}</main></body></html>`;
  return new Response(html, { status, headers:{...baseHeaders,'Content-Type':'text/html; charset=utf-8'} });
}
const emailForm = '<form method="post" action="/report"><button>Email my sign-in link</button></form>';
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
    return page('This browser is excluded from portfolio statistics.', emailForm + dashboard);
  }
  if (request.method !== 'POST') return page('Open the report to continue.',dashboard,405);
  if (!sameOrigin(request)) return page('Open the report to request a sign-in link.',dashboard,403);
  if (!excluded) return page('Check that this browser is excluded before requesting your link.', '<a href="/report">Check exclusion</a>',409);
  const result = await reportApi({...context,request:new Request(new URL('/api/report',url),{
    method:'POST', headers:{Origin:url.origin,'Content-Type':'application/json'}, body:JSON.stringify({action:'email'})
  })});
  const data = await result.json();
  return page(data.message || 'The email could not be requested. Please try again.', result.ok ? dashboard : emailForm, result.status);
}
