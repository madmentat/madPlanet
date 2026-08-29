/* ============ 0.5.53: screenshot + lightning trigger ============ */
const shotEl=document.getElementById('shot');
const shotBtn=document.getElementById('shotBtn');
let shotBlob=null;
let shotObjectUrl='';
let shotCaptureBusy=false;
let shotIncludeCard=true;
let shotMenu=null;
let dlCap=null;

/* Trigger state is consumed by screenshot-trigger.js after render.js is
   defined. No timeout: like an oscilloscope, armed mode waits for the next
   threshold crossing until it fires or the user cancels it. */
const lightningShotTrigger={armed:false,includeCard:true,lastScore:0,threshold:0.48};

if(window.claude&&window.claude.use){
  window.claude.use('downloads').then(v=>{dlCap=v;}).catch(()=>{});
}

function shotFileBase(){
  if(typeof planetExportSafeName==='function') return planetExportSafeName(state?.planetName||('planet-'+state.seed));
  return 'planeta-'+state.seed;
}
function shotInjectStyle(){
  if(document.getElementById('shotMenuStyle'))return;
  const st=document.createElement('style');st.id='shotMenuStyle';st.textContent=`
    .shot-menu{position:fixed;z-index:32;display:none;min-width:190px;padding:8px;border-radius:11px;
      border:1px solid var(--line);background:rgba(9,15,25,.95);backdrop-filter:blur(14px);
      box-shadow:0 12px 38px rgba(0,0,0,.56)}
    .shot-menu.on{display:flex;flex-direction:column;gap:6px}.shot-menu .act-btn{text-align:left;width:100%}
    .shot-menu .shot-opt{display:flex;align-items:center;justify-content:space-between;gap:14px;
      padding:5px 3px 2px;color:var(--mut);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
    #shotBtn.armed{border-color:rgba(190,218,255,.75);color:#eef6ff;box-shadow:0 0 16px rgba(120,180,255,.22)}
  `;document.head.appendChild(st);
}
function shotPositionMenu(){
  if(!shotMenu)return;const r=shotBtn.getBoundingClientRect();
  shotMenu.style.left=Math.max(8,Math.min(innerWidth-205,r.left))+'px';
  shotMenu.style.bottom=Math.max(58,innerHeight-r.top+7)+'px';
}
function shotCloseMenu(){if(shotMenu)shotMenu.classList.remove('on');}
function shotEnsureMenu(){
  if(shotMenu)return shotMenu;shotInjectStyle();
  const pop=document.createElement('div');pop.className='shot-menu';shotMenu=pop;
  const now=document.createElement('button');now.className='act-btn';now.textContent='Сейчас';
  now.addEventListener('click',async()=>{shotCloseMenu();await takeShot({includeCard:shotIncludeCard,showPreview:true});});
  const lightning=document.createElement('button');lightning.className='act-btn';lightning.textContent='⚡ Молния — trigger';
  lightning.addEventListener('click',()=>{shotCloseMenu();shotArmLightning(shotIncludeCard);});
  const opt=document.createElement('div');opt.className='shot-opt';
  const txt=document.createElement('span');txt.textContent='Паспорт планеты';
  const wrap=document.createElement('label');wrap.className='tg';
  const inp=document.createElement('input');inp.type='checkbox';inp.checked=shotIncludeCard;
  const sw=document.createElement('i');wrap.append(inp,sw);opt.append(txt,wrap);
  inp.addEventListener('change',()=>{shotIncludeCard=inp.checked;});
  pop.append(now,lightning,opt);document.body.appendChild(pop);return pop;
}
function shotToggleMenu(){
  if(lightningShotTrigger.armed){shotCancelLightning();return;}
  const pop=shotEnsureMenu();pop.classList.toggle('on');if(pop.classList.contains('on'))shotPositionMenu();
}
function shotArmLightning(includeCard=true){
  lightningShotTrigger.armed=true;lightningShotTrigger.includeCard=!!includeCard;lightningShotTrigger.lastScore=0;
  shotBtn.classList.add('armed');shotBtn.textContent='⚡ Ждём…';shotBtn.title='Trigger вооружён. Нажмите ещё раз или Esc для отмены.';
}
function shotCancelLightning(){
  lightningShotTrigger.armed=false;lightningShotTrigger.lastScore=0;
  shotBtn.classList.remove('armed');shotBtn.textContent='Скриншот';shotBtn.title='';
}
function shotTriggerFired(){
  lightningShotTrigger.armed=false;shotBtn.classList.remove('armed');shotBtn.textContent='Скриншот';shotBtn.title='';
}

