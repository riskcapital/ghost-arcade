/*{
    "CREDIT": "Justin Wood / Ghost Arcade",
    "DESCRIPTION": "Drift Veil - sheets of translucent membrane suspended at different depths in a current, undulating on travelling waves and curled by domain warp until they fold back over themselves. The same water as Deep Descent: god rays from the surface, caustics projected down through it, suspended particulate. A drift rather than a fall, and folded sheets rather than a chain of masses, so the glass is marched through several crossings at once.",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D Room", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "colorMode", "TYPE": "long", "DEFAULT": 0,
         "VALUES": [0, 1, 2, 3, 4, 5, 6],
         "LABELS": ["Kelp", "Abyss", "Bloom", "Sulphur", "Glacier", "Ink", "Ember"]},
        {"NAME": "speed",     "TYPE": "float", "MIN": 0.0,  "MAX": 3.0,  "DEFAULT": 1.0},
        {"NAME": "sheets",    "TYPE": "float", "MIN": 1.0,  "MAX": 5.0,  "DEFAULT": 5.0},
        {"NAME": "swell",     "TYPE": "float", "MIN": 0.1,  "MAX": 2.5,  "DEFAULT": 1.35},
        {"NAME": "curl",      "TYPE": "float", "MIN": 0.0,  "MAX": 2.5,  "DEFAULT": 1.05},
        {"NAME": "thickness", "TYPE": "float", "MIN": 0.02, "MAX": 0.40, "DEFAULT": 0.11},
        {"NAME": "layers",    "TYPE": "float", "MIN": 1.0,  "MAX": 6.0,  "DEFAULT": 3.0},
        {"NAME": "translucency","TYPE":"float","MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.68},
        {"NAME": "shaftBoost","TYPE": "float", "MIN": 0.0,  "MAX": 3.0,  "DEFAULT": 1.0},
        {"NAME": "causticBoost","TYPE":"float","MIN": 0.0,  "MAX": 3.0,  "DEFAULT": 1.0},
        {"NAME": "moteBoost", "TYPE": "float", "MIN": 0.0,  "MAX": 3.0,  "DEFAULT": 1.0},
        {"NAME": "bubbles",   "TYPE": "float", "MIN": 0.0,  "MAX": 3.0,  "DEFAULT": 1.0},
        {"NAME": "haze",      "TYPE": "float", "MIN": 0.3,  "MAX": 2.5,  "DEFAULT": 1.0},
        {"NAME": "audioDrive","TYPE": "float", "MIN": 0.0,  "MAX": 1.0,  "DEFAULT": 0.55},
        {"NAME": "dispersion","TYPE": "float", "MIN": 0.0,  "MAX": 0.35, "DEFAULT": 0.16},
        {"NAME": "camHeight", "TYPE": "float", "MIN": -8.0, "MAX": 6.0,  "DEFAULT": -1.6},
        {"NAME": "hueShift",  "TYPE": "float", "MIN": -0.5, "MAX": 0.5,  "DEFAULT": 0.0},
        {"NAME": "exposure",  "TYPE": "float", "MIN": 0.4,  "MAX": 2.2,  "DEFAULT": 1.0},
        {"NAME": "grainAmt",  "TYPE": "float", "MIN": 0.0,  "MAX": 0.08, "DEFAULT": 0.011}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

/*
 * Drift Veil -- second piece in the Deep Descent series.
 *
 * Same water, different body. Deep Descent falls past a chain of masses
 * threaded on a spine; this drifts sideways through membranes hung at
 * different depths, so the motion is lateral and the form is sheet rather than
 * blob.
 *
 * WHY SHEETS. A folded membrane is the ideal subject for a through-march. A ray
 * crossing a chain of solid masses gets two crossings per mass and the back one
 * is usually hidden behind the front; a ray crossing a curled sheet punches
 * four or five surfaces in a few units of depth, all of them thin enough to see
 * through. The layered glass shading has something to do on every pixel instead
 * of only at the silhouettes.
 *
 * THE FIELD. Each sheet is a height field on XZ, thickened into a shell:
 *
 *     d = |p.y - baseY - amp*wave(p.xz)| - thickness
 *
 * with wave() a sum of four travelling sines running in different directions at
 * incommensurate rates, so the surface never repeats a state. That alone gives
 * a rippling sheet but not a folding one -- a height field is single-valued, so
 * it can never turn back on itself. The domain warp is what buys the folds: it
 * bends the space the sheet is defined in, and an overhang appears wherever the
 * warp tips the local frame past vertical.
 *
 * That form is not a true distance function. The height field's own slope
 * stretches distance along Y, and the warp stretches it again, so the march
 * divides by a bound on both. Understating that bound punches holes clean
 * through a membrane, which on a sheet this thin is instantly visible.
 */

