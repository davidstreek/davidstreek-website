export function isExcluded() {
  return document.cookie.split(';').some(pair=>pair.trim()==='ds_ignore=1');
}
export async function setExcluded(value) {
  document.cookie='ds_ignore='+(value?'1':'')+'; Path=/; Secure; SameSite=Lax; Max-Age='+(value?34560000:0);
  try {
    await fetch('/api/preference',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({exclude:value})});
  } catch { /* The first-party preference above also works while offline. */ }
  return isExcluded();
}
