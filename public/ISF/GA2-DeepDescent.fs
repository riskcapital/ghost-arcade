/*{
    "CREDIT": "Justin Wood / Ghost Arcade",
    "DESCRIPTION": "Deep Descent - a warped organic body falling through lit water. Volumetric god rays, caustics projected from the surface above, and dispersive glass marched THROUGH rather than stopped at, so masses behind show through the ones in front and absorption is measured along the real path inside the body. The journey control walks the form from a wide calm mass at the surface to a fully unwound one in the deep. Blob-tracker overlay is optional.",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D Room", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "speed",        "TYPE": "float", "MIN": 0.0,  "MAX": 3.0,  "DEFAULT": 1.0},
        {"NAME": "autoJourney",  "TYPE": "bool",                            "DEFAULT": true},
        {"NAME": "cycleSecs",    "TYPE": "float", "MIN": 8.0,  "MAX": 240.0,"DEFAULT": 60.0},
        {"NAME": "journey",      "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.0},
        {"NAME": "pingPong",     "TYPE": "bool",                            "DEFAULT": true},
        {"NAME": "warpBoost",    "TYPE": "float", "MIN": 0.0,  "MAX": 4.0,  "DEFAULT": 1.45},
        {"NAME": "warpDetail",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.45},
        {"NAME": "layers",       "TYPE": "float", "MIN": 1.0,  "MAX": 6.0,  "DEFAULT": 3.0},
        {"NAME": "translucency", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.55},
        {"NAME": "shaftBoost",   "TYPE": "float", "MIN": 0.0,  "MAX": 3.0,  "DEFAULT": 1.0},
        {"NAME": "causticBoost", "TYPE": "float", "MIN": 0.0,  "MAX": 3.0,  "DEFAULT": 1.0},
        {"NAME": "moteBoost",    "TYPE": "float", "MIN": 0.0,  "MAX": 3.0,  "DEFAULT": 1.0},
        {"NAME": "audioDrive",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.55},
        {"NAME": "hueShift",     "TYPE": "float", "MIN": -0.5, "MAX": 0.5,  "DEFAULT": 0.0},
        {"NAME": "camPush",      "TYPE": "float", "MIN": 0.5,  "MAX": 2.0,  "DEFAULT": 1.0},
        {"NAME": "exposure",     "TYPE": "float", "MIN": 0.4,  "MAX": 2.2,  "DEFAULT": 1.0},
        {"NAME": "grainAmt",     "TYPE": "float", "MIN": 0.0,  "MAX": 0.08, "DEFAULT": 0.011},
        {"NAME": "showTracker",  "TYPE": "bool",                            "DEFAULT": false}
    ]
}*/


/* ------------------------------------------------------------------
   Deep Descent
   Generated from the shader running behind justinwood.com, so the two
   stay identical. Everything the site drives from scroll position is
   driven here by `journey`: 0 is the surface, 1 is the deep.
   ------------------------------------------------------------------ */

#ifdef GL_ES
precision highp float;
#endif

float T;

/* the site's seven scroll stops, smoothstepped between */
float seg(float i, float k, float f, float lo, float hi){
  return abs(i - k) < 0.5 ? mix(lo, hi, f) : 0.0;
}
float ramp7(float t, float v0, float v1, float v2, float v3, float v4, float v5, float v6){
  t = clamp(t, 0.0, 0.99999)*6.0;
  float i = floor(t);
  float f = fract(t);
  f = f*f*(3.0 - 2.0*f);
  return seg(i,0.0,f,v0,v1) + seg(i,1.0,f,v1,v2) + seg(i,2.0,f,v2,v3)
       + seg(i,3.0,f,v3,v4) + seg(i,4.0,f,v4,v5) + seg(i,5.0,f,v5,v6);
}

float journeyNow(){
  if(!autoJourney) return journey;
  float u = fract(TIME/max(cycleSecs, 0.001));
  return pingPong ? (1.0 - abs(u*2.0 - 1.0)) : u;
}

/* every value the site interpolates across its seven sections */
float warpC, aBass, aLevel, aBeat, aCentroid;
float blobR, blobSpread, clusterGap, spineR, blendK, orbit, morph, warp, twist, spin, colR, wide, armAmt, armCount, armLen, armThick, armCurl, armWave, warpB, warpFreq, camDist, fov, camTilt, descend, shiftX, ior, dispersion, absorb, absorbHue, bodyOpacity, metallic, specular, specPower, fresnelPower, rimGlow, sss, keyHue, fillHue, lightYaw, lightPitch, envBase, envInt, envSharp, murk, fogK, waterHue, surfaceY, shaftInt, shaftScale, causticInt, causticScale, motes, saturation, contrast, gamma, grain, vig;
vec2 jitter;

