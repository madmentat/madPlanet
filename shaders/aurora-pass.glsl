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

/* 0.5.65: high Kp must be visually unmistakable on the nightside, while the
   geometry remains an irregular auroral oval rather than a luminous polar cap
   or techno-ring. */
vec3 auroraEmission(vec3 p,vec3 rd,float activity,float innerR,float outerR){
  float r=length(p); if(r<innerR||r>outerR)return vec3(0.0);
  vec3 n=p/r, ma=normalize(uMagAxis);
  float pole=dot(n,ma);
  float lat=abs(asin(clamp(pole,-1.0,1.0)));
  vec3 ref=abs(ma.y)<0.92?vec3(0,1,0):vec3(1,0,0);
  vec3 mt=normalize(cross(ma,ref)), mb=cross(ma,mt);
  vec3 mq=vec3(dot(n,mt),dot(n,mb),pole);

  float activityV=pow(clamp(activity,0.0,1.0),0.78);
  float timeA=uTime*(0.020+0.070*activityV);
  float daySide=clamp(dot(n,uSunDir)*0.5+0.5,0.0,1.0);
  float baseCenter=radians(mix(75.0,58.5,activityV));
  float wander=fb(mq*3.1+vec3(timeA,-timeA*0.7,11.0));
  float center=baseCenter+radians(1.9)*wander+radians(0.8)*(daySide*2.0-1.0);
  float hw=radians(mix(1.55,8.8,activityV));
  float d=(lat-center)/max(hw,1e-4);

  /* Broad sectors stay broken, but the nonzero floor means noise cannot erase
     an entire physically active oval at exactly the moment the user turns Kp
     up to inspect it. */
  float broad=0.5+0.5*fb(mq*2.35+vec3(timeA*0.45,17.0,-timeA*0.30));
  float cut=mix(0.60,0.30,activityV);
  float sector=0.16+0.84*smoothstep(cut,cut+0.18,broad);
  float arc0=exp(-1.72*d*d)*sector;

  float broad2=0.5+0.5*fb(mq*2.8+vec3(31.0,-timeA*0.34,9.0));
  float sector2=(0.10+0.90*smoothstep(0.48,0.70,broad2))*smoothstep(0.25,0.60,activityV);
  float d2=(lat-(center-hw*(0.82+0.24*wander)))/max(hw*0.72,1e-4);
  float arc1=0.78*exp(-2.15*d2*d2)*sector2;
  float arc=clamp(arc0+arc1,0.0,1.55);
  if(arc<0.0005)return vec3(0.0);

  float foldA=0.5+0.5*fb(mq*11.0+vec3(-timeA*0.9,5.0,timeA*0.55));
  float foldB=0.5+0.5*n3(mq*27.0+vec3(13.0,timeA*1.7,-7.0));
  float folds=0.44+0.56*smoothstep(0.40,0.68,foldA*0.76+foldB*0.24);
  float ragged=0.76+0.24*(0.5+0.5*n3(mq*7.3+vec3(43.0,-timeA,3.0)));

  /* Optical aurora remains predominantly a nightside phenomenon. Twilight is
     allowed a little more visibility than before so the oval does not vanish
     completely as the terminator crosses it. */
  float night=1.0-smoothstep(-0.10,0.22,dot(n,uSunDir));
  float magSupport=0.40+0.60*sqrt(clamp(uMagField,0.0,1.0));
  float power=(0.028+0.64*pow(activityV,1.35))*magSupport;
  power*=mix(0.055,1.0,night)*smoothstep(0.018,0.14,uAtmo);

  float alt=clamp((r-innerR)/max(outerR-innerR,1e-4),0.0,1.0);
  float greenH=exp(-pow((alt-0.34)/0.30,2.0));
  float redH=exp(-pow((alt-0.78)/0.25,2.0));
  float violetH=exp(-pow((alt-0.18)/0.21,2.0));
  vec3 green=vec3(0.10,0.88,0.28);
  vec3 red=vec3(0.82,0.15,0.09);
  vec3 violet=vec3(0.25,0.18,0.68);
  vec3 color=green*greenH+red*redH*(0.14+0.46*activityV)+violet*violetH*(0.04+0.11*activityV);
  color*=clamp(0.88+0.12*uStarFlux,0.78,1.18);
  return color*(arc*folds*ragged*power);
}

void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*uRes)/uRes.y;
  vec3 rd=normalize(uCamMat*normalize(vec3(uv,uFocal)));
  vec3 ro=uCamPos;
  if(uAurora<0.005||uMagField<0.01||uAtmo<0.02){fragColor=vec4(0);return;}

  float activity=clamp(uAurora,0.0,1.0);
  /* Roughly 90..500 km for an Earth-size visual scale. */
  float innerR=1.0130+0.0035*uAtmo;
  float outerR=1.0660+0.0110*uAtmo;
  vec2 outer=sphRange(ro,rd,outerR);
  if(outer.y<=0.0){fragColor=vec4(0);return;}
  float ta=max(outer.x,0.0), tb=outer.y;
  float planet=sphNear(ro,rd,1.0);
  if(planet>0.0)tb=min(tb,planet);
  if(tb<=ta){fragColor=vec4(0);return;}

  vec3 sum=vec3(0.0);
  const int N=9;
  float stepLen=(tb-ta)/float(N);
  for(int i=0;i<N;i++){
    float t=ta+(float(i)+0.5)*stepLen;
    sum+=auroraEmission(ro+rd*t,rd,activity,innerR,outerR);
  }
  sum*=clamp(stepLen/0.0085,0.48,2.15);

  /* Separate additive pass is composited into an already display-space planet
     framebuffer. Keep the explicit display transform, but do not crush it back
     to the nearly invisible 0.72 multiplier used in 0.5.63. */
  vec3 display=sum/(vec3(1.0)+0.72*sum);
  display=pow(clamp(display,vec3(0.0),vec3(1.0)),vec3(1.0/2.2))*1.08;
  fragColor=vec4(clamp(display,vec3(0.0),vec3(0.98)),1.0);
}
