import {database} from '../lib/statistics.js';

// Serve the public half of a one-time key pair for sealed configuration.
export async function onRequestGet({request, env}) {
  const headers = {'Cache-Control':'no-store','X-Robots-Tag':'noindex','Content-Type':'text/plain; charset=utf-8'};
  if (new URL(request.url).hostname !== 'davidstreek.com') return new Response(null,{status:404});
  const db = await database(env);
  const read = key => db.prepare('SELECT value FROM report_settings WHERE key=?').bind(key).first('value');
  if (await read('report-pin-v1')) return new Response(null,{status:410,headers});
  let stored = await read('report-pin-wrap');
  if (!stored) {
    const pair = await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
    const encode = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const value = JSON.stringify({publicKey:encode(await crypto.subtle.exportKey('spki',pair.publicKey)),privateKey:encode(await crypto.subtle.exportKey('pkcs8',pair.privateKey))});
    await db.prepare("INSERT OR IGNORE INTO report_settings(key,value) SELECT 'report-pin-wrap',? WHERE NOT EXISTS (SELECT 1 FROM report_settings WHERE key='report-pin-v1')").bind(value).run();
    stored = await read('report-pin-wrap');
  }
  return stored ? new Response(JSON.parse(stored).publicKey,{headers}) : new Response(null,{status:410,headers});
}