void setParams(float j){
  blobR         = ramp7(j, 0.9, 0.62, 0.52, 0.86, 0.58, 1.3, 0.56);
  blobSpread    = ramp7(j, 1.6, 1.45, 1.3, 1.7, 1.4, 2.05, 1.35);
  clusterGap    = ramp7(j, 5.0, 5.6, 4.6, 6.4, 5.0, 7.4, 4.2);
  spineR        = ramp7(j, 0.3, 0.26, 0.22, 0.3, 0.24, 0.42, 0.22);
  blendK        = ramp7(j, 0.64, 0.56, 0.48, 0.7, 0.52, 1.0, 0.48);
  orbit         = ramp7(j, 0.12, 0.135, 0.15, 0.17, 0.19, 0.15, 0.11);
  morph         = ramp7(j, 0.62, 0.67, 0.72, 0.78, 0.84, 0.79, 0.74);
  warp          = ramp7(j, 1.35, 1.45, 1.55, 1.65, 1.75, 1.85, 1.95);
  twist         = ramp7(j, 0.44, 0.495, 0.55, 0.61, 0.67, 0.73, 0.79);
  colR          = ramp7(j, 2.7, 2.45, 2.2, 2.85, 2.4, 3.3, 2.25);
  wide          = ramp7(j, 2.0, 1.75, 1.55, 1.9, 1.65, 2.45, 1.6);
  armAmt        = ramp7(j, 0.85, 1.0, 0.95, 0.7, 1.0, 0.55, 1.0);
  armLen        = ramp7(j, 1.748, 3.128, 2.576, 2.392, 2.76, 2.392, 2.944);
  armThick      = ramp7(j, 0.319, 0.392, 0.275, 0.348, 0.29, 0.406, 0.304);
  armCurl       = ramp7(j, 0.34, 0.6, 0.48, 0.44, 0.58, 0.4, 0.68);
  armWave       = ramp7(j, 1.5, 1.15, 2.0, 1.4, 2.1, 1.0, 2.4);
  warpB         = ramp7(j, 0.3, 0.32, 0.34, 0.36, 0.38, 0.4, 0.42);
  warpFreq      = ramp7(j, 0.85, 0.925, 1.0, 1.09, 1.18, 1.27, 1.36);
  camDist       = ramp7(j, 9.2, 11.0, 9.4, 12.2, 10.2, 13.0, 10.4);
  fov           = ramp7(j, 0.76, 0.92, 0.68, 0.98, 0.8, 1.02, 0.6);
  camTilt       = ramp7(j, 0.16, 0.12, 0.2, 0.1, 0.14, 0.08, 0.22);
  shiftX        = ramp7(j, 0.0, 0.0, 0.05, 0.0, 0.06, 0.1, 0.46);
  ior           = ramp7(j, 1.34, 1.36, 1.41, 1.33, 1.37, 1.32, 1.46);
  dispersion    = ramp7(j, 0.16, 0.13, 0.21, 0.1, 0.15, 0.085, 0.28);
  absorb        = ramp7(j, 1.95, 2.3, 2.05, 2.65, 2.55, 2.78, 2.3);
  absorbHue     = ramp7(j, 0.52, 0.51, 0.47, 0.53, 0.5, 0.54, 0.5);
  metallic      = ramp7(j, 0.16, 0.2, 0.3, 0.22, 0.26, 0.2, 0.32);
  specular      = ramp7(j, 1.05, 0.92, 1.24, 0.84, 0.98, 0.8, 1.55);
  rimGlow       = ramp7(j, 0.48, 0.4, 0.6, 0.3, 0.38, 0.26, 0.86);
  sss           = ramp7(j, 0.31, 0.28, 0.34, 0.24, 0.29, 0.22, 0.21);
  keyHue        = ramp7(j, 0.5, 0.51, 0.49, 0.52, 0.53, 0.54, 0.47);
  fillHue       = ramp7(j, 0.55, 0.56, 0.54, 0.57, 0.57, 0.58, 0.34);
  lightYaw      = ramp7(j, 0.45, 0.62, 0.9, 0.38, 1.05, 0.28, 2.2);
  lightPitch    = ramp7(j, 0.74, 0.7, 0.62, 0.76, 0.58, 0.78, 0.34);
  envBase       = ramp7(j, 0.62, 0.58, 0.6, 0.56, 0.56, 0.56, 0.54);
  envInt        = ramp7(j, 1.16, 1.06, 1.18, 1.02, 1.08, 1.02, 1.34);
  murk          = ramp7(j, 0.5, 0.58, 0.64, 0.72, 0.78, 0.84, 0.72);
  fogK          = ramp7(j, 0.062, 0.074, 0.086, 0.1, 0.112, 0.128, 0.094);
  waterHue      = ramp7(j, 0.52, 0.54, 0.56, 0.58, 0.6, 0.61, 0.52);
  shaftInt      = ramp7(j, 1.15, 0.95, 0.85, 0.74, 0.72, 0.66, 1.05);
  shaftScale    = ramp7(j, 0.5, 0.58, 0.66, 0.46, 0.62, 0.42, 0.72);
  causticInt    = ramp7(j, 2.6, 2.2, 2.5, 1.9, 2.1, 1.8, 2.8);
  causticScale  = ramp7(j, 6.5, 5.5, 8.0, 5.0, 7.0, 4.8, 8.5);
  motes         = ramp7(j, 0.8, 0.928, 1.056, 0.992, 1.12, 1.184, 1.088);
  saturation    = ramp7(j, 1.12, 1.06, 1.16, 0.99, 1.03, 0.95, 1.18);
  vig           = ramp7(j, 0.48, 0.53, 0.46, 0.58, 0.56, 0.6, 0.44);
  spin          = 0.035;
  armCount      = 7.0;
  descend       = 5.0;
  bodyOpacity   = 0.22;
  specPower     = 26.0;
  fresnelPower  = 3.0;
  envSharp      = 2.3;
  surfaceY      = 2.0;
  contrast      = 1.1;
  gamma         = 0.92;
  grain         = 0.011;
  /* the exposed controls ride on top of the journey */
  warp        *= warpBoost;
  warpB       *= warpBoost;
  warpC        = warpDetail * 0.16 * (0.7 + 0.6*aBass);
  shaftInt    *= shaftBoost;
  causticInt  *= causticBoost;
  motes       *= moteBoost;
  camDist     *= camPush;
  keyHue       = fract(keyHue   + hueShift);
  fillHue      = fract(fillHue  + hueShift);
  waterHue     = fract(waterHue + hueShift);
  absorbHue    = fract(absorbHue+ hueShift);
  envInt      *= exposure;
  envBase     *= exposure;
  grain        = grainAmt;
}

