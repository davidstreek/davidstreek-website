import {isExcluded} from './preference.js';
const optedOut=()=>isExcluded() || navigator.doNotTrack==='1' || navigator.globalPrivacyControl===true;
if (!optedOut() && !document.prerendering) {
  fetch('/api/activity',{cache:'no-store'}).then(r=>r.ok && r.json()).then(data=>{if(data?.enabled && !optedOut()) measure();}).catch(()=>{});
}
function measure() {
  const sections=[...document.querySelectorAll('.work[data-work-key]')];
  const groups=sections.map(section=>[...section.querySelectorAll('.photo-card')]);
  const cards=groups.flat(), modal=document.querySelector('#lightbox');
  const pending=new Map(), seen=new Set(), chosen=new Set(), reached=new Set(), engaged=new Set();
  const visible=new Set(), active=new Map();
  let current=null, clock=performance.now(),visits=false,started=false;
  const permitted=()=>!document.hidden && !optedOut();
  const add=(metric,item='',pos=0,n=1)=>{
    if (!n || optedOut()) return;
    const key=JSON.stringify([metric,item,pos]);
    const row=pending.get(key)||[metric,item,pos,0];
    row[3]+=n;pending.set(key,row);
  };
  const position=card=>Number(card.dataset.photo)+1;
  const photo=(metric,card,n)=>add(metric,card.dataset.imageKey,position(card),n);
  const project=element=>element.closest('.work').dataset.workKey;
  function once(set,id,fn){if(!set.has(id)){set.add(id);fn();}}
  function shown(card){once(seen,card,()=>photo('shown',card));}
  function reach(id){once(reached,id,()=>add('reach',id));}
  function engage(id){reach(id);once(engaged,id,()=>add('engaged',id));}
  function source(){
    const tag=(new URLSearchParams(location.search).get('utm_source')||'').toLowerCase();
    let host='';try{host=new URL(document.referrer).hostname;}catch{}
    if(tag==='golden-guide'||tag==='golden_guide')return 'Golden Guide';
    if(tag==='bark'||/(^|\.)bark\.com$/.test(host))return 'Bark';
    if(tag==='google'||/(^|\.)google\.(com|co\.uk)$/.test(host))return 'Google';
    return host && host!==location.hostname || tag ? 'Other link':'Direct or unknown';
  }
  function visit(){
    if (visits || !permitted())return;
    visits=true;add('visit');add('source',source());add('device',matchMedia('(max-width: 700px)').matches?'Small screen':'Larger screen');
  }
  function flush(){
    const rows=Array.from(pending.values());pending.clear();
    if (optedOut() || !rows.length)return;
    for(let i=0;i<rows.length;i+=60){
      const body=new Blob([JSON.stringify(rows.slice(i,i+60))],{type:'application/json'});
      if (!navigator.sendBeacon?.('/api/activity',body)) fetch('/api/activity',{method:'POST',body,keepalive:true}).catch(()=>{});
    }
  }
  function stopTimers(){
    const now=performance.now();
    if(current && clock!==null) photo('seconds',current,Math.min(3600,Math.round((now-clock)/1000)));
    clock=null;
    for(const [section,begin] of active)add('projectSeconds',project(section),0,Math.min(3600,Math.round((now-begin)/1000)));
    active.clear();
  }
  function sync(){
    if(!permitted())return;
    visit();
    if(!modal.hidden){if(current && clock===null)clock=performance.now();return;}
    for(const el of visible){
      if(el.matches('.photo-card'))shown(el);
      else {reach(project(el));if(!active.has(el))active.set(el,performance.now());}
    }
  }
  const observer=new IntersectionObserver(entries=>{
    for(const e of entries){
      const el=e.target,isPhoto=el.matches('.photo-card'),inside=e.isIntersecting && (isPhoto?e.intersectionRatio>=0.5:e.intersectionRect.height>=1);
      if(inside)visible.add(el);
      else {
        visible.delete(el);
        if(active.has(el)){add('projectSeconds',project(el),0,Math.min(3600,Math.round((performance.now()-active.get(el))/1000)));active.delete(el);}
      }
    }
    sync();
  },{threshold:[0,0.5,1]});
  sections.forEach(el=>observer.observe(el));
  // Measure the image rectangle independently of the caption below it.
  const imageObserver=new IntersectionObserver(entries=>{
    for(const e of entries){
      const card=e.target.closest('.photo-card');
      if(e.isIntersecting && e.intersectionRatio>=0.5)visible.add(card);else visible.delete(card);
    }
    sync();
  },{threshold:[0,0.5,1]});
  cards.forEach(card=>imageObserver.observe(card.querySelector('img')));
  document.addEventListener('portfolio:photo',({detail})=>{
    stopTimers();current=groups[detail.project]?.[detail.photo];
    if(!current || !permitted())return;
    engage(project(current));clock=performance.now();photo('views',current);
    if(detail.how==='open'){shown(current);photo('open',current);once(chosen,current,()=>photo('chosen',current));}
    else photo('browse',current);
  });
  document.addEventListener('portfolio:close',()=>{stopTimers();current=null;sync();});
  for(const section of sections){
    const disclosure=section.querySelector('details');
    disclosure?.addEventListener('toggle',()=>{if(disclosure.open && permitted()){add('read',project(section));engage(project(section));}});
    const gallery=section.querySelector('.gallery');
    gallery?.addEventListener('scroll',()=>{if(permitted())engage(project(section));},{passive:true,once:true});
  }
  document.addEventListener('click',e=>{
    const a=e.target.closest('a');
    if(a?.protocol==='tel:')add('phone');
    if(a?.protocol==='mailto:')add('email');
  });
  document.querySelector('#enquiry-form')?.addEventListener('input',()=>{if(!started){started=true;add('start');}},{once:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopTimers();flush();}else sync();});
  window.addEventListener('pagehide',()=>{stopTimers();flush();});
  window.addEventListener('pageshow',sync);
  setInterval(()=>{if(!document.hidden){stopTimers();sync();flush();}},10000);
  sync();
}
