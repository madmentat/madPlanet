precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCamPos;
uniform mat3 uCamMat;
uniform float uFocal;
uniform vec3 uSunDir;
uniform vec3 uMagAxis;
uniform float uMagField;
uniform float uAurora;
uniform float uAtmo;
uniform float uStarFlux;

float h31(vec3 p){p=fract(p*0.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float n3(vec3 p){
  vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),
                 mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),
                 mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z)*2.0-1.0;
}
float fb(vec3 p){float a=0.0,w=0.55;for(int i=0;i<3;i++){a+=w*n3(p);p=p*2.03+vec3(1.7,2.9,4.1);w*=0.5;}return a;}

vec2 sphRange(vec3 ro,vec3 rd,float r){
  float b=dot(ro,rd),c=dot(ro,ro)-r*r,q=b*b-c;
  if(q<0.0)return vec2(-1.0);
  float s=sqrt(q); return vec2(-b-s,-b+s);
}
float sphNear(vec3 ro,vec3 rd,float r){
  vec2 q=sphRange(ro,rd,r); if(q.x<0.0&&q.y<0.0)return -1.0;
  return q.x>0.0?q.x:q.y;
}

/* Emission from one point in the auroral volume. The structure is deliberately
   noise-driven, not a periodic angular grille: broad active sectors break
   the oval into arcs, while medium noise makes irregular curtain folds. */
vec3 auroraEmission(vec3 p,vec3 rd,float activity,float innerR,float outerR){
  float r=length(p); if(r<innerR||r>outerR)return vec3(0.0);
  vec3 n=p/r, ma=normalize(uMagAxis);
  float pole=dot(n,ma);
  float lat=abs(asin(clamp(pole,-1.0,1.0)));
  vec3 ref=abs(ma.y)<0.92?vec3(0,1,0):vec3(1,0,0);
  vec3 mt=normalize(cross(ma,ref)), mb=cross(ma,mt);
  vec3 mq=vec3(dot(n,mt),dot(n,mb),pole);

  /* 0.5.63: Kp remains a physical activity control, but its visual response
     must not collapse into a nearly invisible broken thread. The oval centre
     stays in the same 75..59.5 degree range used by the UI/overlay, while the
     active half-width grows farther during storms so Kp 8-9 can reach the
     low/mid-50s without moving the nominal oval to an unphysical latitude. */
  float activityV=pow(clamp(activity,0.0,1.0),0.82);
  float timeA=uTime*(0.018+0.060*activityV);
  float daySide=clamp(dot(n,uSunDir)*0.5+0.5,0.0,1.0);
  float baseCenter=radians(mix(75.0,59.5,activityV));
  float wander=fb(mq*3.1+vec3(timeA,-timeA*0.7,11.0));
  float center=baseCenter+radians(1.65)*wander+radians(1.0)*(daySide*2.0-1.0);
  float hw=radians(mix(1.35,6.2,activityV));
  float d=(lat-center)/max(hw,1e-4);

  /* Large irregular sectors. A small floor keeps a real oval from vanishing
     entirely just because the broad noise happens to fall below the cut. */
  float broad=0.5+0.5*fb(mq*2.35+vec3(timeA*0.45,17.0,-timeA*0.30));
  float cut=mix(0.61,0.34,activityV);
  float sector=0.10+0.90*smoothstep(cut,cut+0.18,broad);
  float arc0=exp(-2.05*d*d)*sector;

  /* Strong activity can produce a second equatorward broken arc rather than
     a mathematically perfect concentric ring. */
  float broad2=0.5+0.5*fb(mq*2.8+vec3(31.0,-timeA*0.34,9.0));
  float sector2=(0.06+0.94*smoothstep(0.52,0.73,broad2))*smoothstep(0.30,0.68,activityV);
  float d2=(lat-(center-hw*(0.78+0.24*wander)))/max(hw*0.78,1e-4);
  float arc1=0.64*exp(-2.5*d2*d2)*sector2;
  float arc=clamp(arc0+arc1,0.0,1.35);
  if(arc<0.001)return vec3(0.0);

  /* Curtain folds are irregular patches along the oval. They are constant
     enough with altitude to read as vertical sheets at the limb, but there is
     no periodic radial iris and no techno-grid. */
  float foldA=0.5+0.5*fb(mq*11.0+vec3(-timeA*0.9,5.0,timeA*0.55));
  float foldB=0.5+0.5*n3(mq*27.0+vec3(13.0,timeA*1.7,-7.0));
  float folds=0.34+0.66*smoothstep(0.43,0.70,foldA*0.76+foldB*0.24);
  float ragged=0.74+0.26*(0.5+0.5*n3(mq*7.3+vec3(43.0,-timeA,3.0)));

  /* Daylight still suppresses optical aurora strongly, but on the nightside
     a Kp~5-6 event should be readily visible. Magnetic field is a support
     factor, not another harsh linear gate. */
  float night=1.0-smoothstep(-0.15,0.16,dot(n,uSunDir));
  float magSupport=0.34+0.66*sqrt(clamp(uMagField,0.0,1.0));
  float power=(0.016+0.36*pow(activityV,1.48))*magSupport;
  power*=mix(0.030,1.0,night)*smoothstep(0.02,0.18,uAtmo);

  float alt=clamp((r-innerR)/max(outerR-innerR,1e-4),0.0,1.0);
  float greenH=exp(-pow((alt-0.34)/0.30,2.0));
  float redH=exp(-pow((alt-0.78)/0.24,2.0));
  float violetH=exp(-pow((alt-0.18)/0.20,2.0));
  vec3 green=vec3(0.10,0.78,0.25);
  vec3 red=vec3(0.72,0.13,0.08);
  vec3 violet=vec3(0.20,0.16,0.55);
  vec3 color=green*greenH+red*redH*(0.12+0.34*activityV)+violet*violetH*(0.030+0.075*activityV);
  color*=clamp(0.88+0.12*uStarFlux,0.78,1.18);
  return color*(arc*folds*ragged*power);
}