#define PI  3.14159265359
#define TAU 6.28318530718
#define MARCH 112
#define VOL 18
#define FAR 34.0

float T;
float aBass, aLevel, aBeat, aCentroid;

mat2 rot(float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }
vec3 hue2rgb(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
float hash11(float n){ return fract(sin(n*127.1)*43758.5453); }
float hash21(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

/* Caustics: the iterated-distortion water pattern, same one Deep Descent uses,
   so the two pieces read as the same body of water. */
float caustic(vec2 p, float t){
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

/* Cross-section of the light coming down: sparse beams rather than even haze. */
float beams(vec2 p, float t){
  float a = vnoise(p + vec2(t*0.06, t*0.02));
  float b = vnoise(p*2.4 + vec2(-t*0.05, t*0.03));
  float c = vnoise(p*5.1 + vec2(t*0.09, -t*0.04));
  float v = a*0.55 + b*0.30 + c*0.15;
  return pow(smoothstep(0.44, 0.93, v), 2.0);
}

float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0 - h);
}
float smax(float a, float b, float k){ return -smin(-a, -b, k); }

/* Four travelling sines at incommensurate rates and directions. The waves run
   ACROSS each other rather than along one axis, which is what stops the sheet
   reading as corrugated iron. */
float wave(vec2 xz, float ph){
  float h  = sin(xz.x*0.36 + ph*0.90)*0.55;
  h += sin(xz.y*0.27 - ph*0.71)*0.46;
  h += sin((xz.x*0.61 + xz.y*0.48) + ph*1.27)*0.28;
  h += sin((xz.x*0.93 - xz.y*0.77) - ph*1.63)*0.15;
  return h;
}
const float WAVE_SLOPE = 1.70;   /* bound on |d wave / d xz|, at the 2.05x input scale */

vec3 domain(vec3 p){
  float c = curl;
  vec3 w = p;
  w += c*0.62 * sin(p.yzx*0.51 + T*vec3(0.31, 0.24, 0.43));
  w += c*0.28 * sin(w.zxy*0.93 - T*vec3(0.22, 0.37, 0.19));
  return w;
}
float lipschitz(){
  float a = 1.0 + curl*0.62*0.51;
  a = a + curl*0.28*0.93*a;
  return a * (1.0 + swell*WAVE_SLOPE);
}

float map(vec3 p){
  vec3 w = domain(p);
  int n = int(clamp(sheets, 1.0, 5.0));
  float gap = 2.15;
  float amp = swell*(0.85 + 0.45*aBass);
  float d = 1e3;
  for(int i = 0; i < 5; i++){
    if(i >= n) break;
    float fi = float(i);
    float baseY = (fi - (float(n) - 1.0)*0.5)*gap;
    /* Each sheet runs on its own phase and a slightly different rate, so they
       drift out of step and the gaps between them open and close. */
    float ph = T*(0.85 + fi*0.11) + fi*2.39;
    float h = amp*wave(w.xz*2.05 + vec2(fi*7.3, -fi*4.1), ph);

    /*
     * Tear the sheet. A height field is unbounded in XZ, so on its own each
     * one is an infinite wall -- fly at it and the frame is a single flat
     * plane, which is exactly what the first render was. A second, slower wave
     * gates the thickness: where it falls the membrane thins to nothing and the
     * sheet simply is not there, leaving holes and ragged edges to see the next
     * layer through. The additive term is what makes the absence real rather
     * than a zero-thickness surface the march would still find.
     */
    float pres = smoothstep(0.10, 0.62,
                   wave(w.xz*0.86 + vec2(fi*13.1, fi*9.7), ph*0.55));
    float ds = abs(w.y - baseY - h) - thickness*pres + (1.0 - pres)*0.9;
    d = (i == 0) ? ds : smin(d, ds, 0.35);
  }

  /*
   * No hull.
   *
   * Bounding the sheets into discrete bodies was the wrong instrument: most
   * cells happened to contain no sheet material and rendered as empty water,
   * and the ones that did swallowed the camera. The tearing already does the
   * job -- a gated thickness breaks each sheet into fragments on its own, and
   * because the sheets run to the horizon those fragments recede naturally and
   * the haze takes them. Shoal for free, no cells to fall between.
   */
  return d/lipschitz()*0.85;
}

vec3 calcNormal(vec3 p, float t){
  vec2 e = vec2(0.0016 + t*0.0005, 0.0);
  return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),
                        map(p+e.yxy)-map(p-e.yxy),
                        map(p+e.yyx)-map(p-e.yyx)));
}

