/* Thin channels follow drainage segments. The texture is an acceleration
   structure, not a painted river mask; its texel size never sets river width. */
vec3 riverFaceDirection(int face,vec2 p){
  if(face==0)return normalize(vec3(1.0,p.y,-p.x));
  if(face==1)return normalize(vec3(-1.0,p.y,p.x));
  if(face==2)return normalize(vec3(p.x,1.0,-p.y));
  if(face==3)return normalize(vec3(p.x,-1.0,p.y));
  if(face==4)return normalize(vec3(p.x,p.y,1.0));
  return normalize(vec3(-p.x,p.y,-1.0));
}
vec2 riverChannelSample(vec3 d,float footprint){
  if(uRiverLoopOn<0.5)return vec2(0.0);
  vec3 ad=abs(d);vec2 uv;int face;
  if(ad.x>=ad.y&&ad.x>=ad.z){
    face=d.x>=0.0?0:1;uv=vec2(d.x>=0.0?-d.z:d.z,d.y)/ad.x;
  }else if(ad.y>=ad.z){
    face=d.y>=0.0?2:3;uv=vec2(d.x,d.y>=0.0?-d.z:d.z)/ad.y;
  }else{
    face=d.z>=0.0?4:5;uv=vec2(d.z>=0.0?d.x:-d.x,d.y)/ad.z;
  }
  float size=float(textureSize(uRiverLoopTex,0).x);
  vec2 base=floor((vec2(uv.x,-uv.y)*0.5+0.5)*size);
  vec2 result=vec2(0.0);
  // At a confluence the trunk can own all four nearest texels. Include the
  // upstream texel too, so the last part of a tributary reaches the junction.
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 cell=base+vec2(float(x),float(y));
    vec2 p=(cell+0.5)/size*2.0-1.0;p.y=-p.y;
    vec3 query=riverFaceDirection(face,p);
    uvec4 edge=texture(uRiverLoopTex,query);
    int edgeFace=face;
    if(any(greaterThan(abs(p),vec2(1.0)))){
      vec3 aq=abs(query);
      if(aq.x>=aq.y&&aq.x>=aq.z)edgeFace=query.x>=0.0?0:1;
      else if(aq.y>=aq.z)edgeFace=query.y>=0.0?2:3;
      else edgeFace=query.z>=0.0?4:5;
    }
    // Each RGBA32UI texel holds two independent edges without extra reads.
    // 14-bit UV coordinates preserve junction positions at regional zoom.
    for(int slot=0;slot<2;slot++){
      uint wa=slot==0?(edge.r>>28u):(edge.b>>28u);
      uint wb=slot==0?(edge.g>>28u):(edge.a>>28u);
      if(wa==0u||wb==0u)continue;
      uvec4 quant=slot==0?(edge&uvec4(16383u)):((edge>>uvec4(14u))&uvec4(16383u));
      vec4 uv4=vec4(quant)*(2.25/16383.0)-1.125;
      float widthA=float(wa),widthB=float(wb);
      vec3 a=riverFaceDirection(edgeFace,uv4.rg);
      vec3 b=riverFaceDirection(edgeFace,uv4.ba),ab=b-a;
    float t=clamp(dot(d-a,ab)/max(dot(ab,ab),1e-12),0.0,1.0);
    vec3 center=normalize(a+ab*t);
    float distance=length(d-center);
    // Spline curvature now comes from terrain-constrained shared tangents
    // baked in the atlas. Random bends inside each tiny segment caused
    // visible kinks and a different-looking river at changing scales.
    // Reject fragments outside the physically-sized river footprint.
    if(distance>max(0.001,footprint*1.2))continue;
    float smoothT=t*t*(3.0-2.0*t);
    float widthBin=mix(widthA,widthB,smoothT);
    // Keep world-space channel widths stable: the accumulated flow chooses
    // the bed, not the camera. The fragment footprint softens subpixel
    // channels into a readable one-pixel antialiased trace when zoomed out.
    // Do NOT multiply coverage by physicalHalfWidth/footprint: that used to
    // reduce every real headwater/river to ~0% opacity at orbital zoom.
    float physicalHalfWidth=mix(0.000008,0.00060,pow(widthBin/15.0,2.3));
    float aa=max(0.000001,footprint*0.55);
    float ink=1.0-smoothstep(max(0.0,physicalHalfWidth-aa),
                              physicalHalfWidth+aa,distance);
    // Previous 'plain' was an artificial dark bank halo extending eight
    // channel radii. Real riparian terrain needs its own geographic model.
    result=max(result,vec2(ink,0.0));
    }
  }
  return result;
}
