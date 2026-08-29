/* ============ 0.5.53: Web Share transient-activation bridge ============ */
/* planet-export.js intentionally owns the generic/fallback share UI. This
   adapter runs after that UI exists and intercepts the actual button in the
   capture phase so Web Share is invoked synchronously from the user's click.
   The PNG itself is rendered synchronously only on this explicit action. */

function planetShareActivatedClick(e){
  const btn=document.getElementById('planetShareBtn');
  if(!btn||e.currentTarget!==btn)return;
  e.preventDefault();e.stopImmediatePropagation();
  const s=planetCollectSummary(),url=planetUrlWithName();
  const text=s.climate+' · '+planetExportSignedC(s.meanTempC)+' · '+planetExportFmt(s.pressureBar,2)+' bar';

  if(!navigator.share){planetBuildShareMenu(btn);return;}
  try{
    let blob=null,file=null;
    if(typeof takeShotSyncBlob==='function'&&typeof File!=='undefined'){
      blob=takeShotSyncBlob({includeCard:true});
      file=new File([blob],planetExportSafeName(s.name)+'.png',{type:'image/png'});
    }
    let p;
    if(file&&(!navigator.canShare||navigator.canShare({files:[file]})))
      p=navigator.share({title:s.name,text,url,files:[file]});
    else p=navigator.share({title:s.name,text,url});
    Promise.resolve(p).catch(err=>{
      if(err?.name!=='AbortError')planetBuildShareMenu(btn);
    });
  }catch(err){planetBuildShareMenu(btn);}
}

(function planetInstallShareActivationBridge(){
  const btn=document.getElementById('planetShareBtn');
  if(btn)btn.addEventListener('click',planetShareActivatedClick,true);
})();