#define PI 3.14159265359
#define TAU 6.28318530718
#define MARCH 144
#define VOL 24
#define FAR 30.0

mat2 rot(float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }
vec3 hue2rgb(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
float hash21(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
float hash11(float n){ return fract(sin(n*127.1)*43758.5453); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

/* --------------------------------------------------------------
   CAUSTICS
   The classic iterated-distortion water pattern. Sampled in a
   plane, so it can be projected either onto a surface or through
   the volume along the light direction.
   -------------------------------------------------------------- */
float caustic(vec2 p, float t){
  /* the pattern only forms when the coordinate sits far from the origin,
     so tile it and push it out: that is what makes the filaments sparse */
  p = mod(p, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.0055;
  for(int n = 0; n < 4; n++){
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 6.0);
}

/* the cross-section of the light coming down: sparse bright beams
   with a slow drift, rather than an even haze */
float beams(vec2 p, float t){
  float a = vnoise(p + vec2(t*0.06, t*0.02));
  float b = vnoise(p*2.4 + vec2(-t*0.05, t*0.03));
  float c = vnoise(p*5.1 + vec2(t*0.09, -t*0.04));
  float v = a*0.55 + b*0.30 + c*0.15;
  return pow(smoothstep(0.44, 0.93, v), 2.0);
}

/* --------------------------------------------------------------
   THE FORM
   A chain of organic masses threaded on a drifting spine, repeated
   down Y so the descent never ends. Each repeat is rotated and
   re-sized from its own index hash, so no two read the same.
   -------------------------------------------------------------- */
float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0 - h);
}
float smax(float a, float b, float k){ return -smin(-a, -b, k); }

/* the spine wanders in XZ as it descends, and is continuous across repeats */
vec2 spineAt(float y){
  return vec2(sin(y*0.115 + T*0.21)*1.05, cos(y*0.087 - T*0.16)*1.05);
}

/* tentacles: the sector around Y is folded so one tapered, waving tube is
   authored and repeated. They reach outward, which is what widens the form. */
float armTube(vec3 q, float ia, float sect, float seed){
  float aa = atan(q.z, q.x) - ia*sect;
  float r  = length(q.xz);
  vec2 e = vec2(cos(aa)*r, sin(aa)*r);          /* e.x runs out along the arm */
  float L = armLen;
  float x = clamp(e.x, 0.0, L);
  float ph = ia*2.399 + seed*11.0 + T*0.55;
  float wy = sin(x*armWave + ph)*armCurl;
  float wz = cos(x*armWave*0.82 - ph*0.8)*armCurl*0.66;
  float taper = armThick*(1.0 - 0.74*x/max(L, 0.001));
  return length(vec3(e.x - x, q.y - wy, e.y - wz)) - taper;
}

/* tentacles: the sector around Y is folded so one tapered, waving tube is
   authored and repeated. Both the owning sector and its nearer neighbour are
   evaluated, because the fold alone overestimates distance at the seam. */
float arms(vec3 q, float seed){
  if(armAmt < 0.01) return 1e3;
  float n = max(armCount, 2.0);
  float sect = TAU/n;
  vec2 xz = q.xz + vec2(1e-4, 1e-4);            /* atan is undefined on the axis */
  float a = atan(xz.y, xz.x);
  float f = a/sect;
  float i0 = floor(f + 0.5);
  float i1 = i0 + sign(f - i0);
  return min(armTube(q, i0, sect, seed), armTube(q, i1, sect, seed));
}

/* the domain warp. Two low-frequency layers, the second folded through the
   first, so raising the amplitude bends the whole body rather than roughening
   it. Low frequency is deliberate: it buys enormous distortion cheaply. */
vec3 domain(vec3 p){
  vec3 w = p;
  w += warp  * sin(p.yzx*warpFreq + T*vec3(0.42, 0.31, 0.55));
  w += warpB * sin(w.zxy*(warpFreq*0.45) - T*vec3(0.29, 0.47, 0.23));
  /* Third octave, folded through the first two. Small amplitude at high
     frequency: the low octaves bend the body, this one corrugates the surface
     they produce, so raising it adds writhe without inflating the Lipschitz
     bound the way another low-frequency layer would. */
  w += warpC * sin(w.yzx*(warpFreq*2.35) + T*vec3(0.61, 0.37, 0.83));
  return w;
}

/* how far the warp can stretch distance: every march step is divided by this
   so a ray can never overshoot through the surface */
float lipschitz(){
  float a = 1.0 + warp*warpFreq;
  float b = a + warpB*warpFreq*0.45*a;
  return b + warpC*warpFreq*2.35*b;
}

float map(vec3 p){
  vec3 w = domain(p);

  /* the spine: one long tube running the whole descent */
  float spine = length(w.xz - spineAt(w.y)) - spineR;

  /* masses, repeated down Y */
  /* NOTE: this used to be `float T = clusterGap`, which shadowed the global
     T = TIME*speed for the whole rest of the function. Every animated term
     below -- the spin, the orbit, both morph oscillators -- was reading a
     constant 5.0 instead of the clock, so the masses never orbited, morphed or
     pulsed. Only the domain warp and the spine moved, because those live in
     other functions and still saw the real global. Renamed. */
  float gap = clusterGap;
  float id = floor(p.y/gap + 0.5);
  vec3 q   = w;
  q.y     -= id*gap;
  q.xz    -= spineAt(id*gap);
  q.xz    *= rot(id*2.399 + T*spin + p.y*twist);

  float seed = hash11(id*13.7);
  float d = 1e3;
  for(int i = 0; i < 5; i++){
    float fi = float(i);
    float h  = hash11(id*13.7 + fi*7.31);
    float g  = hash11(id*29.1 + fi*3.77);
    float a  = fi*1.2566 + h*TAU + T*orbit*(0.6 + h*0.8);
    float lift = (h - 0.5)*gap*0.70;
    float rad  = blobSpread*(0.35 + g*1.15);
    vec3 c = vec3(cos(a)*rad, lift + sin(T*0.33 + h*6.0)*morph*0.5, sin(a)*rad);
    float r = blobR*(0.50 + h*0.95)*(1.0 + sin(T*0.47 + h*9.0)*morph*0.22);
    /* squashed on Y: the masses spread sideways instead of stacking */
    vec3 v = (q - c)*vec3(1.0, wide, 1.0);
    d = smin(d, (length(v) - r)/wide, blendK);
  }
  d = smin(d, spine, blendK*1.6);

  /* keep the core inside a column around the spine: the camera orbits outside it */
  d = smax(d, length(p.xz - spineAt(p.y)) - (colR + warp*0.85), 0.55);

  /* fine surface relief so the highlights break up like hammered metal */
  d -= 0.020*sin(w.x*7.1 + T*0.6)*sin(w.y*6.3)*sin(w.z*7.7)*(0.4 + seed*0.6);

  /* tentacles fuse into the core */
  d = smin(d, arms(q, seed), blendK*1.25);

  /* and one last world-space hull, so however hard the warp bends the body it
     can never reach out to where the camera is */
  d = smax(d, length(p.xz - spineAt(p.y)) - (colR + armLen*0.9 + (warp + warpB)*0.95), 0.60);
  return d/lipschitz()*0.85;
}

vec3 calcNormal(vec3 p, float t){
  vec2 e = vec2(0.0022 + t*0.0006, 0.0);
  return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),
                        map(p+e.yxy)-map(p-e.yxy),
                        map(p+e.yyx)-map(p-e.yyx)));
}

