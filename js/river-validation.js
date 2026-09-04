/* madPlanet 0.5.150 - river validation layer
   Diagnostics only. This module never edits the generated river graph.
*/
(function(global){
'use strict';
function RiverValidation(options){
 this.height=options?.height||null;
 this.ocean=options?.ocean||null;
 this.downstream=options?.downstream||null;
 this.basin=options?.basin||null;
 this.result={checked:0, errors:[], stats:{}};
}
RiverValidation.prototype.validatePath=function(start){
 let seen=new Set(), cur=start, path=[];
 while(cur!=null && !seen.has(cur)){
  seen.add(cur); path.push(cur); this.result.checked++;
  let next=this.downstream?.[cur];
  if(next==null) break;
  if(this.height && this.height[next] > this.height[cur]+1e-5)
    this.result.errors.push({type:'uphill',from:cur,to:next});
  cur=next;
 }
 return path;
};
RiverValidation.prototype.validate=function(starts){
 for(const s of starts||[]) this.validatePath(s);
 return this.result;
};
global.RiverValidation=RiverValidation;
})(typeof window!=='undefined'?window:globalThis);