/*
 * Palettes for this shader alone. Deep Descent owns teal, so these move around
 * it: the two pieces should read as the same ocean at different depths and
 * times of day, not as the same look twice.
 *
 * Columns: [waterHue+keyHue+fillHue packed, absorbTint, keyTint].
 * Hues are 0..1 positions on the wheel, not colours, because everything
 * downstream mixes them against white.
 */
mat3 paletteFor(int mode){
    /* [ waterHue, keyHue, fillHue ], [ absorbHue, envBase, envInt ], keyTint */
    if(mode == 1){          /* Abyss    - deep blue, cold key, little fill */
        return mat3(vec3(0.60, 0.58, 0.62), vec3(0.60, 0.42, 1.05), vec3(0.70, 0.85, 1.00));
    } else if(mode == 2){   /* Bloom    - violet water, pink key */
        return mat3(vec3(0.74, 0.88, 0.80), vec3(0.78, 0.50, 1.20), vec3(1.00, 0.72, 0.92));
    } else if(mode == 3){   /* Sulphur  - yellow-green murk */
        return mat3(vec3(0.22, 0.14, 0.28), vec3(0.20, 0.52, 1.15), vec3(1.00, 0.95, 0.55));
    } else if(mode == 4){   /* Glacier  - pale blue-white, high key */
        return mat3(vec3(0.55, 0.54, 0.58), vec3(0.54, 0.78, 1.45), vec3(0.92, 0.98, 1.00));
    } else if(mode == 5){   /* Ink      - near monochrome, structure alone */
        return mat3(vec3(0.58, 0.58, 0.58), vec3(0.58, 0.34, 0.85), vec3(0.88, 0.90, 0.94));
    } else if(mode == 6){   /* Ember    - warm shallow water at sunset */
        return mat3(vec3(0.07, 0.05, 0.11), vec3(0.06, 0.55, 1.25), vec3(1.00, 0.70, 0.38));
    }
    /* Kelp - green water, amber key: the shallows */
    return mat3(vec3(0.36, 0.13, 0.42), vec3(0.30, 0.50, 1.10), vec3(1.00, 0.86, 0.52));
}