vec3 keyDir(){
  return normalize(vec3(sin(lightYaw)*(1.0-lightPitch), lightPitch, cos(lightYaw)*(1.0-lightPitch)));
}

/* the world above: one bright surface, everything else swallowed by water */
vec3 envLight(vec3 d){
  float up = clamp(d.y*0.5 + 0.5, 0.0, 1.0);
  vec3 deep = mix(hue2rgb(waterHue), vec3(0.0), 0.93);
  vec3 lit  = mix(hue2rgb(keyHue), vec3(1.0), 0.38);
  vec3 c = deep*envBase;
  c += lit*pow(up, envSharp)*envInt*0.62;
  c += mix(vec3(1.0), hue2rgb(fillHue), 0.62)
       * pow(max(dot(d, normalize(vec3(-0.62, 0.24, -0.58))), 0.0), 5.0)*envInt*0.16;
  return c;
}

/* --------------------------------------------------------------
   TRACKER OVERLAY (standalone build only)
   On the site the reticles come from a real blob tracker reading
   the rendered frame back. A single-pass ISF has no readback, so
   here the marks are placed analytically: each repeat of the form
   has a known centre on the spine, projected through the same
   camera. Brackets, node, crosshair, a slow dashed orbit, and a
   dashed thread from one mark to the next.
   -------------------------------------------------------------- */