shotBtn.addEventListener('click',shotToggleMenu);
addEventListener('resize',()=>{if(shotMenu?.classList.contains('on'))shotPositionMenu();});
addEventListener('pointerdown',e=>{
  if(shotMenu?.classList.contains('on')&&!shotMenu.contains(e.target)&&e.target!==shotBtn)shotCloseMenu();
},true);
addEventListener('keydown',e=>{if(e.key==='Escape'&&lightningShotTrigger.armed)shotCancelLightning();});

document.getElementById('shotSave').addEventListener('click',e=>{
  const a=e.currentTarget;a.download=shotFileBase()+'.png';
  if(dlCap&&shotBlob){e.preventDefault();dlCap.save({filename:a.download,data:shotBlob}).catch(()=>{});}
});
document.getElementById('shotClose').addEventListener('click',()=>{
  shotEl.classList.remove('on');const img=document.getElementById('shotImg');
  if(shotObjectUrl){URL.revokeObjectURL(shotObjectUrl);shotObjectUrl='';img.removeAttribute('src');}
});

function shotRenderCanvas(now,includeCard){
  const cw=Math.max(1,canvas.clientWidth),ch=Math.max(1,canvas.clientHeight);
  const mult=Math.min(2.5,4096/Math.max(cw,ch));
  const W=Math.max(1,Math.round(cw*mult)),H=Math.max(1,Math.round(ch*mult));
  const oldW=canvas.width,oldH=canvas.height;
  shotCaptureBusy=true;
  try{
    canvas.width=W;canvas.height=H;gl.viewport(0,0,W,H);
    drawFrame(Number.isFinite(now)?now:lastNow);
    const px=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);
    const c2=document.createElement('canvas');c2.width=W;c2.height=H;const ctx=c2.getContext('2d');
    const img=ctx.createImageData(W,H),rowB=W*4;
    for(let y=0;y<H;y++)img.data.set(px.subarray(y*rowB,y*rowB+rowB),(H-1-y)*rowB);
    ctx.putImageData(img,0,0);
    if((state.fieldLinesOn||state.auroraFootpoints)&&typeof magCanvas!=='undefined'&&magCanvas.width>0)ctx.drawImage(magCanvas,0,0,W,H);
    if(includeCard&&typeof planetDrawSummaryCard==='function')planetDrawSummaryCard(ctx,W,H);
    return c2;
  } finally {
    canvas.width=oldW;canvas.height=oldH;gl.viewport(0,0,oldW,oldH);shotCaptureBusy=false;
  }
}
function shotCanvasBlob(c2){
  return new Promise((resolve,reject)=>c2.toBlob(b=>b?resolve(b):reject(new Error('PNG encode failed')),'image/png'));
}
function shotShowBlob(blob){
  shotBlob=blob;if(shotObjectUrl)URL.revokeObjectURL(shotObjectUrl);shotObjectUrl=URL.createObjectURL(blob);
  const im=document.getElementById('shotImg');im.src=shotObjectUrl;
  const a=document.getElementById('shotSave');a.href=shotObjectUrl;a.download=shotFileBase()+'.png';
  shotEl.classList.add('on');
}
async function takeShot(options={}){
  const includeCard=options.includeCard!==undefined?!!options.includeCard:shotIncludeCard;
  const showPreview=options.showPreview!==false;
  const now=Number.isFinite(options.now)?options.now:lastNow;
  const c2=shotRenderCanvas(now,includeCard);const blob=await shotCanvasBlob(c2);shotBlob=blob;
  if(showPreview)shotShowBlob(blob);
  return blob;
}
