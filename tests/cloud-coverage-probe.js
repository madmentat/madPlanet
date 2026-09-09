/* Run: node tests/cloud-coverage-probe.js, then open /cloud-coverage.tmp.html
   on the local static server. Tests actual GLSL on the browser's GPU. */
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const source=['#version 300 es',read('shaders/header.glsl'),read('shaders/noise.glsl'),read('shaders/terrain.glsl'),read('shaders/clouds.glsl'),`
uniform float probeClimate;
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;float y=uv.y*2.0-1.0;
  vec3 d=vec3(cos(uv.x*6.2831853)*sqrt(1.0-y*y),y,sin(uv.x*6.2831853)*sqrt(1.0-y*y));
  vec3 p=cumulusCoord(d,2.58,uSeedC+vec3(3.0,9.0,15.0));
  float shape=cumulusShape(p),climate=probeClimate;
  float broad=0.5+0.5*fbm(p*0.30+uSeedC*0.37+vec3(67.0),3);
  float jit=fbm(p*1.35+uSeedC*0.83+vec3(149.0,37.0,211.0),2);
  float cl0=clamp(climate,0.0,1.0),clim=clamp(cl0+jit*0.30*(4.0*cl0*(1.0-cl0)),0.0,1.0);
  float amount=clamp(uCloudLow*clim,0.0,1.0),a=amount*amount*(3.0-2.0*amount);
  float threshold=mix(0.72,0.26,a);
  float region=ss(threshold,threshold+0.105,broad)*mix(0.24,1.0,ss(0.05,0.62,clim));
  amount=clamp(uCloudLow*climate,0.0,1.0);a=amount*amount*(3.0-2.0*amount);
  float edge=mix(0.675,0.445,a);
  float old=ss(edge-0.018,edge+0.018,shape)*region;
  float current=cumulusDensityFromShape(p,shape,0.005,climate);
  if(uCloudLow<0.015){old=0.0;current=0.0;}
  fragColor=vec4(old,current,0.0,1.0);
}`].join('\n');
const script=`
const canvas=document.querySelector('canvas'),out=document.querySelector('pre');
try{
 const g=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});
 const program=g.createProgram();
 for(const [type,src] of [[g.VERTEX_SHADER,'#version 300 es\\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}'],[g.FRAGMENT_SHADER,${JSON.stringify(source)}]]){
  const s=g.createShader(type);g.shaderSource(s,src);g.compileShader(s);
  if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));g.attachShader(program,s);
 }
 g.linkProgram(program);if(!g.getProgramParameter(program,g.LINK_STATUS))throw Error(g.getProgramInfoLog(program));
 g.useProgram(program);g.disable(g.DITHER);g.viewport(0,0,256,128);
 const loc=n=>g.getUniformLocation(program,n);g.uniform2f(loc('uRes'),256,128);
 const data=new Uint8Array(256*128*4),results=[];
 for(const seed of [[1,7,13],[11,3,17],[5,15,2]])for(const [amount,climate] of [[0.45,0.72],[0.50,0.72],[0.50,0.20],[0.50,1],[0,1],[1,1]]){
  g.uniform3fv(loc('uSeedC'),seed);g.uniform1f(loc('uCloudLow'),amount);g.uniform1f(loc('probeClimate'),climate);
  g.drawArrays(g.TRIANGLES,0,3);g.readPixels(0,0,256,128,g.RGBA,g.UNSIGNED_BYTE,data);
  let before=0,after=0;for(let i=0;i<data.length;i+=4){if(data[i]>25)before++;if(data[i+1]>25)after++;}
  results.push({seed:seed.join(','),amount,climate,before:before/32768,after:after/32768});
 }
 const moderate=results.filter(r=>r.climate===0.72);
 const mean=a=>a.reduce((s,r)=>s+r.after,0)/a.length;
 if(mean(moderate)<0.08||mean(moderate)>0.70)throw Error('Moderate coverage outside 8..70%: '+mean(moderate));
 if(mean(results.filter(r=>r.climate===0.20))>=mean(results.filter(r=>r.climate===1&&r.amount===0.5)))throw Error('Dry weather must have less cloud');
 if(results.some(r=>r.amount===0&&r.after!==0))throw Error('Clouds at zero amount');
 if(results.some(r=>r.amount===1&&r.after<0.9))throw Error('Maximum must support overcast');
 out.textContent='PASS: GPU cloud coverage (density > 0.1)\\n'+JSON.stringify(results,null,2);
}catch(e){out.textContent='FAIL: '+e.stack;}
`;
fs.writeFileSync(path.join(root,'cloud-coverage.tmp.html'),'<!doctype html><meta charset="utf-8"><title>GPU cloud coverage regression</title><canvas width="256" height="128"></canvas><pre>Running GPU cloud coverage…</pre><script>'+script+'</script>');
console.log('Open http://127.0.0.1:8734/cloud-coverage.tmp.html');