vec2 projectPt(vec3 P, vec3 ro, float yaw, float tilt, vec2 R, out float ok, out float dz){
  vec3 D = P - ro;
  D.yz *= rot(-tilt);
  D.xz *= rot(-yaw);
  dz = max(D.z, 0.2);
  ok = step(0.2, D.z);
  vec2 uv = D.xy / dz * fov;
  uv.x -= shiftX;
  return uv*min(R.x, R.y) + 0.5*R;
}
float segDist(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba)/max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba*h);
}
float ink(float d, float w){ return 1.0 - smoothstep(w, w + 1.0, d); }
float bracketDist(vec2 p, vec2 c, vec2 h, float L){
  vec2 q = abs(p - c);
  float d = 1e3;
  if(q.y <= h.y + 0.5 && q.y >= h.y - L) d = min(d, abs(q.x - h.x));
  if(q.x <= h.x + 0.5 && q.x >= h.x - L) d = min(d, abs(q.y - h.y));
  return d;
}
vec3 trackerFX(vec2 px, vec2 R, vec3 ro, float yaw, float tilt, float depth){
  vec3 acc = vec3(0.0);
  /* Same shadowing bug as map() had: the dashed orbit ring below reads T. */
  float gap = clusterGap;
  float id0 = floor(depth/gap + 0.5);
  vec2 prev = vec2(0.0); float prevOk = 0.0;
  for(int k = -2; k <= 2; k++){
    float id = id0 + float(k);
    vec2 sp = spineAt(id*gap);
    vec3 C = vec3(sp.x, id*gap, sp.y);
    float ok, dz;
    vec2 c = projectPt(C, ro, yaw, tilt, R, ok, dz);
    if(ok < 0.5){ prevOk = 0.0; continue; }
    float near = (k == 0) ? 1.0 : 0.0;
    vec3 col = mix(vec3(0.97, 0.96, 0.94), vec3(0.84, 1.0, 0.22), near);
    float a = mix(0.40, 0.95, near);

    float s = (blobR*2.4 + blobSpread*1.1)*fov/dz*min(R.x, R.y);    /* half box, px */
    s = clamp(s, 18.0, 0.45*min(R.x, R.y));
    vec2 h = vec2(s, s*0.72);
    float L = clamp(s*0.28, 6.0, 16.0);
    float m = ink(bracketDist(px, c, h, L), 0.6);

    float r = mix(5.0, 7.0, near);
    vec2 d = px - c;
    float len = length(d);
    m = max(m, ink(abs(len - r), 0.5));
    vec2 q = abs(d);
    float tickH = (q.y < 0.6 && q.x > r + 1.0 && q.x < r + 5.0) ? 0.0 : 1e3;
    float tickV = (q.x < 0.6 && q.y > r + 1.0 && q.y < r + 5.0) ? 0.0 : 1e3;
    m = max(m, ink(min(tickH, tickV), 0.5));
    m = max(m, near*ink(len - 2.2, 0.5));

    /* the dashed orbit ring, turning slowly */
    vec2 e = d / vec2(max(12.0, s*0.9), max(5.0, s*0.35));
    float ang = atan(e.y, e.x) + T*0.35 + float(k)*0.7;
    float dash = step(0.5, fract(ang*1.1));
    float de = abs(length(e) - 1.0)*max(5.0, s*0.35);
    m = max(m, 0.45*dash*ink(de, 0.4));

    /* thread to the previous mark */
    if(prevOk > 0.5){
      vec2 dir = normalize(c - prev + 1e-4);
      float along = dot(px - prev, dir);
      float dashL = step(0.4, fract(along/8.0));
      acc += vec3(0.97, 0.96, 0.94)*0.22*dashL*ink(segDist(px, prev, c), 0.4);
    }
    acc += col*a*m;
    prev = c; prevOk = 1.0;
  }
  return acc;
}

