/* ============ 0.5.53: planet card / local save / share ============ */
/*
   This is intentionally client-only. A saved planet is a downloaded JSON
   archive; opening/reproducing a planet continues to use the canonical URL
   hash. No localStorage/IndexedDB/cloud database is introduced here.

   planetName is metadata, not a physical parameter. It is carried in the
   named URL hash as name=<encoded> so shared links preserve the title without
   participating in any model calculation.
*/

if(typeof state!=='undefined' && typeof state.planetName!=='string') state.planetName='';

function planetExportSafeName(s){
  s=String(s||'').trim();
  if(!s) s='planet-'+String(state?.seed??'');
  return s.replace(/[\\/:*?"<>|\x00-\x1f]+/g,'-').replace(/\s+/g,' ').trim().slice(0,96)||'planet';
}
function planetExportFmt(x,d=2){
  x=Number(x); return Number.isFinite(x)?x.toFixed(d):'—';
}
function planetExportSignedC(c){
  c=Number(c); if(!Number.isFinite(c)) return '—';
  return (c>=0?'+':'')+c.toFixed(1)+' °C';
}
function planetExportGasName(k){
  return ({gasN2:'N₂',gasO2:'O₂',gasH2O:'H₂O',gasCO2:'CO₂',gasSO2:'SO₂',gasCH4:'CH₄',gasHHe:'H₂/He'})[k]||k;
}
function planetExportAtmosphereLabel(){
  if(typeof gasFractions!=='function') return '—';
  const f=gasFractions();
  return Object.keys(f).map(k=>[k,Math.max(0,Number(f[k])||0)])
    .sort((a,b)=>b[1]-a[1]).filter(q=>q[1]>=0.0005).slice(0,3)
    .map(q=>{
      const pc=q[1]*100;
      return planetExportGasName(q[0])+' '+(pc>=10?pc.toFixed(0):pc>=1?pc.toFixed(1):pc.toFixed(2))+'%';
    }).join(' · ') || 'разреженная/неопределённая';
}
function planetExportClimateLabel(c,core){
  const C=Number(c?.C ?? ((c?.T??273.15)-273.15));
  const sea=Math.max(0,Math.min(1,Number(state?.sea)||0));
  const ice=Math.max(0,Math.min(1,Number(c?.iceArea)||0));
  let base;
  if(C<-45) base='ледяной мир';
  else if(C<-12) base=ice>0.35?'холодный ледяной мир':'холодный сухой мир';
  else if(C>70) base='экстремально жаркий мир';
  else if(C>42) base=sea>0.35?'жаркий влажный мир':'жаркий пустынный мир';
  else if(sea>0.67) base='умеренный океанический мир';
  else if(sea<0.18) base='умеренный засушливый мир';
  else base='умеренный континентально-океанический мир';

  let storm='';
  if(core?.lightningPotential){
    let maxRate=0,deep=0;
    for(let i=0;i<core.count;i++){
      maxRate=Math.max(maxRate,Number(core.lightningFlashRateHz?.[i])||0);
      deep+=((Number(core.deepConvectiveState?.[i])||0)>0.55)?1:0;
    }
    const frac=core.count?deep/core.count:0;
    if(maxRate>2.0 || frac>0.08) storm=' · крайне грозовой климат';
    else if(maxRate>0.45 || frac>0.02) storm=' · активные грозы';
    else if(maxRate>0.03) storm=' · локальные грозы';
  }
  return base+storm;
}

function planetCollectSummary(){
  const c=(typeof climateModel==='function')?climateModel():{};
  const p=(typeof planetPhysics==='function')?planetPhysics():{};
  const st=(typeof starPhysics==='function')?starPhysics(state.star,state.luminosity):{};
  const di=(typeof distanceInfo==='function')?distanceInfo(state.distance):{};
  const core=(typeof weatherCoreEnsure==='function')?weatherCoreEnsure():null;
  const pressure=(typeof atmosphereSurfacePressureBar==='function')?atmosphereSurfacePressureBar():(Number(c?.pressureBar)||0);
  const hzLabel=di?.label?String(di.label).split(' · ').slice(-1)[0]:'';
  const name=(state.planetName||'').trim() || 'Планета № '+state.seed;
  return {
    name,
    seed:state.seed,
    version:(typeof APP_VERSION==='string'?APP_VERSION:'—'),
    starClass:(typeof starLabel==='function')?starLabel(state.star):'?',
    starTempK:Number(st.T)||NaN,
    luminositySolar:Number(st.L)||NaN,
    orbitAU:Number(di.au)||NaN,
    hzLabel,
    radiusEarth:Number(p.radiusEarth)||NaN,
    diameterKm:(Number(p.radiusEarth)||0)*12742.0,
    massEarth:Number(p.massEarth)||NaN,
    densityGcm3:Number(p.density)||NaN,
    gravityMS2:Number(p.gravityMS2)||NaN,
    gravityEarth:Number(p.gravityEarth)||NaN,
    escapeKMS:Number(p.escapeKMS)||NaN,
    rotationHours:Number(p.rotationHours)||NaN,
    axialTiltDeg:Number(p.axialTiltDeg)||NaN,
    pressureBar:Number(pressure)||0,
    meanTempC:Number(c?.C ?? ((c?.T??273.15)-273.15)),
    atmosphere:planetExportAtmosphereLabel(),
    climate:planetExportClimateLabel(c,core),
    rings:state.rings ? ((typeof ringMatLabel==='function')?ringMatLabel(state.ringMat):'есть') : '',
  };
}

function planetExportRoundedRect(ctx,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
}
function planetDrawSummaryCard(ctx,W,H,summary=planetCollectSummary()){
  const s=Math.max(0.78,Math.min(2.4,W/1700));
  const margin=30*s,pad=22*s;
  const w=Math.min(W-margin*2,610*s), h=258*s;
  const x=margin,y=H-margin-h;
  ctx.save();
  planetExportRoundedRect(ctx,x,y,w,h,18*s);
  ctx.fillStyle='rgba(7,12,21,.72)';ctx.fill();
  ctx.strokeStyle='rgba(190,214,255,.24)';ctx.lineWidth=Math.max(1,s);ctx.stroke();

  ctx.fillStyle='rgba(239,245,255,.96)';
  ctx.font=`300 ${Math.round(25*s)}px system-ui,Segoe UI,Arial,sans-serif`;
  ctx.fillText(summary.name,x+pad,y+38*s);
  ctx.fillStyle='rgba(161,190,233,.84)';
  ctx.font=`500 ${Math.round(10*s)}px ui-monospace,Consolas,monospace`;
  ctx.fillText(String(summary.climate).toUpperCase(),x+pad,y+58*s);

  const left=[
    ['ДИАМЕТР',Math.round(summary.diameterKm).toLocaleString('ru-RU')+' км'],
    ['МАССА',planetExportFmt(summary.massEarth,2)+' M⊕'],
    ['ГРАВИТАЦИЯ',planetExportFmt(summary.gravityMS2,2)+' м/с² · '+planetExportFmt(summary.gravityEarth,2)+' g⊕'],
    ['ESCAPE V',planetExportFmt(summary.escapeKMS,1)+' км/с'],
  ];
  const right=[
    ['ЗВЕЗДА',summary.starClass+' · '+Math.round(summary.starTempK)+' K · '+planetExportFmt(summary.luminositySolar,2)+' L☉'],
    ['ОРБИТА',planetExportFmt(summary.orbitAU,2)+' AU'+(summary.hzLabel?' · '+summary.hzLabel:'')],
    ['СРЕДНЯЯ T',planetExportSignedC(summary.meanTempC)],
    ['ДАВЛЕНИЕ',planetExportFmt(summary.pressureBar,2)+' bar'],
  ];
  function col(items,cx){
    items.forEach((q,i)=>{
      const yy=y+(86+i*32)*s;
      ctx.fillStyle='rgba(139,153,174,.78)';ctx.font=`500 ${Math.round(8*s)}px ui-monospace,Consolas,monospace`;
      ctx.fillText(q[0],cx,yy);
      ctx.fillStyle='rgba(230,237,248,.96)';ctx.font=`400 ${Math.round(12*s)}px system-ui,Segoe UI,Arial,sans-serif`;
      ctx.fillText(q[1],cx,yy+15*s);
    });
  }
  col(left,x+pad);col(right,x+w*0.51);
  ctx.strokeStyle='rgba(159,194,255,.12)';ctx.beginPath();ctx.moveTo(x+w*0.48,y+78*s);ctx.lineTo(x+w*0.48,y+h-42*s);ctx.stroke();

  ctx.fillStyle='rgba(180,194,216,.88)';ctx.font=`400 ${Math.round(10*s)}px system-ui,Segoe UI,Arial,sans-serif`;
  let footer='АТМОСФЕРА  '+summary.atmosphere;
  if(summary.rings) footer+='    ·    КОЛЬЦА  '+summary.rings;
  ctx.fillText(footer,x+pad,y+h-22*s);
  ctx.fillStyle='rgba(125,143,169,.66)';ctx.font=`500 ${Math.round(8*s)}px ui-monospace,Consolas,monospace`;
  ctx.textAlign='right';ctx.fillText('seed '+summary.seed+' · madPlanet '+summary.version,x+w-pad,y+h-22*s);
  ctx.restore();
}

/* ---- name in canonical share hash ------------------------------------ */
function planetReadNameFromHash(){
  const h=String(location.hash||'').slice(1); if(!h) return '';
  const parts=h.split(',');
  for(let i=1;i<parts.length;i++) if(parts[i].startsWith('name=')){
    try{return decodeURIComponent(parts[i].slice(5)).trim().slice(0,120);}catch(e){return '';}
  }
  return '';
}
function planetUrlWithName(){
  const u=new URL(location.href);
  const parts=u.hash.slice(1).split(',').filter(Boolean).filter(x=>!x.startsWith('name='));
  if(state.planetName) parts.push('name='+encodeURIComponent(state.planetName));
  u.hash=parts.join(',');
  return u.toString();
}

if(typeof loadHash==='function'){
  const planetLoadHashBefore=loadHash;
  loadHash=function(){
    planetLoadHashBefore();
    const n=planetReadNameFromHash();if(n)state.planetName=n;
  };
}
let planetNameHashTimer=0;
if(typeof saveHash==='function'){
  const planetSaveHashBefore=saveHash;
  saveHash=function(){
    planetSaveHashBefore();
    clearTimeout(planetNameHashTimer);
    planetNameHashTimer=setTimeout(()=>{
      if(!state.planetName)return;
      try{history.replaceState(null,'',planetUrlWithName());}catch(e){}
      planetRefreshNameChip();
    },260);
  };
}

function planetPrimitiveState(){
  const out={};
  Object.keys(state).forEach(k=>{
    const v=state[k];
    if(typeof v==='number'||typeof v==='boolean'||typeof v==='string') out[k]=v;
  });
  return out;
}
function planetBuildSaveDocument(){
  return {
    format:'madPlanet.save',formatVersion:1,appVersion:(typeof APP_VERSION==='string'?APP_VERSION:''),
    createdAt:new Date().toISOString(),planetName:state.planetName||'',seed:state.seed,
    shareUrl:planetUrlWithName(),state:planetPrimitiveState(),summary:planetCollectSummary()
  };
}
function planetDownloadBlob(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function planetAskName(){
  const d=(state.planetName||'').trim()||('Планета '+state.seed);
  const r=prompt('Название планеты:',d);
  if(r===null)return null;
  const n=String(r).trim().slice(0,120)||d;
  state.planetName=n;planetRefreshNameChip();if(typeof saveHash==='function')saveHash();return n;
}
async function planetSaveFile(){
  const n=planetAskName();if(n===null)return false;
  /* Let the ordinary debounced hash writer finish before freezing shareUrl. */
  await new Promise(r=>setTimeout(r,300));
  const text=JSON.stringify(planetBuildSaveDocument(),null,2);
  planetDownloadBlob(new Blob([text],{type:'application/json;charset=utf-8'}),planetExportSafeName(n)+'.madplanet.json');
  return true;
}

/* ---- compact UI ------------------------------------------------------ */
let planetNameChip=null,planetShareMenu=null;
function planetRefreshNameChip(){
  if(!planetNameChip)return;
  planetNameChip.textContent=state.planetName||('№ '+state.seed);
  planetNameChip.title=state.planetName||('Планета № '+state.seed);
}
function planetExportInjectStyle(){
  if(document.getElementById('planetExportStyle'))return;
  const st=document.createElement('style');st.id='planetExportStyle';st.textContent=`
    .planet-name-chip{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      font:9px/1.2 var(--mono);letter-spacing:.04em;color:rgba(190,207,233,.72);padding:0 2px}
    .planet-pop{position:fixed;z-index:31;display:none;min-width:180px;padding:7px;border-radius:10px;
      border:1px solid var(--line);background:rgba(10,16,27,.94);backdrop-filter:blur(14px);
      box-shadow:0 10px 36px rgba(0,0,0,.55)}
    .planet-pop.on{display:flex;flex-direction:column;gap:5px}.planet-pop button{width:100%;text-align:left}
    @media(max-width:700px){.planet-name-chip{display:none}.util-bar .act-btn{padding:6px 7px;font-size:9px}}
  `;document.head.appendChild(st);
}
function planetPositionPopup(pop,anchor){
  const r=anchor.getBoundingClientRect();pop.style.left=Math.max(8,Math.min(innerWidth-200,r.left))+'px';
  pop.style.bottom=Math.max(58,innerHeight-r.top+7)+'px';
}
function planetBuildShareMenu(anchor){
  if(planetShareMenu)planetShareMenu.remove();
  const pop=document.createElement('div');pop.className='planet-pop on';planetShareMenu=pop;
  const add=(label,fn)=>{const b=document.createElement('button');b.className='act-btn';b.textContent=label;b.onclick=async()=>{pop.remove();planetShareMenu=null;await fn();};pop.appendChild(b);};
  add('Скопировать ссылку',async()=>{try{await navigator.clipboard.writeText(planetUrlWithName());}catch(e){prompt('Скопируйте ссылку:',planetUrlWithName());}});
  add('Почта',async()=>{
    const s=planetCollectSummary();
    const body=`${s.name}\n${s.climate}\n${planetExportSignedC(s.meanTempC)} · ${planetExportFmt(s.pressureBar,2)} bar\n\n${planetUrlWithName()}`;
    location.href='mailto:?subject='+encodeURIComponent(s.name+' — madPlanet')+'&body='+encodeURIComponent(body);
  });
  add('Скачать PNG',async()=>{if(typeof takeShot==='function')await takeShot({includeCard:true,showPreview:true});});
  document.body.appendChild(pop);planetPositionPopup(pop,anchor);
}
async function planetShare(){
  await new Promise(r=>setTimeout(r,280));
  const s=planetCollectSummary(),url=planetUrlWithName();
  let blob=null;
  if(typeof takeShot==='function'){
    try{blob=await takeShot({includeCard:true,showPreview:false});}catch(e){}
  }
  const text=s.climate+' · '+planetExportSignedC(s.meanTempC)+' · '+planetExportFmt(s.pressureBar,2)+' bar';
  if(navigator.share){
    try{
      if(blob && typeof File!=='undefined'){
        const file=new File([blob],planetExportSafeName(s.name)+'.png',{type:'image/png'});
        const data={title:s.name,text,url,files:[file]};
        if(!navigator.canShare || navigator.canShare({files:[file]})){await navigator.share(data);return true;}
      }
      await navigator.share({title:s.name,text,url});return true;
    }catch(e){if(e?.name==='AbortError')return false;}
  }
  const btn=document.getElementById('planetShareBtn');if(btn)planetBuildShareMenu(btn);
  return false;
}

(function planetExportInitUI(){
  planetExportInjectStyle();
  const shot=document.getElementById('shotBtn');const bar=shot?.parentElement;if(!bar)return;
  planetNameChip=document.createElement('span');planetNameChip.className='planet-name-chip';
  const save=document.createElement('button');save.className='act-btn';save.id='planetSaveBtn';save.textContent='Сохранить';save.addEventListener('click',planetSaveFile);
  const share=document.createElement('button');share.className='act-btn';share.id='planetShareBtn';share.textContent='Отправить';share.addEventListener('click',planetShare);
  shot.insertAdjacentElement('beforebegin',planetNameChip);
  shot.insertAdjacentElement('afterend',save);save.insertAdjacentElement('afterend',share);
  planetRefreshNameChip();
  addEventListener('pointerdown',e=>{if(planetShareMenu&&!planetShareMenu.contains(e.target)&&e.target!==share){planetShareMenu.remove();planetShareMenu=null;}},true);
})();
