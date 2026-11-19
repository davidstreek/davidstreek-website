import { catalog } from './catalog.js';

const schema = [
  'CREATE TABLE IF NOT EXISTS totals (day TEXT, metric TEXT, item TEXT, pos INTEGER, n INTEGER NOT NULL, PRIMARY KEY(day,metric,item,pos))',
  'CREATE TABLE IF NOT EXISTS report_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS report_codes (browser TEXT PRIMARY KEY, issued INTEGER NOT NULL, digest TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS report_sessions (digest TEXT PRIMARY KEY, expires INTEGER NOT NULL)'
];
let ready;
let bound;
export async function database(env) {
  const db = env.PORTFOLIO_STATS;
  if (!db) throw new Error('storage');
  if (bound !== db || !ready) {
    bound = db;
    ready = db.batch(schema.map(sql => db.prepare(sql))).catch(error => { ready = null; throw error; });
  }
  await ready;
  return db;
}
export const response = (data, status = 200, headers = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control':'private, no-store','X-Robots-Tag':'noindex', ...headers } });
export const sameOrigin = req => req.headers.get('Origin') === new URL(req.url).origin;
export function ignored(req) {
  return /(?:^|;\s*)ds_ignore=1(?:;|$)/.test(req.headers.get('Cookie') || '') ||
    /(?:^|;\s*)__Host-ds_report=[0-9a-f]{64}(?:;|$)/.test(req.headers.get('Cookie') || '') || req.headers.get('DNT') === '1' || req.headers.get('Sec-GPC') === '1';
}
export async function isActive(db) {
  return !!await db.prepare("SELECT 1 AS yes FROM report_settings WHERE key='since'").first();
}
const projectIds = new Set(catalog.map(p => p.id));
const imageIds = new Set(catalog.flatMap(p => p.photos.map(i => i.id)));
const photoMetrics = new Set(['shown','chosen','open','browse','seconds','views']);
const projectMetrics = new Set(['reach','read','engaged','projectSeconds']);
const siteMetrics = new Set(['visit','phone','email','start']);
export const discoveries = ['Golden Guide','Bark','Google','Recommendation','Other'];
export function validEvent(row) {
  if (!Array.isArray(row) || row.length !== 4) return false;
  const [metric,item,pos,n] = row;
  if (!Number.isInteger(pos) || !Number.isInteger(n) || n < 1 || n > (['seconds','projectSeconds'].includes(metric) ? 3600 : 50)) return false;
  if (photoMetrics.has(metric)) return imageIds.has(item) && pos >= 1 && pos <= 50;
  if (pos !== 0) return false;
  if (projectMetrics.has(metric)) return projectIds.has(item);
  if (siteMetrics.has(metric)) return item === '';
  if (metric === 'source') return ['Google','Bark','Golden Guide','Other link','Direct or unknown'].includes(item);
  if (metric === 'device') return ['Small screen','Larger screen'].includes(item);
  return false;
}
export const ukDay = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function add(db, rows) {
  const day = ukDay();
  const stmt = db.prepare('INSERT INTO totals(day,metric,item,pos,n) VALUES(?,?,?,?,?) ON CONFLICT(day,metric,item,pos) DO UPDATE SET n=n+excluded.n');
  if (rows.length) await db.batch(rows.map(row => stmt.bind(day,...row)));
}
export async function delivered(env, request, discovery) {
  if (ignored(request) || !env.PORTFOLIO_STATS) return;
  const db = await database(env);
  if (await isActive(db)) await add(db,[['sent','',0,1],['discovery', discoveries.includes(discovery) ? discovery : 'Unspecified',0,1]]);
}
export async function readJSON(req,limit=8192) {
  if (!(req.headers.get('Content-Type') || '').startsWith('application/json')) throw new Error('content');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('body');
  let size=0, text='';
  const decoder=new TextDecoder();
  for (;;) {
    const {done,value}=await reader.read();
    if (done) break;
    size+=value.byteLength;
    if (size>limit) { await reader.cancel(); throw new Error('size'); }
    text+=decoder.decode(value,{stream:true});
  }
  return JSON.parse(text+decoder.decode());
}