void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*uRes)/uRes.y;
  vec3 rd=normalize(uCamMat*normalize(vec3(uv,uFocal)));
  vec3 ro=uCamPos;
  if(uAurora<0.005||uMagField<0.01||uAtmo<0.02){fragColor=vec4(0);return;}

  float activity=clamp(uAurora,0.0,1.0);
  /* Roughly 90..430 km for an Earth-size visual scale. */
  float innerR=1.0135+0.0035*uAtmo;
  float outerR=1.0580+0.0100*uAtmo;
  vec2 outer=sphRange(ro,rd,outerR);
  if(outer.y<=0.0){fragColor=vec4(0);return;}
  float ta=max(outer.x,0.0), tb=outer.y;
  float planet=sphNear(ro,rd,1.0);
  if(planet>0.0)tb=min(tb,planet);
  if(tb<=ta){fragColor=vec4(0);return;}

  vec3 sum=vec3(0.0);
  const int N=6;
  float stepLen=(tb-ta)/float(N);
  for(int i=0;i<N;i++){
    float t=ta+(float(i)+0.5)*stepLen;
    sum+=auroraEmission(ro+rd*t,rd,activity,innerR,outerR);
  }
  /* Path-length term naturally strengthens a curtain at the limb without
     painting the whole polar cap when viewed from above. */
  sum*=clamp(stepLen/0.010,0.35,1.65);

  /* 0.5.63: this is a separate additive pass drawn AFTER the planet pass,
     whose colour has already been tone-mapped and gamma-encoded. Previously
     the aurora wrote raw linear emission straight into that display-space
     framebuffer, so dim but physically valid curtains looked several times
     darker than the same emission inside the old monolithic shader. Apply a
     compact display transform before additive compositing. */
  vec3 display=sum/(vec3(1.0)+0.80*sum);
  display=pow(clamp(display,vec3(0.0),vec3(1.0)),vec3(1.0/2.2))*0.72;
  fragColor=vec4(clamp(display,vec3(0.0),vec3(0.92)),1.0);
}