void main(){
  aBass     = max(audioBass, 0.24 + 0.10*sin(TIME*0.23));
  aLevel    = max(audioLevel, 0.20 + 0.08*sin(TIME*0.17));
  aCentroid = max(audioSpectralCentroid, 0.45 + 0.15*sin(TIME*0.12));
  aBeat     = audioBeat;

  T = TIME*speed;

  vec2 R = RENDERSIZE;
  vec2 jit = vec2(fract(sin(TIME*91.7)*43758.5)-0.5, fract(sin(TIME*57.3)*24634.6)-0.5);
  vec2 uv = (gl_FragCoord.xy + jit - 0.5*R)/min(R.x, R.y);

  mat3 pal = paletteFor(int(colorMode));
  float waterHue = fract(pal[0].x + hueShift);
  float keyHue   = fract(pal[0].y + hueShift);
  float fillHue  = fract(pal[0].z + hueShift);
  float absorbHue= fract(pal[1].x + hueShift);
  float envBase  = pal[1].y*exposure;
  float envInt   = pal[1].z*exposure;
  vec3  keyTint  = pal[2];

  float surfaceY = 7.0;
  float murk = 0.62*haze;
  float fogK = 0.072*haze;
  float absorb = 2.05;

  /* Camera drifts along +Z and sways, rather than sinking. The height control
     puts the eye above, between or below the stack of sheets. */
  /* Drift down the field rather than orbiting one mass, so bodies come out of
     the haze, pass, and recede -- the depth cue the shoal exists to provide. */
  vec3 ro = vec3(sin(T*0.11)*2.2, camHeight + sin(T*0.09)*0.6, T*1.9);
  float yaw = sin(T*0.047)*0.26;
  /* Below the stack looking up. Veils overhead read against the lit surface
     rather than against dark water, so the sheets are backlit -- which is what
     the transmission term in the shading is for, and it is the whole reason a
     membrane looks like a membrane instead of a painted plane. */
  float tilt = -0.05 + sin(T*0.041)*0.04;   /* negative pitches the ray UP */
  vec3 rd = normalize(vec3(uv, 1.05));
  rd.yz *= rot(tilt);
  rd.xz *= rot(yaw);

  vec3 L = normalize(vec3(0.24, 0.92, 0.16));   /* light comes from the surface */

  /* ---------------- the water ---------------- */
  vec3 deepCol = mix(hue2rgb(waterHue), vec3(0.0), 0.90);
  vec3 nearCol = mix(hue2rgb(waterHue), vec3(1.0), 0.20);
  float upness = clamp(rd.y*0.9 + 0.44, 0.0, 1.0);
  vec3 water = mix(deepCol*0.10, nearCol*0.50, pow(upness, 2.6));
  water *= 0.35 + 0.65*exp(-murk*max(0.0, surfaceY - ro.y)*0.010);

  vec3 envUp = mix(hue2rgb(keyHue), vec3(1.0), 0.40);

  /* ---------------- the sheets, marched through ---------------- */
  int maxLayers = int(clamp(layers, 1.0, 6.0));
  vec4 acc = vec4(0.0);
  vec3 through = vec3(1.0);
  bool inside = false;
  float enterT = 0.0;
  int nlay = 0;
  float firstT = FAR;
  float hot = aLevel*audioDrive*0.5;

  float t = 0.05;
  float pd = map(ro + rd*t);
  for(int i = 0; i < MARCH; i++){
    float tPrev = t;
    /* Conservative stride. The hull smax and the warped height field both
       overstate distance near the silhouette, and at 0.72 that shows as
       stair-stepping along the rim of every sheet. */
    t += max(abs(pd)*0.58, 0.010);
    if(t > FAR || acc.a > 0.985 || nlay >= maxLayers) break;
    vec3 pos = ro + rd*t;
    float d = map(pos);

    if((d < 0.0) != (pd < 0.0)){
      /* Bisect onto the crossing. A membrane this thin is exactly the case
         where stepping by |d| strides past the surface entirely. */
      float lo = tPrev, hi = t;
      for(int b = 0; b < 3; b++){
        float mid = 0.5*(lo + hi);
        float dm = map(ro + rd*mid);
        if((dm < 0.0) == (pd < 0.0)) lo = mid; else hi = mid;
      }
      t = hi;
      pos = ro + rd*t;

      vec3 n = calcNormal(pos, t);
      if(dot(n, rd) > 0.0) n = -n;
      bool entering = (d < 0.0);
      if(nlay == 0) firstT = t;

      float ndv = max(dot(n, -rd), 0.0);
      float fres = 0.04 + 0.96*pow(1.0 - ndv, 3.0);

      vec3 reflDir = reflect(rd, n);
      float upR = clamp(reflDir.y*0.5 + 0.5, 0.0, 1.0);
      vec3 reflCol = deepCol*envBase + envUp*pow(upR, 2.0)*envInt*0.95;

      /* Dispersive refraction against the same sky. Per-channel eta, with the
         reflection substituted on any channel past the critical angle -- there
         it returns zero and would otherwise land as a hard coloured seam. */
      float eta = 1.0/1.34;
      vec3 rR = refract(rd, n, eta*(1.0 + dispersion));
      vec3 rG = refract(rd, n, eta);
      vec3 rB = refract(rd, n, eta*(1.0 - dispersion));
      vec3 refrCol;
      refrCol.r = dot(rR,rR) < 0.5 ? reflCol.r : (deepCol*envBase + envUp*pow(clamp(rR.y*0.5+0.5,0.0,1.0), 2.4)*envInt*0.95).r;
      refrCol.g = dot(rG,rG) < 0.5 ? reflCol.g : (deepCol*envBase + envUp*pow(clamp(rG.y*0.5+0.5,0.0,1.0), 2.4)*envInt*0.95).g;
      refrCol.b = dot(rB,rB) < 0.5 ? reflCol.b : (deepCol*envBase + envUp*pow(clamp(rB.y*0.5+0.5,0.0,1.0), 2.4)*envInt*0.95).b;

      vec3 sc = mix(refrCol, reflCol, fres);

      float lit = max(dot(n, L), 0.0);

      /* Caustics on the front sheet only: four iterations of trig, and on a
         membrane already seen through two others it does not survive. */
      if(nlay == 0){
        vec2 cp = pos.xz + (surfaceY - pos.y)*L.xz/max(L.y, 0.38);
        cp = mod(cp, 48.0)*6.2;
        float cau = caustic(cp, T*1.6);
        sc += mix(vec3(1.0), keyTint, 0.35) * cau * lit * causticBoost * 0.5
              * exp(-murk*max(0.0, surfaceY - pos.y)*0.014);
      }

      /* Light through the thin parts. On a membrane this is most of the read:
         the sheet glows where the sun is behind it. */
      /* Transmission is the whole read on a membrane: a sheet lit from behind
         glows, and that is the only thing separating a veil from a painted
         plane. Weighted heavily, and inversely to how much body the light had
         to cross -- thin torn edges blaze, thick folds stay dense. */
      float backlit = pow(max(dot(n, -L) + 0.35, 0.0), 2.0);
      sc += mix(vec3(1.0), hue2rgb(fillHue), 0.45) * through * backlit * 0.95;
      sc += envUp * backlit * through * 0.35 * envInt;

      sc += mix(vec3(1.0), keyTint, 0.3) * pow(max(dot(reflDir, L), 0.0), 30.0) * 0.9;
      sc += keyTint * hot * (0.35 + 0.65*lit) * 0.9;

      vec3 irid = 0.5 + 0.5*cos(TAU*(ndv*0.8 + vec3(0.0, 0.33, 0.67)));
      sc += fres*0.45*mix(vec3(1.0), irid, 0.40);

      sc *= exp(-vec3(0.46, 0.19, 0.12)*t*fogK);
      sc = mix(sc, water, (1.0 - exp(-t*fogK*0.55))*0.55);

      float a = clamp(mix(1.0 - translucency, 1.0, fres), 0.0, 1.0);
      acc.rgb += (1.0 - acc.a)*a*sc*through;
      acc.a   += (1.0 - acc.a)*a;
      nlay += 1;

      if(entering){ inside = true; enterT = t; }
      else if(inside){
        float path = max(t - enterT, 0.0);
        through *= exp(-path*absorb*(1.0 - hue2rgb(absorbHue)*0.88));
        inside = false;
      }
    }
    pd = d;
  }

  vec3 col = water*(1.0 - acc.a) + acc.rgb;

  /* ---------------- god rays + particulate ---------------- */
  float far = min(firstT, FAR);
  float stepL = far/float(VOL);
  float dither = hash21(gl_FragCoord.xy + fract(T)*57.0);
  vec3 shaftCol = mix(vec3(1.0), keyTint, 0.45);
  float fogAcc = 0.0, moteAcc = 0.0, bubAcc = 0.0;
  for(int i = 0; i < VOL; i++){
    float tv = (float(i) + dither)*stepL;
    if(tv > far) break;
    vec3 p = ro + rd*tv;
    float below = max(0.0, surfaceY - p.y);
    vec2 sp = p.xz + below*L.xz/max(L.y, 0.38);
    sp = mod(sp, 96.0)*0.56;
    float beam = beams(sp, T);
    float atten = exp(-below*murk*0.022)*exp(-tv*fogK*0.35);
    beam = mix(beam, 0.34, smoothstep(6.0, 28.0, tv));
    /* Soft occlusion, floored. A hard shadow test kills the shafts entirely
       whenever a sheet is overhead -- which under a stack of veils is almost
       everywhere -- and the god rays that motivate the shot disappear. The
       floor keeps scattered light in the gaps. */
    float occ = mix(0.38, 1.0, smoothstep(0.0, 1.2, map(p + L*1.4)));
    fogAcc += beam*atten*occ;

    vec3 mc = p*7.0;
    vec3 mi = floor(mc);
    float m = hash21(mi.xy + mi.z*31.7);
    vec3 fq = fract(mc) - 0.5;
    float pt = smoothstep(0.15, 0.0, dot(fq, fq));
    moteAcc += step(0.992, m)*pt*(0.55 + 0.45*sin(T*2.0 + m*40.0))*atten;

    /*
     * Bubbles. A lattice sheared upward by time, so every cell holds one bubble
     * climbing toward the surface; the cell index is taken AFTER the shear so a
     * bubble keeps its identity as it rises rather than being reseeded each
     * time it crosses a boundary. Far coarser than the particulate lattice --
     * these are meant to read individually.
     *
     * Shaded as a rim rather than a disc: a bubble underwater is a lens, dark
     * through the middle and bright where the surface turns edge-on, which is
     * the only cue that separates one from a mote.
     */
    /* Coarse lattice deliberately. The volumetric march takes ~18 steps over
       the whole ray, so a bubble smaller than one step is hit at most once and
       renders as a soft blotch rather than a bubble. These are sized to span
       several steps, and made rare enough that they still read as individuals. */
    vec3 bc = p*0.5;
    bc.y -= T*0.75;
    vec3 bi = floor(bc);
    float bh = hash21(bi.xy + bi.z*17.3);
    if(bh > 0.965){
      vec3 bf = fract(bc) - 0.5;
      bf.xz += 0.16*vec2(sin(T*1.6 + bh*31.0), cos(T*1.2 + bh*23.0));
      float br = 0.20 + 0.14*fract(bh*7.0);
      float bl = length(bf);
      float rim = smoothstep(br, br*0.55, bl) - smoothstep(br*0.72, br*0.30, bl);
      bubAcc += max(rim, 0.0)*(0.55 + 0.45*sin(T*3.0 + bh*40.0))*atten;
    }
  }
  col += shaftCol*(fogAcc/float(VOL))*shaftBoost*2.5*(1.0 - acc.a*0.55);
  col += vec3(0.78, 0.93, 1.0)*(moteAcc/float(VOL))*moteBoost*1.1;
  col += mix(vec3(1.0), envUp, 0.5)*(bubAcc/float(VOL))*bubbles*4.0;
  col *= 1.0 + aBeat*audioDrive*0.26;

  /* ---------------- grade ---------------- */
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 1.12);
  col = (col - 0.5)*1.1 + 0.5;
  col = max(col, 0.0);
  col = 1.0 - exp(-col*1.45);
  col = pow(col, vec3(0.92));
  col += (hash21(gl_FragCoord.xy + fract(T)*131.0) - 0.5)*grainAmt;
  vec2 v = uv*vec2(min(R.x,R.y)/R.x, min(R.x,R.y)/R.y);
  col *= 1.0 - dot(v, v)*0.48;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
