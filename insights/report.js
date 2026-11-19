import {setExcluded} from './preference.js';
const id=name=>document.getElementById(name);
const excluded=await setExcluded(true);
id('device').textContent=excluded?'This browser is excluded from portfolio statistics.':'Your browser could not save its exclusion. Allow site cookies before starting measurement.';
const datestr=date=>date.toISOString().slice(0,10);
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
id('to').value=today;id('to').max=today;id('from').max=today;
id('from').value=datestr(new Date(Date.parse(today)-27*86400000));
const action=(name,extra={})=>fetch('/api/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:name,...extra})});
const el=(tag,txt,cl)=>{const node=document.createElement(tag);if(txt!==undefined)node.textContent=txt;if(cl)node.className=cl;return node;};
const ratio=(a,b)=>b?Math.round(100*a/b)+'%':'—';
const roman=['i','ii','iii','iv','v','vi','vii','viii','ix','x'];
const shortDate=day=>new Intl.DateTimeFormat('en-GB',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(day));
function chart(label,series,maximum,days) {
  const fig=el('figure');fig.append(el('figcaption',label));
  if (!days.length){fig.append(el('small','Awaiting measurements'));return fig;}
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 240 52');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
  const max=Math.max(1,maximum), x=i=>series.length===1?120:2+236*i/(series.length-1),y=n=>49-44*n/max;
  const line=(points,color,width)=>{const node=document.createElementNS(ns,'polyline');node.setAttribute('points',points);node.setAttribute('fill','none');node.setAttribute('stroke',color);node.setAttribute('stroke-width',width);node.setAttribute('vector-effect','non-scaling-stroke');svg.append(node);};
  line('2,5 238,5','#d9dbd3',1);line('2,49 238,49','#b9bcb3',1);
  line(series.map((v,i)=>x(i)+','+y(v)).join(' '),'#364b40',2);
  if(series.length===1){const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx','120');dot.setAttribute('cy',y(series[0]));dot.setAttribute('r','2');svg.append(dot);}
  const axis=el('div',undefined,'dates');axis.append(el('span',shortDate(days[0])),el('span','0–'+max),el('span',shortDate(days.at(-1))));
  fig.append(svg,axis);return fig;
}
function render({catalog,since,rows,from,to}){
  const days=[];if(since)for(let t=Date.parse(from<since?since:from);t<=Date.parse(to);t+=86400000)days.push(datestr(new Date(t)));
  const totals=new Map(), daily=new Map();
  for(const {metric,item,day,n} of rows){
    const k=metric+'|'+item;totals.set(k,(totals.get(k)||0)+n);
    const d=k+'|'+day;daily.set(d,(daily.get(d)||0)+n);
  }
  const count=(metric,item='')=>totals.get(metric+'|'+item)||0;
  const series=(metric,items=[''])=>days.map(d=>items.reduce((sum,item)=>sum+(daily.get(metric+'|'+item+'|'+d)||0),0));
  const projectIds=catalog.map(p=>p.id),imgs=catalog.flatMap(p=>p.photos.map(i=>i.id));
  const definitions=[['Visits','visit',['']],['Projects reached','reach',projectIds],['Chosen full-screen','open',imgs],['Enquiries sent','sent',['']]];
  const numbers=id('summary'),trends=id('trends');numbers.replaceChildren();trends.replaceChildren();
  for(const [label,metric,items] of definitions){
    const total=items.reduce((v,item)=>v+count(metric,item),0),values=series(metric,items);
    const block=el('div');block.append(el('small',label),el('strong',total.toLocaleString('en-GB')));numbers.append(block);
    trends.append(chart(label+' per day',values,Math.max(1,...values),days));
  }
  const breakdown=id('contact');breakdown.replaceChildren();
  function column(title,entries){
    const node=el('div');node.append(el('h3',title));
    const list=el('dl');for(const [label,n] of entries){const row=el('div');row.append(el('dt',label),el('dd',n));list.append(row);}node.append(list);breakdown.append(node);
  }
  column('Contact actions',[['Phone taps',count('phone')],['Email taps',count('email')],['Form starts',count('start')],['Enquiries sent',count('sent')]]);
  for(const [title,metric,labels] of [
    ['Visit sources','source',['Google','Golden Guide','Bark','Other link','Direct or unknown']],
    ['Heard about us · enquiries','discovery',['Golden Guide','Bark','Google','Recommendation','Other','Unspecified']],
    ['Screen size','device',['Small screen','Larger screen']],['Broad location','area',['England','Scotland','Wales','Northern Ireland','UK','Outside UK','Unknown']]
  ]) column(title,labels.map(l=>[l,count(metric,l)]));
  const root=id('projects');root.replaceChildren();
  const pMax=Math.max(1,...catalog.flatMap(p=>series('reach',[p.id])));
  const iMax=Math.max(1,...imgs.flatMap(key=>series('open',[key])));
  for(const [index,p] of catalog.entries()){
    const section=el('section'),reaches=count('reach',p.id),interest=count('engaged',p.id);
    section.append(el('small','Project '+(index+1)),el('h2',p.name));
    section.append(el('p',reaches+' project views · '+interest+' explored ('+ratio(interest,reaches)+') · '+count('read',p.id)+' “Read more” openings · '+(reaches?Math.round(count('projectSeconds',p.id)/reaches)+'s':'—')+' mean visible time'));
    const plot=chart('Project views per day',series('reach',[p.id]),pMax,days);plot.className='project-line';section.append(plot);
    const photos=el('div',undefined,'photos');
    for(const [i,photo] of p.photos.entries()){
      const key=photo.id,shown=count('shown',key),chosen=count('chosen',key),views=count('views',key);
      const card=el('article',undefined,'photo'),image=el('img');image.alt=photo.caption;image.src=photo.src;image.loading='lazy';
      card.append(image,el('h3',(index+1)+'.'+(roman[i]||i+1)+' · '+photo.caption));
      const rate=el('progress');rate.max=100;rate.value=shown?100*chosen/shown:0;rate.setAttribute('aria-label','Opening rate '+ratio(chosen,shown));
      card.append(rate);
      const dl=el('dl');
      for(const [term,value] of [['Appearances',shown],['Chosen to enlarge',count('open',key)],['Opening rate',ratio(chosen,shown)],['Reached by swipe / arrow',count('browse',key)],['Mean full-screen time',views?Math.round(count('seconds',key)/views)+'s':'—']]){
        const r=el('div');r.append(el('dt',term),el('dd',value));dl.append(r);
      }
      card.append(dl,chart('Openings per day',series('open',[key]),iMax,days));
      const observed=rows.filter(r=>r.item===key&&r.pos>0).sort((a,b)=>a.day.localeCompare(b.day));
      let pos=0;for(const r of observed){if(r.pos!==pos && pos)card.append(el('small','Position '+r.pos+' observed '+shortDate(r.day)));pos=r.pos;}
      if(key==='garden-studio-05-retouched-20261116')card.append(el('small','Moved from 2.v to 2.ii on 17 Nov 2026, before measurement began.'));
      photos.append(card);
    }
    section.append(photos);root.append(section);
  }
}
async function load(){
  const u=new URL('/api/report',location.origin);u.searchParams.set('from',id('from').value);u.searchParams.set('to',id('to').value);
  try{
    const r=await fetch(u,{cache:'no-store'}),data=await r.json();id('login').hidden=r.status!==401;
    if(!r.ok){id('report').hidden=true;id('activate').hidden=true;id('status').textContent=data.message||(r.status===401?'Sign in through your website enquiry inbox.':'Report unavailable.');return;}
    id('report').hidden=false;id('activate').hidden=!!data.since;id('activate').disabled=!excluded;
    id('status').textContent=data.since?'Measuring since '+shortDate(data.since)+' '+data.since.slice(0,4)+'.':'Collection is paused. Start it here after excluding the browsers you use to review your site.';
    // Read current portfolio order on every report, retaining past figures by stable image key.
    try{
      const page=await fetch('/',{cache:'no-cache'});if(page.ok){
        const source=await page.text();
        // parse a template so reading the portfolio never loads its scripts or images
        const tpl=document.createElement('template');tpl.innerHTML=source;
        for(const p of data.catalog){
          const live=tpl.content.querySelector('[data-work-key="'+p.id+'"]');
          if(!live)continue;
          const keys=[...live.querySelectorAll('[data-image-key]')].map(card=>card.dataset.imageKey);
          p.photos.sort((a,b)=>keys.indexOf(a.id)-keys.indexOf(b.id));
        }
      }
    }catch{}
    render(data);
  }catch{id('status').textContent='Could not load the report. Refresh to try again.';}
}
id('period').onsubmit=e=>{e.preventDefault();load();};
id('login').onclick=async()=>{id('login').disabled=true;try{const r=await action('email');id('status').textContent=(await r.json()).message;}catch{id('status').textContent='Could not request a sign-in link.';}finally{id('login').disabled=false;}};
id('activate').onclick=async()=>{try{const r=await action('start');if(!r.ok)throw Error();await load();}catch{id('status').textContent='Collection could not start. Check this browser’s exclusion and try again.';}};
id('logout').onclick=async()=>{await action('logout');location.replace(location.pathname);};
const key=new URLSearchParams(location.hash.slice(1)).get('key');
if(key){history.replaceState(null,'',location.pathname);try{const r=await action('login',{key});if(!r.ok)throw Error();await load();}catch{id('status').textContent='This link could not sign you in. Request a fresh email.';id('login').hidden=false;}}
else await load();