void main(){
  /* Idle fallbacks, so the piece behaves with nothing bound. */
  aBass     = max(audioBass, 0.24 + 0.10*sin(TIME*0.23));
  aLevel    = max(audioLevel, 0.20 + 0.08*sin(TIME*0.17));
  aCentroid = max(audioSpectralCentroid, 0.45 + 0.15*sin(TIME*0.12));
  aBeat     = audioBeat;

  T = TIME*speed;
  jitter = vec2(fract(sin(TIME*91.7)*43758.5)-0.5,
                fract(sin(TIME*57.3)*24634.6)-0.5);

  setParams(journeyNow());

  vec2 R  = RENDERSIZE;
  vec2 uv = (gl_FragCoord.xy + jitter - 0.5*R) / min(R.x, R.y);
  uv.x += shiftX;

  float depth = -journeyNow()*6.0*descend;                 /* the camera sinks */
  vec3 ro = vec3(0.0, 0.0, -camDist);
  vec3 rd = normalize(vec3(uv, fov));
  float yaw = T*0.045 + 0.0;
  ro.xz *= rot(yaw); rd.xz *= rot(yaw);
  float tilt = camTilt - 0.0;
  ro.yz *= rot(tilt); rd.yz *= rot(tilt);
  ro.y = depth;

  vec3 L = keyDir();
  float toSurf = max(0.0, surfaceY - depth);

  /* ---------------- the water itself ---------------- */
  vec3 deepCol = mix(hue2rgb(waterHue), vec3(0.0), 0.90);
  vec3 nearCol = mix(hue2rgb(waterHue), vec3(1.0), 0.18);
  float upness = clamp(rd.y*0.9 + 0.44, 0.0, 1.0);
  vec3 water = mix(deepCol*0.10, nearCol*0.48, pow(upness, 2.6));
  water *= 0.35 + 0.65*exp(-murk*toSurf*0.010);

  /* The site drove a screen-space lamp from the cursor position. There is no
     cursor here, so it is driven by level instead: the body lights from within
     on loud passages rather than tracking a pointer. */
  float hot = aLevel * audioDrive * 0.55;

  /* ---------------- the body, marched THROUGH ----------------
     The original stopped at the first surface and approximated how much body
     lay behind it with three probes under the skin. That reads as a tinted
     shell: masses behind the front one are simply absent, and the "thickness"
     is a guess sampled at three fixed depths.

     Instead, keep marching. Every time the field changes sign the ray has
     crossed a surface, so shade it and composite front to back with a
     per-surface alpha -- faces translucent, edges opaque via fresnel. Masses
     deeper in the body then genuinely show through the ones in front.

     Crossings also come in pairs, which is what makes the absorption honest:
     the distance between an entry and the following exit IS the path length
     through glass, so Beer-Lambert can be applied to the real number rather
     than to a probe estimate. -------------------------------------------- */
  int maxLayers = int(clamp(layers, 1.0, 6.0));
  vec4 acc = vec4(0.0);          /* premultiplied, front to back */
  vec3 through = vec3(1.0);      /* coloured transmittance through the body */
  float dist = FAR;              /* first crossing, for the volumetrics */
  bool hit = false;
  bool inside = false;
  float enterT = 0.0;
  int nlay = 0;

  float t = 0.05;
  float pd = map(ro + rd*t);
  for(int i = 0; i < MARCH; i++){
    float tPrev = t;
    t += max(abs(pd)*0.72, 0.010);
    if(t > FAR || acc.a > 0.985 || nlay >= maxLayers) break;
    vec3 pos = ro + rd*t;
    float d = map(pos);

    if((d < 0.0) != (pd < 0.0)){                  /* surface crossing */
      /* Bisect onto the crossing before shading it. Stepping by |d| can stride
         clean past a thin tendril and register the sign change wherever the
         stride happened to land, which serrates every edge the warp makes
         thin -- and the whole point of pushing the warp is thin tendrils. Three
         halvings put the surface within an eighth of a step, for three map()
         calls against the ~176 the march already spends. */
      float lo = tPrev, hi = t;
      for(int b = 0; b < 3; b++){
        float mid = 0.5*(lo + hi);
        float dm = map(ro + rd*mid);
        if((dm < 0.0) == (pd < 0.0)) lo = mid; else hi = mid;
      }
      t = hi;
      pos = ro + rd*t;

      vec3 n = calcNormal(pos, t);
      if(dot(n, rd) > 0.0) n = -n;                /* always face the ray */
      bool entering = (d < 0.0);

      if(!hit){ dist = t; hit = true; }

      float ndv = max(dot(n, -rd), 0.0);
      float fres = 0.04 + 0.96*pow(1.0 - ndv, fresnelPower);

      vec3 reflDir = reflect(rd, n);
      vec3 reflCol = envLight(reflDir);
      float eta = 1.0/ior;
      vec3 rR = refract(rd, n, eta*(1.0 + dispersion));
      vec3 rG = refract(rd, n, eta);
      vec3 rB = refract(rd, n, eta*(1.0 - dispersion));
      /* past the critical angle refract() returns zero, and with a different
         eta per channel that lands as a hard coloured seam. Fall back to the
         reflection on whichever channels went total-internal. */
      vec3 refrCol = vec3(dot(rR,rR) < 0.5 ? reflCol.r : envLight(rR).r,
                          dot(rG,rG) < 0.5 ? reflCol.g : envLight(rG).g,
                          dot(rB,rB) < 0.5 ? reflCol.b : envLight(rB).b);

      vec3 sc = mix(refrCol, reflCol, mix(fres, 1.0, metallic));

      /* one soft shadow probe toward the key: the undersides go properly dark */
      float shade = clamp(map(pos + L*0.9)/0.9, 0.0, 1.0);
      shade = 0.22 + 0.78*smoothstep(0.0, 0.75, shade);

      /* caustic light landing on the form, projected from the surface above */
      float lit = max(dot(n, L), 0.0);
      /* Caustics on the front surface only: the pattern is a four-iteration
         trig loop, and on a face already seen through two others it is not
         visible enough to pay for. */
      float cau = 0.0;
      if(nlay == 0){
        vec2 cp = pos.xz + (surfaceY - pos.y)*L.xz/max(L.y, 0.38);
        cp = mod(cp, 48.0)*causticScale;
        cau = caustic(cp, T*1.6);
      }
      sc += mix(vec3(1.0), hue2rgb(keyHue), 0.30) * cau * lit * shade * causticInt * 0.55
            * exp(-murk*max(0.0, surfaceY - pos.y)*0.014);

      /* light bleeding through the thin parts */
      sc += mix(vec3(1.0), hue2rgb(fillHue), 0.55) * through
            * pow(max(dot(n, -L) + 0.30, 0.0), 2.4) * sss;

      /* the body lights from within on loud passages */
      sc += mix(vec3(1.0), hue2rgb(keyHue), 0.35) * hot * (0.40 + 0.60*lit) * 1.25;

      sc += pow(max(dot(reflDir, L), 0.0), specPower) * specular
            * mix(vec3(1.0), hue2rgb(keyHue), 0.3);
      /* iridescent rim, kept mostly white: a full hue sweep here turns the
         creases between masses into hard rainbow seams */
      vec3 irid = 0.5 + 0.5*cos(TAU*(ndv*0.8 + vec3(0.0, 0.33, 0.67)));
      sc += min(fres + hot*0.25, 1.0)*rimGlow*mix(vec3(1.0), irid, 0.42);

      /* water between camera and this crossing eats the reds first */
      sc *= exp(-vec3(0.46, 0.19, 0.12)*t*fogK);
      float ext = 1.0 - exp(-t*fogK*0.55);
      sc = mix(sc, water, ext*0.55);

      /* Faces translucent, silhouettes opaque. A single alpha for the whole
         surface would either hide everything behind the first mass or make the
         edges disappear; fresnel is already the right curve for both. */
      float a = clamp(mix(1.0 - translucency, 1.0, fres), 0.0, 1.0);

      acc.rgb += (1.0 - acc.a) * a * sc * through;
      acc.a   += (1.0 - acc.a) * a;
      nlay += 1;

      if(entering){
        inside = true;
        enterT = t;
      } else if(inside){
        /* Beer-Lambert over the REAL path length between entry and exit. */
        float path = max(t - enterT, 0.0);
        through *= exp(-path*absorb*(1.0 - hue2rgb(absorbHue)*0.88));
        inside = false;
      }
    }
    pd = d;
  }

  vec3 col = water*(1.0 - acc.a) + acc.rgb;
  float surfMask = acc.a;

  /* ---------------- volumetric shafts ---------------- */
  /* march the same ray and gather light that made it down from the surface,
     shaped by the caustic pattern projected along the light direction */
  float far = min(hit ? dist : FAR, FAR);
  float stepL = far/float(VOL);
  float dither = hash21(gl_FragCoord.xy + fract(T)*57.0);
  vec3 shaftCol = mix(vec3(1.0), hue2rgb(keyHue), 0.42);
  float fogAcc = 0.0, moteAcc = 0.0;
  for(int i = 0; i < VOL; i++){
    float tv = (float(i) + dither)*stepL;
    if(tv > far) break;
    vec3 p = ro + rd*tv;
    float below = max(0.0, surfaceY - p.y);

    /* the beam pattern, sampled where this point projects onto the surface */
    vec2 sp = p.xz + below*L.xz/max(L.y, 0.38);
    sp = mod(sp, 96.0)*shaftScale;
    float beam = beams(sp, T);

    /* light dies with depth, and the form casts into the beam */
    float atten = exp(-below*murk*0.022) * exp(-tv*fogK*0.35);
    beam = mix(beam, 0.34, smoothstep(6.0, 26.0, tv));   /* the far field goes to even haze */
    float occ = smoothstep(0.0, 0.9, map(p + L*1.4));
    fogAcc += beam*atten*occ;

    /* suspended particulate, catching the same light */
    vec3 mc = p*7.0;
    vec3 mi = floor(mc);
    float m  = hash21(mi.xy + mi.z*31.7);
    vec3 fq  = fract(mc) - 0.5;
    float pt = smoothstep(0.15, 0.0, dot(fq, fq));       /* round, not cell-shaped */
    moteAcc += step(0.988, m)*pt*(0.55 + 0.45*sin(T*2.0 + m*40.0))*atten;
  }
  fogAcc  = fogAcc/float(VOL)*shaftInt*2.4;
  moteAcc = moteAcc/float(VOL)*motes*1.10;

  col += shaftCol*fogAcc*(1.0 - surfMask*0.55);
  col += shaftCol*hot*0.14;                               /* glow in the water around it */
  col += vec3(0.78, 0.93, 1.0)*moteAcc;

  if(showTracker) col += trackerFX(gl_FragCoord.xy, R, ro, yaw, tilt, depth);

  col *= 1.0 + aBeat*audioDrive*0.28;

  /* ---------------- grade ---------------- */
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, saturation);
  col = (col - 0.5)*contrast + 0.5;
  col = max(col, 0.0);
  col = 1.0 - exp(-col*1.45);
  col = pow(col, vec3(gamma));
  col += (hash21(gl_FragCoord.xy + fract(T)*131.0) - 0.5)*grain;
  vec2 v = uv*vec2(min(R.x,R.y)/R.x, min(R.x,R.y)/R.y);
  col *= 1.0 - dot(v, v)*vig;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
