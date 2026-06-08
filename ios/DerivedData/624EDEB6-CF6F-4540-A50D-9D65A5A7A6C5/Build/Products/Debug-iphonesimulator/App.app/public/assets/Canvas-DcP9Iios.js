const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./modulationBroadcast-DDTQeuhI.js","./index-jeXJYamp.js","./main-4BlCn4xa.js","./audio-BnbxmTFR.js","./customEffects-Detx1fUt.js","./parser-B2YdyCJi.js","./offlineRender-C5AIhNay.js","./layers-BFOZSqIE.js","./webgpuPilot-CkJUfvLn.js","./webgpuCapability-CUMUfS60.js","./renderer-AcCe0mxh.js","./Model3DRenderer-DiaA9ieO.js","./fluidSimulation-CFJ7_Gzl.js","./particleSystem3D-BLD8hzwU.js","./milkdropVisualizer-wFYLJdEg.js","./_commonjsHelpers-CqkleIqs.js","./milkdropPresets-hCvSaGg0.js","./audiomotionVisualizer-L6vaN43T.js","./wavejsVisualizer-D98ZOFr7.js","./hydraVisualizer-CblIzNIm.js","./ghostfxVisualizer-Cl_OaoHC.js","./analyzerLabVisualizer-CxUaVLSo.js","./handfxVisualizer-CCgvSlnE.js"])))=>i.map(i=>d[i]);
import{gN as tl,gK as al,aA as St,R as qe,C as le,bv as Tt,V as fe,af as ot,fH as vo,W as la,aD as or,S as ea,O as Ra,A as ai,cj as _a,P as Aa,M as Ba,aP as zo,b8 as il,B as He,bg as Io,f6 as ol,f2 as rl,D as Zt,fJ as sl,bR as nl,bh as zr,hj as rr,bw as It,fs as ll,f7 as cl,gm as Ii,g6 as ul,F as Ea,aQ as Ds,aJ as zs,z as Wi,_ as at,gF as Ze,gC as ba,gD as dl,gw as fl,gx as pl,gy as hl,m as nt,g as P,gz as Ir,gv as Ur,gJ as Gr,gB as ml,gG as jt,G as vl,J as gl}from"./main-4BlCn4xa.js";import{i as yl,f as Is,a as Or}from"./legacy-D7rpjvZo.js";import{o as bl,b as xl,c as Ci,i as wl}from"./index-client-DfzeMwuN.js";import{s as go}from"./class-BCUEQX14.js";import{p as Sl,s as _l,a as Ft}from"./props-GyONoXFP.js";import{w as ii,g as we}from"./index-jeXJYamp.js";import{i as Se,O as Cl,P as Pl,Q as kl,v as ca,s as Oe,R as Tl,S as Ge,T as tt,U as Ml,m as Wr,k as Vr,V as Rl,W as Al,X as Nr,Y as Pi,Z as qr,_ as yo,$ as Yr,a0 as Hr,a1 as Bl,a2 as El,a3 as Fl,e as Ll,a4 as Dl,a5 as zl,a6 as Il}from"./modulationBroadcast-DDTQeuhI.js";import{p as $e,l as ki,a as Ul,s as Gl,c as Ol,b as Wl,d as Ti}from"./layers-BFOZSqIE.js";import{p as Vl,c as Nl}from"./parser-B2YdyCJi.js";import{LightPaintingRenderer as jr}from"./renderer-Cr78INoi.js";import{b as Gt,g as aa,a as Mi,c as ql}from"./audio-BnbxmTFR.js";import{startAudioBroadcast as Yl,stopAudioBroadcast as Hl,broadcastAudioFrame as Xr}from"./audioBroadcast-DIBo2sVk.js";import{p as jl,g as $r,a as Zr}from"./webgpuCapability-CUMUfS60.js";function bo(i,e,t){var a=tl(i,e);a&&a.set&&(i[e]=t,al(()=>{i[e]=null}))}class Xl{fftTexture;waveformTexture;fftBuffer;waveformBuffer;textureWidth;constructor(e=512){this.textureWidth=e,this.fftBuffer=new Uint8Array(e*4),this.waveformBuffer=new Uint8Array(e*4),this.fftTexture=new St(this.fftBuffer,e,1,qe),this.fftTexture.minFilter=le,this.fftTexture.magFilter=le,this.fftTexture.wrapS=Tt,this.fftTexture.wrapT=Tt,this.waveformTexture=new St(this.waveformBuffer,e,1,qe),this.waveformTexture.minFilter=le,this.waveformTexture.magFilter=le,this.waveformTexture.wrapS=Tt,this.waveformTexture.wrapT=Tt,this.fftTexture.needsUpdate=!0,this.waveformTexture.needsUpdate=!0}update(e){const t=e.fftData,a=e.waveformData,o=Math.min(t.length,this.textureWidth),r=Math.min(a.length,this.textureWidth);for(let s=0;s<this.textureWidth;s++){const n=Math.min(s,o-1),u=Math.max(0,Math.min(1,(t[n]+90)/80))*255|0,f=s*4;this.fftBuffer[f]=u,this.fftBuffer[f+1]=u,this.fftBuffer[f+2]=u,this.fftBuffer[f+3]=255}for(let s=0;s<this.textureWidth;s++){const n=Math.min(s,r-1),l=(a[n]+1)*.5,u=Math.max(0,Math.min(1,l))*255|0,f=s*4;this.waveformBuffer[f]=u,this.waveformBuffer[f+1]=u,this.waveformBuffer[f+2]=u,this.waveformBuffer[f+3]=255}this.fftTexture.needsUpdate=!0,this.waveformTexture.needsUpdate=!0}get fft(){return this.fftTexture}get waveform(){return this.waveformTexture}dispose(){this.fftTexture.dispose(),this.waveformTexture.dispose()}}const Uo=new Xl(512);let Go=null;function Rp(i){Go=i}const xo=`
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,Kr=`
precision highp float;
uniform vec2 RENDERSIZE;
uniform float TIME;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;

  // Animated gradient to show shader is running but had errors
  float t = TIME * 0.5;
  vec3 col1 = vec3(0.8, 0.2, 0.5); // Pink
  vec3 col2 = vec3(0.2, 0.5, 0.8); // Blue
  vec3 col3 = vec3(0.5, 0.8, 0.2); // Green

  float pattern = sin(uv.x * 10.0 + t) * sin(uv.y * 10.0 + t * 0.7);
  vec3 color = mix(col1, col2, uv.x);
  color = mix(color, col3, uv.y);
  color += pattern * 0.2;

  // Add text indicator - "SHADER ERROR" pattern
  float stripe = step(0.48, uv.y) * step(uv.y, 0.52);
  color = mix(color, vec3(1.0, 0.0, 0.0), stripe * 0.5);

  gl_FragColor = vec4(color, 1.0);
}
`,Jr=new Set,Qr=new Map,wo=new Map;function es(i){let e=5381;for(let t=0;t<i.length;t++)e=(e<<5)+e+i.charCodeAt(t)|0;return e.toString(36)}let ia=null,xa=null;function $l(){if(xa){if(!xa.isContextLost())return xa;xa=null,ia=null}return ia||(ia=document.createElement("canvas"),ia.width=1,ia.height=1),xa=ia.getContext("webgl",{failIfMajorPerformanceCaveat:!1,preserveDrawingBuffer:!1,antialias:!1,depth:!1,stencil:!1})||ia.getContext("experimental-webgl"),xa}function Zl(i,e,t){try{const a=es(t);let o=Qr.get(a);o||(o=Vl(t),Qr.set(a,o));const r=Nl(o.metadata.INPUTS);r.RENDERSIZE.value=new fe(1920,1080),r.renderSize.value=new fe(1920,1080),r.DATE.value=new ot(2024,1,1,0);for(const u of o.metadata.INPUTS)if(u.TYPE==="point2D"&&r[u.NAME]){const f=r[u.NAME].value;r[u.NAME].value=new fe(f[0]||.5,f[1]||.5)}else if(u.TYPE==="color"&&r[u.NAME]){const f=r[u.NAME].value;r[u.NAME].value=new ot(f[0]||1,f[1]||1,f[2]||1,f[3]||1)}else u.TYPE==="image"&&r[`_${u.NAME}_imgSize`]&&(r[`_${u.NAME}_imgSize`].value=new fe(1,1));console.log(`ISF shader '${e}' parsed, fragment shader length:`,o.fragmentShader.length);let s,n=!1,l=!1;try{s=new vo({vertexShader:xo,fragmentShader:o.fragmentShader,uniforms:r,transparent:!0,depthTest:!1,depthWrite:!1});const u=es(o.fragmentShader),f=wo.get(u);if(f!==!0){if(typeof f=="string")throw s.dispose(),l=!0,new Error(`Shader compilation failed (cached): ${f}`);{const d=$l();if(d){const h=d.createShader(d.FRAGMENT_SHADER);if(h){if(d.shaderSource(h,o.fragmentShader),d.compileShader(h),!d.getShaderParameter(h,d.COMPILE_STATUS)){const m=d.getShaderInfoLog(h)||"Unknown compilation error";throw console.error(`ISF shader '${e}' compilation failed:`,m),d.deleteShader(h),wo.set(u,m),s.dispose(),l=!0,new Error(`Shader compilation failed: ${m}`)}d.deleteShader(h),wo.set(u,!0)}}}}}catch(u){console.warn(`ISF shader '${e}' failed to compile, using fallback. Error:`,u),l||s.dispose(),s=new vo({vertexShader:xo,fragmentShader:Kr,uniforms:{RENDERSIZE:{value:new fe(1920,1080)},TIME:{value:0}},transparent:!0,depthTest:!1,depthWrite:!1}),n=!0,Jr.has(i)||(Jr.add(i),console.error(`[ISF Renderer] Shader '${e}' (${i}) has compilation errors. Using animated fallback.`))}return console.log(`ISF shader '${e}' created ${n?"(with fallback)":"successfully"}, inputs:`,o.metadata.INPUTS.map(u=>u.NAME)),{id:i,name:e,metadata:o.metadata,material:s,uniforms:n?s.uniforms:r,startTime:performance.now()/1e3,inputTextures:new Map}}catch(a){console.error("Failed to create ISF shader:",e,a);const o={RENDERSIZE:{value:new fe(1920,1080)},TIME:{value:0}},r=new vo({vertexShader:xo,fragmentShader:Kr,uniforms:o,transparent:!0,depthTest:!1,depthWrite:!1});return{id:i,name:e,metadata:{INPUTS:[]},material:r,uniforms:o,startTime:performance.now()/1e3,inputTextures:new Map}}}function Kl(i,e,t,a=.016,o){const r=Go!==null?Go:performance.now()/1e3-i.startTime;if(i.uniforms.RENDERSIZE&&(i.uniforms.RENDERSIZE.value instanceof fe?i.uniforms.RENDERSIZE.value.set(e,t):i.uniforms.RENDERSIZE.value=new fe(e,t)),i.uniforms.renderSize&&(i.uniforms.renderSize.value instanceof fe?i.uniforms.renderSize.value.set(e,t):i.uniforms.renderSize.value=new fe(e,t)),i.uniforms.TIME&&(i.uniforms.TIME.value=r),i.uniforms.TIMEDELTA&&(i.uniforms.TIMEDELTA.value=a),i.uniforms.FRAMEINDEX&&(i.uniforms.FRAMEINDEX.value=i.uniforms.FRAMEINDEX.value+1),i.uniforms.DATE){const s=new Date;i.uniforms.DATE.value instanceof ot?i.uniforms.DATE.value.set(s.getFullYear(),s.getMonth()+1,s.getDate(),s.getHours()*3600+s.getMinutes()*60+s.getSeconds()):i.uniforms.DATE.value=new ot(s.getFullYear(),s.getMonth()+1,s.getDate(),s.getHours()*3600+s.getMinutes()*60+s.getSeconds())}i.uniforms.audioFFT&&(i.uniforms.audioFFT.value=Uo.fft),i.uniforms.audioWaveform&&(i.uniforms.audioWaveform.value=Uo.waveform),o&&o.isActive?(i.uniforms.audioLevel&&(i.uniforms.audioLevel.value=o.amplitude),i.uniforms.audioBass&&(i.uniforms.audioBass.value=o.bands.bass),i.uniforms.audioMid&&(i.uniforms.audioMid.value=o.bands.mid),i.uniforms.audioHigh&&(i.uniforms.audioHigh.value=o.bands.high),i.uniforms.audioBeat&&(i.uniforms.audioBeat.value=o.beat.beatIntensity),i.uniforms.audioBeatPhase&&(i.uniforms.audioBeatPhase.value=o.beatPhase),i.uniforms.audioBPM&&(i.uniforms.audioBPM.value=o.bpm),i.uniforms.audioSpectralCentroid&&(i.uniforms.audioSpectralCentroid.value=o.spectralCentroid??0)):(i.uniforms.audioLevel&&(i.uniforms.audioLevel.value=0),i.uniforms.audioBass&&(i.uniforms.audioBass.value=0),i.uniforms.audioMid&&(i.uniforms.audioMid.value=0),i.uniforms.audioHigh&&(i.uniforms.audioHigh.value=0),i.uniforms.audioBeat&&(i.uniforms.audioBeat.value=0),i.uniforms.audioBeatPhase&&(i.uniforms.audioBeatPhase.value=0),i.uniforms.audioBPM&&(i.uniforms.audioBPM.value=0),i.uniforms.audioSpectralCentroid&&(i.uniforms.audioSpectralCentroid.value=0))}function ts(i,e,t){i.uniforms[e]&&(i.uniforms[e].value=t)}function as(i,e,t){if(!i.uniforms[e])return;i.uniforms[e].value=t;const a=i.uniforms[`_${e}_imgSize`];if(a){const o=t.image,r=o?.width||o?.videoWidth||1,s=o?.height||o?.videoHeight||1;a.value instanceof fe?a.value.set(r,s):a.value=new fe(r,s)}i.inputTextures.set(e,t)}const Jl=`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,Ql=`
  precision highp float;

  uniform float uTime;
  uniform vec2 uResolution;

  // Shared shader mask mode
  uniform bool uUseSharedShader;
  uniform sampler2D uSharedShaderTexture;

  // Per-element corner warp uniforms
  uniform bool uWarpEnabled;
  uniform vec2 uWarpTL;
  uniform vec2 uWarpTR;
  uniform vec2 uWarpBL;
  uniform vec2 uWarpBR;

  // Per-element mesh warp uniforms (up to 4x4 = 16 points)
  uniform bool uMeshWarpEnabled;
  uniform int uMeshRows;
  uniform int uMeshCols;
  uniform vec2 uMeshPoints[16];

  // Custom vertex uniforms (polyline points)
  uniform int uCustomVertexCount;
  uniform vec2 uCustomVertices[64];
  uniform bool uCustomVerticesClosed;

  // Element transform
  uniform vec2 uPosition;
  uniform float uRotation;
  uniform vec2 uScale;

  // Stroke uniforms
  uniform int uStrokeType;
  uniform vec4 uStrokeColor;
  uniform float uStrokeWidth;
  uniform float uGlowSize;
  uniform float uGlowIntensity;
  uniform float uPulseSpeed;
  uniform float uSnakeLength;
  uniform float uSnakeSpeed;
  uniform int uSnakeCount;

  // Extended stroke uniforms
  uniform float uDashLength;
  uniform float uGapLength;
  uniform float uElectricArc;
  uniform float uElectricBranches;
  uniform float uScannerBeamWidth;
  uniform float uScannerTrail;
  uniform float uStrobeRate;

  // Draw progress uniforms
  uniform float uDrawProgress;   // 0-1, how much of the line is drawn
  uniform float uTrailLength;    // 0-1, trail behind the head

  // MultiTail stroke uniforms
  uniform float uMultiTailCount;
  uniform float uMultiTailLength;
  uniform float uMultiTailSpacing;
  uniform float uMultiTailSpeed;
  uniform bool uMultiTailFade;
  uniform bool uMultiTailHeadGlow;
  uniform bool uMultiTailColorShift;
  uniform float uMultiTailColorShiftAmt;

  // Laser stroke uniforms
  uniform float uLaserIntensity;
  uniform float uLaserScatter;
  uniform float uLaserFlicker;

  // Pipe stroke uniforms
  uniform float uPipeDepth;
  uniform float uPipeEdgeLight;
  uniform vec4 uPipeEdgeLightColor;
  uniform float uPipeSpecular;
  uniform float uPipeRoughness;

  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  // ========== UTILITY FUNCTIONS ==========

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  vec2 inverseWarp(vec2 p, vec2 tl, vec2 tr, vec2 bl, vec2 br) {
    vec2 uv = vec2(0.5, 0.5);

    for (int i = 0; i < 8; i++) {
      vec2 top = mix(tl, tr, uv.x);
      vec2 bottom = mix(bl, br, uv.x);
      vec2 predicted = mix(top, bottom, uv.y);

      vec2 error = p - predicted;

      vec2 dTop = tr - tl;
      vec2 dBottom = br - bl;
      vec2 dX = mix(dTop, dBottom, uv.y);
      vec2 dY = bottom - top;

      float det = dX.x * dY.y - dX.y * dY.x;
      if (abs(det) < 0.0001) break;

      vec2 delta = vec2(
        (error.x * dY.y - error.y * dY.x) / det,
        (dX.x * error.y - dX.y * error.x) / det
      );

      uv += delta;
    }

    return uv;
  }

  vec2 inverseMeshWarp(vec2 p, int rows, int cols) {
    vec2 uv = clamp(p, 0.0, 1.0);

    for (int iter = 0; iter < 8; iter++) {
      float cellX = uv.x * float(cols - 1);
      float cellY = uv.y * float(rows - 1);
      int col0 = int(floor(cellX));
      int row0 = int(floor(cellY));
      col0 = clamp(col0, 0, cols - 2);
      row0 = clamp(row0, 0, rows - 2);

      float tx = cellX - float(col0);
      float ty = cellY - float(row0);

      int i00 = row0 * cols + col0;
      int i10 = row0 * cols + col0 + 1;
      int i01 = (row0 + 1) * cols + col0;
      int i11 = (row0 + 1) * cols + col0 + 1;

      vec2 p00 = uMeshPoints[i00];
      vec2 p10 = uMeshPoints[i10];
      vec2 p01 = uMeshPoints[i01];
      vec2 p11 = uMeshPoints[i11];

      vec2 top = mix(p00, p10, tx);
      vec2 bottom = mix(p01, p11, tx);
      vec2 predicted = mix(top, bottom, ty);

      vec2 error = p - predicted;
      if (length(error) < 0.0001) break;

      vec2 dTop = p10 - p00;
      vec2 dBottom = p11 - p01;
      vec2 dX = mix(dTop, dBottom, ty) * float(cols - 1);
      vec2 dY = (bottom - top) * float(rows - 1);

      float det = dX.x * dY.y - dX.y * dY.x;
      if (abs(det) < 0.0001) break;

      vec2 delta = vec2(
        (error.x * dY.y - error.y * dY.x) / det,
        (dX.x * error.y - dX.y * error.x) / det
      );

      uv += delta;
      uv = clamp(uv, 0.0, 1.0);
    }

    return uv;
  }

  // ========== LINE SDF FUNCTIONS ==========

  float sdLine(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  // SDF for polyline using edge distances
  float sdPolygonCustom(vec2 p, int count, bool closed) {
    if (count < 2) return 1000.0;

    float minDist = 1000.0;
    float sign = 1.0;
    int numEdges = closed ? count : count - 1;

    if (closed) {
      float winding = 0.0;
      for (int i = 0; i < 64; i++) {
        if (i >= count) break;
        int j = (i + 1 < count) ? i + 1 : 0;
        vec2 a = uCustomVertices[i];
        vec2 b = uCustomVertices[j];

        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        float d = length(pa - ba * h);
        minDist = min(minDist, d);

        if (a.y <= p.y) {
          if (b.y > p.y) {
            if ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0.0) {
              winding += 1.0;
            }
          }
        } else {
          if (b.y <= p.y) {
            if ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0.0) {
              winding -= 1.0;
            }
          }
        }
      }
      sign = winding != 0.0 ? -1.0 : 1.0;
    } else {
      for (int i = 0; i < 63; i++) {
        if (i >= count - 1) break;
        vec2 a = uCustomVertices[i];
        vec2 b = uCustomVertices[i + 1];

        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        float d = length(pa - ba * h);
        minDist = min(minDist, d);
      }
    }

    return sign * minDist;
  }

  // Calculate path position along polyline (0-1) for animated effects
  float getCustomPolygonPathPos(vec2 p, int count, bool closed) {
    if (count < 2) return 0.0;

    float totalLen = 0.0;
    float closestDist = 1000.0;
    float closestLen = 0.0;

    int numEdges = closed ? count : count - 1;

    for (int i = 0; i < 64; i++) {
      if (i >= numEdges) break;
      int j = closed ? ((i + 1 < count) ? i + 1 : 0) : i + 1;
      vec2 a = uCustomVertices[i];
      vec2 b = uCustomVertices[j];

      float edgeLen = length(b - a);

      vec2 pa = p - a;
      vec2 ba = b - a;
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float d = length(pa - ba * h);

      if (d < closestDist) {
        closestDist = d;
        closestLen = totalLen + edgeLen * h;
      }

      totalLen += edgeLen;
    }

    return totalLen > 0.0 ? closestLen / totalLen : 0.0;
  }

  // ========== DRAW PROGRESS MASKING ==========

  float drawMask(float pathPos, float progress, float trail) {
    if (progress >= 1.0) return 1.0;
    if (progress <= 0.0) return 0.0;
    float headPos = progress;
    float tailPos = max(0.0, progress - trail);
    float mask = smoothstep(tailPos - 0.02, tailPos, pathPos) *
                 (1.0 - smoothstep(headPos, headPos + 0.02, pathPos));
    return mask;
  }

  // ========== HSV UTILITY ==========

  vec3 hsvToRgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  vec3 rgbToHsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  // ========== STROKE RENDERING ==========

  vec4 renderSolidStroke(float d, vec4 color, float width) {
    float strokeDist = abs(d) - width * 0.5;
    float alpha = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, strokeDist);
    return vec4(color.rgb, color.a * alpha);
  }

  vec4 renderGlowStroke(float d, vec4 color, float width, float glowSize, float intensity, float pulse) {
    float pulseMod = pulse > 0.0 ? 0.7 + 0.3 * sin(uTime * pulse * 3.0) : 1.0;

    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float glowDist = abs(d);
    float glow = 1.0 - smoothstep(0.0, glowSize / uResolution.x, glowDist);
    glow = pow(glow, 2.0) * intensity * pulseMod;

    vec3 finalColor = color.rgb * (core + glow);
    float finalAlpha = max(core, glow * 0.8);

    return vec4(finalColor, finalAlpha * color.a);
  }

  vec4 renderNeonStroke(float d, vec4 color, float width, float glowSize, float flicker) {
    float flickerMod = 1.0;
    if (flicker > 0.0) {
      flickerMod = 0.85 + 0.15 * sin(uTime * flicker * 15.0);
      flickerMod *= 0.9 + 0.1 * random(vec2(floor(uTime * 8.0), 0.0));
    }

    float coreDist = abs(d) - width * 0.3;
    float core = 1.0 - smoothstep(0.0, 1.5 / uResolution.x, coreDist);

    float innerDist = abs(d) - width * 0.5;
    float inner = 1.0 - smoothstep(0.0, 3.0 / uResolution.x, innerDist);

    float outerDist = abs(d);
    float outer = 1.0 - smoothstep(0.0, glowSize / uResolution.x, outerDist);
    outer = pow(outer, 1.5);

    vec3 finalColor = vec3(1.0) * core * 0.8 + color.rgb * inner + color.rgb * outer * 0.5;
    finalColor *= flickerMod;
    float finalAlpha = max(core, max(inner * 0.9, outer * 0.6));

    return vec4(finalColor, finalAlpha * color.a);
  }

  vec4 renderSnakeStroke(float d, vec4 color, float width, float snakeLen, float speed, float pathPos, int snakeCount) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float totalInSnake = 0.0;
    float totalFade = 0.0;
    float totalHeadGlow = 0.0;

    for (int s = 0; s < 8; s++) {
      if (s >= snakeCount) break;

      float snakeOffset = float(s) / float(snakeCount);
      float t = mod(uTime * speed + snakeOffset, 1.0);

      float headPos = t;
      float tailPos = t - snakeLen;

      float inSnake = 0.0;
      float fade = 0.0;

      if (tailPos >= 0.0) {
        inSnake = smoothstep(tailPos - 0.02, tailPos + 0.02, pathPos) *
                  (1.0 - smoothstep(headPos - 0.02, headPos + 0.02, pathPos));
        fade = 1.0 - smoothstep(tailPos, headPos, pathPos);
      } else {
        float wrappedTail = tailPos + 1.0;
        float inHead = smoothstep(-0.02, 0.02, pathPos) *
                       (1.0 - smoothstep(headPos - 0.02, headPos + 0.02, pathPos));
        float inTail = smoothstep(wrappedTail - 0.02, wrappedTail + 0.02, pathPos);

        inSnake = max(inHead, inTail);

        if (pathPos <= headPos) {
          fade = 1.0 - (pathPos / (headPos + (1.0 - wrappedTail)));
        } else if (pathPos >= wrappedTail) {
          fade = 1.0 - ((pathPos - wrappedTail + headPos + 0.001) / (headPos + (1.0 - wrappedTail)));
        }
      }

      totalInSnake = max(totalInSnake, inSnake);
      totalFade = max(totalFade, fade * inSnake);

      float headDist = abs(pathPos - headPos);
      float headDistWrapped = min(headDist, 1.0 - headDist);
      totalHeadGlow = max(totalHeadGlow, exp(-headDistWrapped * 30.0));
    }

    float glowDist = abs(d);
    float glow = (1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, glowDist)) * totalHeadGlow;

    float alpha = core * totalInSnake * max(totalFade, 0.1) + glow * 0.5;
    vec3 finalColor = color.rgb * (core * totalInSnake * max(totalFade, 0.1) + glow);

    return vec4(finalColor, alpha * color.a);
  }

  vec4 renderRainbowStroke(float d, float width, float speed, float pathPos) {
    float hue = mod(pathPos * 2.0 + uTime * speed, 1.0);
    vec3 rainbow = 0.5 + 0.5 * cos(TAU * (hue + vec3(0.0, 0.33, 0.67)));

    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float glowDist = abs(d);
    float glow = 1.0 - smoothstep(0.0, width * 1.5 / uResolution.x, glowDist);
    glow = pow(glow, 2.0) * 0.5;

    vec3 finalColor = rainbow * (core + glow);
    float alpha = max(core, glow * 0.7);

    return vec4(finalColor, alpha);
  }

  vec4 renderDashedStroke(float d, vec4 color, float width, float dashLen, float gapLen, float pathPos, float speed) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float cycle = dashLen + gapLen;
    float pos = mod(pathPos + uTime * speed * 0.1, 1.0);
    float dashPhase = mod(pos * 10.0, cycle);
    float dash = smoothstep(0.0, 0.02, dashPhase) * (1.0 - smoothstep(dashLen - 0.02, dashLen, dashPhase));

    return vec4(color.rgb * core * dash, color.a * core * dash);
  }

  vec4 renderDottedStroke(float d, vec4 color, float width, float dotSize, float spacing, float pathPos, float speed) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float cycle = dotSize + spacing;
    float pos = mod(pathPos + uTime * speed * 0.1, 1.0);
    float dotPhase = mod(pos * 10.0, cycle);
    float dot = smoothstep(0.0, 0.02, dotPhase) * (1.0 - smoothstep(dotSize - 0.02, dotSize, dotPhase));

    return vec4(color.rgb * core * dot, color.a * core * dot);
  }

  vec4 renderElectricStroke(float d, vec4 color, float width, float arcIntensity, float speed, float pathPos) {
    float t = uTime * speed;

    float jitter = sin(pathPos * 50.0 + t * 20.0) * arcIntensity * 0.003;
    jitter += sin(pathPos * 120.0 + t * 35.0) * arcIntensity * 0.002;
    float coreDist = abs(d + jitter) - width * 0.3;
    float core = 1.0 - smoothstep(0.0, 1.5 / uResolution.x, coreDist);

    float arc1Offset = sin(pathPos * 30.0 + t * 15.0) * arcIntensity * 0.008;
    float arc1 = 1.0 - smoothstep(0.0, 3.0 / uResolution.x, abs(d + arc1Offset) - width * 0.15);

    float arc2Offset = cos(pathPos * 45.0 + t * 22.0) * arcIntensity * 0.006;
    float arc2 = 1.0 - smoothstep(0.0, 3.0 / uResolution.x, abs(d + arc2Offset) - width * 0.1);

    vec3 coreColor = vec3(1.0) * core;
    vec3 arcColor = color.rgb * (arc1 * 0.6 + arc2 * 0.4);

    float glow = 1.0 - smoothstep(0.0, width * 3.0 / uResolution.x, abs(d));
    glow = pow(glow, 2.5) * 0.4;
    vec3 glowColor = color.rgb * glow;

    float flicker = 0.85 + 0.15 * random(vec2(floor(t * 12.0), pathPos * 5.0));

    vec3 finalColor = (coreColor + arcColor + glowColor) * flicker;
    float alpha = max(core, max(arc1 * 0.6, max(arc2 * 0.4, glow * 0.5)));
    return vec4(finalColor, alpha * color.a);
  }

  vec4 renderScannerStroke(float d, vec4 color, float width, float beamWidth, float speed, float pathPos, float trail) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float scanPos = mod(uTime * speed * 0.2, 1.0);
    float dist = abs(pathPos - scanPos);
    dist = min(dist, 1.0 - dist);

    float beam = 1.0 - smoothstep(0.0, beamWidth, dist);
    beam = pow(beam, 2.0);

    float trailDist = mod(scanPos - pathPos + 1.0, 1.0);
    float trailFade = (1.0 - smoothstep(0.0, trail, trailDist)) * 0.4;

    float intensity = max(beam, trailFade);

    float glow = 1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, abs(d));
    glow = pow(glow, 2.0) * beam * 0.6;

    vec3 finalColor = color.rgb * (core * intensity + glow);
    float alpha = core * intensity + glow * 0.5;
    return vec4(finalColor, alpha * color.a);
  }

  vec4 renderFireStroke(float d, vec4 color, float width, float speed, float pathPos) {
    float t = uTime * speed;

    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float noise = sin(pathPos * 20.0 + t * 5.0) * 0.5 + 0.5;
    noise *= sin(pathPos * 35.0 - t * 3.0) * 0.5 + 0.5;
    noise += sin(pathPos * 8.0 + t * 7.0) * 0.3;

    vec3 fireColor = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.9, 0.2), noise);
    fireColor = mix(fireColor, vec3(1.0), core * 0.5);

    float flameDist = abs(d) - width * (0.5 + noise * 0.8);
    float flame = 1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, max(flameDist, 0.0));
    flame *= noise;

    vec3 finalColor = fireColor * core + vec3(1.0, 0.3, 0.0) * flame * 0.6;
    float alpha = max(core, flame * 0.5);
    return vec4(finalColor, alpha * color.a);
  }

  vec4 renderPulseStroke(float d, vec4 color, float width, float pulseCount, float speed, float pathPos, float fadeLength) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float totalPulse = 0.0;
    for (int i = 0; i < 12; i++) {
      if (float(i) >= pulseCount) break;
      float offset = float(i) / pulseCount;
      float t = mod(uTime * speed + offset, 1.0);
      float dist = abs(pathPos - t);
      dist = min(dist, 1.0 - dist);
      float pulse = exp(-dist * (1.0 / max(fadeLength, 0.01)) * 10.0);
      totalPulse = max(totalPulse, pulse);
    }

    vec3 finalColor = color.rgb * core * totalPulse;
    float alpha = core * totalPulse;

    float glow = 1.0 - smoothstep(0.0, width * 1.5 / uResolution.x, abs(d));
    glow = pow(glow, 2.0) * totalPulse * 0.4;
    finalColor += color.rgb * glow;
    alpha = max(alpha, glow * 0.6);

    return vec4(finalColor, alpha * color.a);
  }

  // ========== STROKE: MultiTail ==========

  vec4 renderMultiTailStroke(float d, vec4 color, float width, float pathPos) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float totalIntensity = 0.0;
    vec3 totalColor = vec3(0.0);
    float totalHeadGlow = 0.0;

    int tailCount = int(uMultiTailCount);

    for (int i = 0; i < 12; i++) {
      if (i >= tailCount) break;

      float headOffset = float(i) * uMultiTailSpacing;
      float headPos = mod(uTime * uMultiTailSpeed + headOffset, 1.0);
      float tailPos = headPos - uMultiTailLength;

      float inTail = 0.0;
      float fade = 1.0;

      if (tailPos >= 0.0) {
        inTail = smoothstep(tailPos - 0.02, tailPos + 0.02, pathPos) *
                 (1.0 - smoothstep(headPos - 0.02, headPos + 0.02, pathPos));
        if (uMultiTailFade) {
          fade = smoothstep(tailPos, headPos, pathPos);
        }
      } else {
        float wrappedTail = tailPos + 1.0;
        float inHead = smoothstep(-0.02, 0.02, pathPos) *
                       (1.0 - smoothstep(headPos - 0.02, headPos + 0.02, pathPos));
        float inTailWrap = smoothstep(wrappedTail - 0.02, wrappedTail + 0.02, pathPos);
        inTail = max(inHead, inTailWrap);

        if (uMultiTailFade) {
          if (pathPos <= headPos) {
            fade = (pathPos + (1.0 - wrappedTail)) / (headPos + (1.0 - wrappedTail));
          } else if (pathPos >= wrappedTail) {
            fade = (pathPos - wrappedTail) / (headPos + (1.0 - wrappedTail));
          }
        }
      }

      // Per-tail hue shift
      vec3 tailColor = color.rgb;
      if (uMultiTailColorShift) {
        vec3 hsv = rgbToHsv(color.rgb);
        hsv.x = mod(hsv.x + float(i) * uMultiTailColorShiftAmt, 1.0);
        tailColor = hsvToRgb(hsv);
      }

      float contribution = inTail * fade;
      totalIntensity = max(totalIntensity, contribution);
      totalColor = max(totalColor, tailColor * contribution);

      // Head glow per tail
      if (uMultiTailHeadGlow) {
        float headDist = abs(pathPos - headPos);
        float headDistWrapped = min(headDist, 1.0 - headDist);
        totalHeadGlow = max(totalHeadGlow, exp(-headDistWrapped * 30.0));
      }
    }

    float glowDist = abs(d);
    float glow = (1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, glowDist)) * totalHeadGlow;

    vec3 finalColor = totalColor * core + color.rgb * glow;
    float alpha = core * totalIntensity + glow * 0.5;

    return vec4(finalColor, alpha * color.a);
  }

  // ========== NEW STROKE: Laser ==========

  vec4 renderLaserStroke(float d, vec4 color, float width) {
    float absDist = abs(d);

    // Flicker modulation
    float flickerMod = 1.0;
    if (uLaserFlicker > 0.0) {
      flickerMod = 1.0 - uLaserFlicker * 0.3 * (0.5 + 0.5 * sin(uTime * 37.0));
      flickerMod *= 1.0 - uLaserFlicker * 0.15 * step(0.92, random(vec2(floor(uTime * 20.0), 0.0)));
    }

    // Tight bright gaussian core
    float coreWidth = width * 0.3 / uResolution.x;
    float core = exp(-absDist * absDist / (coreWidth * coreWidth * 0.5));
    core *= uLaserIntensity;

    // Wider scatter glow (atmospheric scatter)
    float scatterWidth = width * 3.0 / uResolution.x;
    float scatter = exp(-absDist * absDist / (scatterWidth * scatterWidth));
    scatter *= uLaserScatter * 0.6;

    // Super-bright white center, colored edges
    vec3 coreColor = mix(color.rgb, vec3(1.0), 0.7) * core;
    vec3 scatterColor = color.rgb * scatter;

    vec3 finalColor = (coreColor + scatterColor) * flickerMod;
    float alpha = max(core, scatter * 0.8);

    return vec4(finalColor, clamp(alpha, 0.0, 1.0) * color.a);
  }

  // ========== NEW STROKE: Pipe ==========

  vec4 renderPipeStroke(float d, vec4 color, float width) {
    float absDist = abs(d);
    float halfWidth = width * 0.5 / uResolution.x;

    // Inside the pipe band
    float inside = 1.0 - smoothstep(halfWidth - 1.0 / uResolution.x, halfWidth + 1.0 / uResolution.x, absDist);
    if (inside < 0.01) return vec4(0.0);

    // Normalized distance from center of pipe (0 = center, 1 = edge)
    float normDist = absDist / halfWidth;

    // Cylindrical shading: dark center, bright edges (rim light)
    float shade = mix(1.0 - uPipeDepth * 0.6, 1.0, pow(normDist, 1.5));

    // Specular highlight band (fake light direction — slightly off-center)
    float specPos = 0.3; // highlight position (0 = center, 1 = edge)
    float specWidth = mix(0.4, 0.1, uPipeRoughness);
    float spec = exp(-pow((normDist - specPos) / specWidth, 2.0));
    spec *= uPipeSpecular;

    // Edge (rim) lighting
    float rimStart = 0.7;
    float rim = smoothstep(rimStart, 1.0, normDist);
    rim *= uPipeEdgeLight;

    // Combine
    vec3 baseColor = color.rgb * shade;
    baseColor += vec3(1.0) * spec * 0.6;  // White specular
    vec3 rimColor = uPipeEdgeLightColor.rgb * rim;
    vec3 finalColor = baseColor + rimColor;

    return vec4(finalColor * inside, inside * color.a);
  }

  // ========== MAIN ==========

  void main() {
    vec2 p = vUv;

    // Apply per-element mesh warp if enabled
    if (uMeshWarpEnabled && uMeshRows >= 2 && uMeshCols >= 2) {
      p = inverseMeshWarp(p, uMeshRows, uMeshCols);

      if (p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1) {
        gl_FragColor = vec4(0.0);
        return;
      }
    }

    // Apply per-element corner warp if enabled
    if (uWarpEnabled) {
      p = inverseWarp(p, uWarpTL, uWarpTR, uWarpBL, uWarpBR);

      if (p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1) {
        gl_FragColor = vec4(0.0);
        return;
      }
    }

    // Lines always use polyline SDF via custom vertices
    if (uCustomVertexCount < 2) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float d = sdPolygonCustom(p, uCustomVertexCount, uCustomVerticesClosed);
    float pathPos = getCustomPolygonPathPos(p, uCustomVertexCount, uCustomVerticesClosed);

    // Render stroke by type
    vec4 strokeColor = vec4(0.0);

    if (uStrokeType == 1) { // Solid
      strokeColor = renderSolidStroke(d, uStrokeColor, uStrokeWidth / uResolution.x);
    } else if (uStrokeType == 2) { // Glow
      strokeColor = renderGlowStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uGlowSize, uGlowIntensity, uPulseSpeed);
    } else if (uStrokeType == 3) { // Neon
      strokeColor = renderNeonStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uGlowSize, uPulseSpeed);
    } else if (uStrokeType == 4) { // Snake
      strokeColor = renderSnakeStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uSnakeLength, uSnakeSpeed, pathPos, uSnakeCount);
    } else if (uStrokeType == 5) { // Rainbow
      strokeColor = renderRainbowStroke(d, uStrokeWidth / uResolution.x, uSnakeSpeed, pathPos);
    } else if (uStrokeType == 6) { // Dashed
      strokeColor = renderDashedStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uDashLength, uGapLength, pathPos, uSnakeSpeed);
    } else if (uStrokeType == 7) { // Dotted
      strokeColor = renderDottedStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uDashLength, uGapLength, pathPos, uSnakeSpeed);
    } else if (uStrokeType == 8) { // Electric
      strokeColor = renderElectricStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uElectricArc, uSnakeSpeed, pathPos);
    } else if (uStrokeType == 9) { // Scanner
      strokeColor = renderScannerStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uScannerBeamWidth, uSnakeSpeed, pathPos, uScannerTrail);
    } else if (uStrokeType == 10) { // Fire
      strokeColor = renderFireStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uSnakeSpeed, pathPos);
    } else if (uStrokeType == 11) { // Pulse
      strokeColor = renderPulseStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uSnakeLength, uSnakeSpeed, pathPos, uScannerTrail);
    } else if (uStrokeType == 12) { // MultiTail
      strokeColor = renderMultiTailStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, pathPos);
    } else if (uStrokeType == 13) { // Laser
      strokeColor = renderLaserStroke(d, uStrokeColor, uStrokeWidth / uResolution.x);
    } else if (uStrokeType == 14) { // Pipe
      strokeColor = renderPipeStroke(d, uStrokeColor, uStrokeWidth / uResolution.x);
    }

    // Apply draw progress mask
    float mask = drawMask(pathPos, uDrawProgress, uTrailLength);
    strokeColor *= mask;

    // Shared shader mask mode: use line alpha as a window into a shared texture
    if (uUseSharedShader) {
      vec4 shaderSample = texture2D(uSharedShaderTexture, vUv);
      // Use the stroke's alpha shape as the mask, shader's color as the fill
      gl_FragColor = vec4(shaderSample.rgb * strokeColor.a, strokeColor.a);
    } else {
      gl_FragColor = strokeColor;
    }
  }
`;function is(i,e){switch(e){case"easeIn":return i*i;case"easeOut":return i*(2-i);case"easeInOut":return i<.5?2*i*i:-1+(4-2*i)*i;default:return i}}class ec{renderer;scene;camera;renderTarget;quad;material;width;height;startTime;animationStartTimes=new Map;layerAnimationBaseTime=0;constructor(e,t,a){this.renderer=e,this.width=t,this.height=a,this.startTime=performance.now()/1e3,this.renderTarget=new la(t,a,{minFilter:le,magFilter:le,format:qe,type:or}),this.scene=new ea,this.camera=new Ra(0,1,1,0,.1,10),this.camera.position.z=1,this.material=new ai({vertexShader:Jl,fragmentShader:Ql,uniforms:{uTime:{value:0},uResolution:{value:new fe(t,a)},uPosition:{value:new fe(0,0)},uRotation:{value:0},uScale:{value:new fe(1,1)},uWarpEnabled:{value:!1},uWarpTL:{value:new fe(0,0)},uWarpTR:{value:new fe(1,0)},uWarpBL:{value:new fe(0,1)},uWarpBR:{value:new fe(1,1)},uMeshWarpEnabled:{value:!1},uMeshRows:{value:3},uMeshCols:{value:3},uMeshPoints:{value:this.createDefaultMeshPoints(3,3)},uCustomVertexCount:{value:0},uCustomVertices:{value:this.createDefaultCustomVertices()},uCustomVerticesClosed:{value:!1},uStrokeType:{value:2},uStrokeColor:{value:new ot(0,1,.5,1)},uStrokeWidth:{value:4},uGlowSize:{value:20},uGlowIntensity:{value:1},uPulseSpeed:{value:0},uSnakeLength:{value:.3},uSnakeSpeed:{value:1},uSnakeCount:{value:1},uDashLength:{value:.3},uGapLength:{value:.2},uElectricArc:{value:1},uElectricBranches:{value:3},uScannerBeamWidth:{value:.1},uScannerTrail:{value:.3},uStrobeRate:{value:4},uDrawProgress:{value:1},uTrailLength:{value:0},uUseSharedShader:{value:!1},uSharedShaderTexture:{value:null},uMultiTailCount:{value:3},uMultiTailLength:{value:.15},uMultiTailSpacing:{value:.12},uMultiTailSpeed:{value:1},uMultiTailFade:{value:!0},uMultiTailHeadGlow:{value:!0},uMultiTailColorShift:{value:!1},uMultiTailColorShiftAmt:{value:.1},uLaserIntensity:{value:1.5},uLaserScatter:{value:.3},uLaserFlicker:{value:0},uPipeDepth:{value:.5},uPipeEdgeLight:{value:1},uPipeEdgeLightColor:{value:new ot(1,1,1,1)},uPipeSpecular:{value:.5},uPipeRoughness:{value:.5}},transparent:!0,depthTest:!1,depthWrite:!1,blending:_a});const o=new Aa(1,1);o.translate(.5,.5,0),this.quad=new Ba(o,this.material),this.scene.add(this.quad)}resize(e,t){this.width=e,this.height=t,this.renderTarget.setSize(e,t),this.material.uniforms.uResolution.value.set(e,t)}createDefaultMeshPoints(e,t){const a=[];for(let o=0;o<e;o++)for(let r=0;r<t;r++)a.push(new fe(r/(t-1),o/(e-1)));for(;a.length<16;)a.push(new fe(0,0));return a}createDefaultCustomVertices(){const e=[];for(let t=0;t<64;t++)e.push(new fe(0,0));return e}getStrokeTypeIndex(e){return{solid:1,glow:2,neon:3,snake:4,rainbow:5,dashed:6,dotted:7,electric:8,scanner:9,fire:10,pulse:11,multiTail:12,laser:13,pipe:14}[e]??2}computeAnimatedDrawProgress(e,t,a,o,r,s,n=3){const l=e.drawAnimation;if(!l.enabled)return{progress:1,visible:!0};const u=performance.now();this.layerAnimationBaseTime===0&&(this.layerAnimationBaseTime=u);const f=1e3/(l.drawSpeed*o),d=u-this.layerAnimationBaseTime;if(a>0&&(r==="sequential"||r==="solo"||r==="random"||r==="wave")){if(r==="sequential"){const T=f+s,I=Math.floor(d/T)%a;if(t!==I)return{progress:0,visible:!1};const G=d%T/f;let O=this.applyLoopAndEasing(Math.min(G,1),l);return l.reverse&&(O=1-O),{progress:Math.max(0,Math.min(1,O)),visible:!0}}else if(r==="solo"){const T=f*2+s,I=Math.floor(d/T)%a;if(t!==I)return{progress:0,visible:!1};const W=d%T,G=f;let O;return W<G?O=W/G:W<G*2?O=1-(W-G)/G:O=0,O=is(Math.max(0,Math.min(1,O)),l.easing),l.reverse&&(O=1-O),{progress:Math.max(0,Math.min(1,O)),visible:O>.001}}else if(r==="random"){const T=f+s,I=Math.floor(d/T),W=this.getRandomActiveIndex(I,a);if(t!==W)return{progress:0,visible:!1};const O=d%T/f;let L=this.applyLoopAndEasing(Math.min(O,1),l);return l.reverse&&(L=1-L),{progress:Math.max(0,Math.min(1,L)),visible:!0}}else if(r==="wave"){const T=Math.max(1,Math.min(n,a)),I=s>0?s:500,W=Math.floor(d/I)%a;let G=!1;for(let ce=0;ce<T;ce++)if(((W-ce)%a+a)%a===t){G=!0;break}if(!G)return{progress:0,visible:!1};const L=d%(I*a)/f;let N=this.applyLoopAndEasing(L,l);return l.reverse&&(N=1-N),{progress:Math.max(0,Math.min(1,N)),visible:!0}}}this.animationStartTimes.has(e.id)||this.animationStartTimes.set(e.id,u);const h=this.animationStartTimes.get(e.id);let m=0;r==="cascade"&&(m=t*s);const b=u-h-m;if(b<0)return{progress:l.reverse?1:0,visible:!0};const M=b/f;let C=this.applyLoopAndEasing(M,l);return l.reverse&&(C=1-C),{progress:Math.max(0,Math.min(1,C)),visible:!0}}applyLoopAndEasing(e,t){let a;switch(t.loopMode){case"once":a=Math.min(e,1);break;case"loop":a=e%1;break;case"pingpong":{const o=e%2;a=o<=1?o:2-o;break}case"continuous":a=e%1;break;default:a=Math.min(e,1)}return is(a,t.easing)}getRandomActiveIndex(e,t){return(e*2654435761>>>0)%t}resetAnimationTimes(){this.animationStartTimes.clear(),this.layerAnimationBaseTime=0}setElementUniforms(e,t,a,o,r,s,n=3){const l=this.material.uniforms,u=performance.now()/1e3-this.startTime;if(l.uTime.value=u,l.uPosition.value.set(e.position.x,e.position.y),l.uRotation.value=e.rotation*Math.PI/180,l.uScale.value.set(e.scale.x,e.scale.y),e.warpEnabled&&e.warpCorners?(l.uWarpEnabled.value=!0,l.uWarpTL.value.set(e.warpCorners.topLeft.x,e.warpCorners.topLeft.y),l.uWarpTR.value.set(e.warpCorners.topRight.x,e.warpCorners.topRight.y),l.uWarpBL.value.set(e.warpCorners.bottomLeft.x,e.warpCorners.bottomLeft.y),l.uWarpBR.value.set(e.warpCorners.bottomRight.x,e.warpCorners.bottomRight.y)):l.uWarpEnabled.value=!1,e.meshWarpEnabled&&e.meshWarp){l.uMeshWarpEnabled.value=!0,l.uMeshRows.value=e.meshWarp.rows,l.uMeshCols.value=e.meshWarp.cols;const m=l.uMeshPoints.value;let b=0;for(let M=0;M<e.meshWarp.rows&&M<4;M++)for(let C=0;C<e.meshWarp.cols&&C<4;C++)if(b<16){const T=e.meshWarp.points[M][C];m[b].set(T.x,T.y),b++}}else l.uMeshWarpEnabled.value=!1;const f=e.shape.points;if(f.length>=2){l.uCustomVertexCount.value=Math.min(f.length,64),l.uCustomVerticesClosed.value=e.shape.type==="pointClick"?e.shape.closed:!1;const m=l.uCustomVertices.value;for(let b=0;b<64;b++)b<f.length?m[b].set(f[b].x,f[b].y):m[b].set(0,0)}else l.uCustomVertexCount.value=0;const d=e.stroke;if(l.uStrokeType.value=this.getStrokeTypeIndex(d.type),"color"in d){const m=d.color;l.uStrokeColor.value.set(m[0],m[1],m[2],m[3])}if("width"in d&&(l.uStrokeWidth.value=d.width),"glowSize"in d&&(l.uGlowSize.value=d.glowSize),"glowIntensity"in d&&(l.uGlowIntensity.value=d.glowIntensity),"pulseSpeed"in d&&(l.uPulseSpeed.value=d.pulseSpeed),"flickerSpeed"in d&&(l.uPulseSpeed.value=d.flickerSpeed),"length"in d&&(l.uSnakeLength.value=d.length),"speed"in d&&(l.uSnakeSpeed.value=d.speed),"snakeCount"in d?l.uSnakeCount.value=d.snakeCount:l.uSnakeCount.value=1,"dashLength"in d&&(l.uDashLength.value=d.dashLength),"gapLength"in d&&(l.uGapLength.value=d.gapLength),"dotSize"in d&&(l.uDashLength.value=d.dotSize),"spacing"in d&&d.type==="dotted"&&(l.uGapLength.value=d.spacing),"arcIntensity"in d&&(l.uElectricArc.value=d.arcIntensity),"branches"in d&&(l.uElectricBranches.value=d.branches),"beamWidth"in d&&(l.uScannerBeamWidth.value=d.beamWidth),"trail"in d&&(l.uScannerTrail.value=d.trail),"pulseCount"in d&&(l.uSnakeLength.value=d.pulseCount),"fadeLength"in d&&(l.uScannerTrail.value=d.fadeLength),d.type==="multiTail"&&(l.uMultiTailCount.value=d.tailCount,l.uMultiTailLength.value=d.tailLength,l.uMultiTailSpacing.value=d.spacing,l.uMultiTailSpeed.value=d.speed,l.uMultiTailFade.value=d.tailFade,l.uMultiTailHeadGlow.value=d.headGlow,l.uMultiTailColorShift.value=d.colorShift,l.uMultiTailColorShiftAmt.value=d.colorShiftAmount),d.type==="laser"&&(l.uLaserIntensity.value=d.intensity,l.uLaserScatter.value=d.scatter,l.uLaserFlicker.value=d.flicker),d.type==="pipe"){l.uPipeDepth.value=d.depth,l.uPipeEdgeLight.value=d.edgeLight;const m=d.edgeLightColor;l.uPipeEdgeLightColor.value.set(m[0],m[1],m[2],m[3]),l.uPipeSpecular.value=d.specular,l.uPipeRoughness.value=d.roughness}const h=e.drawAnimation;if(h.enabled){const m=this.computeAnimatedDrawProgress(e,t,a,o,r,s,n);if(!m.visible)return!1;l.uDrawProgress.value=m.progress,l.uTrailLength.value=h.trailLength}else l.uDrawProgress.value=1,l.uTrailLength.value=0;return!0}renderElements(e,t,a=1,o="simultaneous",r=200,s=null,n=3){this.material.uniforms.uUseSharedShader.value=!!s,s&&(this.material.uniforms.uSharedShaderTexture.value=s),this.renderer.setRenderTarget(t),this.renderer.setClearColor(0,0),this.renderer.clear();const l=this.renderer.autoClear;this.renderer.autoClear=!1;const u=this.material.uniforms.uResolution.value;(u.x!==t.width||u.y!==t.height)&&this.material.uniforms.uResolution.value.set(t.width,t.height);const f=[...e].sort((d,h)=>d.zIndex-h.zIndex);for(let d=0;d<f.length;d++){const h=f[d];!h.visible||h.shape.points.length<2||!this.setElementUniforms(h,d,f.length,a,o,r,n)||this.renderer.render(this.scene,this.camera)}return this.renderer.autoClear=l,this.material.uniforms.uResolution.value.set(this.width,this.height),this.renderer.setRenderTarget(null),t.texture}dispose(){this.renderTarget.dispose(),this.material.dispose(),this.quad.geometry.dispose()}}const tc=`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,ac=`
  precision highp float;

  uniform float uTime;
  uniform vec2 uResolution;

  // Shape uniforms
  uniform int uShapeType;
  uniform vec2 uShapeCenter;
  uniform float uShapeRadius;
  uniform float uShapeRotation;
  uniform vec2 uShapeScale;
  uniform int uShapeSides;
  uniform float uInnerRadius;
  uniform float uWidth;
  uniform float uHeight;

  // Per-shape corner warp uniforms
  uniform bool uWarpEnabled;
  uniform vec2 uWarpTL;  // Top-left corner offset
  uniform vec2 uWarpTR;  // Top-right corner offset
  uniform vec2 uWarpBL;  // Bottom-left corner offset
  uniform vec2 uWarpBR;  // Bottom-right corner offset

  // Per-shape mesh warp uniforms (up to 4x4 = 16 points)
  uniform bool uMeshWarpEnabled;
  uniform int uMeshRows;
  uniform int uMeshCols;
  uniform vec2 uMeshPoints[16];  // Flattened grid: row * cols + col

  // Custom vertex uniforms (for warped/arbitrary polygon shapes)
  uniform bool uUseCustomVertices;
  uniform int uCustomVertexCount;
  uniform vec2 uCustomVertices[64];  // Up to 64 vertices for arbitrary polygons
  uniform bool uCustomVerticesClosed;  // Whether the polygon is closed

  // Stroke uniforms
  uniform int uStrokeType;
  uniform vec4 uStrokeColor;
  uniform float uStrokeWidth;
  uniform float uGlowSize;
  uniform float uGlowIntensity;
  uniform float uPulseSpeed;
  uniform float uSnakeLength;
  uniform float uSnakeSpeed;
  uniform int uSnakeCount;

  // Fill uniforms
  uniform int uFillType;
  uniform vec4 uFillColor;
  uniform float uFillSpeed;

  // Animation uniforms
  uniform int uAnimationType;
  uniform float uAnimCount;
  uniform float uAnimSpacing;
  uniform float uAnimSpeed;
  uniform int uConcentricDirection;  // 0 = out, 1 = in, 2 = both

  // Extended stroke uniforms
  uniform float uDashLength;     // Dashed stroke dash length
  uniform float uGapLength;      // Dashed stroke gap length
  uniform float uElectricArc;    // Electric stroke arc intensity
  uniform float uElectricBranches; // Electric stroke branch count
  uniform float uScannerBeamWidth; // Scanner beam width
  uniform float uScannerTrail;    // Scanner trail length
  uniform float uStrobeRate;      // Strobe on/off rate

  // Extended fill uniforms
  uniform float uNoiseScale;      // Noise fill scale
  uniform float uNoiseTurbulence; // Noise fill turbulence
  uniform float uHoloShift;       // Holographic hue shift
  uniform float uHoloScanlines;   // Holographic scanline count
  uniform float uGradAngle;       // Gradient fill angle

  // Enhanced fill parameter uniforms
  uniform float uPlasmaScale;     // Plasma spatial scale
  uniform float uPlasmaComplexity; // Plasma wave complexity
  uniform int uPlasmaPalette;     // Plasma color palette (0=rainbow,1=fire,2=ocean,3=neon)
  uniform float uLiquidViscosity; // Liquid distortion amount
  uniform float uLiquidTurbulence; // Liquid noise turbulence
  uniform float uLiquidMetallic;  // Liquid metallic highlight intensity
  uniform float uFireIntensity;   // Fire brightness
  uniform float uFireTurbulence;  // Fire turbulence amount
  uniform int uFirePalette;       // Fire palette (0=orange,1=blue,2=green,3=purple)
  uniform float uElectricIntensity; // Electric fill bolt intensity
  uniform float uElectricArcCount;  // Electric fill arc density
  uniform float uHoloFlicker;     // Holographic flicker amount
  uniform vec4 uNoiseColor2;      // Noise fill second color
  uniform vec4 uGradColor2;       // Gradient fill second color
  uniform int uGradType;          // Gradient type (0=linear, 1=radial, 2=angular)

  // Extended animation uniforms
  uniform float uBreatheMin;      // Breathe min scale
  uniform float uBreatheMax;      // Breathe max scale
  uniform float uRotateSpeed;     // Rotate speed
  uniform int uRotateDir;         // Rotate direction (0=cw, 1=ccw)
  uniform float uWaveAmplitude;   // Wave amplitude
  uniform float uWaveFrequency;   // Wave frequency
  uniform float uRippleDecay;     // Ripple decay
  uniform float uGlitchIntensity; // Glitch intensity
  uniform float uGlitchBlockSize; // Glitch block size

  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  // ========== UTILITY FUNCTIONS ==========

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  // Inverse bilinear interpolation - find UV from warped position
  // Given a point p and four corners, find the corresponding UV (0-1) in the original quad
  vec2 inverseWarp(vec2 p, vec2 tl, vec2 tr, vec2 bl, vec2 br) {
    // Use iterative approach for inverse bilinear interpolation
    vec2 uv = vec2(0.5, 0.5);

    for (int i = 0; i < 8; i++) {
      // Forward bilinear interpolation
      vec2 top = mix(tl, tr, uv.x);
      vec2 bottom = mix(bl, br, uv.x);
      vec2 predicted = mix(top, bottom, uv.y);

      // Compute error
      vec2 error = p - predicted;

      // Compute Jacobian
      vec2 dTop = tr - tl;
      vec2 dBottom = br - bl;
      vec2 dX = mix(dTop, dBottom, uv.y);
      vec2 dY = bottom - top;

      // Solve 2x2 system using Cramer's rule
      float det = dX.x * dY.y - dX.y * dY.x;
      if (abs(det) < 0.0001) break;

      vec2 delta = vec2(
        (error.x * dY.y - error.y * dY.x) / det,
        (dX.x * error.y - dX.y * error.x) / det
      );

      uv += delta;
    }

    return uv;
  }

  // Inverse mesh warp - find the original UV from warped position
  // Uses iterative Newton-Raphson approach within mesh cells
  vec2 inverseMeshWarp(vec2 p, int rows, int cols) {
    // Initial guess - the input position
    vec2 uv = clamp(p, 0.0, 1.0);

    for (int iter = 0; iter < 8; iter++) {
      // Find which cell we're in based on current UV guess
      float cellX = uv.x * float(cols - 1);
      float cellY = uv.y * float(rows - 1);
      int col0 = int(floor(cellX));
      int row0 = int(floor(cellY));
      col0 = clamp(col0, 0, cols - 2);
      row0 = clamp(row0, 0, rows - 2);

      // Local coords within cell (0-1)
      float tx = cellX - float(col0);
      float ty = cellY - float(row0);

      // Get the 4 corners of this cell
      int i00 = row0 * cols + col0;
      int i10 = row0 * cols + col0 + 1;
      int i01 = (row0 + 1) * cols + col0;
      int i11 = (row0 + 1) * cols + col0 + 1;

      vec2 p00 = uMeshPoints[i00];
      vec2 p10 = uMeshPoints[i10];
      vec2 p01 = uMeshPoints[i01];
      vec2 p11 = uMeshPoints[i11];

      // Bilinear interpolation to get predicted position
      vec2 top = mix(p00, p10, tx);
      vec2 bottom = mix(p01, p11, tx);
      vec2 predicted = mix(top, bottom, ty);

      // Compute error
      vec2 error = p - predicted;
      if (length(error) < 0.0001) break;

      // Compute Jacobian for the cell
      vec2 dTop = p10 - p00;
      vec2 dBottom = p11 - p01;
      vec2 dX = mix(dTop, dBottom, ty) * float(cols - 1);
      vec2 dY = (bottom - top) * float(rows - 1);

      // Solve 2x2 system
      float det = dX.x * dY.y - dX.y * dY.x;
      if (abs(det) < 0.0001) break;

      vec2 delta = vec2(
        (error.x * dY.y - error.y * dY.x) / det,
        (dX.x * error.y - dX.y * error.x) / det
      );

      uv += delta;
      uv = clamp(uv, 0.0, 1.0);
    }

    return uv;
  }

  mat2 rotate2d(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat2(c, -s, s, c);
  }

  // ========== SDF FUNCTIONS ==========

  float sdCircle(vec2 p, float r) {
    return length(p) - r;
  }

  float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  float sdEquilateralTriangle(vec2 p, float r) {
    const float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }

  float sdPolygon(vec2 p, float r, int sides) {
    float a = atan(p.x, p.y) + PI;
    float seg = TAU / float(sides);
    a = mod(a, seg) - seg * 0.5;
    return length(p) * cos(a) - r * cos(PI / float(sides));
  }

  float sdStar(vec2 p, float r1, float r2, int n) {
    float an = PI / float(n);
    float en = PI / float(n * 2);
    vec2 acs = vec2(cos(an), sin(an));
    vec2 ecs = vec2(cos(en), sin(en));

    float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
    p = length(p) * vec2(cos(bn), abs(sin(bn)));

    p -= r1 * acs;
    p += ecs * clamp(-dot(p, ecs), 0.0, r1 * acs.y / ecs.y);
    return length(p) * sign(p.x);
  }

  float sdRing(vec2 p, float r1, float r2) {
    return abs(length(p) - (r1 + r2) * 0.5) - abs(r1 - r2) * 0.5;
  }

  float sdLine(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  float sdSpiral(vec2 p, float turns, float r1, float r2) {
    float angle = atan(p.y, p.x);
    float dist = length(p);
    float minDist = 1000.0;

    for (float i = -1.0; i <= turns; i += 1.0) {
      float a = angle + i * TAU;
      float t = clamp(a / (turns * TAU), 0.0, 1.0);
      float targetR = mix(r1, r2, t);
      minDist = min(minDist, abs(dist - targetR));
    }

    return minDist;
  }

  // SDF for arbitrary polygon using edge distances
  float sdPolygonCustom(vec2 p, int count, bool closed) {
    if (count < 2) return 1000.0;

    float minDist = 1000.0;
    float sign = 1.0;
    int numEdges = closed ? count : count - 1;

    // For closed polygons, compute winding number
    if (closed) {
      float winding = 0.0;
      for (int i = 0; i < 64; i++) {
        if (i >= count) break;
        int j = (i + 1 < count) ? i + 1 : 0;
        vec2 a = uCustomVertices[i];
        vec2 b = uCustomVertices[j];

        // Distance to edge
        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        float d = length(pa - ba * h);
        minDist = min(minDist, d);

        // Winding number contribution
        if (a.y <= p.y) {
          if (b.y > p.y) {
            if ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0.0) {
              winding += 1.0;
            }
          }
        } else {
          if (b.y <= p.y) {
            if ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0.0) {
              winding -= 1.0;
            }
          }
        }
      }
      sign = winding != 0.0 ? -1.0 : 1.0;
    } else {
      // Open polyline - just compute distance to edges
      for (int i = 0; i < 63; i++) {
        if (i >= count - 1) break;
        vec2 a = uCustomVertices[i];
        vec2 b = uCustomVertices[i + 1];

        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        float d = length(pa - ba * h);
        minDist = min(minDist, d);
      }
    }

    return sign * minDist;
  }

  // Calculate path position along custom polygon (0-1) for animated effects
  float getCustomPolygonPathPos(vec2 p, int count, bool closed) {
    if (count < 2) return 0.0;

    float totalLen = 0.0;
    float closestDist = 1000.0;
    float closestLen = 0.0;

    int numEdges = closed ? count : count - 1;

    for (int i = 0; i < 64; i++) {
      if (i >= numEdges) break;
      int j = closed ? ((i + 1 < count) ? i + 1 : 0) : i + 1;
      vec2 a = uCustomVertices[i];
      vec2 b = uCustomVertices[j];

      float edgeLen = length(b - a);

      // Distance to this edge segment
      vec2 pa = p - a;
      vec2 ba = b - a;
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float d = length(pa - ba * h);

      if (d < closestDist) {
        closestDist = d;
        closestLen = totalLen + edgeLen * h;
      }

      totalLen += edgeLen;
    }

    return totalLen > 0.0 ? closestLen / totalLen : 0.0;
  }

  // ========== GET SHAPE SDF ==========

  float getShapeSDF(vec2 p, vec2 center, float radius, int shapeType, int sides, float inner, vec2 size) {
    p -= center;
    p = rotate2d(uShapeRotation) * p;
    p /= uShapeScale;

    // Preserve proportions for radial shapes on non-square render targets.
    if (shapeType == 0 || shapeType == 2 || shapeType == 3 || shapeType == 4 || shapeType == 5 || shapeType == 6) {
      p.x *= uResolution.x / uResolution.y;
    }

    if (shapeType == 0) { // Circle
      return sdCircle(p, radius);
    } else if (shapeType == 1) { // Rectangle
      return sdBox(p, size * 0.5);
    } else if (shapeType == 2) { // Triangle
      return sdEquilateralTriangle(p, radius);
    } else if (shapeType == 3) { // Polygon
      return sdPolygon(p, radius, sides);
    } else if (shapeType == 4) { // Star
      return sdStar(p, radius, inner, sides);
    } else if (shapeType == 5) { // Ring
      return sdRing(p, radius, inner);
    } else if (shapeType == 6) { // Spiral
      return sdSpiral(p, float(sides), inner, radius);
    } else if (shapeType == 7) { // Line
      return sdLine(p, vec2(-size.x * 0.5, 0.0), vec2(size.x * 0.5, 0.0));
    }

    return sdCircle(p, radius);
  }

  // ========== STROKE RENDERING ==========

  vec4 renderSolidStroke(float d, vec4 color, float width) {
    float strokeDist = abs(d) - width * 0.5;
    float alpha = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, strokeDist);
    return vec4(color.rgb, color.a * alpha);
  }

  vec4 renderGlowStroke(float d, vec4 color, float width, float glowSize, float intensity, float pulse) {
    float pulseMod = pulse > 0.0 ? 0.7 + 0.3 * sin(uTime * pulse * 3.0) : 1.0;

    // Core stroke
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    // Glow
    float glowDist = abs(d);
    float glow = 1.0 - smoothstep(0.0, glowSize / uResolution.x, glowDist);
    glow = pow(glow, 2.0) * intensity * pulseMod;

    vec3 finalColor = color.rgb * (core + glow);
    float finalAlpha = max(core, glow * 0.8);

    return vec4(finalColor, finalAlpha * color.a);
  }

  vec4 renderNeonStroke(float d, vec4 color, float width, float glowSize, float flicker) {
    float flickerMod = 1.0;
    if (flicker > 0.0) {
      flickerMod = 0.85 + 0.15 * sin(uTime * flicker * 15.0);
      flickerMod *= 0.9 + 0.1 * random(vec2(floor(uTime * 8.0), 0.0));
    }

    // Bright white core
    float coreDist = abs(d) - width * 0.3;
    float core = 1.0 - smoothstep(0.0, 1.5 / uResolution.x, coreDist);

    // Inner glow (colored)
    float innerDist = abs(d) - width * 0.5;
    float inner = 1.0 - smoothstep(0.0, 3.0 / uResolution.x, innerDist);

    // Outer glow
    float outerDist = abs(d);
    float outer = 1.0 - smoothstep(0.0, glowSize / uResolution.x, outerDist);
    outer = pow(outer, 1.5);

    vec3 finalColor = vec3(1.0) * core * 0.8 + color.rgb * inner + color.rgb * outer * 0.5;
    finalColor *= flickerMod;
    float finalAlpha = max(core, max(inner * 0.9, outer * 0.6));

    return vec4(finalColor, finalAlpha * color.a);
  }

  vec4 renderSnakeStroke(float d, vec4 color, float width, float snakeLen, float speed, float pathPos, int snakeCount) {
    // Core stroke distance
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float totalInSnake = 0.0;
    float totalFade = 0.0;
    float totalHeadGlow = 0.0;

    // Render each snake using circular distance (no branch for wrap-around)
    for (int s = 0; s < 8; s++) {
      if (s >= snakeCount) break;

      float snakeOffset = float(s) / float(snakeCount);
      float headPos = mod(uTime * speed + snakeOffset, 1.0);

      // How far behind the head is this point? (circular, always 0..1)
      float distBehind = mod(headPos - pathPos + 1.0, 1.0);

      // Inside the snake body?
      float inSnake = smoothstep(snakeLen + 0.02, snakeLen - 0.02, distBehind);

      // Fade: bright at head (0), dim at tail (snakeLen)
      float fade = 1.0 - clamp(distBehind / max(snakeLen, 0.001), 0.0, 1.0);

      totalInSnake = max(totalInSnake, inSnake);
      totalFade = max(totalFade, fade * inSnake);

      // Head glow (already uses correct circular distance)
      float headDist = abs(pathPos - headPos);
      float headDistWrapped = min(headDist, 1.0 - headDist);
      totalHeadGlow = max(totalHeadGlow, exp(-headDistWrapped * 30.0));
    }

    // Apply glow
    float glowDist = abs(d);
    float glow = (1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, glowDist)) * totalHeadGlow;

    float alpha = core * totalInSnake * max(totalFade, 0.1) + glow * 0.5;
    vec3 finalColor = color.rgb * (core * totalInSnake * max(totalFade, 0.1) + glow);

    return vec4(finalColor, alpha * color.a);
  }

  vec4 renderRainbowStroke(float d, float width, float speed, float pathPos) {
    float hue = mod(pathPos * 2.0 + uTime * speed, 1.0);
    vec3 rainbow = 0.5 + 0.5 * cos(TAU * (hue + vec3(0.0, 0.33, 0.67)));

    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    float glowDist = abs(d);
    float glow = 1.0 - smoothstep(0.0, width * 1.5 / uResolution.x, glowDist);
    glow = pow(glow, 2.0) * 0.5;

    vec3 finalColor = rainbow * (core + glow);
    float alpha = max(core, glow * 0.7);

    return vec4(finalColor, alpha);
  }

  // --- Dashed stroke (type 6) ---
  vec4 renderDashedStroke(float d, vec4 color, float width, float dashLen, float gapLen, float pathPos, float speed) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    // Animated dash pattern along path
    float cycle = dashLen + gapLen;
    float pos = mod(pathPos + uTime * speed * 0.1, 1.0);
    float dashPhase = mod(pos * 10.0, cycle);
    float dash = smoothstep(0.0, 0.02, dashPhase) * (1.0 - smoothstep(dashLen - 0.02, dashLen, dashPhase));

    return vec4(color.rgb * core * dash, color.a * core * dash);
  }

  // --- Electric stroke (type 7) ---
  vec4 renderElectricStroke(float d, vec4 color, float width, float arcIntensity, float speed, float pathPos) {
    float t = uTime * speed;

    // Core line with jittered width
    float jitter = sin(pathPos * 50.0 + t * 20.0) * arcIntensity * 0.003;
    jitter += sin(pathPos * 120.0 + t * 35.0) * arcIntensity * 0.002;
    float coreDist = abs(d + jitter) - width * 0.3;
    float core = 1.0 - smoothstep(0.0, 1.5 / uResolution.x, coreDist);

    // Electric arcs - displaced copies
    float arc1Offset = sin(pathPos * 30.0 + t * 15.0) * arcIntensity * 0.008;
    float arc1 = 1.0 - smoothstep(0.0, 3.0 / uResolution.x, abs(d + arc1Offset) - width * 0.15);

    float arc2Offset = cos(pathPos * 45.0 + t * 22.0) * arcIntensity * 0.006;
    float arc2 = 1.0 - smoothstep(0.0, 3.0 / uResolution.x, abs(d + arc2Offset) - width * 0.1);

    // Bright white core + colored arcs
    vec3 coreColor = vec3(1.0) * core;
    vec3 arcColor = color.rgb * (arc1 * 0.6 + arc2 * 0.4);

    // Outer glow
    float glow = 1.0 - smoothstep(0.0, width * 3.0 / uResolution.x, abs(d));
    glow = pow(glow, 2.5) * 0.4;
    vec3 glowColor = color.rgb * glow;

    // Random flicker
    float flicker = 0.85 + 0.15 * random(vec2(floor(t * 12.0), pathPos * 5.0));

    vec3 finalColor = (coreColor + arcColor + glowColor) * flicker;
    float alpha = max(core, max(arc1 * 0.6, max(arc2 * 0.4, glow * 0.5)));
    return vec4(finalColor, alpha * color.a);
  }

  // --- Strobe stroke (type 8) ---
  vec4 renderStrobeStroke(float d, vec4 color, float width, float rate) {
    float on = step(0.0, sin(uTime * rate * TAU));

    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    // Intense glow when on
    float glow = 1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, abs(d));
    glow = pow(glow, 1.5) * 0.8;

    vec3 finalColor = color.rgb * (core + glow) * on;
    float alpha = max(core, glow * 0.7) * on;
    return vec4(finalColor, alpha * color.a);
  }

  // --- Scanner stroke (type 9) ---
  vec4 renderScannerStroke(float d, vec4 color, float width, float beamWidth, float speed, float pathPos, float trail) {
    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    // Scanning beam position
    float scanPos = mod(uTime * speed * 0.2, 1.0);
    float dist = abs(pathPos - scanPos);
    dist = min(dist, 1.0 - dist); // Wrap around

    // Bright beam
    float beam = 1.0 - smoothstep(0.0, beamWidth, dist);
    beam = pow(beam, 2.0);

    // Trail behind beam
    float trailDist = mod(scanPos - pathPos + 1.0, 1.0);
    float trailFade = (1.0 - smoothstep(0.0, trail, trailDist)) * 0.4;

    float intensity = max(beam, trailFade);

    // Glow around beam position
    float glow = 1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, abs(d));
    glow = pow(glow, 2.0) * beam * 0.6;

    vec3 finalColor = color.rgb * (core * intensity + glow);
    float alpha = core * intensity + glow * 0.5;
    return vec4(finalColor, alpha * color.a);
  }

  // --- Fire stroke (type 10) ---
  vec4 renderFireStroke(float d, vec4 color, float width, float speed, float pathPos) {
    float t = uTime * speed;

    float coreDist = abs(d) - width * 0.5;
    float core = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, coreDist);

    // Flickering fire noise
    float noise = sin(pathPos * 20.0 + t * 5.0) * 0.5 + 0.5;
    noise *= sin(pathPos * 35.0 - t * 3.0) * 0.5 + 0.5;
    noise += sin(pathPos * 8.0 + t * 7.0) * 0.3;

    // Fire gradient: white core -> color -> dark
    vec3 fireColor = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.9, 0.2), noise);
    fireColor = mix(fireColor, vec3(1.0), core * 0.5);

    // Extended glow with flame shape
    float flameDist = abs(d) - width * (0.5 + noise * 0.8);
    float flame = 1.0 - smoothstep(0.0, width * 2.0 / uResolution.x, max(flameDist, 0.0));
    flame *= noise;

    vec3 finalColor = fireColor * core + vec3(1.0, 0.3, 0.0) * flame * 0.6;
    float alpha = max(core, flame * 0.5);
    return vec4(finalColor, alpha * color.a);
  }

  // ========== FILL RENDERING ==========

  vec4 renderSolidFill(float d, vec4 color) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    return vec4(color.rgb, color.a * inside);
  }

  vec4 renderPlasmaFill(float d, vec2 p, float speed, float scale, float complexity, int palette) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t = uTime * speed;
    float s = scale;
    float plasma = 0.0;
    plasma += sin(p.x * s + t);
    plasma += sin(p.y * s + t * 1.2);
    plasma += sin((p.x + p.y) * s * 0.75 + t * 0.7);
    plasma += sin(length(p - 0.5) * s * 1.5 + t * 0.9);
    // Additional complexity layers
    if (complexity > 2.0) {
      plasma += sin(p.x * s * 2.0 - p.y * s * 1.5 + t * 1.5) * 0.5;
      plasma += sin(length(p - vec2(0.3, 0.7)) * s * 2.0 + t * 1.1) * 0.4;
    }
    if (complexity > 4.0) {
      plasma += sin((p.x * p.y) * s * 3.0 + t * 2.0) * 0.3;
      plasma += cos(p.x * s * 3.0 + sin(p.y * s * 2.0 + t)) * 0.25;
    }
    float totalWeight = 4.0 + (complexity > 2.0 ? 0.9 : 0.0) + (complexity > 4.0 ? 0.55 : 0.0);
    plasma = plasma / totalWeight + 0.5;

    vec3 color;
    if (palette == 1) {
      // Fire palette
      color = mix(vec3(0.1, 0.0, 0.0), vec3(1.0, 0.9, 0.2), plasma);
      color = mix(color, vec3(1.0, 0.3, 0.0), sin(plasma * PI) * 0.5 + 0.5);
    } else if (palette == 2) {
      // Ocean palette
      color = mix(vec3(0.0, 0.05, 0.2), vec3(0.0, 0.8, 1.0), plasma);
      color = mix(color, vec3(0.2, 0.4, 0.8), sin(plasma * PI * 2.0) * 0.3 + 0.5);
    } else if (palette == 3) {
      // Neon palette
      color = 0.5 + 0.5 * cos(TAU * (plasma * 2.0 + vec3(0.0, 0.15, 0.4)));
      color = pow(color, vec3(0.8)); // Boost brightness
    } else {
      // Rainbow (default)
      color = 0.5 + 0.5 * cos(TAU * (plasma + vec3(0.0, 0.33, 0.67)));
    }
    return vec4(color, inside);
  }

  vec4 renderLiquidFill(float d, vec2 p, vec4 baseColor, float speed, float viscosity, float turbulence, float metallic) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t = uTime * speed;
    // Viscosity controls distortion amount (higher = less movement, thicker fluid)
    float distAmt = 0.05 * (1.0 - viscosity * 0.8);
    float distort1 = sin(p.x * 15.0 + t) * cos(p.y * 12.0 + t * 0.8) * distAmt;
    float distort2 = cos(p.x * 10.0 - t * 0.6) * sin(p.y * 18.0 + t * 1.2) * distAmt * turbulence;
    vec2 dp = p + vec2(distort1, distort2);

    // Turbulence adds more octaves of noise
    float noise = sin(dp.x * 25.0 + t) * sin(dp.y * 25.0 - t) * 0.5 + 0.5;
    if (turbulence > 0.3) {
      noise += sin(dp.x * 50.0 - t * 1.5) * sin(dp.y * 40.0 + t * 1.3) * 0.2 * turbulence;
    }
    if (turbulence > 0.6) {
      noise += sin(dp.x * 80.0 + t * 2.0) * cos(dp.y * 70.0 - t * 1.8) * 0.1 * turbulence;
    }
    noise = clamp(noise, 0.0, 1.0);

    // Color modulation with depth variation
    vec3 color = baseColor.rgb * (0.6 + noise * 0.6);
    // Add subtle color shift in darker areas
    vec3 deepColor = baseColor.rgb * vec3(0.6, 0.8, 1.2);
    color = mix(deepColor, color, noise);

    // Metallic highlights - intensity controlled by uniform
    float highlight = pow(noise, 3.0 + (1.0 - metallic) * 3.0) * metallic;
    // Specular-like sheen
    float sheen = pow(max(0.0, sin(dp.x * 40.0 + t * 2.0) * cos(dp.y * 35.0 - t * 1.5)), 8.0) * metallic * 0.4;
    color += vec3(highlight + sheen);

    return vec4(color, baseColor.a * inside);
  }

  vec4 renderFireFill(float d, vec2 p, float speed, float intensity, float turbulence, int palette) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t = uTime * speed;
    float fire = 0.0;
    fire += sin(p.x * 8.0 + t * 3.0) * 0.5;
    fire += sin(p.y * 6.0 - t * 2.5) * 0.5;
    fire += sin((p.x + p.y) * 5.0 + t * 4.0) * 0.3;
    // Turbulence adds more chaotic detail
    if (turbulence > 0.3) {
      fire += sin(p.x * 16.0 - t * 5.0) * sin(p.y * 14.0 + t * 3.5) * turbulence * 0.4;
    }
    if (turbulence > 0.6) {
      fire += sin(p.x * 30.0 + t * 8.0) * cos(p.y * 25.0 - t * 6.0) * turbulence * 0.2;
    }
    fire = fire * 0.5 + 0.5;

    vec3 darkColor, brightColor, midColor;
    if (palette == 1) {
      // Blue fire
      darkColor = vec3(0.0, 0.0, 0.4);
      brightColor = vec3(0.4, 0.7, 1.0);
      midColor = vec3(0.1, 0.3, 0.9);
    } else if (palette == 2) {
      // Green fire
      darkColor = vec3(0.0, 0.2, 0.0);
      brightColor = vec3(0.5, 1.0, 0.3);
      midColor = vec3(0.1, 0.7, 0.2);
    } else if (palette == 3) {
      // Purple fire
      darkColor = vec3(0.2, 0.0, 0.3);
      brightColor = vec3(1.0, 0.5, 1.0);
      midColor = vec3(0.5, 0.1, 0.8);
    } else {
      // Orange fire (default)
      darkColor = vec3(1.0, 0.2, 0.0);
      brightColor = vec3(1.0, 0.9, 0.2);
      midColor = vec3(1.0, 0.5, 0.1);
    }

    vec3 color = mix(darkColor, brightColor, pow(fire, 1.5));
    color = mix(color, midColor, fire * 0.4);
    color *= intensity;

    return vec4(color, inside);
  }

  // --- Electric fill (type 5) ---
  vec4 renderElectricFill(float d, vec2 p, vec4 color, float speed, float intensity, float arcCount) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t = uTime * speed;
    float freqMult = arcCount * 6.0; // More arcs = higher frequency

    // Electric arc noise
    float arc = 0.0;
    arc += sin(p.x * freqMult + t * 8.0) * sin(p.y * freqMult * 0.83 - t * 6.0);
    arc += sin((p.x - p.y) * freqMult * 1.33 + t * 12.0) * 0.5;
    arc += sin(length(p - 0.5) * freqMult * 0.67 + t * 10.0) * 0.3;
    arc = pow(abs(arc), 0.3);

    // Intensity controls bolt threshold (lower threshold = more bolts)
    float boltThreshold = 1.0 - intensity * 0.25;
    float bolt = step(boltThreshold, arc);
    float glow = pow(arc, 3.0 - intensity * 0.5);

    vec3 finalColor = color.rgb * (glow * 0.4 * intensity + bolt * 1.5);
    finalColor += vec3(0.8, 0.9, 1.0) * bolt * 0.5 * intensity; // White flash on bolts

    // Random flash - more frequent at higher intensity
    float flashRate = 4.0 + intensity * 4.0;
    float flash = step(0.97 - intensity * 0.05, random(vec2(floor(t * flashRate), 0.0)));
    finalColor += color.rgb * flash * 0.3 * intensity;

    // Background glow between arcs
    float bgGlow = glow * 0.15 * intensity;
    finalColor += color.rgb * bgGlow;

    return vec4(finalColor, inside * max(glow * 0.5, bolt));
  }

  // --- Holographic fill (type 6) ---
  vec4 renderHolographicFill(float d, vec2 p, float speed, float shift, float scanlines, float flickerAmt) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t = uTime * speed;

    // Angle-based hue shift (holographic rainbow)
    float angle = atan(p.y - 0.5, p.x - 0.5);
    float hue = mod(angle / TAU + t * 0.1 + shift, 1.0);
    vec3 rainbow = 0.5 + 0.5 * cos(TAU * (hue + vec3(0.0, 0.33, 0.67)));

    // Fresnel-like edge brightening
    float edgeDist = abs(d) / 0.05;
    float fresnel = exp(-edgeDist * 2.0);

    // Scanlines - density controlled by uniform
    float scan = 1.0;
    if (scanlines > 0.1) {
      scan = sin(p.y * scanlines * 100.0 + t * 2.0) * 0.5 + 0.5;
      scan = mix(0.7, 1.0, scan);
    }

    // Flicker - amount controlled by uniform
    float flicker = 1.0;
    if (flickerAmt > 0.01) {
      flicker = 1.0 - flickerAmt * 0.15;
      flicker += flickerAmt * 0.15 * sin(t * 15.0);
      // Add random flicker bursts
      flicker *= 1.0 - flickerAmt * 0.1 * step(0.95, random(vec2(floor(t * 8.0), 0.0)));
    }

    vec3 finalColor = rainbow * scan * flicker * (0.5 + fresnel * 0.5);
    return vec4(finalColor, inside * 0.8);
  }

  // --- Noise fill (type 7) ---
  vec4 renderNoiseFill(float d, vec2 p, vec4 color, float speed, float scale, float turbulence, vec4 color2) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t = uTime * speed;

    // Multi-octave procedural noise
    float n = 0.0;
    float amp = 1.0;
    float freq = scale;
    for (int i = 0; i < 4; i++) {
      n += amp * (sin(p.x * freq + t + float(i)) * cos(p.y * freq * 1.3 - t * 0.7 + float(i) * 2.0));
      amp *= 0.5;
      freq *= 2.0 + turbulence;
    }
    n = n * 0.5 + 0.5;

    // Interpolate between the two user-defined colors
    vec3 c1 = color.rgb;
    vec3 c2 = color2.rgb;
    vec3 finalColor = mix(c2, c1, n);

    return vec4(finalColor, inside * color.a);
  }

  // --- Gradient fill (type 8) ---
  vec4 renderGradientFill(float d, vec2 p, vec4 color, vec4 color2, float angle, float speed, int gradType) {
    float inside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, d);
    if (inside < 0.01) return vec4(0.0);

    float t;
    if (gradType == 1) {
      // Radial gradient from center
      float dist = length(p - 0.5) * 2.0;
      t = clamp(dist + uTime * speed * 0.1, 0.0, 1.0);
      t = fract(t); // Repeat for animation
    } else if (gradType == 2) {
      // Angular/conical gradient
      float a = atan(p.y - 0.5, p.x - 0.5);
      t = mod(a / TAU + 0.5 + uTime * speed * 0.1, 1.0);
    } else {
      // Linear gradient (default)
      float a = angle + uTime * speed * 0.5;
      vec2 dir = vec2(cos(a), sin(a));
      t = dot(p - 0.5, dir) + 0.5;
      t = clamp(t, 0.0, 1.0);
    }

    // Two-stop gradient with user-defined colors
    vec3 c1 = color.rgb;
    vec3 c2 = color2.rgb;
    vec3 finalColor = mix(c1, c2, t);

    float alpha = mix(color.a, color2.a, t);
    return vec4(finalColor, inside * alpha);
  }

  // ========== CONCENTRIC ANIMATION ==========

  vec4 renderConcentric(vec2 p, vec4 baseColor, int count, float spacing, float speed, int direction, vec2 customCentroid) {
    vec4 result = vec4(0.0);
    float t = uTime * speed;

    // Direction: 0 = out (external), 1 = in (internal), 2 = both
    int loopCount = (direction == 2) ? count * 2 : count;

    // Stroke thickness uses the global stroke width uniform
    float strokeW = uStrokeWidth * 2.0 / uResolution.x;

    for (int i = 0; i < 40; i++) {
      if (i >= loopCount) break;

      float fi = float(i % count);
      bool isInward = (direction == 1) || (direction == 2 && i >= count);

      float scale;
      if (isInward) {
        // Internal: evenly spaced rings shrinking toward center.
        // Smooth animation scrolls rings inward continuously.
        float phase = mod(fi * spacing + t * 0.15, float(count) * spacing);
        scale = 1.0 - phase / (float(count) * spacing) * 0.95;
        scale = max(scale, 0.02);
      } else {
        // External: expand outward
        float phase = mod(fi * spacing + t * 0.15, float(count) * spacing);
        scale = 1.0 + phase;
      }

      float d;
      if (uUseCustomVertices && uCustomVertexCount >= 2) {
        vec2 sp = customCentroid + (p - customCentroid) / scale;
        d = sdPolygonCustom(sp, uCustomVertexCount, uCustomVerticesClosed);
      } else {
        float scaledRadius = uShapeRadius * scale;
        d = getShapeSDF(p, uShapeCenter, scaledRadius, uShapeType, uShapeSides, uInnerRadius * scale, vec2(uWidth, uHeight) * scale);
      }

      // Clean stroke outline only — no fill between rings
      float strokeAlpha = 1.0 - smoothstep(0.0, strokeW, abs(d));

      result = max(result, baseColor * strokeAlpha);
    }

    return result;
  }

  // ========== MAIN ==========

  void main() {
    vec2 p = vUv;

    // Apply per-shape mesh warp if enabled (applied first, then corner warp)
    if (uMeshWarpEnabled && uMeshRows >= 2 && uMeshCols >= 2) {
      p = inverseMeshWarp(p, uMeshRows, uMeshCols);

      // Discard pixels outside the mesh bounds
      if (p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1) {
        gl_FragColor = vec4(0.0);
        return;
      }
    }

    // Apply per-shape corner warp if enabled
    // The warp corners define where the shape's bounding box corners map to
    if (uWarpEnabled) {
      // Compute the warped position by inverse bilinear interpolation
      // The shape is defined in 0-1 space, so we find where in the warped quad this pixel is
      p = inverseWarp(p, uWarpTL, uWarpTR, uWarpBL, uWarpBR);

      // Discard pixels outside the warped quad
      if (p.x < -0.1 || p.x > 1.1 || p.y < -0.1 || p.y > 1.1) {
        gl_FragColor = vec4(0.0);
        return;
      }
    }

    // Get SDF for this shape - use custom vertices if available
    float d;
    float pathPos;

    if (uUseCustomVertices && uCustomVertexCount >= 2) {
      // Use custom polygon SDF
      d = sdPolygonCustom(p, uCustomVertexCount, uCustomVerticesClosed);
      // Calculate path position along the custom polygon edges
      pathPos = getCustomPolygonPathPos(p, uCustomVertexCount, uCustomVerticesClosed);
    } else {
      // Use parametric shape SDF
      d = getShapeSDF(p, uShapeCenter, uShapeRadius, uShapeType, uShapeSides, uInnerRadius, vec2(uWidth, uHeight));
      // Calculate path position for animated strokes (angle-based for parametric shapes)
      vec2 toCenter = p - uShapeCenter;
      pathPos = mod(atan(toCenter.y, toCenter.x) / TAU + 0.5, 1.0);
    }

    vec4 fillColor = vec4(0.0);
    vec4 strokeColor = vec4(0.0);

    // Render fill first
    if (uFillType == 1) { // Solid
      fillColor = renderSolidFill(d, uFillColor);
    } else if (uFillType == 2) { // Plasma
      fillColor = renderPlasmaFill(d, p, uFillSpeed, uPlasmaScale, uPlasmaComplexity, uPlasmaPalette);
    } else if (uFillType == 3) { // Liquid
      fillColor = renderLiquidFill(d, p, uFillColor, uFillSpeed, uLiquidViscosity, uLiquidTurbulence, uLiquidMetallic);
    } else if (uFillType == 4) { // Fire
      fillColor = renderFireFill(d, p, uFillSpeed, uFireIntensity, uFireTurbulence, uFirePalette);
    } else if (uFillType == 5) { // Electric
      fillColor = renderElectricFill(d, p, uFillColor, uFillSpeed, uElectricIntensity, uElectricArcCount);
    } else if (uFillType == 6) { // Holographic
      fillColor = renderHolographicFill(d, p, uFillSpeed, uHoloShift, uHoloScanlines, uHoloFlicker);
    } else if (uFillType == 7) { // Noise
      fillColor = renderNoiseFill(d, p, uFillColor, uFillSpeed, uNoiseScale, uNoiseTurbulence, uNoiseColor2);
    } else if (uFillType == 8) { // Gradient
      fillColor = renderGradientFill(d, p, uFillColor, uGradColor2, uGradAngle, uFillSpeed, uGradType);
    }

    // Render stroke
    if (uStrokeType == 1) { // Solid
      strokeColor = renderSolidStroke(d, uStrokeColor, uStrokeWidth / uResolution.x);
    } else if (uStrokeType == 2) { // Glow
      strokeColor = renderGlowStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uGlowSize, uGlowIntensity, uPulseSpeed);
    } else if (uStrokeType == 3) { // Neon
      strokeColor = renderNeonStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uGlowSize, uPulseSpeed);
    } else if (uStrokeType == 4) { // Snake
      strokeColor = renderSnakeStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uSnakeLength, uSnakeSpeed, pathPos, uSnakeCount);
    } else if (uStrokeType == 5) { // Rainbow
      strokeColor = renderRainbowStroke(d, uStrokeWidth / uResolution.x, uSnakeSpeed, pathPos);
    } else if (uStrokeType == 6) { // Dashed
      strokeColor = renderDashedStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uDashLength, uGapLength, pathPos, uSnakeSpeed);
    } else if (uStrokeType == 7) { // Electric
      strokeColor = renderElectricStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uElectricArc, uSnakeSpeed, pathPos);
    } else if (uStrokeType == 8) { // Strobe
      strokeColor = renderStrobeStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uStrobeRate);
    } else if (uStrokeType == 9) { // Scanner
      strokeColor = renderScannerStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uScannerBeamWidth, uSnakeSpeed, pathPos, uScannerTrail);
    } else if (uStrokeType == 10) { // Fire
      strokeColor = renderFireStroke(d, uStrokeColor, uStrokeWidth / uResolution.x, uSnakeSpeed, pathPos);
    }

    // Apply concentric animation
    if (uAnimationType == 1 && uAnimCount > 0.0) {
      // Pre-compute centroid of custom vertices (used for scaling concentric rings around warped shape)
      vec2 cCentroid = uShapeCenter;
      if (uUseCustomVertices && uCustomVertexCount >= 2) {
        cCentroid = vec2(0.0);
        for (int i = 0; i < 64; i++) {
          if (i >= uCustomVertexCount) break;
          cCentroid += uCustomVertices[i];
        }
        cCentroid /= float(uCustomVertexCount);
      }
      vec4 concentric = renderConcentric(p, uStrokeColor, int(uAnimCount), uAnimSpacing, uAnimSpeed, uConcentricDirection, cCentroid);
      strokeColor += concentric;
    }

    // Apply animation effects (transform-based)
    // Breathe (type 3): scale pulsing
    if (uAnimationType == 3) {
      float breatheT = sin(uTime * uAnimSpeed * PI) * 0.5 + 0.5;
      float breatheScale = mix(uBreatheMin, uBreatheMax, breatheT);
      // Re-evaluate SDF at scaled position
      vec2 breatheP = uShapeCenter + (p - uShapeCenter) / breatheScale;
      float bd;
      if (uUseCustomVertices && uCustomVertexCount >= 2) {
        // Scale query around centroid
        vec2 cent = vec2(0.0);
        for (int i = 0; i < 64; i++) {
          if (i >= uCustomVertexCount) break;
          cent += uCustomVertices[i];
        }
        cent /= float(uCustomVertexCount);
        vec2 sp = cent + (p - cent) / breatheScale;
        bd = sdPolygonCustom(sp, uCustomVertexCount, uCustomVerticesClosed);
      } else {
        bd = getShapeSDF(breatheP, uShapeCenter, uShapeRadius, uShapeType, uShapeSides, uInnerRadius, vec2(uWidth, uHeight));
      }
      // Re-render with breathe'd SDF
      float alpha = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, abs(bd) - uStrokeWidth * 0.5 / uResolution.x);
      strokeColor = vec4(uStrokeColor.rgb * alpha, uStrokeColor.a * alpha);
    }

    // Rotate (type 4): handled via uShapeRotation in renderElement, just add continuous rotation
    // (This is handled in the TypeScript side by modifying uShapeRotation each frame)

    // Radiate (type 2): ray burst from center
    if (uAnimationType == 2 && uAnimCount > 0.0) {
      float rayCount = uAnimCount;
      float raySpeed = uAnimSpeed;
      vec2 rayCenter = uShapeCenter;
      if (uUseCustomVertices && uCustomVertexCount >= 2) {
        rayCenter = vec2(0.0);
        for (int i = 0; i < 64; i++) {
          if (i >= uCustomVertexCount) break;
          rayCenter += uCustomVertices[i];
        }
        rayCenter /= float(uCustomVertexCount);
      }
      float angle = atan(p.y - rayCenter.y, p.x - rayCenter.x);
      float rayAngle = mod(angle + uTime * raySpeed * 0.5, TAU);
      float ray = pow(abs(cos(rayAngle * rayCount * 0.5)), 20.0);
      float dist = length(p - rayCenter);
      float radiate = ray * (1.0 - smoothstep(0.0, 0.4, dist));
      strokeColor += uStrokeColor * radiate * 0.5;
    }

    // Ripple (type 5): expanding ring waves
    if (uAnimationType == 5) {
      vec2 rippleCenter = uShapeCenter;
      if (uUseCustomVertices && uCustomVertexCount >= 2) {
        rippleCenter = vec2(0.0);
        for (int i = 0; i < 64; i++) {
          if (i >= uCustomVertexCount) break;
          rippleCenter += uCustomVertices[i];
        }
        rippleCenter /= float(uCustomVertexCount);
      }
      float dist = length(p - rippleCenter);
      float rippleCount = max(uAnimCount, 3.0);
      for (int i = 0; i < 10; i++) {
        if (float(i) >= rippleCount) break;
        float r = mod(uTime * uAnimSpeed * 0.15 + float(i) * uAnimSpacing, rippleCount * uAnimSpacing);
        float ring = 1.0 - smoothstep(0.0, uStrokeWidth * 2.0 / uResolution.x, abs(dist - r));
        float fade = exp(-r * uRippleDecay * 5.0);
        strokeColor += uStrokeColor * ring * fade * 0.3;
      }
    }

    // Wave (type 6): sinusoidal position distortion
    if (uAnimationType == 6) {
      float wt = uTime * uAnimSpeed;
      vec2 waveOffset = vec2(
        sin(p.y * uWaveFrequency * 20.0 + wt * 3.0) * uWaveAmplitude * 0.02,
        cos(p.x * uWaveFrequency * 20.0 + wt * 2.5) * uWaveAmplitude * 0.02
      );
      vec2 wp = p + waveOffset;
      float wd;
      if (uUseCustomVertices && uCustomVertexCount >= 2) {
        wd = sdPolygonCustom(wp, uCustomVertexCount, uCustomVerticesClosed);
      } else {
        wd = getShapeSDF(wp, uShapeCenter, uShapeRadius, uShapeType, uShapeSides, uInnerRadius, vec2(uWidth, uHeight));
      }
      float walpha = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, abs(wd) - uStrokeWidth * 0.5 / uResolution.x);
      strokeColor = vec4(uStrokeColor.rgb * walpha, uStrokeColor.a * walpha);
      // Re-evaluate fill too
      if (uFillType > 0) {
        float wInside = 1.0 - smoothstep(-2.0 / uResolution.x, 0.0, wd);
        fillColor = vec4(fillColor.rgb, fillColor.a * wInside);
      }
    }

    // Glitch (type 7): block displacement + RGB split
    if (uAnimationType == 7 && uGlitchIntensity > 0.0) {
      float gt = uTime * uAnimSpeed;
      // Block-based offset
      float blockY = floor(p.y * (10.0 / uGlitchBlockSize)) * uGlitchBlockSize * 0.1;
      float glitchTrigger = step(0.92, random(vec2(blockY, floor(gt * 4.0))));
      float offset = (random(vec2(blockY + 1.0, floor(gt * 4.0))) - 0.5) * uGlitchIntensity * 0.05;

      if (glitchTrigger > 0.5) {
        // RGB split with displaced samples
        vec2 rp = p + vec2(offset, 0.0);
        vec2 bp = p - vec2(offset, 0.0);
        float dr, db;
        if (uUseCustomVertices && uCustomVertexCount >= 2) {
          dr = sdPolygonCustom(rp, uCustomVertexCount, uCustomVerticesClosed);
          db = sdPolygonCustom(bp, uCustomVertexCount, uCustomVerticesClosed);
        } else {
          dr = getShapeSDF(rp, uShapeCenter, uShapeRadius, uShapeType, uShapeSides, uInnerRadius, vec2(uWidth, uHeight));
          db = getShapeSDF(bp, uShapeCenter, uShapeRadius, uShapeType, uShapeSides, uInnerRadius, vec2(uWidth, uHeight));
        }
        float ar = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, abs(dr) - uStrokeWidth * 0.5 / uResolution.x);
        float ab = 1.0 - smoothstep(0.0, 2.0 / uResolution.x, abs(db) - uStrokeWidth * 0.5 / uResolution.x);
        float ag = strokeColor.a;

        strokeColor = vec4(
          uStrokeColor.r * ar,
          uStrokeColor.g * ag,
          uStrokeColor.b * ab,
          max(ar, max(ag, ab)) * uStrokeColor.a
        );
      }
    }

    // Composite fill and stroke
    vec4 result = fillColor;
    result = mix(result, strokeColor, strokeColor.a);

    gl_FragColor = result;
  }
`;class ic{renderer;scene;camera;renderTarget;quad;material;width;height;startTime;pathScene;pathMaterial;currentPathLine=null;constructor(e,t,a){this.renderer=e,this.width=t,this.height=a,this.startTime=performance.now()/1e3,this.renderTarget=new la(t,a,{minFilter:le,magFilter:le,format:qe,type:or}),this.scene=new ea,this.camera=new Ra(0,1,1,0,.1,10),this.camera.position.z=1,this.material=new ai({vertexShader:tc,fragmentShader:ac,uniforms:{uTime:{value:0},uResolution:{value:new fe(t,a)},uShapeType:{value:0},uShapeCenter:{value:new fe(.5,.5)},uShapeRadius:{value:.2},uShapeRotation:{value:0},uShapeScale:{value:new fe(1,1)},uShapeSides:{value:6},uInnerRadius:{value:.1},uWidth:{value:.3},uHeight:{value:.2},uWarpEnabled:{value:!1},uWarpTL:{value:new fe(0,0)},uWarpTR:{value:new fe(1,0)},uWarpBL:{value:new fe(0,1)},uWarpBR:{value:new fe(1,1)},uMeshWarpEnabled:{value:!1},uMeshRows:{value:3},uMeshCols:{value:3},uMeshPoints:{value:this.createDefaultMeshPoints(3,3)},uUseCustomVertices:{value:!1},uCustomVertexCount:{value:0},uCustomVertices:{value:this.createDefaultCustomVertices()},uCustomVerticesClosed:{value:!0},uStrokeType:{value:2},uStrokeColor:{value:new ot(0,1,.5,1)},uStrokeWidth:{value:4},uGlowSize:{value:20},uGlowIntensity:{value:1},uPulseSpeed:{value:1},uSnakeLength:{value:.3},uSnakeSpeed:{value:1},uSnakeCount:{value:1},uFillType:{value:0},uFillColor:{value:new ot(1,1,1,.5)},uFillSpeed:{value:1},uAnimationType:{value:0},uAnimCount:{value:5},uAnimSpacing:{value:.04},uAnimSpeed:{value:1},uConcentricDirection:{value:0},uDashLength:{value:.3},uGapLength:{value:.2},uElectricArc:{value:1},uElectricBranches:{value:3},uScannerBeamWidth:{value:.1},uScannerTrail:{value:.3},uStrobeRate:{value:4},uNoiseScale:{value:5},uNoiseTurbulence:{value:.5},uHoloShift:{value:0},uHoloScanlines:{value:3},uGradAngle:{value:0},uPlasmaScale:{value:8},uPlasmaComplexity:{value:3},uPlasmaPalette:{value:0},uLiquidViscosity:{value:.5},uLiquidTurbulence:{value:.5},uLiquidMetallic:{value:.5},uFireIntensity:{value:1},uFireTurbulence:{value:.5},uFirePalette:{value:0},uElectricIntensity:{value:1},uElectricArcCount:{value:5},uHoloFlicker:{value:.5},uNoiseColor2:{value:new ot(0,.2,.4,1)},uGradColor2:{value:new ot(1,1,1,1)},uGradType:{value:0},uBreatheMin:{value:.8},uBreatheMax:{value:1.2},uRotateSpeed:{value:1},uRotateDir:{value:0},uWaveAmplitude:{value:1},uWaveFrequency:{value:1},uRippleDecay:{value:1},uGlitchIntensity:{value:1},uGlitchBlockSize:{value:1}},transparent:!0,depthTest:!1,depthWrite:!1,blending:_a});const o=new Aa(1,1);o.translate(.5,.5,0),this.quad=new Ba(o,this.material),this.scene.add(this.quad),this.pathScene=new ea,this.pathMaterial=new zo({color:16711935,transparent:!0,opacity:1,depthTest:!1,depthWrite:!1,blending:_a})}resize(e,t){this.width=e,this.height=t,this.renderTarget.setSize(e,t),this.material.uniforms.uResolution.value.set(e,t)}createDefaultMeshPoints(e,t){const a=[];for(let o=0;o<e;o++)for(let r=0;r<t;r++)a.push(new fe(r/(t-1),o/(e-1)));for(;a.length<16;)a.push(new fe(0,0));return a}createDefaultCustomVertices(){const e=[];for(let t=0;t<64;t++)e.push(new fe(0,0));return e}getShapeTypeIndex(e){return{circle:0,ellipse:0,arc:0,rectangle:1,roundedRect:1,triangle:2,polygon:3,star:4,ring:5,spiral:6,line:7,freehand:0,pointClickLine:7}[e]??0}getStrokeTypeIndex(e){return{none:0,solid:1,glow:2,neon:3,snake:4,rainbow:5,dashed:6,electric:7,strobe:8,scanner:9,fire:10,pulse:4,dotted:6}[e]??2}getFillTypeIndex(e){return{none:0,solid:1,plasma:2,liquid:3,fire:4,electric:5,holographic:6,noise:7,gradient:8,radialGradient:8}[e]??0}getAnimationTypeIndex(e){return{none:0,concentric:1,radiate:2,breathe:3,rotate:4,ripple:5,wave:6,glitch:7}[e]??0}isCustomVertexShape(e){return!1}getShapeVerticesForRender(e){return e.customVertices&&e.customVertices.length>=2?e.customVertices:"points"in e&&Array.isArray(e.points)?e.points:[]}isClosedVertexShape(e){return e.customVertices&&e.customVertices.length>=2?e.type==="freehand"||e.type==="line"?!1:(e.type==="pointClickLine"||e.type==="polyline")&&"closed"in e?e.closed:!0:(e.type==="pointClickLine"||e.type==="polyline")&&"closed"in e?e.closed:!1}renderVertexElement(e){const t=e.shape,a=this.getShapeVerticesForRender(t);if(a.length<2)return;this.currentPathLine&&(this.pathScene.remove(this.currentPathLine),this.currentPathLine.geometry.dispose(),this.currentPathLine.material instanceof il&&this.currentPathLine.material.dispose(),this.currentPathLine=null);const o=a.map(f=>new He(f.x,f.y,0)),r=new Io().setFromPoints(o);let s=16711935,n=1;if(e.stroke.type!=="none"&&"color"in e.stroke){const f=e.stroke.color;s=Math.round(f[0]*255)<<16|Math.round(f[1]*255)<<8|Math.round(f[2]*255),n=f[3]}const l=new zo({color:s,transparent:!0,opacity:n,depthTest:!1,depthWrite:!1,blending:_a,linewidth:1}),u=this.isClosedVertexShape(t);this.currentPathLine=u?new ol(r,l):new rl(r,l),this.pathScene.add(this.currentPathLine)}renderPathElement(e){this.renderVertexElement(e)}isPathShape(e){return this.isCustomVertexShape(e)}renderElement(e){const t=this.material.uniforms,a=performance.now()/1e3-this.startTime;t.uTime.value=a;const o=e.shape;if(t.uShapeType.value=this.getShapeTypeIndex(o.type),t.uShapeCenter.value.set(o.position.x,o.position.y),t.uShapeRotation.value=o.rotation*Math.PI/180,t.uShapeScale.value.set(o.scale.x,o.scale.y),e.warpEnabled&&e.warpCorners?(t.uWarpEnabled.value=!0,t.uWarpTL.value.set(e.warpCorners.topLeft.x,e.warpCorners.topLeft.y),t.uWarpTR.value.set(e.warpCorners.topRight.x,e.warpCorners.topRight.y),t.uWarpBL.value.set(e.warpCorners.bottomLeft.x,e.warpCorners.bottomLeft.y),t.uWarpBR.value.set(e.warpCorners.bottomRight.x,e.warpCorners.bottomRight.y)):t.uWarpEnabled.value=!1,e.meshWarpEnabled&&e.meshWarp){t.uMeshWarpEnabled.value=!0,t.uMeshRows.value=e.meshWarp.rows,t.uMeshCols.value=e.meshWarp.cols;const l=t.uMeshPoints.value;let u=0;for(let f=0;f<e.meshWarp.rows&&f<4;f++)for(let d=0;d<e.meshWarp.cols&&d<4;d++)if(u<16){const h=e.meshWarp.points[f][d];l[u].set(h.x,h.y),u++}}else t.uMeshWarpEnabled.value=!1;if(o.type!=="circle"&&o.customVertices&&o.customVertices.length>=2){t.uUseCustomVertices.value=!0,t.uCustomVertexCount.value=Math.min(o.customVertices.length,64),t.uCustomVerticesClosed.value=this.isClosedVertexShape(o);const l=t.uCustomVertices.value;for(let u=0;u<64;u++)u<o.customVertices.length?l[u].set(o.customVertices[u].x,o.customVertices[u].y):l[u].set(0,0)}else if("points"in o&&Array.isArray(o.points)&&(o.type==="freehand"||o.type==="pointClickLine"||o.type==="polyline")){const l=o.points;if(l.length>=2){t.uUseCustomVertices.value=!0,t.uCustomVertexCount.value=Math.min(l.length,64),t.uCustomVerticesClosed.value=this.isClosedVertexShape(o);const u=t.uCustomVertices.value;for(let f=0;f<64;f++)f<l.length?u[f].set(l[f].x,l[f].y):u[f].set(0,0)}else t.uUseCustomVertices.value=!1}else t.uUseCustomVertices.value=!1;"radius"in o&&(t.uShapeRadius.value=o.radius),"width"in o&&"height"in o&&(t.uWidth.value=o.width,t.uHeight.value=o.height),"size"in o&&(t.uShapeRadius.value=o.size),"sides"in o&&(t.uShapeSides.value=o.sides),"points"in o&&o.type==="star"&&(t.uShapeSides.value=o.points),"innerRadius"in o&&(t.uInnerRadius.value=o.innerRadius),"outerRadius"in o&&(t.uShapeRadius.value=o.outerRadius),"turns"in o&&(t.uShapeSides.value=o.turns,t.uInnerRadius.value=o.startRadius,t.uShapeRadius.value=o.endRadius);const r=e.stroke;if(t.uStrokeType.value=this.getStrokeTypeIndex(r.type),r.type!=="none"&&"color"in r){const l=r.color;t.uStrokeColor.value.set(l[0],l[1],l[2],l[3])}r.type!=="none"&&"width"in r&&(t.uStrokeWidth.value=r.width),"glowSize"in r&&(t.uGlowSize.value=r.glowSize),"glowIntensity"in r&&(t.uGlowIntensity.value=r.glowIntensity),"pulseSpeed"in r&&(t.uPulseSpeed.value=r.pulseSpeed),"flickerSpeed"in r&&(t.uPulseSpeed.value=r.flickerSpeed),"length"in r&&(t.uSnakeLength.value=r.length),"speed"in r&&(t.uSnakeSpeed.value=r.speed),"snakeCount"in r?t.uSnakeCount.value=r.snakeCount:t.uSnakeCount.value=1,"dashLength"in r&&(t.uDashLength.value=r.dashLength),"gapLength"in r&&(t.uGapLength.value=r.gapLength),"arcIntensity"in r&&(t.uElectricArc.value=r.arcIntensity),"beamWidth"in r&&(t.uScannerBeamWidth.value=r.beamWidth),"trail"in r&&(t.uScannerTrail.value=r.trail),"rate"in r&&(t.uStrobeRate.value=r.rate);const s=e.fill;if(t.uFillType.value=this.getFillTypeIndex(s.type),s.type!=="none"&&"color"in s){const l=s.color;t.uFillColor.value.set(l[0],l[1],l[2],l[3])}if("speed"in s&&(t.uFillSpeed.value=s.speed),"scale"in s&&(t.uNoiseScale.value=s.scale),"turbulence"in s&&(t.uNoiseTurbulence.value=s.turbulence),"shiftAmount"in s&&(t.uHoloShift.value=s.shiftAmount),"scanlines"in s&&(t.uHoloScanlines.value=s.scanlines),"angle"in s&&(t.uGradAngle.value=s.angle),s.type==="plasma"){t.uPlasmaScale.value=s.scale??8,t.uPlasmaComplexity.value=s.complexity??3;const l={rainbow:0,fire:1,ocean:2,neon:3};t.uPlasmaPalette.value=l[s.palette]??0}if(s.type==="liquid"&&(t.uLiquidViscosity.value=s.viscosity??.5,t.uLiquidTurbulence.value=s.turbulence??.5,t.uLiquidMetallic.value=s.metallic??.5),s.type==="fire"){t.uFireIntensity.value=s.intensity??1,t.uFireTurbulence.value=s.turbulence??.5;const l={orange:0,blue:1,green:2,purple:3};t.uFirePalette.value=l[s.palette]??0}if(s.type==="electric"&&(t.uElectricIntensity.value=s.intensity??1,t.uElectricArcCount.value=s.arcCount??5),s.type==="holographic"&&(t.uHoloFlicker.value=s.flicker??.5),s.type==="noise"&&"color2"in s){const l=s.color2;if(t.uNoiseColor2.value.set(l[0],l[1],l[2],l[3]),"color1"in s){const u=s.color1;t.uFillColor.value.set(u[0],u[1],u[2],u[3])}}if(s.type==="gradient"){if("color2"in s){const u=s.color2;t.uGradColor2.value.set(u[0],u[1],u[2],u[3])}if("color"in s){const u=s.color;t.uFillColor.value.set(u[0],u[1],u[2],u[3])}const l={linear:0,radial:1,angular:2};t.uGradType.value=l[s.gradientType]??0}const n=e.animation;if(t.uAnimationType.value=this.getAnimationTypeIndex(n.type),n.type==="concentric"){const l=n;t.uAnimCount.value=l.count,t.uAnimSpacing.value=l.spacing,t.uAnimSpeed.value=l.speed;const u={out:0,in:1,both:2};t.uConcentricDirection.value=u[l.direction]??0}else if(n.type==="breathe")t.uAnimSpeed.value=n.speed??1,t.uBreatheMin.value=n.minScale??.8,t.uBreatheMax.value=n.maxScale??1.2;else if(n.type==="rotate"){t.uAnimSpeed.value=n.speed??1,t.uRotateDir.value=n.direction==="ccw"?1:0;const l=performance.now()/1e3-this.startTime,u=n.speed??1,f=n.direction==="ccw"?-1:1;t.uShapeRotation.value=e.shape.rotation*Math.PI/180+l*u*f}else n.type==="radiate"?(t.uAnimCount.value=n.rays??8,t.uAnimSpeed.value=n.speed??1):n.type==="ripple"?(t.uAnimCount.value=n.count??5,t.uAnimSpacing.value=n.spacing??.04,t.uAnimSpeed.value=n.speed??1,t.uRippleDecay.value=n.decay??1):n.type==="wave"?(t.uAnimSpeed.value=n.speed??1,t.uWaveAmplitude.value=n.amplitude??1,t.uWaveFrequency.value=n.frequency??1):n.type==="glitch"?(t.uAnimSpeed.value=n.speed??1,t.uGlitchIntensity.value=n.intensity??1,t.uGlitchBlockSize.value=n.blockSize??1):t.uAnimCount.value=0}render(e){this.renderer.setRenderTarget(this.renderTarget),this.renderer.setClearColor(0,0),this.renderer.clear();for(const t of e)if(t.visible)for(const a of t.elements)a.shape.visible&&(this.isPathShape(a.shape)?(this.renderPathElement(a),this.renderer.render(this.pathScene,this.camera)):(this.renderElement(a),this.renderer.render(this.scene,this.camera)));return this.renderer.setRenderTarget(null),this.renderTarget.texture}renderElements(e,t){this.renderer.setRenderTarget(t),this.renderer.setClearColor(0,0),this.renderer.clear();const a=this.renderer.autoClear;this.renderer.autoClear=!1;const o=this.material.uniforms.uResolution.value;(o.x!==t.width||o.y!==t.height)&&this.material.uniforms.uResolution.value.set(t.width,t.height);const r=[...e].sort((s,n)=>s.shape.zIndex-n.shape.zIndex);for(const s of r)s.shape.visible&&(this.isPathShape(s.shape)?(this.renderPathElement(s),this.renderer.render(this.pathScene,this.camera)):(this.renderElement(s),this.renderer.render(this.scene,this.camera)));return this.renderer.autoClear=a,this.material.uniforms.uResolution.value.set(this.width,this.height),this.renderer.setRenderTarget(null),t.texture}dispose(){this.renderTarget.dispose(),this.material.dispose(),this.quad.geometry.dispose(),this.pathMaterial.dispose(),this.currentPathLine&&this.currentPathLine.geometry.dispose()}}const oc=`
// Mulberry32-flavored hash: stable per-stamp pseudo-randomness so
// procedural brushes produce the same per-stamp variation every
// frame — no flicker on paused renders. Seeded by per-instance i_seed.
float hash11(float x) {
  x = fract(x * 0.1031);
  x *= x + 33.33;
  x *= x + x;
  return fract(x);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// Box-Muller from two uniform samples — used by spray brush for
// Gaussian dot distribution.
vec2 boxMuller(vec2 u) {
  float u1 = max(u.x, 0.001);
  float mag = sqrt(-2.0 * log(u1));
  float ang = 6.28318530718 * u.y;
  return vec2(mag * cos(ang), mag * sin(ang));
}
// Radial soft falloff — used as the basic brush envelope.
float radialFalloff(float d, float falloff) {
  return exp(-d * d * falloff);
}
// Simplex-ish value noise — cheap interpolated hash noise, plenty
// for brush effects.
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i + vec2(0.0, 0.0));
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// 4-octave fractal-brownian motion. Returns ~[0, 1.875] (sum of
// 1 + 0.5 + 0.25 + 0.125 weighted noise). Divide by ~1.875 if you
// need 0..1.
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * valueNoise(p);
    p *= 2.07;
    a *= 0.5;
  }
  return v;
}
// 2D rotation helper.
vec2 rot2(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
// Polar fold for kaleidoscope (n-way symmetry).
vec2 polarFold(vec2 uv, float symmetry) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float wedge = 6.28318530718 / max(symmetry, 1.0);
  a = mod(a, wedge);
  a = abs(a - wedge * 0.5);
  return vec2(cos(a), sin(a)) * r;
}
`,rc=`#version 300 es
precision highp float;
precision highp int;

// Explicit attribute locations — WebGL2 / GLSL ES 3.00 does NOT
// guarantee compilers assign locations in declaration order, and
// the renderer's vertexAttribPointer calls reference fixed numeric
// locations. Without these qualifiers, attribute data is fed into
// the wrong shader inputs on some drivers and brush types render
// as garbage (often appearing identical to the default).
//
// HARD LIMIT: WebGL2 spec MAX_VERTEX_ATTRIBS minimum is 16 (locations
// 0..15). Chromium / ANGLE / D3D11 backends enforce this minimum
// strictly. Phase-3 added 6 new procedural params — we pack those
// into two vec3 attributes to stay inside the 16-location budget.
layout(location = 0)  in vec2 a_corner;            // (-1,-1), (1,-1), (-1,1), (1,1)

layout(location = 1)  in vec2  i_position;         // stamp center in canvas pixels
layout(location = 2)  in float i_size;             // brush diameter in pixels
layout(location = 3)  in float i_angle;            // stroke direction radians
layout(location = 4)  in vec3  i_color;            // 0..1 RGB tint
layout(location = 5)  in float i_alpha;            // per-stamp alpha
layout(location = 6)  in float i_glow;             // brush.glow (0..5)
layout(location = 7)  in float i_softness;         // brush.softness (0..1)
layout(location = 8)  in float i_seed;             // per-stamp seed
layout(location = 9)  in float i_time;             // animation phase (timeS * brush.speed)
layout(location = 10) in float i_progress;         // stamp position along stroke (0..1)
// Packed procedural params — see PROC_PACK_LAYOUT in webglRenderer.ts.
// pack1.x = particleSize, pack1.y = internalGlow, pack1.z = complexity
// pack2.x = noiseScale,   pack2.y = noiseSpeed,   pack2.z = noiseAmount
layout(location = 11) in vec3  i_pack1;
layout(location = 12) in vec3  i_pack2;

uniform vec2  u_resolution;   // canvas size in pixels
uniform int   u_brushType;
uniform float u_useAngle;     // 1.0 if brush uses stroke direction
uniform float u_extentScale;  // multiplier on size for quad extent

out vec2  v_uv;
out vec3  v_color;
out float v_alpha;
out float v_glow;
out float v_softness;
out float v_seed;
out float v_time;
out float v_size;
out float v_progress;
out float v_particleSize;
out float v_internalGlow;
out float v_noiseScale;
out float v_noiseSpeed;
out float v_noiseAmount;
out float v_complexity;

void main() {
  float extent = i_size * 0.5 * u_extentScale;

  float c = cos(i_angle * u_useAngle);
  float s = sin(i_angle * u_useAngle);
  mat2 rot = mat2(c, s, -s, c);

  vec2 cornerWorld = i_position + rot * (a_corner * extent);

  vec2 ndc = (cornerWorld / u_resolution) * 2.0 - 1.0;
  ndc.y = -ndc.y;

  gl_Position = vec4(ndc, 0.0, 1.0);
  v_uv            = a_corner;
  v_color         = i_color;
  v_alpha         = i_alpha;
  v_glow          = i_glow;
  v_softness      = i_softness;
  v_seed          = i_seed;
  v_time          = i_time;
  v_size          = i_size;
  v_progress      = i_progress;
  // Unpack procedural params from the two vec3 attributes.
  v_particleSize  = i_pack1.x;
  v_internalGlow  = i_pack1.y;
  v_complexity    = i_pack1.z;
  v_noiseScale    = i_pack2.x;
  v_noiseSpeed    = i_pack2.y;
  v_noiseAmount   = i_pack2.z;
}
`,sc=`#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2  v_uv;
in vec3  v_color;
in float v_alpha;
in float v_glow;
in float v_softness;
in float v_seed;
in float v_time;
in float v_size;
in float v_progress;
in float v_particleSize;
in float v_internalGlow;
in float v_noiseScale;
in float v_noiseSpeed;
in float v_noiseAmount;
in float v_complexity;

uniform int u_brushType;

out vec4 outColor;

${oc}

// ─────────────────────────────────────────────────────────────────
// PHASE 1 — Canvas2D-parity brushes
// ─────────────────────────────────────────────────────────────────

vec4 brushGlow(vec2 uv) {
  float d = length(uv);
  if (d > 1.0) return vec4(0.0);
  // Halo gradient — fills the entire quad (which the renderer sizes
  // as 1 + 2*glow so high-glow strokes get a wider footprint, matching
  // Canvas2D's glowRadius = radius * (1 + glow * 2) formula).
  // Softness pushed further than before — at softness=1 the falloff
  // is 0.5 instead of 1.2 (much wider, more diffuse halo).
  float haloFalloff = mix(2.5, 0.5, v_softness);
  float halo = radialFalloff(d, haloFalloff);
  // Core gradient — should stay at a FIXED pixel size regardless of
  // glow, so as glow grows the core looks proportionally smaller
  // inside the larger halo. v_uv is normalized to the quad extent =
  // (1 + 2*glow) * radius, so a fixed-pixel core occupies a
  // shrinking v_uv range as glow rises. coreEnd = 0.5 / (1 + 2*glow).
  float coreEnd = 0.5 / (1.0 + 2.0 * v_glow);
  float core = radialFalloff(d / max(coreEnd, 0.05), 6.0);
  // Color: tint = brush color, core lifts toward white.
  vec3 col = mix(v_color, vec3(1.0), core * 0.7);
  float alpha = (halo * 0.85 + core * 0.5) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushNeon(vec2 uv) {
  float d = length(uv);
  if (d > 1.0) return vec4(0.0);
  float halo = radialFalloff(d, 1.2 / max(v_glow, 0.1));
  float core = radialFalloff(d * 4.0, 12.0);
  vec3 col = mix(v_color * 0.95, vec3(1.0), core * 0.95);
  float alpha = (halo * 0.7 + core * 0.95) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushLaser(vec2 uv) {
  float d = length(uv);
  if (d > 1.0) return vec4(0.0);
  float coreR = 0.18;
  float core = radialFalloff(d / coreR, 6.0);
  float halo = radialFalloff(d, max(0.2, 1.5 / v_glow));
  vec3 col = mix(v_color, vec3(1.0), core);
  float alpha = (halo * 0.5 + core) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushCalligraphy(vec2 uv) {
  vec2 scaled = vec2(uv.x, uv.y * 8.0);
  float d = length(scaled);
  if (d > 1.0) return vec4(0.0);
  float edge = 1.0 - smoothstep(0.85, 1.0, d);
  return vec4(v_color, edge * v_alpha);
}

vec4 brushMarker(vec2 uv) {
  vec2 halfSize = vec2(1.0, 0.25);
  vec2 d2 = abs(uv) - halfSize;
  vec2 d2Pos = max(d2, vec2(0.0));
  float outside = length(d2Pos);
  float softEdge = 0.05;
  float alpha = (1.0 - smoothstep(0.0, softEdge, outside)) * 0.7 * v_alpha;
  return vec4(v_color, alpha);
}

vec4 brushFlame(vec2 uv) {
  float d = length(uv);
  if (d > 1.0) return vec4(0.0);
  float t = v_time * 4.0;
  float flicker = 0.7
    + 0.3 * (sin(t * 2.7) * 0.5 + 0.5)
    + 0.15 * (sin(t * 5.3) * 0.5 + 0.5)
    + 0.15 * hash11(v_seed);
  float yOff = 0.1 * sin(t * 1.8);
  vec2 uvShifted = vec2(uv.x, uv.y + yOff);
  float dS = length(uvShifted);
  vec3 col;
  float alpha;
  if (dS < 0.2) {
    col = vec3(1.0, 1.0, 0.78);
    alpha = flicker;
  } else if (dS < 0.6) {
    float k = (dS - 0.2) / 0.4;
    col = mix(vec3(1.0, 1.0, 0.78), v_color, k);
    alpha = mix(flicker, flicker * 0.8, k);
  } else if (dS < 1.0) {
    float k = (dS - 0.6) / 0.4;
    vec3 dark = vec3(v_color.r * 0.5, 0.0, 0.0);
    col = mix(v_color, dark, k);
    alpha = mix(flicker * 0.4, 0.0, k);
  } else {
    return vec4(0.0);
  }
  return vec4(col, alpha * v_alpha);
}

vec4 brushElectric(vec2 uv) {
  float t = v_time * 6.0;
  float radius = length(uv);
  if (radius > 1.0) return vec4(0.0);
  float angle = atan(uv.y, uv.x);
  float corePulse = 0.35 + 0.05 * sin(t * 5.0);
  float core = radialFalloff(radius / corePulse, 6.0);
  float sparkAlpha = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float baseAng = (fi / 6.0) * 6.28318530718;
    float wobble = sin(t * 2.1 + fi * 1.7) * 0.8;
    float sparkAng = baseAng + wobble;
    float da = angle - sparkAng;
    da = mod(da + 3.14159265, 6.28318530718) - 3.14159265;
    float angCloseness = exp(-da * da * 80.0);
    float lenMod = 0.5 + 0.5 * sin(t * 3.7 + fi * 2.3);
    float sparkLen = 0.5 + lenMod * v_glow * 0.5;
    float withinSpark = smoothstep(sparkLen + 0.1, sparkLen - 0.05, radius);
    sparkAlpha = max(sparkAlpha, angCloseness * withinSpark * 0.7);
  }
  vec3 col = mix(v_color, vec3(1.0), core);
  float alpha = (core + sparkAlpha) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushRibbon(vec2 uv) {
  // Linear gradient strip. Time-driven rotation handled in the
  // vertex shader's i_angle (we feed time-based rotation in via the
  // CPU side for ribbons). Strip extends along X axis here.
  // Strip is full width × 0.15 height.
  if (abs(uv.y) > 0.075 * 6.667) return vec4(0.0);  // 0.5 in normalized space
  if (abs(uv.y) > 0.5) return vec4(0.0);
  if (abs(uv.x) > 1.0) return vec4(0.0);
  // Horizontal alpha taper: fade at the ends.
  float xFade = 1.0 - smoothstep(0.7, 1.0, abs(uv.x));
  float yFade = 1.0 - smoothstep(0.3, 0.5, abs(uv.y));
  return vec4(v_color, xFade * yFade * v_alpha);
}

vec4 brushParticle(vec2 uv) {
  float t = v_time * 3.0;
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  int count = 4;
  for (int i = 0; i < 5; i++) {
    if (i >= count) break;
    float fi = float(i);
    float ang = (fi / float(count)) * 6.28318530718
              + sin(t * 2.3 + fi * 1.1) * 1.5;
    float dist = (0.3 + 0.7 * abs(sin(t * 1.9 + fi * 2.7))) * 0.5;
    vec2 pCenter = vec2(cos(ang), sin(ang)) * dist;
    float pSize = 0.05 + abs(sin(t * 3.1 + fi * 0.8)) * 0.15;
    float pSize2 = pSize * (1.0 + v_glow * 0.5);
    float d = length(uv - pCenter) / pSize2;
    if (d < 1.0) {
      float pAlpha = radialFalloff(d * 1.0, 3.0);
      float core = radialFalloff(d * 4.0, 8.0);
      col += mix(v_color, vec3(1.0), core) * pAlpha;
      alpha += pAlpha;
    }
  }
  if (alpha > 0.0) col /= alpha;
  return vec4(col, min(1.0, alpha) * v_alpha);
}

vec4 brushSmoke(vec2 uv) {
  vec2 off = (hash22(vec2(v_seed, v_seed * 1.7)) - 0.5) * 0.3;
  vec2 uvShifted = uv - off;
  float d = length(uvShifted);
  if (d > 1.0) return vec4(0.0);
  float wideFalloff = mix(0.8, 0.3, v_softness);
  float alpha = radialFalloff(d, wideFalloff) * 0.3 * v_alpha;
  return vec4(v_color, alpha);
}

vec4 brushSpray(vec2 uv) {
  // Gaussian cluster of dots — entirely procedural in the fragment.
  // We sample N "virtual dots" around the stamp center, compute how
  // close uv is to each, accumulate alpha. This replaces Canvas2D's
  // for-loop with a single fragment evaluation. With 24 dots we
  // match the visual density of the original.
  float density = 24.0;
  float spread = 0.3 + v_softness * 0.7;
  float alpha = 0.0;
  for (float i = 0.0; i < 24.0; i++) {
    vec2 u1u2 = hash22(vec2(v_seed * 73.1 + i, v_seed * 31.7 + i * 1.3));
    vec2 g = boxMuller(u1u2) * 0.5 * spread;
    if (length(g) > 1.0) continue;
    // Each "dot" is a tiny disc. Render its contribution at this uv.
    float dotSize = 0.02 + hash11(v_seed * 11.0 + i * 1.7) * 0.03;
    float d = length(uv - g);
    if (d < dotSize) {
      alpha += 0.15 * (1.0 - d / dotSize);
    }
  }
  return vec4(v_color, min(1.0, alpha) * v_alpha);
}

vec4 brushPaintbrush(vec2 uv) {
  int bristleCount = int(5.0 + min(15.0, v_size * 0.15));
  float maxAlpha = 0.0;
  for (int i = 0; i < 20; i++) {
    if (i >= bristleCount) break;
    float fi = float(i);
    float t = fi / float(bristleCount - 1) - 0.5;
    float jitter = (hash11(v_seed * 23.0 + fi) - 0.5) * 0.1;
    float bx = t + jitter;
    float by = (hash11(v_seed * 31.0 + fi) - 0.5) * 0.05;
    float bSize = 0.02 + hash11(v_seed * 41.0 + fi) * 0.04;
    float d = length(uv - vec2(bx, by)) / bSize;
    if (d < 1.0) {
      float a = (1.0 - d) * (0.3 + 0.7 * (1.0 - abs(t) * 2.0));
      maxAlpha = max(maxAlpha, a);
    }
  }
  return vec4(v_color, maxAlpha * (0.3 + v_softness * 0.7) * v_alpha);
}

vec4 brushWatercolor(vec2 uv) {
  vec3 col = v_color;
  float alpha = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float spread = 1.0 + fl * 0.4 * v_softness;
    vec2 off = (hash22(vec2(v_seed * 11.0 + fl, v_seed * 17.0 + fl * 1.3)) - 0.5) * 0.2;
    vec2 uvL = uv - off;
    float d = length(uvL);
    if (d > spread) continue;
    float ang = atan(uvL.y, uvL.x);
    float wobble = 0.85 + 0.3 * hash11(v_seed * 7.0 + fl * 13.0 + ang * 2.0);
    float effective = spread * wobble;
    if (d > effective) continue;
    // Per-layer alpha bumped 3× from the original (0.08/0.06/0.04).
    // The original values produced a stamp so faint that it was
    // effectively invisible until many stamps overlapped — users
    // report the brush appears to do nothing. The 3× bump gives
    // single stamps a clearly visible translucent wash while still
    // allowing pleasant accumulation across overlapping stamps.
    float layerAlpha = (0.24 - fl * 0.06);
    float k = d / effective;
    float aMul;
    if (k < 0.6) aMul = mix(1.0, 0.5, k / 0.6);
    else aMul = mix(0.5, 0.0, (k - 0.6) / 0.4);
    alpha += layerAlpha * aMul;
  }
  return vec4(col, min(1.0, alpha) * v_alpha);
}

// ─────────────────────────────────────────────────────────────────
// PHASE 2 — WebGL2-only procedural brushes
// These match the original Phase 2 versions exactly — they do NOT
// read the Phase-3 per-instance varyings (v_particleSize,
// v_internalGlow, v_noiseScale, v_noiseSpeed, v_noiseAmount,
// v_complexity, v_progress). Those varyings are still passed
// through but only the Phase-3 brushes (nebula..bubbles) consume
// them.
// ─────────────────────────────────────────────────────────────────

vec4 brushSparkle(vec2 uv) {
  // Burst of twinkling stars with cross-shaped beams.
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  const int STAR_COUNT = 9;
  for (int i = 0; i < STAR_COUNT; i++) {
    float fi = float(i);
    vec2 sPos = (hash22(vec2(v_seed * 13.7 + fi, v_seed * 7.3 + fi * 1.1)) - 0.5) * 1.4;
    float twinklePhase = hash11(v_seed * 23.0 + fi);
    float twinkle = 0.5 + 0.5 * (0.5 + 0.5 * sin(v_time * 6.0 + twinklePhase * 6.28));
    float sSize = 0.12 + hash11(v_seed * 31.0 + fi) * 0.18;
    vec2 d = uv - sPos;
    float rot = v_time * 0.4 + twinklePhase * 6.28;
    float c = cos(rot), s = sin(rot);
    vec2 r = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    float horizontal = exp(-(r.x * r.x) / (sSize * sSize * 0.04) - (r.y * r.y) / (sSize * sSize));
    float vertical   = exp(-(r.y * r.y) / (sSize * sSize * 0.04) - (r.x * r.x) / (sSize * sSize));
    float core       = exp(-dot(d, d) / (sSize * sSize * 0.15));
    float starAlpha = max(max(horizontal, vertical), core * 1.5) * twinkle;
    col += mix(v_color, vec3(1.0, 1.0, 0.95), core * 0.9) * starAlpha;
    alpha = max(alpha, starAlpha);
  }
  if (alpha > 0.0) col /= alpha;
  return vec4(col, alpha * v_alpha);
}

vec4 brushFirefly(vec2 uv) {
  // Pulsing glow dots drifting around the stamp.
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  const int FLY_COUNT = 4;
  for (int i = 0; i < FLY_COUNT; i++) {
    float fi = float(i);
    float driftPhase = hash11(v_seed * 41.0 + fi) * 6.28;
    vec2 driftAmp = (hash22(vec2(v_seed * 17.0 + fi, v_seed * 19.0 + fi * 1.3)) - 0.5) * 0.6;
    vec2 fPos = driftAmp + vec2(
      sin(v_time * 1.5 + driftPhase) * 0.3,
      cos(v_time * 1.2 + driftPhase * 1.3) * 0.3
    );
    float pulse = 0.4 + 0.6 * (0.5 + 0.5 * sin(v_time * 4.0 + driftPhase));
    float d = length(uv - fPos);
    float fSize = 0.08 + 0.04 * pulse;
    if (d > fSize * 3.0) continue;
    float halo = radialFalloff(d / fSize, 1.5) * pulse;
    float core = radialFalloff(d / (fSize * 0.3), 4.0) * pulse;
    col += mix(v_color, vec3(1.0, 1.0, 0.7), core * 0.8) * (halo + core);
    alpha += (halo + core) * 0.5;
  }
  if (alpha > 0.0) col /= alpha;
  return vec4(col, min(1.0, alpha) * v_alpha);
}

vec4 brushPlasma(vec2 uv) {
  // Animated electric ball with internal noise arcs.
  float d = length(uv);
  if (d > 1.0) return vec4(0.0);
  float radialMask = radialFalloff(d, 2.5);
  float n1 = sin(uv.x * 7.0 + v_time * 2.0) * cos(uv.y * 7.0 + v_time * 1.7);
  float n2 = sin(uv.x * 15.0 - v_time * 2.7) * cos(uv.y * 13.0 + v_time * 3.1);
  float n3 = hash12(uv * 30.0 + vec2(v_time, v_time * 0.7)) - 0.5;
  float arcs = abs(n1 * 0.6 + n2 * 0.3 + n3 * 0.1);
  float arcMask = pow(1.0 - arcs, 4.0) * radialMask;
  float core = radialFalloff(d * 3.0, 4.0);
  vec3 col = mix(v_color, vec3(1.0, 1.0, 1.0), arcMask + core);
  float alpha = (arcMask * 0.8 + radialMask * 0.3 + core * 0.7) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushGalaxy(vec2 uv) {
  // Spiral arms with star density.
  float r = length(uv);
  if (r > 1.0) return vec4(0.0);
  float ang = atan(uv.y, uv.x);
  float spiralArg = ang - log(r + 0.1) * 3.0 + v_time * 0.5;
  float arms = max(0.0, sin(spiralArg * 3.0));
  float coreEnvelope = radialFalloff(r * 2.5, 3.0);
  float armEnvelope = radialFalloff(r * 0.9, 0.6);
  float starsRaw = hash12(uv * 50.0 + vec2(v_seed * 100.0));
  float stars = step(0.97, starsRaw) * (arms * 0.5 + 0.5);
  vec3 col = mix(v_color, vec3(1.0), coreEnvelope * 0.9 + stars);
  float alpha = (arms * armEnvelope * 0.6 + coreEnvelope * 0.7 + stars * 0.9) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushLightning(vec2 uv) {
  // Branching fractal bolts.
  float r = length(uv);
  if (r > 1.0) return vec4(0.0);
  float ang = atan(uv.y, uv.x);
  float spineWobble = sin(r * 8.0 + v_time * 6.0) * 0.5;
  float baseSpine = sin(v_time * 1.7 + v_seed * 6.28) * 1.5;
  float maxBolt = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float spineAng = baseSpine + fi * (6.28 / 4.0);
    float da = ang - spineAng - spineWobble;
    da = mod(da + 3.14159265, 6.28318530718) - 3.14159265;
    float boltShape = exp(-da * da * 80.0);
    float fade = (1.0 - r) * (0.5 + 0.5 * sin(r * 20.0 + v_time * 8.0));
    maxBolt = max(maxBolt, boltShape * fade);
  }
  float core = radialFalloff(r * 6.0, 8.0);
  vec3 col = mix(v_color, vec3(1.0), maxBolt * 0.85 + core * 0.9);
  float alpha = (maxBolt + core * 0.6) * v_alpha;
  return vec4(col, alpha);
}

vec4 brushVortex(vec2 uv) {
  // Swirling spiral with chromatic aberration.
  float r = length(uv);
  if (r > 1.0) return vec4(0.0);
  float ang = atan(uv.y, uv.x);
  float spiralR = ang - log(r + 0.1) * 2.5 + v_time * 1.2;
  float spiralG = spiralR + 0.15;
  float spiralB = spiralR + 0.3;
  float armR = max(0.0, sin(spiralR * 4.0));
  float armG = max(0.0, sin(spiralG * 4.0));
  float armB = max(0.0, sin(spiralB * 4.0));
  float envelope = radialFalloff(r * 1.5, 1.2);
  vec3 perChannel = vec3(armR, armG, armB);
  vec3 col = mix(v_color, vec3(1.0), envelope * 0.4) * (1.0 + perChannel);
  float alpha = ((armR + armG + armB) / 3.0) * envelope * v_alpha;
  return vec4(col, alpha);
}

// ─────────────────────────────────────────────────────────────────
// PHASE 3 — New brushes
// ─────────────────────────────────────────────────────────────────

vec4 brushNebula(vec2 uv) {
  // Volumetric fbm cloud with star sparkles. Noise scale = cloud
  // frequency; noise amount = density contrast; complexity = octave
  // count multiplier (more wisps); glow = outer halo; internal glow
  // = bright hot pockets.
  float r = length(uv);
  if (r > 1.1) return vec4(0.0);
  float t = v_time * 0.3 * v_noiseSpeed;
  vec2 p = uv * 2.0 * v_noiseScale + vec2(t, t * 0.7);
  float cloud = fbm(p);
  // Extra warp pass for that "swirling nebula" feel.
  vec2 warp = vec2(fbm(p + 1.7), fbm(p + 5.3)) - 0.5;
  cloud = fbm(p + warp * v_noiseAmount * 2.0 * v_complexity);
  // Radial envelope so the cloud doesn't bleed past quad bounds.
  float envelope = radialFalloff(r, 1.4);
  float density = clamp(cloud * v_noiseAmount + 0.3, 0.0, 1.0) * envelope;
  // Bright hot pockets.
  float hot = smoothstep(0.55, 0.85, cloud) * v_internalGlow * envelope;
  // Star sparkles.
  float starRaw = hash12(uv * 70.0 + vec2(v_seed * 100.0));
  float stars = step(0.985, starRaw) * envelope;
  // Outer glow halo.
  float halo = radialFalloff(r * 1.3, 0.6) * v_glow * 0.4;
  vec3 col = mix(v_color, vec3(1.0, 1.0, 0.95), hot * 0.7 + stars);
  col += v_color * halo * 0.5;
  float alpha = (density * 0.7 + hot * 0.6 + stars * 1.0 + halo * 0.4) * v_alpha;
  return vec4(col, min(1.0, alpha));
}

vec4 brushKaleido(vec2 uv) {
  // Mirror-symmetric mandala. Complexity controls symmetry (3..12).
  // Noise drives the inner pattern; glow halos the outside; internal
  // glow brightens the core star.
  float r = length(uv);
  if (r > 1.05) return vec4(0.0);
  float sym = clamp(floor(v_complexity * 3.0 + 2.0), 3.0, 12.0);
  vec2 folded = polarFold(uv, sym);
  // Pattern: rotated fbm sampled in the folded coordinate space.
  vec2 p = folded * 3.0 * v_noiseScale + vec2(v_time * 0.4 * v_noiseSpeed);
  float n = fbm(p);
  // Petal shape: radial sin × angular pattern.
  float petalAng = atan(folded.y, folded.x);
  float petals = pow(max(0.0, cos(petalAng * sym * 0.5 + v_time * v_noiseSpeed)), mix(8.0, 2.0, v_softness));
  float pattern = petals * (0.4 + 0.6 * n * v_noiseAmount);
  float core = radialFalloff(r * 3.0, 4.0) * v_internalGlow;
  float halo = radialFalloff(r * 1.2, 0.6) * v_glow * 0.35;
  float envelope = radialFalloff(r, 1.6);
  vec3 col = mix(v_color, vec3(1.0), core * 0.85 + pattern * 0.3);
  col += v_color * halo * 0.4;
  float alpha = (pattern * envelope * 0.85 + core * 0.7 + halo * 0.4) * v_alpha;
  return vec4(col, min(1.0, alpha));
}

vec4 brushInk(vec2 uv) {
  // Inky bloom: irregular soft disc edge with radiating fibres and
  // a few darker concentration pockets. Noise drives edge roughness;
  // glow widens outer bleed; internal glow brightens the dark core
  // (counter-intuitive but useful for "wet ink" highlight).
  float r = length(uv);
  if (r > 1.1) return vec4(0.0);
  float ang = atan(uv.y, uv.x);
  // Wobbly edge.
  float edge = 0.7 + 0.25 * fbm(vec2(ang * 4.0, r * 5.0) * v_noiseScale + v_seed * 10.0);
  float bleed = 1.0 - smoothstep(edge - 0.15 - v_glow * 0.05, edge + 0.1, r);
  // Inner density: concentration pockets driven by fbm so the ink
  // looks "wet" rather than uniform.
  float pockets = fbm(uv * 4.0 * v_noiseScale + vec2(v_seed));
  float inner = smoothstep(0.0, edge, edge - r) * (0.55 + 0.45 * pockets * v_noiseAmount);
  // Radiating fibres (the "feathered" ink streaks at edges).
  float fibres = 0.0;
  int fibreCount = int(clamp(6.0 + v_complexity * 6.0, 4.0, 14.0));
  for (int i = 0; i < 14; i++) {
    if (i >= fibreCount) break;
    float fi = float(i);
    float fa = (fi / float(fibreCount)) * 6.28318530718 + hash11(v_seed * 41.0 + fi) * 0.5;
    float da = ang - fa;
    da = mod(da + 3.14159265, 6.28318530718) - 3.14159265;
    float beam = exp(-da * da * 200.0);
    float reach = 0.85 + 0.25 * hash11(v_seed * 53.0 + fi);
    float within = smoothstep(reach + 0.1, edge, r);
    fibres = max(fibres, beam * within);
  }
  float core = radialFalloff(r * 4.0, 6.0) * v_internalGlow * 0.6;
  vec3 col = mix(v_color, vec3(1.0), core);
  float alpha = (bleed * 0.5 + inner * 0.9 + fibres * 0.7 + core * 0.4) * v_alpha;
  return vec4(col, min(1.0, alpha));
}

vec4 brushCrystal(vec2 uv) {
  // Faceted gem appearance via discrete polar wedges + edge highlights.
  // Complexity = facet count; noise = facet color variation; internal
  // glow = bright glints at facet edges; glow = halo around crystal.
  float r = length(uv);
  if (r > 1.05) return vec4(0.0);
  float ang = atan(uv.y, uv.x);
  float facets = clamp(floor(v_complexity * 3.0 + 3.0), 4.0, 16.0);
  float wedge = 6.28318530718 / facets;
  float wedgeIdx = floor((ang + 3.14159265) / wedge);
  float wedgeAng = (wedgeIdx + 0.5) * wedge - 3.14159265;
  // Distance from current pixel to the wedge centerline (in radians).
  float da = abs(ang - wedgeAng);
  da = min(da, abs(ang - wedgeAng - 6.28318530718));
  da = min(da, abs(ang - wedgeAng + 6.28318530718));
  // Per-facet brightness variation.
  float facetVal = hash11(wedgeIdx * 1.3 + v_seed * 7.0);
  float facetShade = mix(0.55, 1.0, facetVal);
  // Edge highlights at the seams between facets.
  float edgeGlint = smoothstep(wedge * 0.5, wedge * 0.5 - 0.05, da) * v_internalGlow;
  // Animated highlight that "rotates" around the crystal.
  float rotHighlight = 0.5 + 0.5 * sin(ang * facets + v_time * 2.0 * v_noiseSpeed);
  rotHighlight = pow(rotHighlight, 8.0) * 0.6;
  // Slight outward fade.
  float envelope = 1.0 - smoothstep(0.85, 1.0, r);
  // Inner core glow.
  float core = radialFalloff(r * 3.0, 4.0) * v_internalGlow * 0.5;
  // Outer halo.
  float halo = radialFalloff(r * 1.2, 0.7) * v_glow * 0.3;
  vec3 col = v_color * facetShade + vec3(1.0) * (edgeGlint + rotHighlight + core);
  col += v_color * halo * 0.4;
  float alpha = (envelope * 0.85 + edgeGlint * 0.5 + rotHighlight * 0.4 + halo * 0.4) * v_alpha;
  return vec4(col, min(1.0, alpha));
}

vec4 brushAurora(vec2 uv) {
  // Flowing curtain — vertical bands shifted by fbm in X with
  // brightness pulses traveling left→right. Noise drives ripple
  // frequency and amount. Internal glow brightens the curtain core;
  // glow halos the edges.
  float r = length(uv);
  if (r > 1.1) return vec4(0.0);
  float t = v_time * v_noiseSpeed;
  // Horizontal ripple — vertical band centerline wobbles in X.
  float ripple = fbm(vec2(uv.y * 3.0 * v_noiseScale, t * 0.5)) - 0.5;
  float bandX = uv.x - ripple * v_noiseAmount * 1.5;
  // Vertical curtain shape (taller than wide).
  float curtainWidth = mix(0.18, 0.5, v_softness);
  float curtain = exp(-bandX * bandX / (curtainWidth * curtainWidth));
  // Brightness bands traveling along the curtain.
  float bands = 0.5 + 0.5 * sin(uv.y * 4.0 * v_noiseScale + t * 2.0);
  // Secondary curtain for depth.
  float bandX2 = uv.x - ripple * v_noiseAmount * 1.5 - 0.35;
  float curtain2 = exp(-bandX2 * bandX2 / (curtainWidth * 0.6 * curtainWidth * 0.6)) * 0.5;
  float curtainTotal = max(curtain, curtain2);
  // Vertical fade so the curtain "hangs" — brighter at top.
  float vFade = 1.0 - smoothstep(0.3, 1.0, uv.y);
  // Outer envelope.
  float envelope = 1.0 - smoothstep(0.9, 1.05, r);
  // Color shift across vertical so it goes from main color → bright top.
  vec3 col = mix(v_color * 0.7, vec3(1.0), curtainTotal * bands * v_internalGlow);
  // Halo.
  float halo = curtainTotal * v_glow * 0.3 * envelope;
  col += v_color * halo;
  float alpha = (curtainTotal * (0.4 + 0.6 * bands) * vFade * envelope + halo * 0.4) * v_alpha;
  return vec4(col, min(1.0, alpha));
}

vec4 brushBubbles(vec2 uv) {
  // Cluster of bubbles that float upward through the stamp and fade
  // out near the top — like effervescence rising through liquid.
  //
  // Each bubble has its own life cycle (0..1, looping). At life=0 it
  // spawns near the bottom of the stamp with a random horizontal
  // offset; over the cycle it drifts upward (negative-Y in our UV
  // space — see the y-flip note in the vertex shader header), with
  // small sideways wobble; near the end of the cycle it fades to 0.
  //
  // Cycle period scales with noiseSpeed; horizontal wobble amount
  // scales with noiseAmount. Particle size = per-bubble radius.
  // Complexity = bubble count (3..14). Internal glow brightens rim
  // and refractive highlight; glow adds an outer halo.
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  int count = int(clamp(4.0 + v_complexity * 5.0, 3.0, 14.0));
  float bubR = 0.15 * v_particleSize;
  float t = v_time * 0.35 * max(0.1, v_noiseSpeed);
  for (int i = 0; i < 14; i++) {
    if (i >= count) break;
    float fi = float(i);
    // Per-bubble phase + cycle position. Each bubble has its own
    // start offset so they don't all spawn at the same time.
    float phaseOff = hash11(v_seed * 41.0 + fi);
    float speedJ = 0.7 + 0.6 * hash11(v_seed * 59.0 + fi);    // some bubbles rise faster
    float life = fract(t * speedJ + phaseOff);                  // 0..1, loops
    // Horizontal start position (-0.9..0.9), unique per bubble + seed.
    float startX = (hash11(v_seed * 13.7 + fi) - 0.5) * 1.8;
    // Sideways wobble grows with life so the path looks gentle.
    float wobbleFreq = 2.0 + 3.0 * hash11(v_seed * 29.0 + fi);
    float wobble = sin(life * 6.28 * wobbleFreq + phaseOff * 6.28)
                 * 0.18 * v_noiseAmount * life;
    float cx = startX + wobble;
    // Floating: y goes from +1 (bottom of stamp in v_uv space) up to
    // -1 (top). Total travel = 2.0 over life=0..1.
    float cy = 0.9 - life * 1.9;
    vec2 c = vec2(cx, cy);
    // Per-bubble radius variation.
    float br = bubR * (0.65 + 0.7 * hash11(v_seed * 31.0 + fi));
    // Fade in quickly at the start, hold, then fade out near the top.
    float fadeIn  = smoothstep(0.0, 0.12, life);
    float fadeOut = 1.0 - smoothstep(0.7, 1.0, life);
    float lifeAlpha = fadeIn * fadeOut;
    float d = length(uv - c);
    if (d > br * (1.3 + v_glow * 0.3)) continue;
    // Shell: bright ring near d == br.
    float rim = exp(-pow((d - br * 0.85) / max(br * 0.10, 0.001), 2.0)) * v_internalGlow;
    // Faint interior so bubbles aren't completely hollow.
    float inner = (1.0 - smoothstep(0.0, br, d)) * 0.12;
    // Refractive highlight (upper-left-ish).
    vec2 hlOff = c + vec2(-br * 0.35, -br * 0.35);
    float hl = exp(-pow(length(uv - hlOff) / max(br * 0.22, 0.001), 2.0))
             * 0.8 * v_internalGlow;
    // Outer halo for glow param.
    float halo = smoothstep(br * 1.3, br * 1.0, d) * v_glow * 0.3;
    vec3 bubbleCol = v_color * (0.55 + 0.45 * rim) + vec3(1.0) * (hl + rim * 0.5);
    float bubA = (rim + inner + hl + halo * 0.5) * lifeAlpha;
    col += bubbleCol * bubA;
    alpha = max(alpha, bubA);
  }
  if (alpha > 0.0) col /= max(alpha, 0.001);
  return vec4(col, min(1.0, alpha) * v_alpha);
}

void main() {
  // Independent if statements (no else cascade) — some drivers fail
  // to honor long else-if chains; some fail to honor switch with
  // many cases. Independent if-tests compile to a series of
  // conditional moves which every driver handles reliably.
  vec4 c = vec4(0.0);
  if (u_brushType == 0)  c = brushGlow(v_uv);
  if (u_brushType == 1)  c = brushNeon(v_uv);
  if (u_brushType == 2)  c = brushLaser(v_uv);
  if (u_brushType == 3)  c = brushCalligraphy(v_uv);
  if (u_brushType == 4)  c = brushMarker(v_uv);
  if (u_brushType == 5)  c = brushFlame(v_uv);
  if (u_brushType == 6)  c = brushElectric(v_uv);
  if (u_brushType == 7)  c = brushRibbon(v_uv);
  if (u_brushType == 8)  c = brushParticle(v_uv);
  if (u_brushType == 9)  c = brushSmoke(v_uv);
  if (u_brushType == 10) c = brushSpray(v_uv);
  if (u_brushType == 11) c = brushPaintbrush(v_uv);
  if (u_brushType == 12) c = brushWatercolor(v_uv);
  if (u_brushType == 13) c = brushSparkle(v_uv);
  if (u_brushType == 14) c = brushFirefly(v_uv);
  if (u_brushType == 15) c = brushPlasma(v_uv);
  if (u_brushType == 16) c = brushGalaxy(v_uv);
  if (u_brushType == 17) c = brushLightning(v_uv);
  if (u_brushType == 18) c = brushVortex(v_uv);
  if (u_brushType == 19) c = brushNebula(v_uv);
  if (u_brushType == 20) c = brushKaleido(v_uv);
  if (u_brushType == 21) c = brushInk(v_uv);
  if (u_brushType == 22) c = brushCrystal(v_uv);
  if (u_brushType == 23) c = brushAurora(v_uv);
  if (u_brushType == 24) c = brushBubbles(v_uv);

  if (c.a < 0.001) discard;
  // Output premultiplied alpha for clean additive-over compositing.
  outColor = vec4(c.rgb * c.a, c.a);
}
`,So=`#version 300 es
// Pin a_pos to location 0 — same reasoning as the stamp vertex
// shader. The composite pass uses enableVertexAttribArray(0).
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`,nc=`#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_tex;
uniform vec2  u_offsetPx;       // UV-space sample offset (translate output)
uniform float u_alpha;
uniform vec3  u_tint;
uniform float u_useHueShift;
uniform float u_hueShift;
// Output zoom/scale around UV center (0.5, 0.5). 1.0 = identity,
// > 1 = output appears larger (zoom in), < 1 = output appears smaller.
// Used by the breathe effect.
uniform float u_outputScale;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  // Apply output scale around UV center 0.5. Sampling UV is the
  // INVERSE of the output scale: if we want the output to appear 2×
  // larger, we sample the inner half of the source.
  float invScale = u_outputScale > 0.0 ? 1.0 / u_outputScale : 1.0;
  vec2 sampleUV = (v_uv - 0.5) * invScale + 0.5 - u_offsetPx;
  // Clamp behavior — sample 0 outside the source rectangle.
  if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
    outColor = vec4(0.0);
    return;
  }
  vec4 col = texture(u_tex, sampleUV);
  if (u_useHueShift > 0.5 && col.a > 0.001) {
    vec3 rgb = col.rgb / col.a;
    vec3 hsv = rgb2hsv(rgb);
    hsv.x = fract(hsv.x + u_hueShift / 6.28318530718);
    rgb = hsv2rgb(hsv);
    col.rgb = rgb * col.a;
  }
  col.rgb *= u_tint;
  col.a *= u_alpha;
  col.rgb *= u_alpha;
  outColor = col;
}
`,lc=`#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_tex;        // the rendered light painting
uniform float u_amount;         // sparkle slider value (0..1)
uniform float u_time;           // animation seconds (drives randomness)

// Hash function — good enough sub-pixel noise.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 src = texture(u_tex, v_uv);
  // Only sparkle where the trail is actually painted.
  if (src.a < 0.05) discard;
  // Per-pixel per-frame noise, quantized to mostly-empty so only a
  // few pixels per region light up at once (= stars, not a fog).
  // Higher u_amount lowers the threshold = more sparkles.
  float noise = hash12(v_uv * 1500.0 + vec2(u_time * 60.0));
  float threshold = mix(0.998, 0.95, u_amount);  // 0.5%..5% of pixels
  if (noise < threshold) discard;
  // Bright sparkle, tinted slightly toward the source color so it
  // doesn't read as "alien white dots" but as bright sparkles of the
  // stroke's hue.
  vec3 rgb = src.rgb;
  if (src.a > 0.001) rgb = src.rgb / src.a;     // unpremultiply
  vec3 col = mix(rgb, vec3(1.0), 0.7);
  float a = u_amount * 0.9;
  outColor = vec4(col * a, a);
}
`,cc=`#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_tex;
uniform vec2  u_texelSize;     // 1.0 / textureWidth, 1.0 / textureHeight
uniform vec2  u_direction;     // (1, 0) for horizontal pass, (0, 1) for vertical
uniform float u_radius;        // tap spacing in pixels (controls blur width)

void main() {
  // Gaussian weights for sigma = 4 (so taps at ±4 are still significant).
  const float w0 = 0.227027;   // center
  const float w1 = 0.1945946;  // ±1
  const float w2 = 0.1216216;  // ±2
  const float w3 = 0.054054;   // ±3
  const float w4 = 0.016216;   // ±4
  vec2 step = u_direction * u_texelSize * u_radius;
  vec4 sum = texture(u_tex, v_uv) * w0;
  sum += texture(u_tex, v_uv + step * 1.0) * w1;
  sum += texture(u_tex, v_uv - step * 1.0) * w1;
  sum += texture(u_tex, v_uv + step * 2.0) * w2;
  sum += texture(u_tex, v_uv - step * 2.0) * w2;
  sum += texture(u_tex, v_uv + step * 3.0) * w3;
  sum += texture(u_tex, v_uv - step * 3.0) * w3;
  sum += texture(u_tex, v_uv + step * 4.0) * w4;
  sum += texture(u_tex, v_uv - step * 4.0) * w4;
  outColor = sum;
}
`,uc=`#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2  a_corner;    // unit quad corner (-1..+1, -1..+1)
layout(location = 1) in vec2  i_endA;      // segment start in canvas px
layout(location = 2) in vec2  i_endB;      // segment end in canvas px
layout(location = 3) in float i_alpha;     // per-segment alpha (taper-modulated avg)

uniform vec2  u_resolution;
uniform float u_halfWidth;                 // overlay half-width in pixels

out vec2  v_pixel;
out vec2  v_endA;
out vec2  v_endB;
out float v_alpha;

void main() {
  // Build a segment-aligned bounding rectangle that fully contains
  // the segment plus a halfWidth margin on every side (so endpoint
  // round caps and side soft-edges have room to render).
  vec2 ab = i_endB - i_endA;
  float segLen = length(ab);
  vec2 t = segLen > 0.0001 ? ab / segLen : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);

  vec2 center = (i_endA + i_endB) * 0.5;
  float halfLen = segLen * 0.5 + u_halfWidth;
  vec2 worldPos = center + t * (a_corner.x * halfLen) + n * (a_corner.y * u_halfWidth);

  vec2 ndc = (worldPos / u_resolution) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);

  v_pixel = worldPos;
  v_endA  = i_endA;
  v_endB  = i_endB;
  v_alpha = i_alpha;
}
`,dc=`#version 300 es
precision highp float;
precision highp int;

in vec2  v_pixel;
in vec2  v_endA;
in vec2  v_endB;
in float v_alpha;

uniform vec3  u_color;          // brush color (0..1)
uniform float u_intensity;      // overlay brightness multiplier (0..1)
uniform float u_halfWidth;      // half-width in pixels (matches vertex shader)
uniform float u_softness;       // brush.softness — controls edge feathering

out vec4 outColor;

void main() {
  // Standard distance-to-segment: project pixel onto segment, clamp
  // to [0, 1] for round caps at endpoints, distance from projection
  // is the segment distance.
  vec2 ab = v_endB - v_endA;
  float lenSq = dot(ab, ab);
  float t = lenSq > 0.0001
    ? clamp(dot(v_pixel - v_endA, ab) / lenSq, 0.0, 1.0)
    : 0.0;
  vec2 closest = v_endA + t * ab;
  float dist = length(v_pixel - closest);

  if (dist > u_halfWidth) discard;

  // Cross-section brightness profile. Edge feathering scales with
  // softness: at softness=0 the bright line has crisp edges
  // (smoothstep 0.7..1.0), at softness=1 the line is fully feathered
  // (smoothstep 0.0..1.0) so it dissolves smoothly into the halo.
  float d = dist / u_halfWidth;
  float edgeStart = mix(0.7, 0.0, u_softness);
  float coreShape = 1.0 - smoothstep(edgeStart, 1.0, d);
  float a = coreShape * u_intensity * v_alpha;
  if (a < 0.001) discard;

  // White-tinted bright line — mimics Canvas2D's stroke + shadow combo.
  vec3 col = mix(u_color, vec3(1.0), 0.7);
  // Premultiplied output. Renderer uses gl.ONE/gl.ONE additive blend
  // for this pass so contributions from overlapping segments build up.
  outColor = vec4(col * a, a);
}
`,os=new Set(["spiral","firefly","sap-flow","water","smoke","galaxy","nebula","sparkle","vortex","plasma"]),fc={glow:0,neon:1,laser:2,calligraphy:3,marker:4,flame:5,electric:6,ribbon:7,particle:8,smoke:9,spray:10,paintbrush:11,watercolor:12,sparkle:13,firefly:14,plasma:15,galaxy:16,lightning:17,vortex:18,nebula:19,kaleido:20,ink:21,crystal:22,aurora:23,bubbles:24,spiral:-1,"sap-flow":-1,water:-1},pc={glow:!1,neon:!1,laser:!1,calligraphy:!0,marker:!0,paintbrush:!0,flame:!1,electric:!1,ribbon:!1,particle:!1,smoke:!1,spray:!1,watercolor:!1,sparkle:!1,firefly:!1,plasma:!1,galaxy:!1,lightning:!1,vortex:!1,nebula:!1,kaleido:!1,ink:!1,crystal:!1,aurora:!1,bubbles:!1,spiral:!1,"sap-flow":!1,water:!1},hc={glow:2.5,neon:2.5,laser:4,calligraphy:1.1,marker:1.05,paintbrush:1.05,flame:1.4,electric:1.5,ribbon:1.2,particle:1.5,smoke:1.5,spray:1.05,watercolor:1.3,sparkle:1.4,firefly:1.4,plasma:1.3,galaxy:1.3,lightning:1.3,vortex:1.3,nebula:2.2,kaleido:1.9,ink:1.9,crystal:1.8,aurora:2.2,bubbles:2,spiral:1,"sap-flow":1,water:1},mc={glow:!1,neon:!1,laser:!1,calligraphy:!1,marker:!1,paintbrush:!1,smoke:!1,spray:!1,watercolor:!1,flame:!0,electric:!0,ribbon:!0,particle:!0,sparkle:!0,firefly:!0,plasma:!0,galaxy:!0,lightning:!0,vortex:!0,nebula:!0,kaleido:!0,ink:!0,crystal:!0,aurora:!0,bubbles:!0,spiral:!1,"sap-flow":!1,water:!1},Ui=19,vc=Ui*4;function rs(i,e,t,a,o,r,s){const n=i.points;if(n.length===0)return[];const l=i.brush,u=n.length,f=o>0?Math.max(0,a-o):0,h=l.type==="calligraphy"||l.type==="paintbrush"||l.type==="marker"||l.type==="ribbon"?.04:.08,m=Math.max(1,Math.ceil(l.size*h)),b=[];let M=0;for(let C=f;C<a;C++){if(!((C-f)%m===0||C===a-1))continue;const I=n[C],W=I.x*e,G=I.y*t,O=u>1?C/(u-1):0;let L=1;if(l.taper){const j=Math.min(1,O*5),Ae=Math.min(1,(1-O)*5);L=j*Ae}const N=l.pressureSensitive?I.pressure:1,ce=Math.max(1,l.size*N*L),ae=Math.max(0,Math.min(1,l.opacity*L*s));let se=1;o>0&&o<u&&(se=(C-f)/Math.max(1,o-1));let te=W,Q=G;if(l.jitter>0){const j=Math.sin(C*12.9898)*43758.5453,Ae=Math.sin(C*78.233)*43758.5453;te+=(j-Math.floor(j)-.5)*l.jitter*l.size*2,Q+=(Ae-Math.floor(Ae)-.5)*l.jitter*l.size*2}let $=0;if(C>0){const j=n[C-1];$=Math.atan2(G-j.y*t,W-j.x*e)}else if(C<u-1){const j=n[C+1];$=Math.atan2(j.y*t-G,j.x*e-W)}b.push({x:te,y:Q,size:ce,angle:$,pressure:N,progress:O,alpha:ae*se,seed:M*.137+C*.013,time:r*(l.speed??1)}),M++}return b}function ss(i,e,t){const a=i.createShader(e);if(i.shaderSource(a,t),i.compileShader(a),!i.getShaderParameter(a,i.COMPILE_STATUS)){const o=i.getShaderInfoLog(a);throw i.deleteShader(a),new Error(`Shader compile failed: ${o}

Source:
${t}`)}return a}function Va(i,e,t){const a=ss(i,i.VERTEX_SHADER,e),o=ss(i,i.FRAGMENT_SHADER,t),r=i.createProgram();if(i.attachShader(r,a),i.attachShader(r,o),i.linkProgram(r),!i.getProgramParameter(r,i.LINK_STATUS)){const s=i.getProgramInfoLog(r);throw i.deleteProgram(r),new Error(`Program link failed: ${s}`)}return i.deleteShader(a),i.deleteShader(o),r}function oa(i,e,t){const a=i.createTexture();i.bindTexture(i.TEXTURE_2D,a),i.texImage2D(i.TEXTURE_2D,0,i.RGBA,e,t,0,i.RGBA,i.UNSIGNED_BYTE,null),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAG_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE);const o=i.createFramebuffer();i.bindFramebuffer(i.FRAMEBUFFER,o),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,a,0);const r=i.checkFramebufferStatus(i.FRAMEBUFFER);if(r!==i.FRAMEBUFFER_COMPLETE)throw new Error(`Framebuffer incomplete: 0x${r.toString(16)}`);return i.bindFramebuffer(i.FRAMEBUFFER,null),{tex:a,fb:o}}const gc=(()=>{const i=new Date;return i.setHours(0,0,0,0),i.getTime()})();class yc{canvas;gl;texture;width;height;stampProgram;compositeProgram;stripProgram;blurProgram;sparkleProgram;stampUniforms;compositeUniforms;sparkleUniforms;stripUniforms;blurUniforms;stripBuffer;cornerBuffer;instanceBuffer;fullscreenBuffer;committedRT;currentRT;workRT;finalRT;persistRT;bloomRT_A;bloomRT_B;bloomW=0;bloomH=0;bakedHashes=new Map;bakedOrder=[];animationTime=0;perfStampCount=0;perfDrawCalls=0;perfLastRenderMs=0;loggedBrushTypes=new Set;constructor(e,t){this.width=e,this.height=t,this.canvas=document.createElement("canvas"),this.canvas.width=e,this.canvas.height=t;const a=this.canvas.getContext("webgl2",{premultipliedAlpha:!0,alpha:!0,antialias:!1,preserveDrawingBuffer:!1});if(!a)throw new Error("WebGL2 unavailable");this.gl=a,this.stampProgram=Va(a,rc,sc),this.compositeProgram=Va(a,So,nc),this.stripProgram=Va(a,uc,dc),this.blurProgram=Va(a,So,cc),this.sparkleProgram=Va(a,So,lc),this.stampUniforms={resolution:a.getUniformLocation(this.stampProgram,"u_resolution"),brushType:a.getUniformLocation(this.stampProgram,"u_brushType"),useAngle:a.getUniformLocation(this.stampProgram,"u_useAngle"),extentScale:a.getUniformLocation(this.stampProgram,"u_extentScale")},this.stripUniforms={resolution:a.getUniformLocation(this.stripProgram,"u_resolution"),halfWidth:a.getUniformLocation(this.stripProgram,"u_halfWidth"),color:a.getUniformLocation(this.stripProgram,"u_color"),intensity:a.getUniformLocation(this.stripProgram,"u_intensity"),softness:a.getUniformLocation(this.stripProgram,"u_softness")},this.blurUniforms={tex:a.getUniformLocation(this.blurProgram,"u_tex"),texelSize:a.getUniformLocation(this.blurProgram,"u_texelSize"),direction:a.getUniformLocation(this.blurProgram,"u_direction"),radius:a.getUniformLocation(this.blurProgram,"u_radius")},this.stripBuffer=a.createBuffer(),a.bindBuffer(a.ARRAY_BUFFER,this.stripBuffer),a.bufferData(a.ARRAY_BUFFER,1e4*6*4,a.DYNAMIC_DRAW),this.compositeUniforms={tex:a.getUniformLocation(this.compositeProgram,"u_tex"),offsetPx:a.getUniformLocation(this.compositeProgram,"u_offsetPx"),alpha:a.getUniformLocation(this.compositeProgram,"u_alpha"),tint:a.getUniformLocation(this.compositeProgram,"u_tint"),useHueShift:a.getUniformLocation(this.compositeProgram,"u_useHueShift"),hueShift:a.getUniformLocation(this.compositeProgram,"u_hueShift"),outputScale:a.getUniformLocation(this.compositeProgram,"u_outputScale")},this.sparkleUniforms={tex:a.getUniformLocation(this.sparkleProgram,"u_tex"),amount:a.getUniformLocation(this.sparkleProgram,"u_amount"),time:a.getUniformLocation(this.sparkleProgram,"u_time")},this.cornerBuffer=a.createBuffer(),a.bindBuffer(a.ARRAY_BUFFER,this.cornerBuffer),a.bufferData(a.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),a.STATIC_DRAW),this.instanceBuffer=a.createBuffer(),a.bindBuffer(a.ARRAY_BUFFER,this.instanceBuffer),a.bufferData(a.ARRAY_BUFFER,5e3*vc,a.DYNAMIC_DRAW),this.fullscreenBuffer=a.createBuffer(),a.bindBuffer(a.ARRAY_BUFFER,this.fullscreenBuffer),a.bufferData(a.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),a.STATIC_DRAW),this.allocateRenderTargets(e,t),this.texture=new Zt(this.canvas),this.texture.minFilter=le,this.texture.magFilter=le,this.texture.format=qe,a.enable(a.BLEND),a.blendFuncSeparate(a.ONE,a.ONE_MINUS_SRC_ALPHA,a.ONE,a.ONE_MINUS_SRC_ALPHA);const o=a.getExtension("WEBGL_debug_renderer_info"),r=o?a.getParameter(o.UNMASKED_RENDERER_WEBGL):"unknown";console.log(`[LightPaintingWebGL] initialised — ${e}×${t} — GPU: ${r}`)}allocateRenderTargets(e,t){const a=this.gl;this.committedRT&&(a.deleteTexture(this.committedRT.tex),a.deleteFramebuffer(this.committedRT.fb)),this.currentRT&&(a.deleteTexture(this.currentRT.tex),a.deleteFramebuffer(this.currentRT.fb)),this.workRT&&(a.deleteTexture(this.workRT.tex),a.deleteFramebuffer(this.workRT.fb)),this.finalRT&&(a.deleteTexture(this.finalRT.tex),a.deleteFramebuffer(this.finalRT.fb)),this.persistRT&&(a.deleteTexture(this.persistRT.tex),a.deleteFramebuffer(this.persistRT.fb)),this.bloomRT_A&&(a.deleteTexture(this.bloomRT_A.tex),a.deleteFramebuffer(this.bloomRT_A.fb)),this.bloomRT_B&&(a.deleteTexture(this.bloomRT_B.tex),a.deleteFramebuffer(this.bloomRT_B.fb)),this.committedRT=oa(a,e,t),this.currentRT=oa(a,e,t),this.workRT=oa(a,e,t),this.finalRT=oa(a,e,t),this.persistRT=oa(a,e,t),this.bloomW=Math.max(64,Math.floor(e/4)),this.bloomH=Math.max(64,Math.floor(t/4)),this.bloomRT_A=oa(a,this.bloomW,this.bloomH),this.bloomRT_B=oa(a,this.bloomW,this.bloomH),this.bakedHashes.clear(),this.bakedOrder=[]}getCanvas(){return this.canvas}resize(e,t){this.width===e&&this.height===t||(this.width=e,this.height=t,this.canvas.width=e,this.canvas.height=t,this.allocateRenderTargets(e,t))}hashStroke(e){const t=e.brush,a=t.color;return[e.points.length,t.type,t.size,`${a[0]},${a[1]},${a[2]}`,t.opacity,t.glow,t.softness,t.jitter,t.taper?1:0,t.pressureSensitive?1:0,t.speed,t.particleSize??1,t.internalGlow??1,t.noiseScale??1,t.noiseSpeed??1,t.noiseAmount??.6,t.complexity??1,e.visible?1:0].join("|")}drawStampBatch(e,t){if(e.length===0)return;const a=this.gl,o=new Float32Array(e.length*Ui),[r,s,n]=t.color,l=r/255,u=s/255,f=n/255,d=t.particleSize??1,h=t.internalGlow??1,m=t.noiseScale??1,b=t.noiseSpeed??1,M=t.noiseAmount??.6,C=t.complexity??1;for(let G=0;G<e.length;G++){const O=e[G],L=G*Ui;o[L+0]=O.x,o[L+1]=O.y,o[L+2]=O.size,o[L+3]=O.angle,o[L+4]=l,o[L+5]=u,o[L+6]=f,o[L+7]=O.alpha,o[L+8]=t.glow,o[L+9]=t.softness,o[L+10]=O.seed,o[L+11]=O.time,o[L+12]=O.progress,o[L+13]=d,o[L+14]=h,o[L+15]=C,o[L+16]=m,o[L+17]=b,o[L+18]=M}a.bindBuffer(a.ARRAY_BUFFER,this.instanceBuffer),a.bufferData(a.ARRAY_BUFFER,o,a.DYNAMIC_DRAW),a.useProgram(this.stampProgram),a.uniform2f(this.stampUniforms.resolution,this.width,this.height);const T=fc[t.type];a.uniform1i(this.stampUniforms.brushType,T),a.uniform1f(this.stampUniforms.useAngle,pc[t.type]?1:0);let I=hc[t.type];(t.type==="glow"||t.type==="neon"||t.type==="laser")&&(I=1+t.glow*2),a.uniform1f(this.stampUniforms.extentScale,I),this.loggedBrushTypes.has(t.type)||(this.loggedBrushTypes.add(t.type),console.log(`[LightPaintingWebGL] first stamp — brush.type="${t.type}" → u_brushType=${T} (samples=${e.length})`)),a.bindBuffer(a.ARRAY_BUFFER,this.cornerBuffer),a.enableVertexAttribArray(0),a.vertexAttribPointer(0,2,a.FLOAT,!1,0,0),a.vertexAttribDivisor(0,0),a.bindBuffer(a.ARRAY_BUFFER,this.instanceBuffer);const W=[[1,2,0],[2,1,2],[3,1,3],[4,3,4],[5,1,7],[6,1,8],[7,1,9],[8,1,10],[9,1,11],[10,1,12],[11,3,13],[12,3,16]];for(const[G,O,L]of W)a.enableVertexAttribArray(G),a.vertexAttribPointer(G,O,a.FLOAT,!1,Ui*4,L*4),a.vertexAttribDivisor(G,1);a.drawArraysInstanced(a.TRIANGLE_STRIP,0,4,e.length),this.perfStampCount+=e.length,this.perfDrawCalls++}drawStripBatch(e,t){if(e.length<2)return;const a=this.gl,o=5,r=e.length-1,s=new Float32Array(r*o);for(let b=0;b<r;b++){const M=e[b],C=e[b+1],T=b*o;s[T+0]=M.x,s[T+1]=M.y,s[T+2]=C.x,s[T+3]=C.y,s[T+4]=(M.alpha+C.alpha)*.5}a.bindBuffer(a.ARRAY_BUFFER,this.stripBuffer),a.bufferData(a.ARRAY_BUFFER,s,a.DYNAMIC_DRAW),a.useProgram(this.stripProgram),a.uniform2f(this.stripUniforms.resolution,this.width,this.height);const n=t.size*(.125+t.softness*.375);a.uniform1f(this.stripUniforms.halfWidth,n);const[l,u,f]=t.color;a.uniform3f(this.stripUniforms.color,l/255,u/255,f/255);const h=(t.type==="laser"?.55:t.type==="neon"?.45:.4)*(1-t.softness*.3);a.uniform1f(this.stripUniforms.intensity,h),a.uniform1f(this.stripUniforms.softness,t.softness),a.blendFuncSeparate(a.ONE,a.ONE,a.ONE,a.ONE),a.bindBuffer(a.ARRAY_BUFFER,this.cornerBuffer),a.enableVertexAttribArray(0),a.vertexAttribPointer(0,2,a.FLOAT,!1,0,0),a.vertexAttribDivisor(0,0);const m=o*4;a.bindBuffer(a.ARRAY_BUFFER,this.stripBuffer),a.enableVertexAttribArray(1),a.vertexAttribPointer(1,2,a.FLOAT,!1,m,0),a.vertexAttribDivisor(1,1),a.enableVertexAttribArray(2),a.vertexAttribPointer(2,2,a.FLOAT,!1,m,8),a.vertexAttribDivisor(2,1),a.enableVertexAttribArray(3),a.vertexAttribPointer(3,1,a.FLOAT,!1,m,16),a.vertexAttribDivisor(3,1),a.drawArraysInstanced(a.TRIANGLE_STRIP,0,4,r),a.blendFuncSeparate(a.ONE,a.ONE_MINUS_SRC_ALPHA,a.ONE,a.ONE_MINUS_SRC_ALPHA),a.vertexAttribDivisor(1,0),a.vertexAttribDivisor(2,0),a.vertexAttribDivisor(3,0),this.perfStampCount+=r,this.perfDrawCalls++}composite(e){const t=this.gl;t.useProgram(this.compositeProgram);const a=(e.offsetPx?.[0]??0)/this.width,o=(e.offsetPx?.[1]??0)/this.height;t.uniform2f(this.compositeUniforms.offsetPx,a,o),t.uniform1f(this.compositeUniforms.alpha,e.alpha??1);const r=e.tint??[1,1,1];t.uniform3f(this.compositeUniforms.tint,r[0],r[1],r[2]),t.uniform1f(this.compositeUniforms.useHueShift,e.hueShift!==void 0?1:0),t.uniform1f(this.compositeUniforms.hueShift,e.hueShift??0),t.uniform1f(this.compositeUniforms.outputScale,e.outputScale??1),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,e.sourceTex),t.uniform1i(this.compositeUniforms.tex,0),t.bindBuffer(t.ARRAY_BUFFER,this.fullscreenBuffer),t.enableVertexAttribArray(0),t.vertexAttribPointer(0,2,t.FLOAT,!1,0,0),t.vertexAttribDivisor(0,0),t.drawArrays(t.TRIANGLES,0,6),this.perfDrawCalls++}drawSparkle(e,t,a){const o=this.gl;o.useProgram(this.sparkleProgram),o.uniform1f(this.sparkleUniforms.amount,t),o.uniform1f(this.sparkleUniforms.time,a),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,e),o.uniform1i(this.sparkleUniforms.tex,0),o.bindBuffer(o.ARRAY_BUFFER,this.fullscreenBuffer),o.enableVertexAttribArray(0),o.vertexAttribPointer(0,2,o.FLOAT,!1,0,0),o.vertexAttribDivisor(0,0),o.drawArrays(o.TRIANGLES,0,6),this.perfDrawCalls++}clearTarget(e,t,a,o,r){const s=this.gl;s.bindFramebuffer(s.FRAMEBUFFER,e.fb),s.viewport(0,0,this.width,this.height),s.clearColor(t,a,o,r),s.clear(s.COLOR_BUFFER_BIT)}gaussianBlur(e,t){const a=this.gl;a.bindFramebuffer(a.FRAMEBUFFER,this.bloomRT_A.fb),a.viewport(0,0,this.bloomW,this.bloomH),a.clearColor(0,0,0,0),a.clear(a.COLOR_BUFFER_BIT),a.useProgram(this.blurProgram),a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,e),a.uniform1i(this.blurUniforms.tex,0),a.uniform2f(this.blurUniforms.texelSize,1/this.bloomW,1/this.bloomH),a.uniform2f(this.blurUniforms.direction,1,0),a.uniform1f(this.blurUniforms.radius,t),a.disable(a.BLEND),a.bindBuffer(a.ARRAY_BUFFER,this.fullscreenBuffer),a.enableVertexAttribArray(0),a.vertexAttribPointer(0,2,a.FLOAT,!1,0,0),a.vertexAttribDivisor(0,0),a.drawArrays(a.TRIANGLES,0,6),a.bindFramebuffer(a.FRAMEBUFFER,this.bloomRT_B.fb),a.viewport(0,0,this.bloomW,this.bloomH),a.clearColor(0,0,0,0),a.clear(a.COLOR_BUFFER_BIT),a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,this.bloomRT_A.tex),a.uniform1i(this.blurUniforms.tex,0),a.uniform2f(this.blurUniforms.direction,0,1),a.drawArrays(a.TRIANGLES,0,6),[this.bloomRT_A,this.bloomRT_B]=[this.bloomRT_B,this.bloomRT_A],a.enable(a.BLEND),this.perfDrawCalls+=2}computeDrawUpTo(e,t,a,o){const r=e.points.length;if(!o.isPlaying||r<=1)return{drawUpTo:r,progress:1,trailLen:0};let s=0;if(o.staggerStrokes)for(const b of a)b.visible&&(s+=b.duration/Math.max(.01,o.drawSpeed)+o.staggerDelay);else for(const b of a)b.visible&&(s=Math.max(s,b.duration/Math.max(.01,o.drawSpeed)));let n=0;if(o.staggerStrokes)for(let b=0;b<t;b++){const M=a[b];M.visible&&(n+=M.duration/Math.max(.01,o.drawSpeed)+o.staggerDelay)}const l=e.duration/Math.max(.01,o.drawSpeed);let u=this.animationTime;if(s>0)if(o.loopMode==="forward")u=u%s;else if(o.loopMode==="reverse")u=s-u%s;else if(o.loopMode==="pingpong"){const b=Math.max(0,o.pingPongHold??0),M=s*2+b*2,C=u%M;C<s?u=C:C<s+b?u=s:C<s*2+b?u=s-(C-s-b):u=0}else o.loopMode==="once"&&(u=Math.min(u,s));const f=u-n;let d=0;l<=0?d=1:d=Math.max(0,Math.min(1,f/l));const h=Math.max(0,Math.min(r,Math.floor(r*d)));let m=0;return o.trailLength>0&&(m=Math.floor(r*(1-o.trailLength))),o.snake>0&&(m=Math.floor(r*(1-o.snake))),{drawUpTo:h,progress:d,trailLen:m}}rebuildCommitted(e,t,a){const o=this.gl;this.clearTarget(this.committedRT,0,0,0,0),o.bindFramebuffer(o.FRAMEBUFFER,this.committedRT.fb),o.viewport(0,0,this.width,this.height),this.bakedHashes.clear(),this.bakedOrder=[];for(let r=0;r<e.length;r++){const s=e[r];if(!s.visible||os.has(s.brush.type))continue;const{drawUpTo:n,trailLen:l}=this.computeDrawUpTo(s,r,e,a);if(n<=0)continue;const u=rs(s,this.width,this.height,n,l,t,1);this.drawStampBatch(u,s.brush);const f=s.brush.type;(f==="glow"||f==="neon"||f==="laser")&&this.drawStripBatch(u,s.brush),this.bakedHashes.set(s.id,this.hashStroke(s)),this.bakedOrder.push(s.id)}}render(e,t){const a=this.gl,o=performance.now();this.perfStampCount=0,this.perfDrawCalls=0,e.isPlaying&&(this.animationTime=(Date.now()-gc)*e.animationSpeed);const r=Date.now()%1e6/1e3,s=e.strokes.filter(K=>K.visible);let n=!1;const l=s.map(K=>K.id);if(l.length!==this.bakedOrder.length)n=!0;else for(let K=0;K<l.length;K++){if(l[K]!==this.bakedOrder[K]){n=!0;break}const We=this.hashStroke(s[K]);if(this.bakedHashes.get(l[K])!==We){n=!0;break}}const u=s.some(K=>mc[K.brush.type]);(e.isPlaying||u)&&(n=!0),n&&this.rebuildCommitted(s,r,e),this.clearTarget(this.currentRT,0,0,0,0),a.bindFramebuffer(a.FRAMEBUFFER,this.currentRT.fb),a.viewport(0,0,this.width,this.height);const f=e.livePreviewStroke;if(f&&f.points?.length>=2&&f.brush&&!os.has(f.brush.type)){const K={points:f.points,brush:f.brush},We=rs(K,this.width,this.height,K.points.length,0,r,1);this.drawStampBatch(We,f.brush);const pe=f.brush.type;(pe==="glow"||pe==="neon"||pe==="laser")&&this.drawStripBatch(We,f.brush)}const d=e.globalOpacity??1,h=e.colorShift??0,m=e.bloom??0,b=e.afterglow??0,M=e.motionBlur??0,C=!!e.multiColorGlow,T=e.pulse??0,I=e.pulseSpeed??1,W=e.strobe??0,G=e.flicker??0,O=e.breathe??0,L=e.breatheSpeed??1,N=e.wave??0,ce=e.waveFreq??1,ae=e.waveSpeed??1,se=e.sparkle??0;let te=1;if(T>0&&e.isPlaying){const K=Math.sin(r*I*Math.PI*2);te=1-T*.5*(.5-K*.5)}let Q=1;if(W>0&&e.isPlaying){const K=W*20;Q=Math.sin(r*K*Math.PI*2)>0?1:.05}let $=1;G>0&&e.isPlaying&&($=1-G*Math.random()*.6);let j=1;O>0&&e.isPlaying&&(j=1+O*.3*Math.sin(r*L*Math.PI*2));let Ae=0,Ce=0;if(N>0&&e.isPlaying){const K=N*15,We=r*ae*Math.PI*2;Ae=Math.sin(We)*K,Ce=Math.cos(We*ce)*K*.5}const Be=d,ie=d*te*Q*$,Pe=h>0&&e.isPlaying?this.animationTime/3e3*h%1*Math.PI*2:0;if(this.clearTarget(this.finalRT,0,0,0,0),a.bindFramebuffer(a.FRAMEBUFFER,this.finalRT.fb),a.viewport(0,0,this.width,this.height),C){const K=Pe+Math.PI*.5;this.composite({sourceTex:this.committedRT.tex,alpha:Be*.5,hueShift:K}),this.composite({sourceTex:this.currentRT.tex,alpha:Be*.5,hueShift:K})}const Ke=Math.round(e.echo??0);if(Ke>0){const K=e.echoDecay??.4,We=e.echoOffset??.05;for(let pe=Ke;pe>=1;pe--){const ze=Math.pow(1-K,pe)*Be;if(ze<=.001)continue;const Ve=pe*We*this.width*.5;this.composite({sourceTex:this.committedRT.tex,offsetPx:[0,-Ve],alpha:ze,hueShift:Pe||void 0}),this.composite({sourceTex:this.committedRT.tex,offsetPx:[0,Ve],alpha:ze,hueShift:Pe||void 0})}}if(this.composite({sourceTex:this.committedRT.tex,alpha:Be,hueShift:Pe||void 0}),this.composite({sourceTex:this.currentRT.tex,alpha:Be,hueShift:Pe||void 0}),m>0){const K=2+m*3;this.gaussianBlur(this.finalRT.tex,K),a.bindFramebuffer(a.FRAMEBUFFER,this.finalRT.fb),a.viewport(0,0,this.width,this.height),a.blendFuncSeparate(a.ONE,a.ONE,a.ONE,a.ONE),this.composite({sourceTex:this.bloomRT_A.tex,alpha:Math.min(1,m*.5)}),a.blendFuncSeparate(a.ONE,a.ONE_MINUS_SRC_ALPHA,a.ONE,a.ONE_MINUS_SRC_ALPHA)}if(a.bindFramebuffer(a.FRAMEBUFFER,null),a.viewport(0,0,this.width,this.height),a.clearColor(0,0,0,0),a.clear(a.COLOR_BUFFER_BIT),b>0){const K=.4+b*.55;this.composite({sourceTex:this.persistRT.tex,alpha:K})}if(M>0){a.blendFuncSeparate(a.ONE,a.ONE,a.ONE,a.ONE);const K=4;for(let We=1;We<=K;We++){const pe=M*.25*(1-We/(K+1)),ze=We*M*8;this.composite({sourceTex:this.persistRT.tex,offsetPx:[-ze,0],alpha:pe}),this.composite({sourceTex:this.persistRT.tex,offsetPx:[ze,0],alpha:pe})}a.blendFuncSeparate(a.ONE,a.ONE_MINUS_SRC_ALPHA,a.ONE,a.ONE_MINUS_SRC_ALPHA)}return this.composite({sourceTex:this.finalRT.tex,alpha:ie,outputScale:j,offsetPx:[Ae,Ce]}),se>0&&e.isPlaying&&(a.blendFuncSeparate(a.ONE,a.ONE,a.ONE,a.ONE),this.drawSparkle(this.finalRT.tex,se,r),a.blendFuncSeparate(a.ONE,a.ONE_MINUS_SRC_ALPHA,a.ONE,a.ONE_MINUS_SRC_ALPHA)),(b>0||M>0)&&(this.clearTarget(this.persistRT,0,0,0,0),a.bindFramebuffer(a.FRAMEBUFFER,this.persistRT.fb),a.viewport(0,0,this.width,this.height),this.composite({sourceTex:this.finalRT.tex,alpha:1})),this.texture.needsUpdate=!0,this.perfLastRenderMs=performance.now()-o,this.texture}resetAnimation(){this.animationTime=0,this.bakedHashes.clear(),this.bakedOrder=[]}setPlaybackPosition(e){this.animationTime=e*6e4,this.bakedHashes.clear(),this.bakedOrder=[]}getPerfStats(){return{renderMs:this.perfLastRenderMs,stampCount:this.perfStampCount,drawCalls:this.perfDrawCalls,backend:"webgl2"}}dispose(){const e=this.gl;e.deleteProgram(this.stampProgram),e.deleteProgram(this.compositeProgram),e.deleteProgram(this.stripProgram),e.deleteProgram(this.blurProgram),e.deleteProgram(this.sparkleProgram),e.deleteBuffer(this.cornerBuffer),e.deleteBuffer(this.instanceBuffer),e.deleteBuffer(this.stripBuffer),e.deleteBuffer(this.fullscreenBuffer),e.deleteTexture(this.committedRT.tex),e.deleteFramebuffer(this.committedRT.fb),e.deleteTexture(this.currentRT.tex),e.deleteFramebuffer(this.currentRT.fb),e.deleteTexture(this.workRT.tex),e.deleteFramebuffer(this.workRT.fb),e.deleteTexture(this.finalRT.tex),e.deleteFramebuffer(this.finalRT.fb),e.deleteTexture(this.persistRT.tex),e.deleteFramebuffer(this.persistRT.fb),e.deleteTexture(this.bloomRT_A.tex),e.deleteFramebuffer(this.bloomRT_A.fb),e.deleteTexture(this.bloomRT_B.tex),e.deleteFramebuffer(this.bloomRT_B.fb),this.texture.dispose()}}let Us=null;function Ap(i){Us=i}function bc(){return Us}class xc{canvas;ctx;texture;width;height;startTime;lastText="";letterMetrics=[];lastStaticSig=null;flatCanvas=null;flatCtx=null;constructor(e,t){this.width=e,this.height=t,this.canvas=document.createElement("canvas"),this.canvas.width=e,this.canvas.height=t,this.ctx=this.canvas.getContext("2d",{willReadFrequently:!1}),this.texture=new Zt(this.canvas),this.texture.minFilter=le,this.texture.magFilter=le,this.texture.format=qe,this.startTime=performance.now()/1e3}resize(e,t){this.width===e&&this.height===t||(this.width=e,this.height=t,this.canvas.width=e,this.canvas.height=t,this.lastText="")}measureLetters(e){const t=`${e.text}|${e.fontFamily}|${e.fontSize}|${e.fontWeight}|${e.fontStyle}|${e.letterSpacing}|${e.lineHeight}|${e.alignment}`;if(this.lastText===t)return;this.lastText=t;const a=this.ctx,o=`${e.fontStyle} ${e.fontWeight} ${e.fontSize}px "${e.fontFamily}"`;a.font=o;const r=e.text.split(`
`),s=e.fontSize*e.lineHeight,n=r.length*s,l=(this.height-n)/2+e.fontSize*.8;this.letterMetrics=[];let u=0;for(let f=0;f<r.length;f++){const h=[...r[f]];let m=0;const b=[];for(const T of h){const I=a.measureText(T).width+e.letterSpacing;b.push(I),m+=I}m-=e.letterSpacing;let M;e.alignment==="left"?M=40:e.alignment==="right"?M=this.width-m-40:M=(this.width-m)/2;let C=M;for(let T=0;T<h.length;T++)this.letterMetrics.push({char:h[T],x:C,y:l+f*s,width:b[T],index:u,lineIndex:f}),C+=b[T],u++}}applyTextStyle(e){const t=this.ctx;t.font=`${e.fontStyle} ${e.fontWeight} ${e.fontSize}px "${e.fontFamily}"`,t.textBaseline="alphabetic",t.fillStyle=e.color,e.strokeWidth>0&&(t.strokeStyle=e.strokeColor,t.lineWidth=e.strokeWidth,t.lineJoin="round"),e.shadowBlur>0||e.shadowOffsetX!==0||e.shadowOffsetY!==0?(t.shadowColor=e.shadowColor,t.shadowBlur=e.shadowBlur,t.shadowOffsetX=e.shadowOffsetX,t.shadowOffsetY=e.shadowOffsetY):(t.shadowColor="transparent",t.shadowBlur=0,t.shadowOffsetX=0,t.shadowOffsetY=0)}drawLetter(e,t,a,o,r=1,s=1,n=1,l=0,u=0,f=0){if(r<=0||t===" ")return void 0;const d=this.ctx;d.save(),d.globalAlpha=Math.max(0,Math.min(1,r)),d.translate(a+u,o+f),l!==0&&d.rotate(l),(s!==1||n!==1)&&d.scale(s,n),e.strokeWidth>0&&d.strokeText(t,0,0),d.fillText(t,0,0),d.restore()}getFlatCanvas(){return(!this.flatCanvas||this.flatCanvas.width!==this.width||this.flatCanvas.height!==this.height)&&(this.flatCanvas=document.createElement("canvas"),this.flatCanvas.width=this.width,this.flatCanvas.height=this.height,this.flatCtx=this.flatCanvas.getContext("2d")),{canvas:this.flatCanvas,ctx:this.flatCtx}}render(e,t){if(e.animation.type==="none"){const m=JSON.stringify({t:e.text,f:e.fontFamily,s:e.fontSize,w:e.fontWeight,c:e.color,bg:e.backgroundColor,a:e.textAlign,v:e.verticalAlign,ls:e.letterSpacing,lh:e.lineHeight,s3:e.enable3D,ed:e.extrudeDepth,sh:e.shadowEnabled,out:e.outlineEnabled,oc:e.outlineColor,ow:e.outlineWidth,w_:this.width,h:this.height});if(m===this.lastStaticSig)return this.texture;this.lastStaticSig=m}else this.lastStaticSig=null;const a=this.ctx,o=performance.now()/1e3-this.startTime,r=e.animation.speed,s=o*r,n=e.animation.intensity,l=e.animation.staggerDelay,u=e.enable3D&&e.extrudeDepth>0;let f;u?(f=this.getFlatCanvas().ctx,this.ctx=f,f.clearRect(0,0,this.width,this.height)):f=a,a.clearRect(0,0,this.width,this.height),e.backgroundColor&&e.backgroundColor!=="transparent"&&(a.fillStyle=e.backgroundColor,a.fillRect(0,0,this.width,this.height)),this.measureLetters(e),this.applyTextStyle(e);const d=this.letterMetrics;switch(e.animation.type){case"none":this.renderStatic(e,d);break;case"ticker":this.renderTicker(e,d,s,n);break;case"letterReveal":this.renderLetterReveal(e,d,s,l,n);break;case"typewriter":this.renderTypewriter(e,d,s,l,n);break;case"fadeInLetters":this.renderFadeInLetters(e,d,s,l,n);break;case"waveY":this.renderWaveY(e,d,s,n);break;case"waveX":this.renderWaveX(e,d,s,n);break;case"elastic":this.renderElastic(e,d,s,l,n);break;case"scramble":this.renderScramble(e,d,s,l,n);break;case"glitch3d":this.renderGlitch3D(e,d,s,n);break;case"perspective3d":this.renderPerspective3D(e,d,s,n);break;case"flipLetters":this.renderFlipLetters(e,d,s,l,n);break;case"spiralIn":this.renderSpiralIn(e,d,s,l,n);break;case"explode":this.renderExplode(e,d,s,l,n);break;case"liquid":this.renderLiquid(e,d,s,n);break;case"neonPulse":this.renderNeonPulse(e,d,s,n);break;case"matrixRain":this.renderMatrixRain(e,d,s,n);break;case"bounce":this.renderBounce(e,d,s,l,n);break;default:this.renderStatic(e,d)}return u&&(this.ctx=a,this.render3DExtrusion(e,this.flatCanvas)),this.texture.needsUpdate=!0,this.texture}render3DExtrusion(e,t){const a=this.ctx,o=e.extrudeDepth,r=e.rotateX,s=e.rotateY,n=e.rotateZ,l=e.lightAngle*Math.PI/180,u=e.lightIntensity,f=r*Math.PI/180,d=s*Math.PI/180,h=n*Math.PI/180,m=Math.cos(f),b=Math.sin(f),M=Math.cos(d),T=Math.sin(d),I=-b*M,W=Math.abs(M),G=Math.abs(m),O=Math.cos(h),L=Math.sin(h),N=O*W,ce=-L*G,ae=L*W,se=O*G,te=this.width/2,Q=this.height/2,$=this.parseColor(e.extrudeColor),j=Math.ceil(o);for(let Ae=j;Ae>=0;Ae--){const Ce=Ae/Math.max(j,1),Be=T*o*Ce,ie=I*o*Ce;if(a.save(),a.translate(te+Be,Q+ie),a.transform(N,ae,ce,se,0,0),a.translate(-te,-Q),Ae>0){const Pe=.5+.5*Math.cos(l-Math.atan2(I,T)),Ke=1-u*(1-Pe*(1-Ce*.5));a.drawImage(t,0,0),a.globalCompositeOperation="source-atop",a.fillStyle=`rgba(${Math.round($.r*Ke)}, ${Math.round($.g*Ke)}, ${Math.round($.b*Ke)}, 1)`,a.fillRect(0,0,this.width,this.height),a.globalCompositeOperation="source-over"}else if(a.drawImage(t,0,0),e.bevelSize>0){a.globalCompositeOperation="source-atop";const Pe=a.createLinearGradient(0,0,0,this.height);Pe.addColorStop(0,`rgba(255,255,255,${.3*e.bevelSize/10})`),Pe.addColorStop(.15,"rgba(255,255,255,0)"),Pe.addColorStop(.85,"rgba(0,0,0,0)"),Pe.addColorStop(1,`rgba(0,0,0,${.2*e.bevelSize/10})`),a.fillStyle=Pe,a.fillRect(0,0,this.width,this.height),a.globalCompositeOperation="source-over"}a.restore()}}parseColor(e){const t=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(e);return t?{r:parseInt(t[1],16),g:parseInt(t[2],16),b:parseInt(t[3],16)}:{r:68,g:68,b:68}}renderStatic(e,t){for(const a of t)this.drawLetter(e,a.char,a.x,a.y)}renderTicker(e,t,a,o){if(t.length===0)return;const r=t[t.length-1],n=r.x+r.width-t[0].x+this.width,l=200*o,u=a*l%n;for(const f of t){const h=((f.x-u+this.width)%n+n)%n-this.width*.1;this.drawLetter(e,f.char,h,f.y)}}renderLetterReveal(e,t,a,o,r){const s=t.length*o+.5,n=a%(s+1),l=this.ctx;for(const u of t){const f=u.index*o,d=Math.max(0,Math.min(1,(n-f)/.3));if(d<=0)continue;const h=Math.max(0,1-(n-f)/.5);h>0&&r>0&&(l.save(),l.shadowColor=e.color,l.shadowBlur=30*h*r,l.globalAlpha=h*.5,l.fillText(u.char,u.x,u.y),l.restore(),this.applyTextStyle(e));const m=.5+.5*this.easeOutBack(d);this.drawLetter(e,u.char,u.x,u.y,d,m,m)}}renderTypewriter(e,t,a,o,r){const s=t.length*o+2,n=a%s,l=Math.floor(n/o),u=this.ctx;for(let d=0;d<Math.min(l,t.length);d++){const h=t[d];this.drawLetter(e,h.char,h.x,h.y)}const f=Math.min(l,t.length-1);if(f>=0&&f<t.length&&Math.sin(a*6)>0){const h=t[f],m=h.x+h.width+4;u.save(),u.fillStyle=e.color,u.globalAlpha=r,u.fillRect(m,h.y-e.fontSize*.8,3,e.fontSize),u.restore(),this.applyTextStyle(e)}}renderFadeInLetters(e,t,a,o,r){const s=t.length*o+1,n=a%(s+2);for(const l of t){const u=l.index*o,f=Math.max(0,Math.min(1,(n-u)/.5));f<=0||this.drawLetter(e,l.char,l.x,l.y,f)}}renderWaveY(e,t,a,o){const r=30*o,s=.15,n=a*4;for(const l of t){const u=Math.sin(l.index*s+n)*r;this.drawLetter(e,l.char,l.x,l.y,1,1,1,0,0,u)}}renderWaveX(e,t,a,o){const r=20*o,s=.2,n=a*3;for(const l of t){const u=Math.sin(l.index*s+n)*r;this.drawLetter(e,l.char,l.x,l.y,1,1,1,0,u,0)}}renderElastic(e,t,a,o,r){const s=t.length*o+1.5,n=a%(s+1);for(const l of t){const u=l.index*o,f=Math.max(0,(n-u)/.8);if(f<=0)continue;const d=this.easeOutElastic(Math.min(1,f)),h=d*r+(1-r),m=(1-d)*-200*r;this.drawLetter(e,l.char,l.x,l.y,Math.min(1,f*2),h,h,0,0,m)}}renderScramble(e,t,a,o,r){const s="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*",n=t.length*o+1,l=a%(n+2);for(const u of t){const f=u.index*o,d=Math.max(0,Math.min(1,(l-f)/.6));if(l<f-.2)continue;let h;if(d>=1)h=u.char;else{const m=(1-d)*r;Math.random()<m?h=s[Math.floor(Math.random()*s.length)]:h=u.char}this.drawLetter(e,h,u.x,u.y,Math.min(1,d+.3))}}renderGlitch3D(e,t,a,o){const r=this.ctx,s=Math.sin(a*7)*Math.sin(a*13),l=Math.abs(s)>.7?(Math.abs(s)-.7)/.3*o:0,u=[{color:`rgba(255,0,0,${.7+l*.3})`,dx:-4*l,dy:-2*l},{color:`rgba(0,255,0,${.7+l*.3})`,dx:2*l,dy:1*l},{color:`rgba(0,0,255,${.7+l*.3})`,dx:-1*l,dy:3*l}];if(l>.1){for(const f of u){r.save(),r.globalCompositeOperation="lighter",r.fillStyle=f.color,r.font=`${e.fontStyle} ${e.fontWeight} ${e.fontSize}px "${e.fontFamily}"`,r.textBaseline="alphabetic";const d=(Math.random()-.5)*.1*l;r.transform(1,d,0,1,0,0);for(const h of t){const m=(Math.random()-.5)*10*l,b=(Math.random()-.5)*6*l;r.fillText(h.char,h.x+f.dx*5+m,h.y+f.dy*5+b)}r.restore()}if(l>.5){r.save(),r.globalAlpha=l*.3;for(let f=0;f<this.height;f+=3)Math.random()>.85&&(r.fillStyle=`rgba(255,255,255,${Math.random()*.3})`,r.fillRect(0,f,this.width,1+Math.random()*2));r.restore()}}else{this.applyTextStyle(e);for(const f of t)this.drawLetter(e,f.char,f.x,f.y)}}renderPerspective3D(e,t,a,o){const r=this.ctx,s=a*.5*o;r.save(),r.translate(this.width/2,this.height/2);const n=Math.cos(s),l=Math.sin(s),u=Math.abs(n);r.scale(u||.01,1);const f=.5+.5*Math.abs(n);this.applyTextStyle(e);for(const d of t){const h=d.x-this.width/2,m=d.y-this.height/2,b=1+h/this.width*l*.5*o;r.save(),r.translate(h,m),r.scale(b,b),r.globalAlpha=f,e.strokeWidth>0&&r.strokeText(d.char,0,0),r.fillText(d.char,0,0),r.restore()}r.restore()}renderFlipLetters(e,t,a,o,r){for(const s of t){const n=a*2+s.index*.3,l=Math.cos(n)*r,u=Math.abs(l)*.7+.3,f=.3+.7*u;this.drawLetter(e,s.char,s.x+s.width/2,s.y,f,u,1,0,-s.width/2*u,0)}}renderSpiralIn(e,t,a,o,r){const s=t.length*o+1.5,n=a%(s+1.5);for(const l of t){const u=l.index*o,f=Math.max(0,Math.min(1,(n-u)/1));if(f<=0)continue;const d=this.easeOutCubic(f),h=(1-d)*Math.PI*4*r,m=(1-d)*400*r,b=l.x,M=l.y,C=b+Math.cos(h)*m,T=M+Math.sin(h)*m,I=(1-d)*Math.PI*2*r;this.drawLetter(e,l.char,C,T,d,d,d,I)}}renderExplode(e,t,a,o,r){const n=a%4;let l,u;n<1?(l=0,u=0):n<2?(l=1,u=n-1):n<3?(l=2,u=1):(l=3,u=1-(n-3));const f=l===0?0:l===1?this.easeOutCubic(u):l===2?1:this.easeInCubic(u);for(const d of t){const h=d.index/t.length*Math.PI*2+d.index*1.5,m=(150+d.index*30)*r,b=Math.cos(h)*m*f,M=Math.sin(h)*m*f,C=f*(d.index%2===0?1:-1)*Math.PI*r,T=1-f*.3,I=1-f*.4;this.drawLetter(e,d.char,d.x,d.y,I,T,T,C,b,M)}}renderLiquid(e,t,a,o){for(const r of t){const l=Math.sin(r.y*.02+a*2)*15*o+Math.sin(r.x*.03+a*1.5)*10*o,u=Math.cos(r.x*.02+a*1.7)*12*o+Math.cos(r.y*.03+a*2.3)*8*o,f=1+Math.sin(a*3+r.index*.5)*.15*o,d=1+Math.cos(a*2.5+r.index*.7)*.15*o,h=Math.sin(a*1.5+r.index*.4)*.1*o;this.drawLetter(e,r.char,r.x,r.y,1,f,d,h,l,u)}}renderNeonPulse(e,t,a,o){const r=this.ctx,s=(Math.sin(a*3)+1)/2,l=Math.sin(a*47)*Math.sin(a*73)>.95?.3:1,u=[{blur:40*o,alpha:.15*s*l},{blur:20*o,alpha:.3*s*l},{blur:10*o,alpha:.5*l},{blur:4,alpha:.8*l}];for(const f of u){r.save(),r.shadowColor=e.color,r.shadowBlur=f.blur,r.globalAlpha=f.alpha,r.fillStyle=e.color,r.font=`${e.fontStyle} ${e.fontWeight} ${e.fontSize}px "${e.fontFamily}"`,r.textBaseline="alphabetic";for(const d of t)r.fillText(d.char,d.x,d.y);r.restore()}r.save(),r.globalAlpha=l,r.fillStyle="#ffffff",r.font=`${e.fontStyle} ${e.fontWeight} ${e.fontSize}px "${e.fontFamily}"`,r.textBaseline="alphabetic";for(const f of t)r.fillText(f.char,f.x,f.y);r.restore(),this.applyTextStyle(e)}renderMatrixRain(e,t,a,o){const r=this.ctx,s="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()ゲギグゴザジズゼゾ",n=e.fontSize*.7,l=Math.ceil(this.width/n),u=150*o;r.fillStyle="rgba(0, 0, 0, 0.1)",r.fillRect(0,0,this.width,this.height),r.font=`${e.fontWeight} ${e.fontSize*.6}px "${e.fontFamily}"`,r.textBaseline="top";for(let f=0;f<l;f++){const d=f*7.3+.1,h=(.5+this.pseudoRandom(d)*.5)*u,m=this.pseudoRandom(d+1)*this.height*3,b=f*n,M=(a*h+m)%(this.height*1.5),C=10+Math.floor(this.pseudoRandom(d+2)*15);for(let T=0;T<C;T++){const I=M-T*e.fontSize*.7;if(I<-e.fontSize||I>this.height)continue;const W=1-T/C,G=T===0;r.save(),G?(r.fillStyle="#ffffff",r.shadowColor="#00ff00",r.shadowBlur=15,r.globalAlpha=1):(r.fillStyle=`rgba(0, 255, 70, ${W*.8})`,r.globalAlpha=W);const O=Math.floor(this.pseudoRandom(d+T*3.7+Math.floor(a*8))*s.length);r.fillText(s[O],b,I),r.restore()}}r.save(),r.font=`${e.fontStyle} ${e.fontWeight} ${e.fontSize}px "${e.fontFamily}"`,r.textBaseline="alphabetic",r.shadowColor="#00ff00",r.shadowBlur=20*o,r.fillStyle="#00ff00",r.globalAlpha=.7+.3*Math.sin(a*4);for(const f of t){const d=Math.random()>.05?f.char:s[Math.floor(Math.random()*s.length)];r.fillText(d,f.x,f.y)}r.restore(),this.applyTextStyle(e)}renderBounce(e,t,a,o,r){const s=t.length*o+2,n=a%(s+1);for(const l of t){const u=l.index*o,f=n-u;if(f<0)continue;const d=-100,h=l.y,m=h-d;let b,M=1;if(f<.5){const W=f/.5;b=d+m*this.easeInQuad(W)}else{const W=f-.5,G=Math.exp(-W*4),O=Math.abs(Math.sin(W*8))*80*G*r;b=h-O}const C=f<.5?f*4:Math.cos((f-.5)*8)*Math.exp(-(f-.5)*4),T=1+Math.abs(C)*.2*r,I=1/T;this.drawLetter(e,l.char,l.x,b,M,I,T)}}easeOutBack(e){return 1+2.70158*Math.pow(e-1,3)+1.70158*Math.pow(e-1,2)}easeOutElastic(e){if(e===0||e===1)return e;const t=2*Math.PI/3;return Math.pow(2,-10*e)*Math.sin((e*10-.75)*t)+1}easeOutCubic(e){return 1-Math.pow(1-e,3)}easeInCubic(e){return e*e*e}easeInQuad(e){return e*e}pseudoRandom(e){const t=Math.sin(e*12.9898+78.233)*43758.5453;return t-Math.floor(t)}dispose(){this.texture.dispose()}}const wc=`
  uniform float time;
  uniform float pointSize;
  uniform bool sizeAttenuation;

  // Animation uniforms
  uniform float animationProgress;
  uniform float animationIntensity;
  uniform int animationType;
  uniform float explodeForce;
  uniform float voxelGridSize;
  uniform vec3 peelAxis;
  uniform float gravity;
  uniform float turbulence;

  // Displacement uniforms
  uniform int displacementType;
  uniform float displacementAmount;
  uniform float noiseScale;
  uniform float noiseSpeed;
  uniform float waveFrequency;
  uniform float waveAmplitude;
  uniform float glitchIntensity;
  uniform vec3 windDirection;
  uniform float windStrength;

  // Audio uniforms
  uniform bool audioEnabled;
  uniform float audioLevel;
  uniform float audioDisplacement;
  uniform float audioScale;
  uniform float beatIntensity;
  uniform float beatPhase;

  // Transform uniforms
  uniform float scaleUniform;
  uniform vec3 rotation3D;
  uniform vec3 position3D;

  // Slice plane
  uniform bool sliceEnabled;
  uniform vec3 sliceAxis;
  uniform float slicePosition;
  uniform float sliceThickness;

  // Mouse interaction
  uniform vec3 mousePosition;
  uniform float mouseInfluence;
  uniform float mouseRadius;
  uniform int mouseMode;

  attribute vec3 originalPosition;
  attribute vec3 color;
  attribute float alpha;
  attribute float vertexIndex;
  attribute vec3 velocity;
  attribute vec2 texUV;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vDiscard;
  varying vec3 vPosition;
  varying float vVertexIndex;
  varying float vMouseDistance; // For reveal effect in fragment shader
  varying vec2 vTexUV;

  // Simplex noise functions
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  // Apply animation to position
  vec3 applyAnimation(vec3 pos, vec3 origPos) {
    float t = animationProgress * animationIntensity;

    // Explode - points move outward from center
    if (animationType == 1) {
      vec3 dir = normalize(origPos);
      return pos + dir * t * explodeForce;
    }

    // Implode - points move toward center
    if (animationType == 2) {
      vec3 dir = normalize(origPos);
      return pos - dir * t * explodeForce;
    }

    // Slice - plane reveals/hides
    if (animationType == 3) {
      float planePos = (t * 2.0 - 1.0) * 2.0;
      float dist = dot(pos, normalize(peelAxis));
      if (dist > planePos) {
        vDiscard = 1.0;
      }
      return pos;
    }

    // Voxel snap - points snap to grid
    if (animationType == 4) {
      vec3 gridPos = floor(origPos * voxelGridSize + 0.5) / voxelGridSize;
      return mix(origPos, gridPos, t);
    }

    // Peel - layer by layer reveal
    if (animationType == 5) {
      float layerPos = dot(origPos, normalize(peelAxis));
      float revealThreshold = mix(-2.0, 2.0, t);
      if (layerPos > revealThreshold) {
        vDiscard = 1.0;
      }
      return pos;
    }

    // Gravity - points fall
    if (animationType == 6) {
      float fallTime = max(0.0, t - vertexIndex * 0.0001);
      return pos + vec3(0.0, -gravity * fallTime * fallTime, 0.0);
    }

    // Swarm - flocking behavior with noise-driven velocity fields
    if (animationType == 7) {
      float id = vertexIndex * 0.00137;
      // Cohesion: drift toward local center with noise-based group assignment
      float groupPhase = floor(snoise(origPos * 0.5) * 4.0) * 1.57;
      vec3 groupCenter = vec3(
        sin(time * 0.7 + groupPhase) * 0.8,
        cos(time * 0.5 + groupPhase * 0.7) * 0.5,
        sin(time * 0.6 + groupPhase * 1.3) * 0.8
      );
      vec3 toCenter = groupCenter - origPos;
      // Separation: push away from neighbors using noise
      vec3 separation = vec3(
        snoise(origPos * 3.0 + time * 1.5),
        snoise(origPos * 3.0 + time * 1.5 + 50.0),
        snoise(origPos * 3.0 + time * 1.5 + 100.0)
      ) * 0.4;
      // Alignment: smooth directional flow
      vec3 flow = vec3(
        snoise(origPos * 0.8 + time * 0.8 + 200.0),
        snoise(origPos * 0.8 + time * 0.6 + 300.0) * 0.5,
        snoise(origPos * 0.8 + time * 0.8 + 400.0)
      ) * 0.6;
      vec3 swarmOffset = (toCenter * 0.3 + separation + flow) * t * turbulence;
      return pos + swarmOffset;
    }

    // Morph - points transition toward a sphere surface
    if (animationType == 8) {
      // Calculate target position on a sphere
      float r = length(origPos);
      float avgR = max(r, 0.001);
      vec3 spherePos = normalize(origPos) * avgR;
      // Add some rotation on the sphere for visual interest
      float angle = t * 1.5 + vertexIndex * 0.0001;
      float cosA = cos(angle * 0.3);
      float sinA = sin(angle * 0.3);
      vec3 rotatedSphere = vec3(
        spherePos.x * cosA - spherePos.z * sinA,
        spherePos.y + sin(time * 0.5 + length(origPos.xz) * 3.0) * 0.1 * t,
        spherePos.x * sinA + spherePos.z * cosA
      );
      return mix(pos, rotatedSphere, t);
    }

    // Orbit - points rotate around center
    if (animationType == 9) {
      float angle = t * 6.28318 + vertexIndex * 0.01;
      float r = length(pos.xz);
      return vec3(cos(angle) * r, pos.y, sin(angle) * r);
    }

    // Wave 3D - wave propagation
    if (animationType == 10) {
      float wave = sin(length(origPos.xz) * 5.0 - time * 3.0) * 0.3 * t;
      return pos + vec3(0.0, wave, 0.0);
    }

    // Scatter - random dispersion
    if (animationType == 11) {
      vec3 scatter = vec3(
        snoise(origPos * 10.0 + time),
        snoise(origPos * 10.0 + time + 100.0),
        snoise(origPos * 10.0 + time + 200.0)
      );
      return pos + scatter * t * 2.0;
    }

    // Spiral - spiral motion
    if (animationType == 12) {
      float angle = t * 6.28318 * 2.0 + vertexIndex * 0.001;
      float spiral = t * 2.0;
      vec3 spiralOffset = vec3(cos(angle) * spiral, t * 2.0, sin(angle) * spiral);
      return pos + spiralOffset * 0.5;
    }

    return pos;
  }

  // Apply displacement effect
  vec3 applyDisplacement(vec3 pos) {
    if (displacementType == 0) return pos;

    // Noise displacement
    if (displacementType == 1) {
      float noise = snoise(pos * noiseScale + time * noiseSpeed);
      vec3 noiseDir = vec3(
        snoise(pos * noiseScale + vec3(100.0, 0.0, 0.0) + time * noiseSpeed),
        snoise(pos * noiseScale + vec3(0.0, 100.0, 0.0) + time * noiseSpeed),
        snoise(pos * noiseScale + vec3(0.0, 0.0, 100.0) + time * noiseSpeed)
      );
      return pos + noiseDir * displacementAmount;
    }

    // Audio reactive displacement (enhanced with beat pulse)
    if (displacementType == 2 && audioEnabled) {
      vec3 dir = normalize(pos);
      float audioDisp = audioLevel * audioDisplacement;
      // Beat pulse adds extra displacement burst
      audioDisp += beatIntensity * audioDisplacement * 0.5;
      return pos + dir * audioDisp;
    }

    // Wave displacement
    if (displacementType == 3) {
      float wave = sin(pos.x * waveFrequency + time * 2.0) * waveAmplitude;
      wave += sin(pos.z * waveFrequency + time * 1.5) * waveAmplitude;
      return pos + vec3(0.0, wave * displacementAmount, 0.0);
    }

    // Glitch displacement
    if (displacementType == 4) {
      float glitch = step(0.99 - glitchIntensity * 0.1, fract(sin(time * 100.0 + vertexIndex) * 43758.5453));
      vec3 offset = vec3(
        fract(sin(vertexIndex * 12.9898 + time) * 43758.5453) - 0.5,
        fract(sin(vertexIndex * 78.233 + time) * 43758.5453) - 0.5,
        fract(sin(vertexIndex * 45.164 + time) * 43758.5453) - 0.5
      );
      return pos + offset * glitch * displacementAmount;
    }

    // Wind displacement
    if (displacementType == 5) {
      float wind = snoise(pos * 2.0 + windDirection * time * windStrength);
      return pos + windDirection * wind * displacementAmount;
    }

    // Ripple displacement
    if (displacementType == 7) {
      float dist = length(pos - mousePosition);
      float ripple = sin(dist * 10.0 - time * 5.0) * exp(-dist * 2.0);
      return pos + normalize(pos - mousePosition) * ripple * displacementAmount;
    }

    return pos;
  }

  // Apply mouse interaction
  vec3 applyMouseInteraction(vec3 pos) {
    if (mouseInfluence <= 0.0) return pos;

    // Calculate distance - use a scaled influence for better feel
    float dist = length(pos - mousePosition);

    // Smooth falloff from center to edge of radius
    float influence = smoothstep(mouseRadius, 0.0, dist) * mouseInfluence;

    // Avoid NaN when point is exactly at mouse position
    vec3 dir = dist > 0.001 ? normalize(pos - mousePosition) : vec3(0.0, 1.0, 0.0);

    // Scale effect strength based on distance for more natural feel
    float effectStrength = mouseRadius * 0.5;

    // Attract - points move toward mouse
    if (mouseMode == 0) {
      return pos - dir * influence * effectStrength;
    }

    // Repel - points move away from mouse
    if (mouseMode == 1) {
      return pos + dir * influence * effectStrength;
    }

    // Swirl - points orbit around mouse
    if (mouseMode == 2) {
      float angle = influence * 3.14159 * 2.0;
      vec3 offset = pos - mousePosition;
      vec3 swirl = vec3(
        offset.x * cos(angle) - offset.z * sin(angle),
        offset.y,
        offset.x * sin(angle) + offset.z * cos(angle)
      );
      return mousePosition + mix(offset, swirl, influence);
    }

    // Reveal - fade in points near mouse (handled in fragment shader via varying)
    // Just return position unchanged for reveal mode
    return pos;
  }

  void main() {
    vColor = color;
    vAlpha = alpha;
    vDiscard = 0.0;
    vMouseDistance = 1000.0; // Default to far away

    vec3 pos = originalPosition;

    // Apply transforms
    pos *= scaleUniform;

    // Apply rotation (simplified euler rotation)
    float cx = cos(rotation3D.x);
    float sx = sin(rotation3D.x);
    float cy = cos(rotation3D.y);
    float sy = sin(rotation3D.y);
    float cz = cos(rotation3D.z);
    float sz = sin(rotation3D.z);

    mat3 rotX = mat3(1, 0, 0, 0, cx, -sx, 0, sx, cx);
    mat3 rotY = mat3(cy, 0, sy, 0, 1, 0, -sy, 0, cy);
    mat3 rotZ = mat3(cz, -sz, 0, sz, cz, 0, 0, 0, 1);

    pos = rotZ * rotY * rotX * pos;
    pos += position3D;

    // Apply animation
    pos = applyAnimation(pos, originalPosition);

    // Apply displacement
    pos = applyDisplacement(pos);

    // Calculate mouse distance for reveal effect (before moving points)
    vMouseDistance = length(pos - mousePosition) / max(mouseRadius, 0.001);

    // Apply mouse interaction
    pos = applyMouseInteraction(pos);

    // Apply audio scale
    if (audioEnabled) {
      pos *= 1.0 + audioLevel * audioScale;
    }

    // Check slice plane
    if (sliceEnabled) {
      float dist = dot(pos, sliceAxis);
      float halfThickness = sliceThickness * 0.5;
      if (abs(dist - slicePosition) > halfThickness) {
        vDiscard = 1.0;
      }
    }

    vPosition = pos;
    vVertexIndex = vertexIndex;
    vTexUV = texUV;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Point size with optional attenuation + beat pulse
    float size = pointSize;
    if (audioEnabled) {
      size *= 1.0 + audioLevel * audioScale * 0.5;
      // Beat pulse on point size
      size *= 1.0 + beatIntensity * audioScale * 0.3;
    }
    if (sizeAttenuation) {
      size *= (300.0 / -mvPosition.z);
    }
    gl_PointSize = size;
  }
`,Sc=`
  uniform float time;
  uniform float opacity;
  uniform int renderMode;

  // Color effect uniforms
  uniform int colorEffectType;
  uniform float colorEffectIntensity;
  uniform float hueShift;
  uniform bool useOriginalColors;
  uniform vec3 colorA;
  uniform vec3 colorB;
  uniform float colorMix;
  uniform float hologramSpeed;
  uniform float hologramDensity;

  // Opacity effect uniforms
  uniform int opacityEffectType;
  uniform float opacityEffectIntensity;
  uniform float dofFocalDistance;
  uniform float dofBlurAmount;
  uniform float fogDensity;
  uniform vec3 fogColor;
  uniform float pulseSpeed;
  uniform float dissolveProgress;

  // Creative effect uniforms
  uniform int creativeEffectType;
  uniform float creativeEffectIntensity;
  uniform float trailLength;

  // Audio uniforms
  uniform bool audioEnabled;
  uniform float audioLevel;
  uniform float audioColor;
  uniform float beatIntensity;
  uniform float beatPhase;

  // Texture mapping uniforms
  uniform bool textureEnabled;
  uniform sampler2D textureMap;
  uniform float textureBlend;
  uniform int textureProjection; // 0=spherical, 1=cylindrical, 2=planarXY, 3=planarXZ, 4=planarYZ, 5=box, 6=native
  uniform float textureScale;
  uniform vec2 textureOffset;
  uniform vec3 pointCloudMin;  // Bounding box min for UV calculation
  uniform vec3 pointCloudMax;  // Bounding box max for UV calculation

  varying vec3 vColor;
  varying float vAlpha;
  varying float vDiscard;
  varying vec3 vPosition;
  varying float vVertexIndex;
  varying float vMouseDistance;
  varying vec2 vTexUV;

  // Mouse uniforms for reveal mode
  uniform int mouseMode;
  uniform float mouseInfluence;

  // Calculate UV coordinates based on projection mode
  vec2 calculateUV(vec3 pos) {
    // Normalize position to 0-1 range based on bounding box
    vec3 normalizedPos = (pos - pointCloudMin) / (pointCloudMax - pointCloudMin);

    vec2 uv;

    if (textureProjection == 0) {
      // Spherical projection
      vec3 dir = normalize(pos);
      uv.x = 0.5 + atan(dir.z, dir.x) / (2.0 * 3.14159265);
      uv.y = 0.5 - asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265;
    }
    else if (textureProjection == 1) {
      // Cylindrical projection
      vec3 dir = normalize(vec3(pos.x, 0.0, pos.z));
      uv.x = 0.5 + atan(dir.z, dir.x) / (2.0 * 3.14159265);
      uv.y = normalizedPos.y;
    }
    else if (textureProjection == 2) {
      // Planar XY (front view)
      uv = normalizedPos.xy;
    }
    else if (textureProjection == 3) {
      // Planar XZ (top view)
      uv = normalizedPos.xz;
    }
    else if (textureProjection == 4) {
      // Planar YZ (side view)
      uv = normalizedPos.yz;
    }
    else if (textureProjection == 6) {
      // Native UVs from file — bypass procedural calculation
      uv = vTexUV;
      // Apply scale and offset, then return directly
      uv = (uv - 0.5) * textureScale + 0.5 + textureOffset;
      return uv;
    }
    else {
      // Box projection - use the dominant axis
      vec3 absPos = abs(normalize(pos));
      if (absPos.x >= absPos.y && absPos.x >= absPos.z) {
        uv = normalizedPos.zy;
      } else if (absPos.y >= absPos.x && absPos.y >= absPos.z) {
        uv = normalizedPos.xz;
      } else {
        uv = normalizedPos.xy;
      }
    }

    // Apply scale and offset
    uv = (uv - 0.5) * textureScale + 0.5 + textureOffset;

    return uv;
  }

  // Noise function for effects
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // HSV to RGB conversion
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // RGB to HSV conversion
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  // Apply color effect
  vec3 applyColorEffect(vec3 color) {
    float intensity = colorEffectIntensity;

    // Apply hue shift first
    if (hueShift != 0.0) {
      vec3 hsv = rgb2hsv(color);
      hsv.x = fract(hsv.x + hueShift / 360.0);
      color = hsv2rgb(hsv);
    }

    if (colorEffectType == 0) return color;

    // 1: Chromatic shift - rainbow based on 3D position
    if (colorEffectType == 1) {
      vec3 hsv = rgb2hsv(color);
      float posHash = (vPosition.x + vPosition.y + vPosition.z) * 0.05;
      hsv.x = fract(hsv.x + posHash * intensity + time * 0.05);
      hsv.y = min(1.0, hsv.y + 0.3 * intensity);
      return mix(color, hsv2rgb(hsv), intensity);
    }

    // 2: Heatmap - proper thermal gradient
    if (colorEffectType == 2) {
      float heat = clamp((vPosition.y + 5.0) / 10.0, 0.0, 1.0);
      vec3 cold = vec3(0.0, 0.0, 0.5);
      vec3 cool = vec3(0.0, 0.5, 1.0);
      vec3 warm = vec3(1.0, 1.0, 0.0);
      vec3 hot = vec3(1.0, 0.0, 0.0);
      vec3 heatColor;
      if (heat < 0.33) {
        heatColor = mix(cold, cool, heat * 3.0);
      } else if (heat < 0.66) {
        heatColor = mix(cool, warm, (heat - 0.33) * 3.0);
      } else {
        heatColor = mix(warm, hot, (heat - 0.66) * 3.0);
      }
      return mix(color, heatColor, intensity);
    }

    // 3: Pointillist - per-point color cycling with offset
    if (colorEffectType == 3) {
      vec3 hsv = rgb2hsv(color);
      float pointOffset = hash(vPosition.xy) * 6.28;
      hsv.x = fract(hsv.x + sin(time * 2.0 + pointOffset) * 0.5 * intensity);
      hsv.y = min(1.0, hsv.y + 0.2 * intensity);
      hsv.z = min(1.0, hsv.z + 0.1 * intensity);
      return hsv2rgb(hsv);
    }

    // 4: Hologram
    if (colorEffectType == 4) {
      float scan = fract(vPosition.y * hologramDensity * 0.1 + time * hologramSpeed);
      vec3 holo = vec3(0.2, 0.8, 1.0);
      float flicker = 0.9 + 0.1 * sin(time * 30.0 + vPosition.x * 10.0);
      return mix(color, holo * flicker, scan * intensity);
    }

    // 5: Rainbow - smooth rainbow based on position
    if (colorEffectType == 5) {
      float hue = fract((vPosition.y + vPosition.x * 0.3) * 0.1 + time * 0.1);
      vec3 rainbow = hsv2rgb(vec3(hue, 1.0, 1.0));
      return mix(color, rainbow, intensity);
    }

    // 6: Audio color (with beat flash)
    if (colorEffectType == 6 && audioEnabled) {
      vec3 hsv = rgb2hsv(color);
      hsv.x = fract(hsv.x + audioLevel * audioColor);
      hsv.y = min(1.0, hsv.y + audioLevel * 0.5);
      hsv.z = min(1.0, hsv.z + audioLevel * 0.3);
      // Beat flash: bright pulse on beats
      hsv.z = min(1.0, hsv.z + beatIntensity * 0.4);
      hsv.y = max(0.0, hsv.y - beatIntensity * 0.3);
      return hsv2rgb(hsv);
    }

    // 7: Depth gradient
    if (colorEffectType == 7) {
      float depth = clamp((vPosition.z + 10.0) / 20.0, 0.0, 1.0);
      vec3 near = vec3(1.0, 0.3, 0.1);
      vec3 far = vec3(0.1, 0.3, 1.0);
      return mix(color, mix(near, far, depth), intensity);
    }

    // 8: Neon glow
    if (colorEffectType == 8) {
      vec3 hsv = rgb2hsv(color);
      hsv.y = 1.0;
      hsv.z = 1.0;
      vec3 neon = hsv2rgb(hsv);
      float glow = 1.0 + 0.5 * sin(time * 3.0 + vPosition.x * 5.0);
      return mix(color, neon * glow, intensity);
    }

    // 9: Pastel
    if (colorEffectType == 9) {
      vec3 hsv = rgb2hsv(color);
      hsv.s *= 0.4;
      hsv.z = 0.9 + 0.1 * hsv.z;
      return mix(color, hsv2rgb(hsv), intensity);
    }

    // 10: Cyberpunk (magenta/cyan)
    if (colorEffectType == 10) {
      float t = sin(vPosition.x * 2.0 + time) * 0.5 + 0.5;
      vec3 magenta = vec3(1.0, 0.0, 0.8);
      vec3 cyan = vec3(0.0, 1.0, 1.0);
      vec3 cyber = mix(magenta, cyan, t);
      return mix(color, cyber, intensity);
    }

    // 11: Fire
    if (colorEffectType == 11) {
      float fire = noise2D(vPosition.xy * 3.0 + vec2(0.0, -time * 2.0));
      vec3 fireColor = mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 1.0, 0.0), fire);
      fireColor = mix(fireColor, vec3(1.0, 0.5, 0.0), sin(fire * 3.14));
      return mix(color, fireColor, intensity);
    }

    // 12: Ice
    if (colorEffectType == 12) {
      float ice = noise2D(vPosition.xy * 2.0 + time * 0.2);
      vec3 iceColor = mix(vec3(0.7, 0.9, 1.0), vec3(0.3, 0.6, 0.9), ice);
      return mix(color, iceColor, intensity);
    }

    return color;
  }

  // Apply opacity effect
  float applyOpacityEffect(float alpha) {
    if (opacityEffectType == 0) return alpha;

    // DOF fade
    if (opacityEffectType == 1) {
      float dist = abs(vPosition.z - dofFocalDistance * 4.0 - 2.0);
      float blur = smoothstep(0.0, dofBlurAmount * 3.0, dist);
      return alpha * (1.0 - blur * opacityEffectIntensity);
    }

    // Fog
    if (opacityEffectType == 2) {
      float dist = length(vPosition);
      float fog = 1.0 - exp(-dist * fogDensity * 0.1);
      return alpha * (1.0 - fog * opacityEffectIntensity);
    }

    // Pulse
    if (opacityEffectType == 3) {
      float pulse = (sin(time * pulseSpeed * 3.14159) + 1.0) * 0.5;
      return alpha * (1.0 - (1.0 - pulse) * opacityEffectIntensity);
    }

    // Proximity (type 4)
    if (opacityEffectType == 4) {
      float dist = length(vPosition);
      float prox = 1.0 - smoothstep(0.0, 5.0, dist);
      return alpha * mix(1.0, prox, opacityEffectIntensity);
    }

    // Dissolve
    if (opacityEffectType == 5) {
      float noise = hash(vPosition.xy + vPosition.z);
      if (noise < dissolveProgress * opacityEffectIntensity) {
        return 0.0;
      }
    }

    // Scan reveal
    if (opacityEffectType == 6) {
      float scan = fract(time * 0.3);
      float yNorm = (vPosition.y + 5.0) / 10.0;
      float reveal = smoothstep(scan - 0.2, scan, yNorm);
      return alpha * mix(1.0, reveal, opacityEffectIntensity);
    }

    // Audio fade
    if (opacityEffectType == 7 && audioEnabled) {
      return alpha * (0.5 + audioLevel * 0.5);
    }

    return alpha;
  }

  // Apply creative effect
  vec4 applyCreativeEffect(vec4 fragColor) {
    if (creativeEffectType == 0) return fragColor;

    float intensity = creativeEffectIntensity;
    vec2 uv = gl_PointCoord;

    // 1: Feedback - echo/ghost effect
    if (creativeEffectType == 1) {
      float echo = sin(time * 5.0 + vPosition.x * 3.0) * 0.5 + 0.5;
      fragColor.rgb = mix(fragColor.rgb, fragColor.rgb * 1.5, echo * intensity);
      fragColor.a *= 0.8 + 0.2 * echo;
    }

    // 2: Kaleidoscope - mirror/reflect colors
    if (creativeEffectType == 2) {
      float angle = atan(vPosition.y, vPosition.x);
      float segments = 6.0;
      float kaleid = abs(mod(angle, 3.14159 / segments) - 3.14159 / segments / 2.0);
      vec3 hsv = rgb2hsv(fragColor.rgb);
      hsv.x = fract(hsv.x + kaleid * intensity);
      fragColor.rgb = hsv2rgb(hsv);
    }

    // 3: Constellation - sparkle/twinkle effect
    if (creativeEffectType == 3) {
      float sparkle = sin(time * 10.0 + vVertexIndex * 0.1) * 0.5 + 0.5;
      float twinkle = pow(sparkle, 3.0);
      fragColor.rgb += vec3(twinkle * intensity);
      fragColor.a = mix(fragColor.a, fragColor.a * (0.5 + twinkle), intensity);
    }

    // 4: Datamosh - glitchy color shifts
    if (creativeEffectType == 4) {
      float glitch = step(0.95, hash(vec2(floor(time * 10.0), vPosition.y)));
      if (glitch > 0.5) {
        fragColor.rgb = fragColor.bgr;
      }
      float shift = hash(vec2(time, vPosition.x)) * intensity * 0.1;
      fragColor.r = fragColor.r + shift;
      fragColor.b = fragColor.b - shift;
    }

    // 5: Pixel sort - brightness-based effect
    if (creativeEffectType == 5) {
      float brightness = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
      float sortThreshold = 0.5 + sin(time + vPosition.x) * 0.3;
      if (brightness > sortThreshold) {
        fragColor.rgb *= 1.0 + intensity * 0.5;
      }
    }

    // 6: Echo - multiple ghost layers
    if (creativeEffectType == 6) {
      float layers = 3.0;
      float echoAlpha = 0.0;
      for (float i = 1.0; i <= layers; i++) {
        float delay = i * 0.1;
        float echo = sin((time - delay) * 3.0 + vPosition.x) * 0.5 + 0.5;
        echoAlpha += echo / layers;
      }
      fragColor.a *= 0.7 + 0.3 * echoAlpha * intensity;
    }

    return fragColor;
  }

  void main() {
    if (vDiscard > 0.5) discard;

    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    float edgeAlpha = 1.0;

    // Render mode shapes
    // 0: points (circle), 1: gaussians (soft), 2: spheres (3D), 3: billboards (square), 4: cubes (diamond)

    if (renderMode == 0) {
      // Points - hard circle
      if (dist > 0.5) discard;
      edgeAlpha = 1.0 - smoothstep(0.4, 0.5, dist);
    }
    else if (renderMode == 1) {
      // Gaussians - very soft falloff
      float gaussian = exp(-dist * dist * 8.0);
      if (gaussian < 0.01) discard;
      edgeAlpha = gaussian;
    }
    else if (renderMode == 2) {
      // Spheres - 3D shaded look
      if (dist > 0.5) discard;
      float z = sqrt(max(0.0, 0.25 - dist * dist));
      vec3 normal = normalize(vec3(coord, z));
      vec3 light = normalize(vec3(0.5, 0.5, 1.0));
      float diffuse = max(0.0, dot(normal, light));
      edgeAlpha = 0.3 + 0.7 * diffuse;
    }
    else if (renderMode == 3) {
      // Billboards - square
      if (abs(coord.x) > 0.45 || abs(coord.y) > 0.45) discard;
      edgeAlpha = 1.0;
    }
    else if (renderMode == 4) {
      // Cubes - diamond shape
      if (abs(coord.x) + abs(coord.y) > 0.5) discard;
      edgeAlpha = 1.0 - (abs(coord.x) + abs(coord.y)) * 0.5;
    }

    // Get base color
    vec3 color = useOriginalColors ? vColor : mix(colorA / 255.0, colorB / 255.0, colorMix);

    // Apply texture mapping if enabled
    if (textureEnabled) {
      vec2 uv = calculateUV(vPosition);
      vec4 texColor = texture2D(textureMap, uv);
      // Blend texture color with point color based on textureBlend
      // textureBlend = 0: all point color, textureBlend = 1: all texture
      color = mix(color, texColor.rgb, textureBlend * texColor.a);
    }

    // Apply color effect
    color = applyColorEffect(color);

    // Calculate alpha
    float alpha = vAlpha * opacity * edgeAlpha;

    // Apply opacity effect
    alpha = applyOpacityEffect(alpha);

    // Hologram scanlines enhancement
    if (colorEffectType == 4) {
      float scanline = abs(sin(gl_FragCoord.y * 0.5));
      alpha *= 0.7 + scanline * 0.3;
      color += vec3(0.0, 0.1, 0.2) * scanline;
    }

    vec4 fragColor = vec4(color, alpha);

    // Apply creative effect
    fragColor = applyCreativeEffect(fragColor);

    // Handle reveal mode (mouseMode == 3) - fade in points near mouse
    if (mouseMode == 3 && mouseInfluence > 0.0) {
      float revealFactor = 1.0 - smoothstep(0.0, 1.0, vMouseDistance);
      fragColor.a *= revealFactor * mouseInfluence + (1.0 - mouseInfluence);
    }

    gl_FragColor = fragColor;
  }
`;class _c{scene;camera;renderer=null;canvas=null;_width=1920;_height=1080;points=null;geometry=null;material=null;startTime=0;plyData=null;wireframe=null;wireframeGeometry=null;wireframeMaterial=null;currentRenderMode="points";originalPositions=null;velocities=null;mousePosition=new He;mouseNormalized=new fe;_mouseRaycaster=new sl;_mouseCamDir=new He;_mousePlaneNormal=new He;_mousePlanePoint=new He;_mousePlane=new nl;_mouseIntersection=new He;pointCloudScale=1;pointCloudBounds={min:new He,max:new He,size:1};constructor(e,t){if(this.scene=new ea,this.scene.background=null,typeof e=="number"){const a=e,o=t||1080;this._width=a,this._height=o,this.camera=new zr(60,a/o,.1,1e3),this.camera.position.z=5}else this.canvas=e,this.camera=new zr(60,e.width/e.height,.1,1e3),this.camera.position.z=5,this.renderer=new rr({canvas:e,alpha:!0,antialias:!0,premultipliedAlpha:!1,preserveDrawingBuffer:!0}),this.renderer.setSize(e.width,e.height,!1),this.renderer.setPixelRatio(1),e.addEventListener("mousemove",this.onMouseMove.bind(this)),e.addEventListener("mouseleave",()=>{this.mousePosition.set(1e3,1e3,1e3)});this.startTime=performance.now()}onMouseMove(e){if(!this.canvas)return;const t=this.canvas.getBoundingClientRect(),a=(e.clientX-t.left)/t.width*2-1,o=-((e.clientY-t.top)/t.height)*2+1;this.updateMousePosition(a,o)}setMouseNormalized(e,t){this.updateMousePosition(e,t)}clearMousePosition(){this.mousePosition.set(1e3,1e3,1e3)}updateMousePosition(e,t){this.mouseNormalized.x=e,this.mouseNormalized.y=t,this._mouseRaycaster.setFromCamera(this.mouseNormalized,this.camera),this.camera.getWorldDirection(this._mouseCamDir),this._mousePlaneNormal.copy(this._mouseCamDir).negate(),this._mousePlanePoint.set(0,0,0),this._mousePlane.setFromNormalAndCoplanarPoint(this._mousePlaneNormal,this._mousePlanePoint);const a=this._mouseRaycaster.ray;if(a.intersectPlane(this._mousePlane,this._mouseIntersection))this.mousePosition.copy(this._mouseIntersection);else{const o=this.camera.position.length();this.mousePosition.copy(a.origin).addScaledVector(a.direction,o)}}loadData(e){this.plyData=e;const t=e.boundingBox;this.pointCloudBounds.min.set(t.min.x,t.min.y,t.min.z),this.pointCloudBounds.max.set(t.max.x,t.max.y,t.max.z),this.pointCloudBounds.size=Math.max(t.max.x-t.min.x,t.max.y-t.min.y,t.max.z-t.min.z),this.pointCloudBounds.size<.1&&(this.pointCloudBounds.size=1),this.createGeometry(e)}getData(){return this.plyData}createGeometry(e){this.geometry&&this.geometry.dispose(),this.material&&this.material.dispose(),this.points&&this.scene.remove(this.points);const t=e.vertices,a=t.length;this.geometry=new Io;const o=new Float32Array(a*3);this.originalPositions=new Float32Array(a*3);const r=new Float32Array(a*3),s=new Float32Array(a),n=new Float32Array(a);this.velocities=new Float32Array(a*3);const l=new Float32Array(a*2),u=e.center;for(let f=0;f<a;f++){const d=t[f],h=f*3;o[h]=d.x-u.x,o[h+1]=d.y-u.y,o[h+2]=d.z-u.z,this.originalPositions[h]=o[h],this.originalPositions[h+1]=o[h+1],this.originalPositions[h+2]=o[h+2],r[h]=d.r/255,r[h+1]=d.g/255,r[h+2]=d.b/255,s[f]=d.a/255,n[f]=f,this.velocities[h]=0,this.velocities[h+1]=0,this.velocities[h+2]=0;const m=f*2;l[m]=d.texture_u??0,l[m+1]=d.texture_v??0}this.geometry.setAttribute("position",new It(o,3)),this.geometry.setAttribute("originalPosition",new It(this.originalPositions,3)),this.geometry.setAttribute("color",new It(r,3)),this.geometry.setAttribute("alpha",new It(s,1)),this.geometry.setAttribute("vertexIndex",new It(n,1)),this.geometry.setAttribute("velocity",new It(this.velocities,3)),this.geometry.setAttribute("texUV",new It(l,2)),this.material=new ai({vertexShader:wc,fragmentShader:Sc,uniforms:this.createUniforms(),transparent:!0,depthWrite:!1,blending:_a}),this.points=new ll(this.geometry,this.material),this.scene.add(this.points),this.createWireframeGeometry(e,o,r)}createWireframeGeometry(e,t,a){this.wireframeGeometry&&this.wireframeGeometry.dispose(),this.wireframeMaterial&&this.wireframeMaterial.dispose(),this.wireframe&&this.scene.remove(this.wireframe);const o=e.vertices.length;if(o<2)return;const r=e.boundingBox,n=Math.max(r.max.x-r.min.x,r.max.y-r.min.y,r.max.z-r.min.z)*.025,l=n*n,u=[],f=8,d=new Uint8Array(o),h=n*2,m=new Map;for(let C=0;C<o;C++){const T=t[C*3],I=t[C*3+1],W=t[C*3+2],G=Math.floor(T/h),O=Math.floor(I/h),L=Math.floor(W/h),N=`${G},${O},${L}`;m.has(N)||m.set(N,[]),m.get(N).push(C)}for(let C=0;C<o;C++){if(d[C]>=f)continue;const T=t[C*3],I=t[C*3+1],W=t[C*3+2],G=Math.floor(T/h),O=Math.floor(I/h),L=Math.floor(W/h);for(let N=-1;N<=1;N++)for(let ce=-1;ce<=1;ce++)for(let ae=-1;ae<=1;ae++){const se=`${G+N},${O+ce},${L+ae}`,te=m.get(se);if(te)for(const Q of te){if(Q<=C||d[C]>=f||d[Q]>=f)continue;const $=t[Q*3],j=t[Q*3+1],Ae=t[Q*3+2],Ce=$-T,Be=j-I,ie=Ae-W,Pe=Ce*Ce+Be*Be+ie*ie;Pe<l&&Pe>1e-4&&(u.push(C,Q),d[C]++,d[Q]++)}}}if(u.length===0)return;this.wireframeGeometry=new Io;const b=new Float32Array(u.length*3),M=new Float32Array(u.length*3);for(let C=0;C<u.length;C++){const T=u[C];b[C*3]=t[T*3],b[C*3+1]=t[T*3+1],b[C*3+2]=t[T*3+2],M[C*3]=a[T*3],M[C*3+1]=a[T*3+1],M[C*3+2]=a[T*3+2]}this.wireframeGeometry.setAttribute("position",new It(b,3)),this.wireframeGeometry.setAttribute("color",new It(M,3)),this.wireframeMaterial=new zo({vertexColors:!0,transparent:!0,opacity:1,blending:_a}),this.wireframe=new cl(this.wireframeGeometry,this.wireframeMaterial),this.wireframe.visible=!1,this.scene.add(this.wireframe)}createUniforms(){return{time:{value:0},pointSize:{value:3},sizeAttenuation:{value:!0},opacity:{value:1},renderMode:{value:0},animationProgress:{value:0},animationIntensity:{value:1},animationType:{value:0},explodeForce:{value:1},voxelGridSize:{value:16},peelAxis:{value:new He(0,1,0)},gravity:{value:9.8},turbulence:{value:0},displacementType:{value:0},displacementAmount:{value:.5},noiseScale:{value:2},noiseSpeed:{value:1},waveFrequency:{value:2},waveAmplitude:{value:.3},glitchIntensity:{value:.5},windDirection:{value:new He(1,0,0)},windStrength:{value:.5},audioEnabled:{value:!1},audioLevel:{value:0},audioDisplacement:{value:.5},audioScale:{value:.3},audioColor:{value:.5},beatIntensity:{value:0},beatPhase:{value:0},scaleUniform:{value:1},rotation3D:{value:new He(0,0,0)},position3D:{value:new He(0,0,0)},sliceEnabled:{value:!1},sliceAxis:{value:new He(0,1,0)},slicePosition:{value:0},sliceThickness:{value:.1},mousePosition:{value:new He(1e3,1e3,1e3)},mouseInfluence:{value:0},mouseRadius:{value:.2},mouseMode:{value:0},colorEffectType:{value:0},colorEffectIntensity:{value:1},hueShift:{value:0},useOriginalColors:{value:!0},colorA:{value:new He(255,255,255)},colorB:{value:new He(100,200,255)},colorMix:{value:0},hologramSpeed:{value:2},hologramDensity:{value:20},opacityEffectType:{value:0},opacityEffectIntensity:{value:1},dofFocalDistance:{value:.5},dofBlurAmount:{value:.5},fogDensity:{value:.3},fogColor:{value:new He(50,50,80)},pulseSpeed:{value:1},dissolveProgress:{value:0},creativeEffectType:{value:0},creativeEffectIntensity:{value:1},trailLength:{value:.5},textureEnabled:{value:!1},textureMap:{value:null},textureBlend:{value:.5},textureProjection:{value:0},textureScale:{value:1},textureOffset:{value:new fe(0,0)},pointCloudMin:{value:new He(-1,-1,-1)},pointCloudMax:{value:new He(1,1,1)}}}textureMap=null;videoElement=null;currentTexturePath="";setTexture(e,t="image"){if(e!==this.currentTexturePath){if(this.currentTexturePath=e,this.textureMap&&(this.textureMap.dispose(),this.textureMap=null),this.videoElement&&(this.videoElement.pause(),this.videoElement.src="",this.videoElement=null),!e){this.material&&(this.material.uniforms.textureEnabled.value=!1,this.material.uniforms.textureMap.value=null);return}if(t==="video"){const a=document.createElement("video");a.src=e,a.loop=!0,a.muted=!0,a.playsInline=!0,a.crossOrigin="anonymous",a.addEventListener("loadeddata",()=>{const o=new Ii(a);o.minFilter=le,o.magFilter=le,o.format=qe,this.textureMap=o,this.videoElement=a,this.material&&(this.material.uniforms.textureMap.value=o),a.play().catch(r=>console.warn("Video autoplay blocked:",r))}),a.load()}else new ul().load(e,o=>{o.minFilter=le,o.magFilter=le,this.textureMap=o,this.material&&(this.material.uniforms.textureMap.value=o)},void 0,o=>console.error("Failed to load texture:",o))}}updateVideoTexture(){this.videoElement&&this.textureMap&&!this.videoElement.paused&&(this.textureMap.needsUpdate=!0)}update(e,t=0,a){if(!this.material)return;const o=(performance.now()-this.startTime)/1e3,r=this.material.uniforms;r.time.value=o,r.pointSize.value=e.pointSize,r.sizeAttenuation.value=e.pointSizeAttenuation,r.opacity.value=e.opacity,r.renderMode.value=this.getRenderModeIndex(e.renderMode);const s=e.renderMode==="wireframe";if(this.points&&(this.points.visible=!s),this.wireframe&&(this.wireframe.visible=s,this.wireframeMaterial&&(this.wireframeMaterial.opacity=e.opacity)),this.currentRenderMode=e.renderMode,this.geometry&&this.plyData){const l=this.plyData.vertices.length,u=e.pointDensity??1,f=Math.max(1,Math.floor(l*u));this.geometry.setDrawRange(0,f)}r.animationType.value=this.getAnimationTypeIndex(e.animationType),r.animationProgress.value=e.animationLoop?.5-.5*Math.cos(o*e.animationSpeed*Math.PI*2):e.animationProgress,r.animationIntensity.value=e.animationIntensity,r.explodeForce.value=e.explodeForce,r.voxelGridSize.value=e.voxelGridSize,r.peelAxis.value.set(e.peelAxis==="x"?1:0,e.peelAxis==="y"?1:0,e.peelAxis==="z"?1:0),r.gravity.value=e.physics.gravity,r.turbulence.value=e.physics.turbulence,r.displacementType.value=this.getDisplacementTypeIndex(e.displacementType),r.displacementAmount.value=e.displacementAmount,r.noiseScale.value=e.noiseScale,r.noiseSpeed.value=e.noiseSpeed,r.waveFrequency.value=e.waveFrequency,r.waveAmplitude.value=e.waveAmplitude,r.glitchIntensity.value=e.glitchIntensity,r.windDirection.value.set(e.windDirection.x,e.windDirection.y,e.windDirection.z),r.windStrength.value=e.windStrength,r.audioEnabled.value=e.audioEnabled,r.audioLevel.value=t,r.audioDisplacement.value=e.audioDisplacement,r.audioScale.value=e.audioScale,r.audioColor.value=e.audioColor,r.beatIntensity.value=a?.beat?.beatIntensity||0,r.beatPhase.value=a?.beatPhase||0,r.scaleUniform.value=e.scaleUniform,r.rotation3D.value.set(e.rotationX*Math.PI/180,e.rotationY*Math.PI/180,e.rotationZ*Math.PI/180),r.position3D.value.set(e.positionX,e.positionY,e.positionZ),r.sliceEnabled.value=e.slicePlane.enabled,r.sliceAxis.value.set(e.slicePlane.axis==="x"?1:0,e.slicePlane.axis==="y"?1:0,e.slicePlane.axis==="z"?1:0),r.slicePosition.value=e.slicePlane.animated?Math.sin(o*e.slicePlane.speed)*2:e.slicePlane.position*2,r.sliceThickness.value=e.slicePlane.thickness*4,this.pointCloudScale=e.scaleUniform,r.mousePosition.value.copy(this.mousePosition),r.mouseInfluence.value=e.mouseInfluence;const n=this.pointCloudBounds.size*e.scaleUniform*.5;r.mouseRadius.value=e.mouseRadius*n,r.mouseMode.value=this.getMouseModeIndex(e.mouseMode),r.colorEffectType.value=this.getColorEffectIndex(e.colorEffectType),r.colorEffectIntensity.value=e.colorEffectIntensity,r.hueShift.value=e.hueShift,r.useOriginalColors.value=e.useOriginalColors,r.colorA.value.set(e.colorA[0],e.colorA[1],e.colorA[2]),r.colorB.value.set(e.colorB[0],e.colorB[1],e.colorB[2]),r.colorMix.value=e.colorMix,r.hologramSpeed.value=e.hologramSpeed,r.hologramDensity.value=e.hologramDensity,r.opacityEffectType.value=this.getOpacityEffectIndex(e.opacityEffectType),r.opacityEffectIntensity.value=e.opacityEffectIntensity,r.dofFocalDistance.value=e.dofFocalDistance,r.dofBlurAmount.value=e.dofBlurAmount,r.fogDensity.value=e.fogDensity,r.fogColor.value.set(e.fogColor[0],e.fogColor[1],e.fogColor[2]),r.pulseSpeed.value=e.pulseSpeed,r.dissolveProgress.value=e.dissolveProgress,r.creativeEffectType.value=this.getCreativeEffectIndex(e.creativeEffectType),r.creativeEffectIntensity.value=e.creativeEffectIntensity,r.trailLength.value=e.trailLength,r.textureEnabled.value=e.textureEnabled&&this.textureMap!==null,r.textureBlend.value=e.textureBlend,r.textureProjection.value=this.getTextureProjectionIndex(e.textureProjection),r.textureScale.value=e.textureScale??1,r.textureOffset.value.set(e.textureOffsetX??0,e.textureOffsetY??0),r.pointCloudMin.value.copy(this.pointCloudBounds.min),r.pointCloudMax.value.copy(this.pointCloudBounds.max),this.updateVideoTexture(),this.updateCamera(e)}getTextureProjectionIndex(e){const a=["spherical","cylindrical","planarXY","planarXZ","planarYZ","box","native"].indexOf(e||"spherical");return a>=0?a:0}updateCamera(e){this.camera.fov=e.cameraFov,this.camera.updateProjectionMatrix();const t=e.cameraDistance,a=e.cameraOrbitX*Math.PI/180,o=e.cameraOrbitY*Math.PI/180,r=(e.cameraRoll??0)*Math.PI/180;let s=o;e.autoRotate&&(s+=(performance.now()-this.startTime)/1e3*e.autoRotateSpeed*Math.PI/180);const n=Math.sin(s)*Math.cos(a)*t,l=Math.sin(a)*t,u=Math.cos(s)*Math.cos(a)*t;this.camera.position.set(n,l,u),this.camera.lookAt(0,0,0),this.camera.rotation.z=r;const f=(e.cameraPanX??0)*.02,d=(e.cameraPanY??0)*.02;if(f!==0||d!==0){const h=this.canvas?this.canvas.width:this._width,m=this.canvas?this.canvas.height:this._height;this.camera.setViewOffset(h,m,-f*h,d*m,h,m),this.camera.updateProjectionMatrix()}else this.camera.clearViewOffset(),this.camera.updateProjectionMatrix()}getAnimationTypeIndex(e){return["none","explode","implode","slice","voxelSnap","peel","gravity","swarm","morph","orbit","wave3d","scatter","spiral"].indexOf(e)}getDisplacementTypeIndex(e){return["none","noise","audioReactive","wave","glitch","wind","magnetic","ripple"].indexOf(e)}getRenderModeIndex(e){return Math.max(0,["points","gaussians","spheres","billboards","cubes"].indexOf(e))}getColorEffectIndex(e){const a=["none","chromatic","heatmap","pointillist","hologram","rainbow","audioColor","depthGradient","neon","pastel","cyberpunk","fire","ice"].indexOf(e);return a>=0?a:0}getOpacityEffectIndex(e){return["none","dof","fog","pulse","proximity","dissolve","scanReveal","audioFade"].indexOf(e)}getCreativeEffectIndex(e){return["none","feedback","kaleidoscope","constellation","datamosh","pixelSort","echo"].indexOf(e)}getMouseModeIndex(e){return["attract","repel","swirl","reveal"].indexOf(e)}render(){this.renderer&&this.renderer.render(this.scene,this.camera)}renderTo(e,t){e.setRenderTarget(t),e.setClearColor(0,0),e.clear(),e.render(this.scene,this.camera),e.setRenderTarget(null)}resize(e,t){this._width=e,this._height=t,this.camera.aspect=e/t,this.camera.updateProjectionMatrix(),this.renderer&&this.renderer.setSize(e,t,!1)}dispose(){this.geometry&&this.geometry.dispose(),this.material&&this.material.dispose(),this.points&&this.scene.remove(this.points),this.wireframeGeometry&&this.wireframeGeometry.dispose(),this.wireframeMaterial&&this.wireframeMaterial.dispose(),this.wireframe&&this.scene.remove(this.wireframe),this.textureMap&&this.textureMap.dispose(),this.videoElement&&(this.videoElement.pause(),this.videoElement.src=""),this.renderer&&this.renderer.dispose(),this.canvas&&this.canvas.removeEventListener("mousemove",this.onMouseMove)}getContext(){return this.renderer?this.renderer.getContext():null}getCanvas(){return this.canvas}}function Cc(i){const e=i.split(`
`),t=[];let a=null,o="ascii",r=0;for(let s=0;s<e.length;s++){const n=e[s].trim();if(r+=e[s].length+1,n==="end_header")break;if(n.startsWith("format ")){const l=n.split(" ")[1];l==="binary_little_endian"?o="binary_little_endian":l==="binary_big_endian"?o="binary_big_endian":o="ascii"}if(n.startsWith("element ")){const l=n.split(" ");a={name:l[1],count:parseInt(l[2],10),properties:[]},t.push(a)}if(n.startsWith("property ")&&a){const l=n.split(" ");l[1]==="list"?a.properties.push({name:l[4],type:l[3],isList:!0,countType:l[2]}):a.properties.push({name:l[2],type:l[1],isList:!1})}}return{elements:t,format:o,headerLength:r}}function Mt(i){switch(i){case"char":case"uchar":case"int8":case"uint8":return 1;case"short":case"ushort":case"int16":case"uint16":return 2;case"int":case"uint":case"int32":case"uint32":case"float":case"float32":return 4;case"double":case"float64":return 8;default:return 4}}function Ot(i,e,t,a){switch(t){case"char":case"int8":return i.getInt8(e);case"uchar":case"uint8":return i.getUint8(e);case"short":case"int16":return i.getInt16(e,a);case"ushort":case"uint16":return i.getUint16(e,a);case"int":case"int32":return i.getInt32(e,a);case"uint":case"uint32":return i.getUint32(e,a);case"float":case"float32":return i.getFloat32(e,a);case"double":case"float64":return i.getFloat64(e,a);default:return i.getFloat32(e,a)}}function Pc(i){const e=i.map(o=>o.name),t=e.some(o=>o.startsWith("scale_")),a=e.some(o=>o.startsWith("rot_"));return t&&a}function kc(i,e,t){const a=[],o=i.substring(e).trim().split(`
`),r=t.find(n=>n.name==="vertex");if(!r)return a;const s={};r.properties.forEach((n,l)=>{s[n.name]=l});for(let n=0;n<r.count&&n<o.length;n++){const l=o[n].trim().split(/\s+/).map(Number),u={x:l[s.x]??0,y:l[s.y]??0,z:l[s.z]??0,r:s.red!==void 0?l[s.red]:255,g:s.green!==void 0?l[s.green]:255,b:s.blue!==void 0?l[s.blue]:255,a:s.alpha!==void 0?l[s.alpha]:255};s.nx!==void 0&&(u.nx=l[s.nx]),s.ny!==void 0&&(u.ny=l[s.ny]),s.nz!==void 0&&(u.nz=l[s.nz]),s.scale_0!==void 0&&(u.scale_0=l[s.scale_0]),s.scale_1!==void 0&&(u.scale_1=l[s.scale_1]),s.scale_2!==void 0&&(u.scale_2=l[s.scale_2]),s.rot_0!==void 0&&(u.rot_0=l[s.rot_0]),s.rot_1!==void 0&&(u.rot_1=l[s.rot_1]),s.rot_2!==void 0&&(u.rot_2=l[s.rot_2]),s.rot_3!==void 0&&(u.rot_3=l[s.rot_3]),s.f_dc_0!==void 0&&(u.f_dc_0=l[s.f_dc_0]),s.f_dc_1!==void 0&&(u.f_dc_1=l[s.f_dc_1]),s.f_dc_2!==void 0&&(u.f_dc_2=l[s.f_dc_2]);const f=s.u??s.s??s.texture_u,d=s.v??s.t??s.texture_v;f!==void 0&&(u.texture_u=l[f]),d!==void 0&&(u.texture_v=l[d]),a.push(u)}return a}function Tc(i,e,t,a){const o=[],r=new DataView(i,e),s=t.find(u=>u.name==="vertex");if(!s)return o;let n=0;const l={};for(const u of s.properties)l[u.name]={offset:n,type:u.type},n+=Mt(u.type);for(let u=0;u<s.count;u++){const f=u*n,d=$=>{const j=l[$];if(j)return Ot(r,f+j.offset,j.type,a)},h={x:d("x")??0,y:d("y")??0,z:d("z")??0,r:d("red")??255,g:d("green")??255,b:d("blue")??255,a:d("alpha")??255},m=l.red;m&&(m.type==="float"||m.type==="float32")&&(h.r=Math.floor(h.r*255),h.g=Math.floor(h.g*255),h.b=Math.floor(h.b*255),h.a=Math.floor(h.a*255));const b=d("nx"),M=d("ny"),C=d("nz");b!==void 0&&(h.nx=b),M!==void 0&&(h.ny=M),C!==void 0&&(h.nz=C);const T=d("scale_0"),I=d("scale_1"),W=d("scale_2"),G=d("rot_0"),O=d("rot_1"),L=d("rot_2"),N=d("rot_3");T!==void 0&&(h.scale_0=T),I!==void 0&&(h.scale_1=I),W!==void 0&&(h.scale_2=W),G!==void 0&&(h.rot_0=G),O!==void 0&&(h.rot_1=O),L!==void 0&&(h.rot_2=L),N!==void 0&&(h.rot_3=N);const ce=d("f_dc_0"),ae=d("f_dc_1"),se=d("f_dc_2");ce!==void 0&&(h.f_dc_0=ce),ae!==void 0&&(h.f_dc_1=ae),se!==void 0&&(h.f_dc_2=se);const te=d("u")??d("s")??d("texture_u"),Q=d("v")??d("t")??d("texture_v");te!==void 0&&(h.texture_u=te),Q!==void 0&&(h.texture_v=Q),o.push(h)}return o}function Mc(i){if(i.length===0)return{boundingBox:{min:{x:0,y:0,z:0},max:{x:0,y:0,z:0}},center:{x:0,y:0,z:0}};let e=1/0,t=1/0,a=1/0,o=-1/0,r=-1/0,s=-1/0;for(const n of i)n.x<e&&(e=n.x),n.y<t&&(t=n.y),n.z<a&&(a=n.z),n.x>o&&(o=n.x),n.y>r&&(r=n.y),n.z>s&&(s=n.z);return{boundingBox:{min:{x:e,y:t,z:a},max:{x:o,y:r,z:s}},center:{x:(e+o)/2,y:(t+r)/2,z:(a+s)/2}}}async function Rc(i){let e;return i.startsWith("http://")||i.startsWith("https://")?e=await(await fetch(i)).arrayBuffer():e=await(await fetch(i)).arrayBuffer(),sr(e)}function Ac(i){let e=0;for(const t of i.properties)t.isList||(e+=Mt(t.type));return e}function Bc(i,e,t,a){if(!t.properties.some(s=>s.isList)){const s=Ac(t);return e+s*t.count}let r=e;for(let s=0;s<t.count;s++)for(const n of t.properties)if(n.isList){const l=Mt(n.countType),u=Ot(i,r,n.countType,a);r+=l,r+=u*Mt(n.type)}else r+=Mt(n.type);return r}function Ec(i,e,t,a){const o=[];let r=e;for(let s=0;s<t.count;s++){const n=[];for(const l of t.properties)if(l.isList){const u=Mt(l.countType),f=Ot(i,r,l.countType,a);r+=u;for(let d=0;d<f;d++)n.push(Ot(i,r,l.type,a)),r+=Mt(l.type)}else r+=Mt(l.type);o.push(n)}return{faces:o,endOffset:r}}function Fc(i,e,t,a){const o=[];let r=0;const s={};for(const n of t.properties)n.isList||(s[n.name]={offset:r,type:n.type},r+=Mt(n.type));for(let n=0;n<t.count;n++){const l=e+n*r,u=s.tx,f=s.u,d=s.v;o.push({tx:u?Ot(i,l+u.offset,u.type,a):0,u:f?Ot(i,l+f.offset,f.type,a):0,v:d?Ot(i,l+d.offset,d.type,a):0})}return{uvs:o,endOffset:e+r*t.count}}function Lc(i,e,t,a){const o=[];let r=e;for(let s=0;s<t.count;s++){const n=[];for(const l of t.properties)if(l.isList){const u=Mt(l.countType),f=Ot(i,r,l.countType,a);r+=u;for(let d=0;d<f;d++)n.push(Ot(i,r,l.type,a)),r+=Mt(l.type)}else r+=Mt(l.type);o.push(n)}return{texFaces:o,endOffset:r}}function sr(i){const t=new TextDecoder("ascii").decode(i.slice(0,Math.min(i.byteLength,1e4))),{elements:a,format:o,headerLength:r}=Cc(t),s=a.find(h=>h.name==="vertex");if(!s)throw new Error("PLY file does not contain vertex element");const n=Pc(s.properties)?"gaussian":"pointcloud";let l;o==="ascii"?l=kc(t,r,a):l=Tc(i,r,a,o==="binary_little_endian");let u=l.length>0&&l[0].texture_u!==void 0;if(!u&&o!=="ascii"){const h=a.find(M=>M.name==="face"),m=a.find(M=>M.name==="multi_texture_vertex"),b=a.find(M=>M.name==="multi_texture_face");if(h&&m&&b)try{const M=o==="binary_little_endian",C=new DataView(i,r);let T=0;const I={};for(const N of a)I[N.name]=T,T=Bc(C,T,N,M);const{faces:W}=Ec(C,I.face,h,M),{uvs:G}=Fc(C,I.multi_texture_vertex,m,M),{texFaces:O}=Lc(C,I.multi_texture_face,b,M),L=Math.min(W.length,O.length);for(let N=0;N<L;N++){const ce=W[N],ae=O[N],se=Math.min(ce.length,ae.length);for(let te=0;te<se;te++){const Q=ce[te],$=ae[te];Q<l.length&&$<G.length&&l[Q].texture_u===void 0&&(l[Q].texture_u=G[$].u,l[Q].texture_v=G[$].v)}}u=l.some(N=>N.texture_u!==void 0),u&&console.log(`[PLY] Mapped UVs from multi_texture elements to ${l.filter(N=>N.texture_u!==void 0).length}/${l.length} vertices`)}catch(M){console.warn("[PLY] Failed to parse multi_texture elements:",M)}}const{boundingBox:f,center:d}=Mc(l);return{vertices:l,dataType:n,hasUVs:u,boundingBox:f,center:d}}async function Bp(i){return new Promise((e,t)=>{const a=new FileReader;a.onload=()=>{try{const o=sr(a.result);e(o)}catch(o){t(o)}},a.onerror=()=>t(a.error),a.readAsArrayBuffer(i)})}const _o=32;function Gs(i){const e=Math.floor(i.byteLength/_o);if(e===0)throw new Error("Invalid .splat file: no splat data found");console.log(`[splatLoader] Parsing ${e} splats from ${i.byteLength} bytes`);const t=new Float32Array(i),a=new Uint8Array(i),o=new Array(e);let r=1/0,s=1/0,n=1/0,l=-1/0,u=-1/0,f=-1/0,d=0,h=0,m=0;for(let b=0;b<e;b++){const M=b*_o/4,C=b*_o,T=t[M],I=t[M+1],W=t[M+2],G=t[M+3],O=t[M+4],L=t[M+5],N=a[C+24],ce=a[C+25],ae=a[C+26],se=a[C+27],te=(a[C+28]-128)/128,Q=(a[C+29]-128)/128,$=(a[C+30]-128)/128,j=(a[C+31]-128)/128;o[b]={x:T,y:I,z:W,r:N,g:ce,b:ae,a:se,scale_0:G,scale_1:O,scale_2:L,rot_0:te,rot_1:Q,rot_2:$,rot_3:j},T<r&&(r=T),I<s&&(s=I),W<n&&(n=W),T>l&&(l=T),I>u&&(u=I),W>f&&(f=W),d+=T,h+=I,m+=W}return{vertices:o,dataType:"gaussian",hasUVs:!1,boundingBox:{min:{x:r,y:s,z:n},max:{x:l,y:u,z:f}},center:{x:d/e,y:h/e,z:m/e}}}async function Dc(i){const e=await fetch(i);if(!e.ok)throw new Error(`Failed to fetch .splat file: ${e.status} ${e.statusText}`);const t=await e.arrayBuffer();return Gs(t)}function ua(i){const e={};for(const t of i)e[t.key]=t.default;return e}const zc={earth:0,mars:1,jupiter:2,saturn:3},Os=[{kind:"select",key:"planet",label:"Planet",group:"Planet",options:[{value:"earth",label:"Earth"},{value:"mars",label:"Mars"},{value:"jupiter",label:"Jupiter"},{value:"saturn",label:"Saturn"}],default:"earth"},{kind:"slider",key:"cameraDistance",label:"Distance",group:"Camera",min:1.05,max:8,step:.01,default:4},{kind:"slider",key:"fovDeg",label:"FOV",group:"Camera",min:15,max:90,step:1,default:50},{kind:"angle",key:"cameraYaw",label:"Yaw",group:"Camera",default:0},{kind:"angle",key:"cameraPitch",label:"Pitch",group:"Camera",default:0},{kind:"slider",key:"planetX",label:"Planet X",group:"Camera",min:-3,max:3,step:.01,default:0},{kind:"slider",key:"planetY",label:"Planet Y",group:"Camera",min:-3,max:3,step:.01,default:0},{kind:"slider",key:"rotationSpeed",label:"Spin Speed (°/s)",group:"Rotation",min:-30,max:30,step:.1,default:4},{kind:"angle",key:"rotationOffset",label:"Rotation Offset",group:"Rotation",default:0},{kind:"angle",key:"sunYaw",label:"Sun Yaw",group:"Lighting",default:-45},{kind:"angle",key:"sunPitch",label:"Sun Pitch",group:"Lighting",default:15},{kind:"slider",key:"sunBrightness",label:"Sun Brightness",group:"Lighting",min:0,max:3,step:.01,default:1},{kind:"slider",key:"emission",label:"Self-Emission",group:"Lighting",min:0,max:1.5,step:.01,default:.35},{kind:"slider",key:"outerGlow",label:"Outer Glow",group:"Lighting",min:0,max:2,step:.01,default:0},{kind:"slider",key:"cloudCoverage",label:"Cloud Coverage",group:"Clouds",min:0,max:1,step:.01,default:.65},{kind:"slider",key:"cloudThickness",label:"Cloud Thickness",group:"Clouds",min:.5,max:4,step:.05,default:1.8},{kind:"slider",key:"cloudSpeed",label:"Cloud Speed",group:"Clouds",min:0,max:3,step:.01,default:.7},{kind:"color",key:"cloudColor",label:"Cloud Color",group:"Clouds",default:[255,255,255]},{kind:"slider",key:"atmosphereHeight",label:"Atmosphere Thickness",group:"Atmosphere",min:0,max:.3,step:.005,default:.06},{kind:"slider",key:"auroraStrength",label:"Aurora Strength",group:"Atmosphere",min:0,max:2,step:.01,default:.8},{kind:"color",key:"landColor",label:"Land Color",group:"Earth Surface",default:[110,175,70]},{kind:"color",key:"shorelineColor",label:"Shoreline Glow Color",group:"Earth Surface",default:[60,230,220]},{kind:"slider",key:"shorelineIntensity",label:"Shoreline Glow Intensity",group:"Earth Surface",min:0,max:5,step:.05,default:1.6},{kind:"slider",key:"shorelineWidth",label:"Shoreline Width",group:"Earth Surface",min:.005,max:.1,step:.001,default:.04},{kind:"slider",key:"starDensity",label:"Star Density",group:"Background",min:0,max:2,step:.01,default:1},{kind:"slider",key:"ringInner",label:"Ring Inner Radius",group:"Saturn",min:1.05,max:2.5,step:.01,default:1.25},{kind:"slider",key:"ringOuter",label:"Ring Outer Radius",group:"Saturn",min:1.5,max:4,step:.01,default:2.3},{kind:"slider",key:"ringOpacity",label:"Ring Opacity",group:"Saturn",min:0,max:1,step:.01,default:.95},{kind:"slider",key:"ringDetail",label:"Ring Detail",group:"Saturn",min:0,max:1.5,step:.01,default:1}],Oo=ua(Os),Ic=`
const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717958;

struct Globals {
  resolution:        vec2<f32>,
  time:              f32,
  planet_id:         u32,         // 0=earth, 1=mars, 2=jupiter, 3=saturn

  camera_distance:   f32,
  fov_deg:           f32,
  camera_yaw:        f32,         // degrees
  camera_pitch:      f32,         // degrees

  rotation_offset:   f32,         // degrees (manual)
  rotation_anim:     f32,         // degrees (time-driven)
  sun_yaw:           f32,         // degrees
  sun_pitch:         f32,         // degrees

  cloud_coverage:    f32,
  cloud_phase:       f32,         // accumulated cloud time (for scroll)
  atmosphere_height: f32,         // fraction of planet radius
  aurora_strength:   f32,

  star_density:      f32,
  ring_inner:        f32,
  ring_outer:        f32,
  ring_opacity:      f32,

  // ── Added: cloud color (rgb) + sun brightness ──
  cloud_color:       vec3<f32>,
  sun_brightness:    f32,

  // ── Planet world-space offset + ring detail multiplier ──
  planet_x:          f32,
  planet_y:          f32,
  ring_detail:       f32,         // 0..1.5 — multiplier on ring micro-bands
  pad_a:             f32,

  // ── Emission + outer glow ──
  emission:          f32,
  outer_glow:        f32,
  pad0:              f32,
  pad1:              f32,

  // ── Earth surface controls ──
  land_color:        vec3<f32>,
  shoreline_intensity: f32,
  shoreline_color:   vec3<f32>,
  shoreline_width:   f32,
  // ── Cloud thickness (multiplier on absorption) ──
  cloud_thickness:   f32,
  pad_b:             f32,
  pad_c:             f32,
  pad_d:             f32,
};

@group(0) @binding(0) var<uniform> u: Globals;

// ── Hash + noise helpers ──
fn hash11(n: f32) -> f32 {
  return fract(sin(n * 12.9898) * 43758.5453);
}
fn hash21(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
fn hash31(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let v000 = hash31(i);
  let v100 = hash31(i + vec3(1.0, 0.0, 0.0));
  let v010 = hash31(i + vec3(0.0, 1.0, 0.0));
  let v110 = hash31(i + vec3(1.0, 1.0, 0.0));
  let v001 = hash31(i + vec3(0.0, 0.0, 1.0));
  let v101 = hash31(i + vec3(1.0, 0.0, 1.0));
  let v011 = hash31(i + vec3(0.0, 1.0, 1.0));
  let v111 = hash31(i + vec3(1.0, 1.0, 1.0));
  let x00 = mix(v000, v100, s.x);
  let x10 = mix(v010, v110, s.x);
  let x01 = mix(v001, v101, s.x);
  let x11 = mix(v011, v111, s.x);
  let y0 = mix(x00, x10, s.y);
  let y1 = mix(x01, x11, s.y);
  return mix(y0, y1, s.z);
}

fn fbm(p: vec3<f32>, octaves: i32) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var pp = p;
  for (var i = 0; i < octaves; i = i + 1) {
    v = v + amp * noise3(pp);
    pp = pp * 2.03;
    amp = amp * 0.5;
  }
  return v;
}

// Ridged variant for sharp continental edges / cloud filaments.
fn fbm_ridge(p: vec3<f32>, octaves: i32) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var pp = p;
  for (var i = 0; i < octaves; i = i + 1) {
    let n = 1.0 - abs(noise3(pp) * 2.0 - 1.0);
    v = v + amp * n * n;
    pp = pp * 2.03;
    amp = amp * 0.5;
  }
  return v;
}

// ── Ray-sphere intersection. Returns vec2(t_near, t_far) or
//    vec2(-1) if no intersection. ──
fn raySphere(ro: vec3<f32>, rd: vec3<f32>, c: vec3<f32>, r: f32) -> vec2<f32> {
  let oc = ro - c;
  let b = dot(oc, rd);
  let cc = dot(oc, oc) - r * r;
  let h = b * b - cc;
  if (h < 0.0) { return vec2(-1.0, -1.0); }
  let s = sqrt(h);
  return vec2(-b - s, -b + s);
}

// Ray-plane (y = 0). Returns t or -1.
fn rayPlaneY(ro: vec3<f32>, rd: vec3<f32>, planeY: f32) -> f32 {
  if (abs(rd.y) < 1e-5) { return -1.0; }
  let t = (planeY - ro.y) / rd.y;
  return select(-1.0, t, t > 0.0);
}

// ── Star field background. Two layers (small + occasional bright)
// hash-cell sampled along the ray direction. Stars are now larger
// and brighter so they actually read on the bridge canvas. ──
fn starLayer(rd: vec3<f32>, scale: f32, density: f32, sizePx: f32, brightBase: f32) -> vec3<f32> {
  let lat = asin(clamp(rd.y, -1.0, 1.0)) / PI + 0.5;
  let lon = atan2(rd.z, rd.x) / TAU + 0.5;
  let uv = vec2(lon, lat) * scale;
  let cell = floor(uv);
  let f = fract(uv) - 0.5;
  let h1 = hash21(cell);
  let h2 = hash21(cell + 17.31);
  let h3 = hash21(cell + 41.11);
  let threshold = 1.0 - density * 0.10;
  if (h1 < threshold) { return vec3(0.0); }
  let center = vec2(h2, h3) - 0.5;
  let d = length(f - center);
  let bright = pow(h1, 8.0) * brightBase + 0.15;
  let star = smoothstep(sizePx, 0.0, d) * bright;
  let hue = vec3(
    0.80 + 0.20 * h2,
    0.85 + 0.15 * h3,
    0.92 + 0.08 * h1,
  );
  return star * hue;
}

fn starField(rd: vec3<f32>, density: f32) -> vec3<f32> {
  // Two layers: dense small stars + sparse bright stars for variety.
  // Density param scales BOTH so the user has one knob.
  let small = starLayer(rd, 180.0, density * 1.0,  0.04, 0.85);
  let big   = starLayer(rd, 60.0,  density * 0.45, 0.10, 1.6);
  return small + big;
}

// ── Per-planet surface shaders. Take a sphere-surface point's
// direction (n) and return surface RGB. UV not used directly —
// noise is sampled in 3D so there's no pole pinching / seam. ──
fn earthSurface(n: vec3<f32>) -> vec3<f32> {
  let p = n * 3.0;
  // Continental landmasses via FBM thresholded. 4 octaves instead of 5 —
  // continent silhouette is dominated by the first 3 octaves; the 5th
  // adds sub-pixel jitter that anti-aliasing eats anyway.
  let continent = fbm(p, 4);
  let is_land = step(0.5, continent);

  // Ocean — deep blue to lighter shore.
  let ocean_deep = vec3(0.015, 0.06, 0.18);
  let ocean_shore = vec3(0.05, 0.20, 0.42);
  let ocean = mix(ocean_deep, ocean_shore, smoothstep(0.40, 0.50, continent));

  // ── Land ──
  // Use the user's land color as the BASE green. Add subtle dark
  // variation via FBM so the surface reads as terrain instead of
  // flat paint, but the dominant tone is the user-chosen color.
  // Single 4-octave fbm covers both broad highlands and small valleys;
  // the previous 5-oct + 4-oct twin sample was duplicative and the
  // mid-band terms cancel out in the (shade = a + b) blend.
  let lat = abs(n.y);
  let elev = fbm(p * 1.7 + vec3(11.3), 4);
  let snow = vec3(0.92, 0.94, 0.97);
  let shade = (elev - 0.5) * 0.45;
  var land = u.land_color + vec3(shade);
  // Polar latitudes blend toward snow.
  land = mix(land, snow, smoothstep(0.78, 0.95, lat));

  // Polar caps — both land and ocean go snowy at high latitude.
  let polar = smoothstep(0.86, 0.97, lat);
  return mix(mix(ocean, land, is_land), snow, polar);
}

fn marsSurface(n: vec3<f32>) -> vec3<f32> {
  let p = n * 3.5;
  let base = fbm(p, 5);
  let detail = fbm(p * 4.0, 4);
  // Two reds — rust + darker iron oxide.
  let rust = vec3(0.78, 0.42, 0.25);
  let iron = vec3(0.45, 0.20, 0.12);
  let dust = vec3(0.92, 0.70, 0.55);
  var col = mix(iron, rust, smoothstep(0.3, 0.7, base));
  col = mix(col, dust, smoothstep(0.55, 0.85, base + detail * 0.2) * 0.45);
  // Polar caps — pale CO2 ice.
  let lat = abs(n.y);
  let polar = smoothstep(0.82, 0.94, lat);
  return mix(col, vec3(0.95, 0.92, 0.88), polar);
}

fn jupiterSurface(n: vec3<f32>) -> vec3<f32> {
  // Jupiter is dominated by latitudinal bands. Modulate by FBM in
  // the perpendicular direction so the bands have turbulence.
  let lat = n.y;
  // 7 bands across the planet via cosine.
  let band_signal = sin(lat * 14.0 + fbm(n * 4.0, 4) * 2.5);
  let band = smoothstep(-0.4, 0.4, band_signal);
  let cream = vec3(0.92, 0.83, 0.62);
  let beige = vec3(0.78, 0.62, 0.42);
  let brown = vec3(0.50, 0.32, 0.18);
  let white = vec3(0.95, 0.92, 0.85);
  var col = mix(brown, cream, band);
  // Add a second layer with finer detail.
  let detail = fbm(n * 8.0 + vec3(13.7, 0.0, 0.0), 4);
  col = mix(col, beige, detail * 0.4);
  col = mix(col, white, smoothstep(0.7, 0.95, band) * 0.3);
  // Great Red Spot — elliptical region at southern mid-latitude.
  let spot_lat = -0.32;
  let spot_lon = atan2(n.z, n.x);
  let dlon = spot_lon - PI * 0.4;
  let dlon_w = atan2(sin(dlon), cos(dlon));    // wrap to [-π, π]
  let dlat = n.y - spot_lat;
  let spot = exp(-(dlon_w * dlon_w * 14.0 + dlat * dlat * 110.0));
  let spot_col = vec3(0.78, 0.30, 0.22);
  return mix(col, spot_col, smoothstep(0.0, 0.6, spot));
}

fn saturnSurface(n: vec3<f32>) -> vec3<f32> {
  // Like Jupiter but pastel + softer bands.
  let lat = n.y;
  let band_signal = sin(lat * 11.0 + fbm(n * 3.0, 4) * 1.8);
  let band = smoothstep(-0.5, 0.5, band_signal);
  let pale_gold = vec3(0.95, 0.85, 0.65);
  let warm_tan = vec3(0.85, 0.72, 0.50);
  let dim_tan = vec3(0.70, 0.58, 0.38);
  var col = mix(dim_tan, pale_gold, band);
  let detail = fbm(n * 7.0, 4);
  col = mix(col, warm_tan, detail * 0.3);
  return col;
}

// ── Cloud layer. Generic — works on every planet now (Mars dust
// clouds, Jupiter ammonia, Earth water vapour all share the same
// noise math; user-controlled color + coverage discriminate). The
// per-planet scale tweak just changes how broken-up the clouds
// look (higher freq for gas giants → more streaky).
fn cloudCover(n: vec3<f32>, phase: f32, coverage: f32, freq_mul: f32) -> f32 {
  let p = n * 4.0 * freq_mul + vec3(phase * 0.2, 0.0, phase * 0.15);
  let raw = fbm(p, 6);
  let c = smoothstep(0.45 - coverage * 0.35, 0.65 - coverage * 0.35, raw);
  let wisp = fbm_ridge(p * 2.5 + 7.7, 4);
  return clamp(c + wisp * 0.1 - 0.05, 0.0, 1.0);
}

// ── Aurora — thin curtain at high latitudes. We sample along the
// view ray as it passes through the atmosphere shell, accumulating
// where the curtain is present (lat > 0.7). The curtain itself is
// a 3D noise modulated by latitude + time. ──
fn auroraColor(p: vec3<f32>, t: f32) -> vec3<f32> {
  let n = normalize(p);
  let lat = abs(n.y);
  if (lat < 0.62) { return vec3(0.0); }
  // Curtain pattern — vertical streaks via stretched noise.
  let q = vec3(n.x * 6.0, p.y * 8.0 + t * 0.4, n.z * 6.0);
  let pattern = fbm_ridge(q, 4);
  let pattern2 = fbm(q * 2.0 + t * 0.3, 3);
  let intensity = pattern * pattern2;
  // Latitude falloff — strongest at ~0.85, fades by 0.62 and 0.97.
  let lat_falloff = smoothstep(0.62, 0.78, lat) * (1.0 - smoothstep(0.92, 0.99, lat));
  // Color cycle — green dominant, magenta accents, blue tail.
  let phase = pattern + t * 0.12;
  let green  = vec3(0.05, 0.95, 0.35);
  let magenta = vec3(0.85, 0.10, 0.65);
  let blue   = vec3(0.20, 0.45, 0.95);
  let col = mix(green, mix(magenta, blue, sin(phase) * 0.5 + 0.5), 0.35);
  return col * intensity * lat_falloff;
}

// ── Surface heightmap + perturbed normal ──
// Sample a low-frequency height for each planet, compute the
// surface normal via finite differences in tangent space, and
// return a perturbed normal that creates real terrain shadowing
// when lit. Gas giants stay smooth (return original n).
fn surfaceHeight(n: vec3<f32>, planet_id: u32) -> f32 {
  if (planet_id == 0u) {
    // Earth: continents have elevation. FBM-thresholded land mask
    // gives binary; multiply by detail noise so highlands feel
    // textured rather than flat.
    let p = n * 4.0;
    let h_continent = fbm(p, 5);
    let is_land = step(0.5, h_continent);
    let detail = fbm(p * 6.0, 4);
    return is_land * (h_continent - 0.5 + detail * 0.4) * 0.18;
  }
  if (planet_id == 1u) {
    // Mars: rugged with crater-like detail. Higher amplitude than
    // Earth — less water, more visible relief.
    let p = n * 5.0;
    return (fbm(p, 6) - 0.5) * 0.24;
  }
  return 0.0;  // Gas giants: smooth
}

// Stripped height sampler for bump-mapping ONLY. perturbedNormal calls
// this 3× per pixel (h0/h1/h2 for tangent-space gradient), so cutting
// octaves here is multiplied by 3. The full surfaceHeight() above is
// still used elsewhere where the value is read directly, not differenced.
//
// Tangent-space gradient picks up the LOW-FREQUENCY relief (mountain
// ranges, continental shelves) — that's what casts visible terminator
// shadows at the planet's apparent scale. High-frequency detail noise
// (the * 6.0 term, frequency 24) contributes nothing across an
// eps=0.012 step at planet scale; its gradient is dominated by aliasing,
// not signal.
fn surfaceHeightBump(n: vec3<f32>, planet_id: u32) -> f32 {
  if (planet_id == 0u) {
    // Earth bump: just the continent mask, 3 octaves instead of 5+4=9.
    let p = n * 4.0;
    let h_continent = fbm(p, 3);
    let is_land = step(0.5, h_continent);
    return is_land * (h_continent - 0.5) * 0.18;
  }
  if (planet_id == 1u) {
    // Mars bump: 3 octaves instead of 6.
    let p = n * 5.0;
    return (fbm(p, 3) - 0.5) * 0.24;
  }
  return 0.0;
}

fn perturbedNormal(n: vec3<f32>, planet_id: u32) -> vec3<f32> {
  if (planet_id == 2u || planet_id == 3u) { return n; }
  let eps = 0.012;
  // Tangent basis from arbitrary helper vector — robust because we
  // don't care about specific tangent direction.
  let helper = select(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), abs(n.y) > 0.95);
  let tangent = normalize(cross(n, helper));
  let bitangent = normalize(cross(n, tangent));
  // 3× the cost of fbm here — was 9 octaves × 3 = 27 octaves per pixel
  // on Earth. Stripped sampler drops that to 3 × 3 = 9 octaves. Single
  // biggest per-pixel win in the surface pass.
  let h0 = surfaceHeightBump(n, planet_id);
  let h1 = surfaceHeightBump(normalize(n + tangent * eps), planet_id);
  let h2 = surfaceHeightBump(normalize(n + bitangent * eps), planet_id);
  let dx = (h1 - h0) / eps;
  let dy = (h2 - h0) / eps;
  // Bumpiness multiplier — higher = more pronounced terrain shadows.
  let bump = 4.0;
  return normalize(n - tangent * dx * bump - bitangent * dy * bump);
}

// ── Earth shoreline glow ──
// Single contribution: a bright glowing ring at the EXACT
// land/ocean boundary (the outline of every continent). The
// intensity, color, and width of the ring are all user-driven via
// uniforms so the look ranges from subtle bioluminescence to
// SOFI-stadium Tron-Earth.
//
// Math: the continent FBM crosses 0.5 right at the coast, so
// abs(continent - 0.5) is a signed distance to the coastline.
// smoothstep(width, 0, dist) gives a sharp ring of glow centered
// on that boundary. A small FBM jitter along the coast keeps it
// organic instead of perfectly uniform.
fn earthShorelineGlow(n_rot: vec3<f32>) -> vec3<f32> {
  let p = n_rot * 3.0;
  // 3 octaves instead of 5. The coastline silhouette is determined by
  // the threshold-crossing of the lowest 2-3 octaves; the 4th/5th add
  // sub-coast wiggle that the smoothstep eats anyway. Cuts 40% off
  // shoreline cost on every Earth pixel even when shoreline is off
  // (early-out below saves the jitter sample but not this one).
  let continent = fbm(p, 3);
  let coast_dist = abs(continent - 0.5);
  let half_width = max(u.shoreline_width, 0.001);
  let coast = smoothstep(half_width, 0.0, coast_dist);
  if (coast < 0.001) { return vec3(0.0); }
  // Light per-pixel variation so the coastline doesn't look painted
  // on with a uniform brush. 2-octave is enough at freq 22.
  let jitter = 0.75 + 0.25 * fbm(n_rot * 22.0 + 3.7, 2);
  return u.shoreline_color * coast * jitter * u.shoreline_intensity;
}

// ── Volumetric atmosphere ray-march ──
// Simplified Rayleigh-ish scattering: sample density along the view
// ray inside the atmosphere shell, accumulate scattered light using
// a single secondary ray toward the sun per sample. Gives proper
// sunsets, day/night terminator glow, and a depth-aware rim.
fn atmDensity(p: vec3<f32>, planet_center: vec3<f32>, r_planet: f32, r_atmo: f32) -> f32 {
  let h = length(p - planet_center) - r_planet;
  let scale_height = (r_atmo - r_planet) * 0.45;
  return exp(-max(h, 0.0) / scale_height);
}

fn marchAtmosphere(
  ro: vec3<f32>, rd: vec3<f32>,
  t_start: f32, t_end: f32,
  sun: vec3<f32>,
  planet_center: vec3<f32>, r_planet: f32, r_atmo: f32,
  planet_id: u32, sun_brightness: f32,
) -> vec3<f32> {
  let span = max(t_end - t_start, 0.0);
  if (span <= 0.0001) { return vec3(0.0); }
  // 8 steps instead of 12 — atmosphere is exponentially front-loaded
  // (rim shells contribute most), the eye can't distinguish 8 vs 12
  // samples across a soft Rayleigh integral.
  let steps: i32 = 8;
  let dt = span / f32(steps);
  let tint = atmosphereTint(planet_id);
  let r_planet_sq = r_planet * r_planet;
  var accum = vec3(0.0);
  for (var i = 0; i < steps; i = i + 1) {
    let t = t_start + (f32(i) + 0.5) * dt;
    let p = ro + rd * t;
    let density = atmDensity(p, planet_center, r_planet, r_atmo);
    if (density < 0.001) { continue; }
    // Secondary ray toward sun: single-sample optical depth proxy.
    let sun_hit = raySphere(p, sun, planet_center, r_atmo);
    let sun_path = max(sun_hit.y, 0.0);
    // Cheap planet-shadow test: the sun-ray hits the planet body iff
    // the perpendicular distance from the planet center to the line
    // (p, sun) is less than r_planet AND the planet is in front of p
    // along the sun direction. Cuts a raySphere() call per atmosphere
    // step (8 fewer raySphere calls per pixel) without altering the
    // terminator dimming behaviour visibly.
    let to_c = planet_center - p;
    let along = dot(to_c, sun);                // >0 = planet is sunward
    let perp_sq = dot(to_c, to_c) - along * along;
    let blocked = step(0.0, along) * step(perp_sq, r_planet_sq);
    let sun_density = density * sun_path * 0.7;
    let attenuation = exp(-sun_density * tint * 1.4);
    accum = accum + attenuation * tint * density * dt * (1.0 - blocked * 0.85);
  }
  return accum * 6.5 * sun_brightness;
}

// ── Henyey-Greenstein phase function ──
// g controls forward (g→1) vs back (g→-1) scattering. Real clouds
// have g≈0.7-0.8 (strongly forward scattering), which gives the
// silver lining when sun is behind the cloud and the bright halo
// when looking through the cloud toward the sun.
fn hgPhase(cos_theta: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * cos_theta, 1.5));
}

// ── Volumetric cloud density ──
// Three-layer construction:
//   1. CUMULUS BASE — low-frequency FBM defines the big formations
//      (anvils, fronts). Coverage threshold here.
//   2. PUFFS — mid-frequency FBM modulates density inside formations
//      so they read as bulbous billows, not flat blobs.
//   3. EROSION — high-frequency ridged FBM SUBTRACTS at the edges,
//      cutting wispy filaments + breaking up the silhouette so the
//      clouds look truly fluid + alive instead of cookie-cutter.
//
// Vertical density curve: gradual fade-in from the base, peak in
// the middle of the shell, slow fade at the top. Gives cumulus a
// flatter base and more billowy crown.
fn cloudDensity(
  p_local: vec3<f32>, total_rot: f32, phase: f32,
  coverage: f32, freq_mul: f32,
) -> f32 {
  let r = length(p_local);
  let r_low = 1.005;
  let r_high = 1.060;
  if (r < r_low || r > r_high) { return 0.0; }
  // Asymmetric vertical curve: flatter base, billowy top.
  let shell_t = (r - r_low) / (r_high - r_low);
  let vertical = smoothstep(0.0, 0.18, shell_t) * (1.0 - smoothstep(0.7, 1.0, shell_t));
  // Apply planet rotation so clouds drift with the world.
  let p_rot = rotateY(p_local, total_rot * 0.92);
  let n = normalize(p_rot);
  // Layer 1 — CUMULUS BASE (low freq, big formations)
  let p_big = n * 1.8 * freq_mul + vec3(phase * 0.18, 0.0, phase * 0.12);
  let cumulus = fbm(p_big, 4);
  // Coverage threshold drives the fundamental cloud-vs-sky decision.
  let cov_t = 0.50 - coverage * 0.35;
  let shape = smoothstep(cov_t, cov_t + 0.18, cumulus);
  if (shape < 0.001) { return 0.0; }
  // Layer 2 — PUFFS (medium freq, billowy structure)
  let p_med = n * 6.0 * freq_mul + vec3(phase * 0.30, 0.0, phase * 0.22);
  let puffs = fbm(p_med, 4);
  let with_puffs = shape * (0.55 + 0.55 * puffs);
  // Layer 3 — EROSION (high freq ridged, edge detail)
  let p_det = n * 18.0 * freq_mul + vec3(phase * 0.45, 0.0, phase * 0.35);
  let detail = fbm_ridge(p_det, 4);
  let eroded = max(0.0, with_puffs - detail * 0.32);
  return clamp(eroded * vertical, 0.0, 1.0);
}

// Stripped shadow-only cloud density: cumulus shape + vertical shell only.
// No puffs, no erosion, 2-octave fbm instead of 4. Used inside the shadow
// loop where the result is integrated along the sun ray, so high-freq edge
// detail washes out anyway — only the coarse silhouette affects attenuation.
// Roughly 6× cheaper than cloudDensity() and the visual delta is invisible
// because shadow rays only modulate the lighting term, not the silhouette.
fn cloudDensityShadow(
  p_local: vec3<f32>, total_rot: f32, phase: f32,
  coverage: f32, freq_mul: f32,
) -> f32 {
  let r = length(p_local);
  let r_low = 1.005;
  let r_high = 1.060;
  if (r < r_low || r > r_high) { return 0.0; }
  let shell_t = (r - r_low) / (r_high - r_low);
  let vertical = smoothstep(0.0, 0.18, shell_t) * (1.0 - smoothstep(0.7, 1.0, shell_t));
  let p_rot = rotateY(p_local, total_rot * 0.92);
  let n = normalize(p_rot);
  let p_big = n * 1.8 * freq_mul + vec3(phase * 0.18, 0.0, phase * 0.12);
  let cumulus = fbm(p_big, 2);
  let cov_t = 0.50 - coverage * 0.35;
  let shape = smoothstep(cov_t, cov_t + 0.18, cumulus);
  return clamp(shape * vertical, 0.0, 1.0);
}

// ── Volumetric cloud ray-march ──
// 22 primary samples + 2 logarithmically-spaced light samples per
// dense primary, with per-pixel + per-frame temporal jitter on the
// primary t-offset so the eye integrates over 2-3 frames at 60fps
// without visible banding. Beer-Powder lighting (Häusler-Frostbite
// trick): direct attenuation (Beer) + powder term for dark internal
// shadowing on thick clouds. HG phase term gives the silver lining
// when backlit. Multiple-scattering approximation via a small
// ambient lift on top. Shadow samples use cloudDensityShadow() — a
// stripped 2-octave cumulus-only sampler ~6× cheaper than the full
// cloudDensity(); shadow integration washes out fine detail anyway.
fn marchClouds(
  ro: vec3<f32>, rd: vec3<f32>,
  t_start: f32, t_end: f32,
  sun: vec3<f32>,
  planet_center: vec3<f32>,
  total_rot: f32, phase: f32,
  coverage: f32, freq_mul: f32,
  cloud_color: vec3<f32>,
  sun_brightness: f32,
) -> vec4<f32> {
  let span = max(t_end - t_start, 0.0);
  if (span <= 0.0001) { return vec4(0.0); }
  let steps: i32 = 22;
  let dt = span / f32(steps);
  // Per-pixel + per-frame jitter on the march offset. The eye accumulates
  // across frames at typical 60fps refresh, smoothing banding that 22
  // primary steps would otherwise show on dense cloud edges. White-noise
  // jitter is fine for volumetric integration; blue-noise would look
  // marginally cleaner on stills but adds a 64×64 LUT for negligible gain.
  let jitter = hash31(rd * 100.0 + vec3(u.time * 11.0, u.time * 7.0, u.time * 13.0));
  var transmittance = 1.0;
  var color = vec3(0.0);

  // ── Lighting model ──
  // Three components, all visible from ANY view angle:
  //   1. LAMBERTIAN BASELINE — direct-attenuated sun light, view-
  //      independent. Makes front-lit clouds visible (was missing
  //      before — pure phase-only model collapsed when sun was
  //      behind the camera).
  //   2. PHASE BOOST (HG) — additional brightness when looking
  //      toward sun (silver lining backlit, halo through clouds).
  //   3. SKY AMBIENT — blue lift on the top of clouds approximating
  //      multiple-scattering bounce light from the sky.
  let cos_theta = dot(rd, sun);
  let phase_fwd = hgPhase(cos_theta, 0.72);   // tight forward
  let phase_back = hgPhase(cos_theta, -0.18); // gentle back
  let phase_term = phase_fwd * 0.78 + phase_back * 0.22;

  // Shadow march: 2 samples (close + far) using the stripped density
  // function. Sum of distances 0.072 vs the prior 3-sample sum 0.112,
  // but cloudDensityShadow() returns ~1.4× higher (no erosion subtract)
  // so the light_density integral lands ~0.9× of the prior 3-sample one —
  // close enough that the 9.0/18.0 Beer-Powder multipliers preserve the
  // lit/shadow contrast without re-tuning.
  let light_steps_dist: array<f32, 2> = array<f32, 2>(0.012, 0.060);
  let sky_color = vec3(0.55, 0.70, 0.95);

  // Thickness multiplier — scales every density sample so clouds
  // become more opaque + cast deeper self-shadows. User-controlled
  // via the cloud_thickness uniform.
  let thick = u.cloud_thickness;

  for (var i = 0; i < steps; i = i + 1) {
    let t = t_start + (f32(i) + jitter) * dt;
    let p_local = ro + rd * t - planet_center;
    let d_raw = cloudDensity(p_local, total_rot, phase, coverage, freq_mul);
    let d = d_raw * thick;
    if (d < 0.002) { continue; }

    // Optical depth toward sun via 2 log-spaced samples (close + far),
    // each using the stripped cloudDensityShadow() — 2-octave cumulus
    // shape only. Shadow integration smooths out high-freq detail so
    // dropping puffs + erosion is invisible. This is the biggest single
    // perf win in the cloud pass.
    var light_density = 0.0;
    for (var j = 0; j < 2; j = j + 1) {
      let pl = p_local + sun * light_steps_dist[j];
      light_density = light_density + cloudDensityShadow(pl, total_rot, phase, coverage, freq_mul) * thick * light_steps_dist[j];
    }
    // Beer-Powder: direct attenuation + powder term (dark heart on
    // thick clouds when viewed perpendicular to sun). Symmetric
    // around perpendicular so both front-lit and backlit clouds
    // get the powder shading.
    let beer = exp(-light_density * 9.0);
    let powder = 1.0 - exp(-light_density * 18.0);
    let perp_factor = 1.0 - abs(cos_theta);                          // 0 at aligned, 1 perpendicular
    let beer_powder = beer * mix(1.0, 1.0 - powder * 0.55, perp_factor);

    // (1) LAMBERTIAN BASELINE — view-independent direct light.
    // Without this, front-lit clouds vanish. Multiplier (5.0) tuned
    // so cumulus reads bright in normal sunlight.
    let lambert = beer_powder * sun_brightness * 5.0;

    // (2) PHASE BOOST — directional silver-lining/halo on top.
    let directional = beer_powder * phase_term * sun_brightness * 9.0;

    // (3) SKY AMBIENT — top-of-cloud sky bounce.
    let n_sphere = normalize(p_local);
    let sky_lift = (max(n_sphere.y, 0.0) * 0.4 + 0.18) * 0.20;
    let sky_amb = sky_color * sky_lift;

    let scattered = cloud_color * (lambert + directional) + cloud_color * sky_amb;

    // Beer's law on accumulated cloud density for opacity.
    let sample_alpha = 1.0 - exp(-d * 8.5 * dt);
    color = color + scattered * sample_alpha * transmittance;
    transmittance = transmittance * (1.0 - sample_alpha);
    // Early-out at 0.05: once 95% of light is absorbed, remaining
    // samples contribute below visible threshold (well under 1 LSB at
    // 8-bit). Cheap lift for dense cloud cover paths.
    if (transmittance < 0.05) { break; }
  }
  return vec4(color, 1.0 - transmittance);
}

// ── Milky Way + nebulae background ──
// Soft galactic plane band tilted at an arbitrary angle, with FBM
// nebula clouds along it. Adds depth + cosmic atmosphere to the
// star field. Returns rgb to add to the sky.
fn milkyWay(rd: vec3<f32>) -> vec3<f32> {
  // Galactic plane normal — fixed orientation.
  let plane_normal = normalize(vec3(0.45, 0.85, 0.30));
  let off_plane = abs(dot(rd, plane_normal));
  // Gaussian band: bright near the plane, fades to dark at poles.
  let band = exp(-off_plane * off_plane * 16.0);
  if (band < 0.005) { return vec3(0.0); }
  // FBM clouds along the galactic plane.
  let p = rd * 5.0;
  let nebula_a = fbm(p, 5);
  let nebula_b = fbm(p * 3.0 + vec3(11.0), 4);
  let intensity = band * (0.4 + 0.6 * nebula_a) * (0.6 + 0.4 * nebula_b);
  // Colour: warm reds and blues — interstellar dust.
  let warm = vec3(0.65, 0.45, 0.30);
  let cool = vec3(0.30, 0.40, 0.65);
  let hue = mix(warm, cool, nebula_b);
  return hue * intensity * 0.35;
}

// ── ACES filmic tonemap ──
// Industry-standard cinematic tonemap. Compresses highlights more
// elegantly than Reinhard while preserving deep blacks. The values
// are the Krzysztof Narkowicz approximation.
fn tonemap_aces(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3(0.0), vec3(1.0));
}

// ── Saturn rings — analytic SDF with multi-band detail ──
// Three major rings (C, B, A) separated by the Cassini Division.
// Encke + Maxwell sub-gaps add character. FBM micro-banding gives
// granular detail at every zoom level. detail_mul (0..1.5) scales
// the high-frequency micro-bands so the user can dial granularity.
fn ringDetailedColor(r: f32, rad_inner: f32, rad_outer: f32, detail_mul: f32) -> vec4<f32> {
  if (r < rad_inner || r > rad_outer) { return vec4(0.0); }
  let t = (r - rad_inner) / (rad_outer - rad_inner);

  // Major-band density profile. Ranges roughly correspond to real
  // Saturn rings rescaled to [0..1]:
  //   C ring  : t ∈ [0.00, 0.18]   thin, dim
  //   B ring  : t ∈ [0.18, 0.50]   bright, dense (most opaque)
  //   Cassini : t ∈ [0.50, 0.55]   gap
  //   A ring  : t ∈ [0.55, 0.90]   medium opacity
  //   Encke   : t ≈  0.78          narrow gap inside A
  var density = 0.0;
  // C
  density = density + smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.16, 0.20, t)) * 0.32;
  // Inside C, faint Maxwell gap at t ≈ 0.10
  let maxwell = smoothstep(0.095, 0.105, t) * (1.0 - smoothstep(0.115, 0.105, t));
  density = density * (1.0 - maxwell * 0.7);
  // B (densest)
  density = density + smoothstep(0.16, 0.22, t) * (1.0 - smoothstep(0.46, 0.52, t)) * 0.95;
  // Cassini gap
  let cassini = smoothstep(0.49, 0.52, t) * (1.0 - smoothstep(0.55, 0.58, t));
  density = density * (1.0 - cassini * 0.92);
  // A
  density = density + smoothstep(0.52, 0.58, t) * (1.0 - smoothstep(0.86, 0.92, t)) * 0.62;
  // Encke
  let encke = smoothstep(0.775, 0.78, t) * (1.0 - smoothstep(0.795, 0.79, t));
  density = density * (1.0 - encke * 0.85);
  // Inner taper + outer fade
  density = density * smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.92, 1.0, t));

  // FBM micro-banding along radius — gives the granular ringlet
  // texture you see in Cassini imagery. Two octaves at very different
  // frequencies stack up to look natural. detail_mul scales it.
  let micro_a = fbm(vec3(t * 90.0, 0.0, 0.0), 4);
  let micro_b = fbm(vec3(t * 240.0 + 7.0, 0.0, 0.0), 3);
  let micro = (micro_a * 0.6 + micro_b * 0.4) - 0.5;
  density = density * (1.0 + micro * 0.45 * detail_mul);

  // Hairline ringlets — sinusoidal detail to suggest individual
  // ringlets at very high zoom. Frequency scales with detail.
  let ringlet = sin(t * 380.0) * 0.5 + 0.5;
  density = density * (0.85 + 0.15 * ringlet * detail_mul);

  // Color: warm cream in the dense B, cooler greys outward, and a
  // hint of dim brown in C. Real Saturn rings look like this in
  // visible-light imaging.
  let cream = vec3(0.97, 0.88, 0.65);
  let cool  = vec3(0.72, 0.68, 0.58);
  let dim   = vec3(0.50, 0.45, 0.38);
  var col = mix(dim, cream, smoothstep(0.0, 0.25, t));
  col = mix(col, cool, smoothstep(0.55, 0.95, t));

  return vec4(col, clamp(density, 0.0, 1.0));
}

// ── Camera matrix — yaw/pitch around target with given distance. ──
fn cameraDir(uv: vec2<f32>) -> vec3<f32> {
  // Build basis: planet at origin, camera offset by distance + orbit.
  let yaw = u.camera_yaw * PI / 180.0;
  let pitch = u.camera_pitch * PI / 180.0;
  let cy = cos(yaw); let sy = sin(yaw);
  let cp = cos(pitch); let sp = sin(pitch);
  // Camera position around origin
  let cam = vec3(sy * cp, sp, -cy * cp) * u.camera_distance;
  // Forward = -cam direction (looking at origin)
  let fwd = -normalize(cam);
  let right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  let f = 1.0 / tan(u.fov_deg * 0.5 * PI / 180.0);
  return normalize(uv.x * right + uv.y * up + f * fwd);
}

fn cameraPos() -> vec3<f32> {
  let yaw = u.camera_yaw * PI / 180.0;
  let pitch = u.camera_pitch * PI / 180.0;
  let cy = cos(yaw); let sy = sin(yaw);
  let cp = cos(pitch); let sp = sin(pitch);
  return vec3(sy * cp, sp, -cy * cp) * u.camera_distance;
}

// Sun direction in world space.
fn sunDir() -> vec3<f32> {
  let yaw = u.sun_yaw * PI / 180.0;
  let pitch = u.sun_pitch * PI / 180.0;
  let cy = cos(yaw); let sy = sin(yaw);
  let cp = cos(pitch); let sp = sin(pitch);
  return normalize(vec3(sy * cp, sp, -cy * cp));
}

// Atmosphere scattering colour — approximate Rayleigh-ish per-planet
// rim glow. Returns RGB to add at the silhouette.
fn atmosphereTint(planet_id: u32) -> vec3<f32> {
  // Earth: blue. Mars: dusty pink. Jupiter: pale cream. Saturn: pale gold.
  if (planet_id == 0u) { return vec3(0.30, 0.55, 1.05); }
  if (planet_id == 1u) { return vec3(0.85, 0.55, 0.42); }
  if (planet_id == 2u) { return vec3(0.85, 0.78, 0.62); }
  return vec3(0.92, 0.85, 0.65);
}

// Rotate vector around Y axis by angle (radians).
fn rotateY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a); let s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// ── Vertex: full-screen triangle ──
struct V { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_full(@builtin(vertex_index) vid: u32) -> V {
  let x = f32((vid << 1u) & 2u);
  let y = f32(vid & 2u);
  var out: V;
  out.clip = vec4(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2(x, y);
  return out;
}

// ── Fragment: the planet ──
@fragment fn fs_planet(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let frag = pos.xy;
  // Centered, aspect-corrected screen UV.
  let uv = (frag - u.resolution * 0.5) / u.resolution.y;
  // Y in clip space goes down for fragment coords; flip so UP is positive y.
  let uv2 = vec2(uv.x, -uv.y);

  let ro = cameraPos();
  let rd = cameraDir(uv2);
  // Planet center is offset in world space — moves the planet around
  // in the frame independently of camera orbit. Camera always looks
  // at world origin so the offset just shifts the sphere within the
  // field of view.
  let center = vec3(u.planet_x, u.planet_y, 0.0);
  let r_planet = 1.0;
  let r_atmo = r_planet * (1.0 + u.atmosphere_height);
  let r_cloud = r_planet * 1.012;
  let sun = sunDir();

  // Atmosphere shell intersection (for rim glow + aurora marching).
  let tA = raySphere(ro, rd, center, r_atmo);
  let tP = raySphere(ro, rd, center, r_planet);
  let hits_atmo = tA.x > 0.0;
  let hits_planet = tP.x > 0.0;

  // ── Background ──
  // Stars + Milky Way galactic band. Sky-only: pixels covered by the
  // planet body would overwrite the background entirely on the next
  // branch, so computing starField()/milkyWay() there is pure waste.
  // For a planet that fills 30-40% of the frame, this skips a couple
  // dozen noise lookups per visible-planet pixel.
  var col = vec3(0.0);
  if (!hits_planet) {
    col = starField(rd, u.star_density) + milkyWay(rd) * u.star_density;
  }

  // ── Surface ──
  if (hits_planet) {
    let p = ro + rd * tP.x;
    let n = normalize(p - center);
    let total_rot = (u.rotation_offset + u.rotation_anim) * PI / 180.0;
    let n_rot = rotateY(n, total_rot);

    var base_surface = vec3(0.0);
    if (u.planet_id == 0u)      { base_surface = earthSurface(n_rot); }
    else if (u.planet_id == 1u) { base_surface = marsSurface(n_rot); }
    else if (u.planet_id == 2u) { base_surface = jupiterSurface(n_rot); }
    else                         { base_surface = saturnSurface(n_rot); }

    // Perturbed normal from heightmap — gives real terrain shadows
    // (mountain ranges cast shadow at low sun angles). Gas giants
    // skip this and use the smooth sphere normal.
    let n_perturbed = perturbedNormal(n_rot, u.planet_id);
    // Rotate the perturbed normal back into world space for lighting.
    let n_lit = rotateY(n_perturbed, -total_rot);

    // Sun lighting — uses the perturbed normal so terrain self-shadows.
    let nl_smooth = max(dot(n, sun), 0.0);                  // for terminator
    let nl_perturbed = max(dot(n_lit, sun), 0.0);            // for terrain
    let term = smoothstep(-0.05, 0.15, dot(n, sun));
    let ambient = 0.06;
    let lighting = (ambient + nl_perturbed * u.sun_brightness) * term + ambient * (1.0 - term);
    var surface = base_surface * lighting;

    // Self-emission — surface glows independent of sun.
    surface = surface + base_surface * u.emission;

    // ── Earth shoreline glow ──
    // Glowing ring at the EXACT outline of every continent. Color +
    // intensity + width all under user control via the panel. A
    // small night-side boost so the rim is visible on the dark
    // hemisphere too.
    if (u.planet_id == 0u && u.shoreline_intensity > 0.001) {
      let glow = earthShorelineGlow(n_rot);
      let night_boost = 1.0 + (1.0 - term) * 0.6;
      surface = surface + glow * night_boost;
    }

    // Specular sun-glint on Earth oceans.
    if (u.planet_id == 0u) {
      let view = normalize(ro - p);
      let halfV = normalize(sun + view);
      let spec = pow(max(dot(n, halfV), 0.0), 64.0) * smoothstep(0.0, 0.4, nl_smooth);
      surface = surface + vec3(1.0, 0.95, 0.85) * spec * 0.45 * u.sun_brightness;
    }

    col = surface;
  }

  // ── Volumetric clouds (ray-march through cloud shell) ──
  // Marches through the cloud shell IN FRONT of the planet hit (or
  // through the full chord if missing the planet). Lit by sun, with
  // self-shadowing + forward scattering (silver lining).
  if (u.cloud_coverage > 0.001) {
    // Cloud shell is now taller (1.005 → 1.060) to give cumulus
    // more visible vertical depth. Matches cloudDensity's r_low /
    // r_high.
    let cloud_inner = r_planet * 1.005;
    let cloud_outer = r_planet * 1.060;
    let tCi = raySphere(ro, rd, center, cloud_inner);
    let tCo = raySphere(ro, rd, center, cloud_outer);
    if (tCo.x > 0.0) {
      // Front cap of the cloud shell, terminated by the planet hit
      // if we hit it before exiting the shell.
      let t_start = max(tCo.x, 0.0);
      var t_end = tCo.y;
      if (hits_planet && tP.x < t_end) { t_end = tP.x; }
      // If we entered the inner sphere (planet+near-cloud), march
      // only the front cap of the cloud shell.
      if (tCi.x > 0.0 && tCi.x < t_end) { t_end = tCi.x; }
      let total_rot = (u.rotation_offset + u.rotation_anim) * PI / 180.0;
      var cloud_freq_mul = 1.0;
      if (u.planet_id == 1u) { cloud_freq_mul = 0.8; }
      if (u.planet_id == 2u) { cloud_freq_mul = 1.6; }
      if (u.planet_id == 3u) { cloud_freq_mul = 1.4; }
      let cloud_rgba = marchClouds(
        ro, rd, t_start, t_end, sun, center,
        total_rot, u.cloud_phase, u.cloud_coverage, cloud_freq_mul,
        u.cloud_color, u.sun_brightness,
      );
      col = mix(col, cloud_rgba.rgb, cloud_rgba.a);
    }
  }

  // ── Volumetric atmosphere ──
  // Ray-march the atmosphere shell with per-sample sun lighting.
  // Gives proper Rayleigh-ish color shifts (planet rim glows in
  // its atmosphere tint, color gets warmer when viewing the
  // terminator at a glancing angle = "sunset" effect).
  if (hits_atmo && u.atmosphere_height > 0.0001) {
    let t_start = max(tA.x, 0.0);
    let t_end = select(tA.y, tP.x, hits_planet);
    let scattered = marchAtmosphere(
      ro, rd, t_start, t_end, sun,
      center, r_planet, r_atmo, u.planet_id, u.sun_brightness,
    );
    col = col + scattered;
  }

  // ── Outer glow halo ──
  // Soft luminous halo extending OUTSIDE the planet/atmosphere,
  // independent of physical scattering. Lets the user push the
  // planet to look like a glowing celestial body. Falls off with
  // angular distance to the planet center.
  if (u.outer_glow > 0.0001) {
    // Closest approach distance (in world units) from ray to the
    // planet center — used as the falloff metric.
    let to_center = center - ro;
    let proj = dot(to_center, rd);
    let closest = ro + rd * max(proj, 0.0);
    let dist = length(closest - center);
    // Fade from full at the planet surface to nothing at ~3 radii out.
    let halo = 1.0 - smoothstep(r_planet, r_planet * 3.0, dist);
    let halo_tint = atmosphereTint(u.planet_id);
    col = col + halo_tint * pow(halo, 2.5) * u.outer_glow * 0.7;
  }

  // ── Aurora — only Earth, at high latitudes. We march a few
  // samples through the atmosphere shell looking for points where
  // the polar curtain pattern lights up. ──
  if (u.planet_id == 0u && u.aurora_strength > 0.001 && hits_atmo) {
    let t_start = max(tA.x, 0.0);
    let t_end = select(tA.y, tP.x, hits_planet);
    let span = max(t_end - t_start, 0.0);
    let steps: i32 = 6;
    var aur = vec3(0.0);
    for (var i = 0; i < steps; i = i + 1) {
      let f = (f32(i) + 0.5) / f32(steps);
      let t = t_start + span * f;
      let p = ro + rd * t;
      // Translate to planet-local space, then rotate. Aurora moves
      // with the world and stays anchored to the planet (which may
      // be offset via planet_x/y).
      let p_local = p - center;
      let total_rot = (u.rotation_offset + u.rotation_anim) * PI / 180.0;
      let p_rot = rotateY(p_local, total_rot);
      aur = aur + auroraColor(p_rot, u.time);
    }
    aur = aur * (span / f32(steps)) * 0.6;
    col = col + aur * u.aurora_strength;
  }

  // ── Saturn rings ──
  // Analytic ray-plane intersection on the planet's equatorial
  // plane, multi-band detail with FBM micro-structure, sun-shadow
  // from the planet body. Plane moves with the planet's offset.
  if (u.planet_id == 3u && u.ring_opacity > 0.001) {
    let t_ring = rayPlaneY(ro, rd, center.y);
    if (t_ring > 0.0) {
      let ring_pt = (ro + rd * t_ring) - center;
      let r = length(ring_pt.xz);
      let occluded_by_planet = hits_planet && tP.x < t_ring;
      if (!occluded_by_planet) {
        let rc = ringDetailedColor(r, u.ring_inner, u.ring_outer, u.ring_detail);
        let alpha = rc.a * u.ring_opacity;
        // Sun shadow — if the line from ring point to sun passes
        // through the planet body, that ring patch is in shadow.
        let along = dot(ring_pt, sun);
        let perp = ring_pt - sun * along;
        let in_shadow = step(length(perp), r_planet) * step(0.0, along);
        // Forward-scattering brightness boost when the camera looks
        // toward the sun through the rings (gives that lit-up
        // backlit ring look from Cassini's "In Saturn's Shadow").
        let view = normalize(ro - (ring_pt + center));
        let phase = max(dot(view, -sun), 0.0);
        let backlit = pow(phase, 6.0) * 0.6;
        let lit = mix(0.95 * u.sun_brightness + backlit, 0.20, in_shadow);
        col = mix(col, rc.rgb * lit, alpha);
      }
    }
  }

  // ── ACES filmic tonemap + slight contrast pop ──
  // ACES handles bright atmosphere/aurora highlights way better
  // than Reinhard — keeps colors saturated instead of bleaching to
  // white. Slight gamma curve at the end for cinematic punch.
  col = tonemap_aces(col);
  col = pow(col, vec3(0.95));

  return vec4(col, 1.0);
}
`;class Uc{device;presentFormat;uniformBuffer;bindGroupLayout;pipelineByFormat=new Map;bindGroup;startTime=performance.now();accumRotation=0;cloudPhase=0;lastFrameTime=performance.now();params={...Oo};constructor(e,t){this.device=e,this.presentFormat=t,this.uniformBuffer=e.createBuffer({size:176,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.bindGroupLayout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),this.bindGroup=e.createBindGroup({layout:this.bindGroupLayout,entries:[{binding:0,resource:{buffer:this.uniformBuffer}}]}),console.log("[WebGPUPlanet] initialised")}setParams(e){this.params={...Oo,...e}}getOrCreatePipeline(e){const t=String(e),a=this.pipelineByFormat.get(t);if(a)return a;const o=this.device.createShaderModule({code:Ic}),r=this.device.createPipelineLayout({bindGroupLayouts:[this.bindGroupLayout]}),s=this.device.createRenderPipeline({layout:r,vertex:{module:o,entryPoint:"vs_full"},fragment:{module:o,entryPoint:"fs_planet",targets:[{format:e,blend:{color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list"}});return this.pipelineByFormat.set(t,s),s}encodeFrame(e,t,a,o,r,s){const n=performance.now(),l=Math.min(.1,(n-this.lastFrameTime)/1e3);this.lastFrameTime=n,this.accumRotation=(this.accumRotation+(this.params.rotationSpeed??0)*l)%360,this.cloudPhase+=(this.params.cloudSpeed??0)*l;const u=(n-this.startTime)/1e3,f=zc[String(this.params.planet??"earth")]??0,d=new ArrayBuffer(176),h=new Float32Array(d),m=new Uint32Array(d);h[0]=o,h[1]=r,h[2]=u,m[3]=f,h[4]=this.params.cameraDistance??4,h[5]=this.params.fovDeg??50,h[6]=this.params.cameraYaw??0,h[7]=this.params.cameraPitch??0,h[8]=this.params.rotationOffset??0,h[9]=this.accumRotation,h[10]=this.params.sunYaw??-45,h[11]=this.params.sunPitch??15,h[12]=this.params.cloudCoverage??.55,h[13]=this.cloudPhase,h[14]=this.params.atmosphereHeight??.06,h[15]=this.params.auroraStrength??.7,h[16]=this.params.starDensity??1,h[17]=this.params.ringInner??1.3,h[18]=this.params.ringOuter??2.2,h[19]=this.params.ringOpacity??.95;const b=this.params.cloudColor??[255,255,255];h[20]=(b[0]??255)/255,h[21]=(b[1]??255)/255,h[22]=(b[2]??255)/255,h[23]=this.params.sunBrightness??1,h[24]=this.params.planetX??0,h[25]=this.params.planetY??0,h[26]=this.params.ringDetail??1,h[28]=this.params.emission??0,h[29]=this.params.outerGlow??0;const M=this.params.landColor??[110,175,70];h[32]=(M[0]??110)/255,h[33]=(M[1]??175)/255,h[34]=(M[2]??70)/255,h[35]=this.params.shorelineIntensity??1.6;const C=this.params.shorelineColor??[60,230,220];h[36]=(C[0]??60)/255,h[37]=(C[1]??230)/255,h[38]=(C[2]??220)/255,h[39]=this.params.shorelineWidth??.04,h[40]=this.params.cloudThickness??1.8,this.device.queue.writeBuffer(this.uniformBuffer,0,d);const T=this.getOrCreatePipeline(a),I=e.beginRenderPass({colorAttachments:[{view:t,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});I.setPipeline(T),I.setBindGroup(0,this.bindGroup),I.draw(3),I.end()}dispose(){try{this.uniformBuffer?.destroy?.()}catch{}}}const Co=32,ns=1e6,Gc=25e4;function Po(i,e){const t=new Float32Array(16);for(let a=0;a<4;a++)for(let o=0;o<4;o++){let r=0;for(let s=0;s<4;s++)r+=i[s*4+o]*e[a*4+s];t[a*4+o]=r}return t}const ls={identity:0,"depth-shift":1,"sand-fall":2,scatter:3,halftone:4,"stipple-noise":5,dissolve:6},Oc=`
struct Particle {
  pos:   vec3<f32>,
  alpha: f32,
  vel:   vec3<f32>,
  life:  f32,
};

struct Globals {
  time:          f32,   // seconds since init
  dt:            f32,   // seconds since last frame
  total:         u32,   // active particle count
  mode:          u32,   // effect-mode id
  // Per-mode knobs (packed into a single vec4 to keep the uniform
  // small; meanings shift by mode):
  //   depth-shift:  x=depth_strength,  y=_,            z=spin_speed,  w=spin_axis
  //   sand-fall:    x=fall_speed,      y=floor_y,      z=x_drift_amp, w=stream_density (0..1)
  //   scatter:      x=jitter_amp,      y=recovery,     z=noise_freq,  w=_
  //   halftone:     x=cell_size,       y=size_gain,    z=_,           w=_
  //   stipple:      x=wobble_amp,      y=wobble_freq,  z=_,           w=_
  //   dissolve:     x=spread,          y=cycle_speed,  z=swirl,       w=_
  knobs:         vec4<f32>,
  tex_size:      vec2<f32>,
  anchor_jitter: f32,
  // Lighting toggle — when 1, depth-shift mode shades particles via
  // a Lambert term computed from the heightmap normal + light position.
  light_enabled: f32,
  // Light position in world space + intensity multiplier (vec4 for
  // alignment).
  light_pos:     vec4<f32>,    // xyz=position, w=intensity
  // Ambient + heightmap-derivative scale for the lighting model.
  light_ambient_height: vec4<f32>, // x=ambient, y=height_scale, z=_, w=_
  // Noise-driven displacement for depth-shift. amp_xy + amp_z control
  // strength on the two axes; freq + speed control spatial / temporal
  // scale of the underlying value noise.
  noise_params:  vec4<f32>,    // x=amp_xy, y=amp_z, z=freq, w=speed
  // Fit mode + view extent. fit_mode: 0=stretch, 1=contain, 2=cover.
  // view_extent_xy is the camera's visible world extent at the planet
  // plane (z=0) — computed JS-side from FOV + cameraZ + canvas
  // aspect. By sizing the anchor extent to match the view extent,
  // STRETCH always fills the canvas regardless of camera zoom; the
  // other modes scale relative to this baseline.
  // x repurposed: mirror_source_x flag (0 or 1). Anchor extent is
  // already stretch-only after the fit-mode removal so that slot
  // had no consumer; using it for the source-mirror toggle keeps
  // the buffer size unchanged.
  fit_params:    vec4<f32>,    // x=mirror_source_x, y=canvas_aspect, z=view_x, w=view_y
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform>             u: Globals;
@group(0) @binding(2) var src:                 texture_2d<f32>;
@group(0) @binding(3) var samp:                sampler;

// Cheap deterministic hash for per-particle randomness. Returns
// 0..1. A full PRNG is overkill for our use — phase noise reads as
// random enough.
fn hash11(n: f32) -> f32 {
  let s = sin(n * 78.233 + 12.9898) * 43758.5453;
  return s - floor(s);
}
fn hash21(p: vec2<f32>) -> f32 {
  let s = sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453;
  return s - floor(s);
}

// Smooth 2D value noise (gradient noise is not worth the cost for
// post-effect wobble). Range 0..1.
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash21(i);
  let b = hash21(i + vec2(1.0, 0.0));
  let c = hash21(i + vec2(0.0, 1.0));
  let d = hash21(i + vec2(1.0, 1.0));
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

// Luminance from RGB.
fn lum(c: vec3<f32>) -> f32 {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.total) { return; }
  var p = particles[i];

  // Anchor in UV space. We lay out particles on a quasi-uniform grid
  // (Hammersley-ish using bit reversal would be ideal but a simple
  // sqrt-based grid + per-particle jitter avoids visible banding for
  // the counts we care about).
  let count_f = f32(u.total);
  let cols = ceil(sqrt(count_f));
  let cx = f32(i % u32(cols));
  let cy = floor(f32(i) / cols);
  let cell = vec2(cx, cy) / cols;
  let jx = (hash11(f32(i) * 1.731) - 0.5) * u.anchor_jitter / cols;
  let jy = (hash11(f32(i) * 2.137) - 0.5) * u.anchor_jitter / cols;
  let uv = clamp(cell + vec2(jx, jy), vec2(0.0), vec2(0.99999));

  // Default tint (vel) to white — modes that use lighting (depth-
  // shift) overwrite this. Render shader multiplies the source
  // sample by p.vel.xyz, so vec3(1) is a no-op tint.
  p.vel = vec3(1.0);

  // Source-sampling UV. We mirror the SAMPLE (not the anchor) when
  // mirror_source_x is on so particles stay in place but read the
  // colour from the opposite side of the source — the standard
  // "selfie" flip for webcam feeds. Costs one branch per particle.
  var sample_uv = uv;
  if (u.fit_params.x > 0.5) { sample_uv.x = 1.0 - sample_uv.x; }

  // Sample source color + luminance (used for depth in several modes).
  let col = textureSampleLevel(src, samp, sample_uv, 0.0);
  let l = lum(col.rgb);

  // Anchor extent matches the camera's view extent at the source
  // plane (z=0). The source UV maps uniformly across this extent,
  // so the source always fills the visible canvas — non-matching
  // aspects show the source stretched to fit. The user controls
  // framing via Camera Distance / FOV / Pan (no separate fit mode).
  let view_x = max(u.fit_params.z, 0.001);
  let view_y = max(u.fit_params.w, 0.001);
  let anchor_world = vec2((uv.x * 2.0 - 1.0) * view_x, (1.0 - uv.y * 2.0) * view_y);

  if (u.mode == 0u) {
    // ── IDENTITY ──
    // Pin to anchor with a subtle per-particle alpha shimmer so the
    // image has a faint living quality (not stone-still). Camera
    // controls still apply so the user can frame / zoom the source.
    p.pos = vec3(anchor_world, 0.0);
    let shimmer = 0.92 + 0.08 * sin(u.time * 1.3 + f32(i) * 0.07);
    p.alpha = col.a * shimmer;
    p.life = 1.0;
  } else if (u.mode == 1u) {
    // ── DEPTH SHIFT ──
    // Z displaced by luminance with optional auto-spin (set spin
    // speed = 0 to disable; default is 0). Camera yaw/pitch in the
    // VP matrix lets the user orbit even when auto-spin is off.
    // Optional Lambert lighting from a movable point light: surface
    // normal computed from the source's luminance derivatives, then
    // diffuse term applied to the particle color.
    let depth = u.knobs.x;
    let spin_s = u.knobs.z;
    let axis = u.knobs.w;     // 0=Y axis, 1=X axis (rotate vertically)
    let z = (l - 0.5) * depth;
    var rotated = vec3(anchor_world, z);
    if (abs(spin_s) > 0.001) {
      let ang = u.time * spin_s;
      let s_sin = sin(ang);
      let s_cos = cos(ang);
      if (axis < 0.5) {
        rotated = vec3(
          s_cos * rotated.x + s_sin * rotated.z,
          rotated.y,
          -s_sin * rotated.x + s_cos * rotated.z,
        );
      } else {
        rotated = vec3(
          rotated.x,
          s_cos * rotated.y - s_sin * rotated.z,
          s_sin * rotated.y + s_cos * rotated.z,
        );
      }
    }
    // ── Noise displacement ──
    // Layered value noise sampled at (uv * freq) + a time offset
    // gives a flowing per-particle wobble. Three different sample
    // points (offset in noise space) produce decorrelated x/y/z
    // displacements so the particle wanders smoothly rather than
    // sliding along one axis.
    let n_amp_xy = u.noise_params.x;
    let n_amp_z = u.noise_params.y;
    let n_freq = max(u.noise_params.z, 0.001);
    let n_speed = u.noise_params.w;
    if (n_amp_xy > 0.0001 || n_amp_z > 0.0001) {
      let nt = u.time * n_speed;
      // Three noise samples — separated by large arbitrary offsets so
      // they read as independent fields. Center each on 0 by
      // subtracting 0.5.
      let nx = vnoise(uv * n_freq + vec2(nt, 0.0)) - 0.5;
      let ny = vnoise(uv * n_freq + vec2(17.31, nt * 0.83)) - 0.5;
      let nz = vnoise(uv * n_freq + vec2(43.7 + nt * 0.61, 91.2)) - 0.5;
      rotated.x = rotated.x + nx * n_amp_xy * 2.0;
      rotated.y = rotated.y + ny * n_amp_xy * 2.0;
      rotated.z = rotated.z + nz * n_amp_z;
    }
    p.pos = rotated;

    // ── Lighting (optional) ──
    // Compute a surface normal from the heightmap derivatives, then
    // Lambert-shade against the user's light position. Result stored
    // in p.color; render shader uses p.color as a tint multiplier on
    // top of the source sample so colored sources keep their colour
    // but get the light/shadow gradient.
    var tint = vec3(1.0);
    if (u.light_enabled > 0.5) {
      let h_scale = u.light_ambient_height.y;
      // Sample neighbours for finite-difference normal. Use the
      // texture size to compute one-pixel offsets; fallback to a
      // small fixed offset when tex_size is missing.
      let px = vec2(1.0 / max(u.tex_size.x, 1.0), 0.0);
      let py = vec2(0.0, 1.0 / max(u.tex_size.y, 1.0));
      let lL = lum(textureSampleLevel(src, samp, clamp(sample_uv - px, vec2(0.0), vec2(1.0)), 0.0).rgb);
      let lR = lum(textureSampleLevel(src, samp, clamp(sample_uv + px, vec2(0.0), vec2(1.0)), 0.0).rgb);
      let lU = lum(textureSampleLevel(src, samp, clamp(sample_uv - py, vec2(0.0), vec2(1.0)), 0.0).rgb);
      let lD = lum(textureSampleLevel(src, samp, clamp(sample_uv + py, vec2(0.0), vec2(1.0)), 0.0).rgb);
      let dx = (lR - lL) * depth * h_scale * 4.0;
      let dy = (lD - lU) * depth * h_scale * 4.0;
      // Source plane lives in XY, depth in Z. Normal points toward
      // +Z when surface is flat; gradient tilts it toward -gradient.
      let n = normalize(vec3(-dx, dy, 1.0));
      let to_light = normalize(u.light_pos.xyz - rotated);
      let diffuse = max(dot(n, to_light), 0.0);
      let intensity = u.light_pos.w;
      let ambient = u.light_ambient_height.x;
      tint = vec3(ambient + diffuse * intensity);
    }
    // Stash tint in vel (vel is unused by the new stateless modes).
    // Render shader multiplies the source sample by this vec3 to
    // apply the lighting term.
    p.vel = tint;
    p.alpha = col.a;
    p.life = 1.0;
  } else if (u.mode == 2u) {
    // ── SAND FALL ──
    // Stateless continuous flow. Each particle has a per-particle
    // PHASE (offset from a global clock), and its Y position
    // interpolates from the anchor (top) down to the floor over a
    // period. When phase wraps, it pops back up to the anchor —
    // result is a constant rain of grains with the source image
    // visible at the top. Stateless = no per-frame state, no
    // settling-then-stopping bug.
    let fall_speed = max(u.knobs.x, 0.05);   // cycles per second-ish
    let floor_y = u.knobs.y;                  // bottom Y in world coords
    let drift_amp = u.knobs.z;                // x-drift amplitude
    let density = clamp(u.knobs.w, 0.0, 1.0); // 0=sparse, 1=full
    // Per-particle phase: time + per-particle offset (0..1) wrapped
    // by fall_speed so each grain falls on its own schedule.
    let h = hash11(f32(i) * 0.137);
    let phase = fract(u.time * fall_speed + h);
    // Y interpolates from anchor_world.y (top) to floor_y (bottom).
    let top_y = anchor_world.y;
    let drop_y = mix(top_y, floor_y, phase);
    // X-drift uses time-varying noise per particle so streams aren't
    // perfectly vertical.
    let drift_x = sin(u.time * 0.6 + f32(i) * 0.21) * drift_amp;
    p.pos = vec3(anchor_world.x + drift_x, drop_y, 0.0);
    // Density gate — particles whose hash exceeds the density value
    // are hidden so the user can sparsify a dense source.
    let visible = step(h, density);
    // Soft fade in (entering from anchor) + fade out (about to wrap).
    let fade = smoothstep(0.0, 0.04, phase) * smoothstep(1.0, 0.96, phase);
    p.alpha = col.a * fade * visible;
  } else if (u.mode == 3u) {
    // ── SCATTER ──
    // Each particle wobbles around its anchor following a noise
    // field; recovery pulls it back so the image holds its overall
    // shape while constantly trembling. Reads as "alive sand image".
    let amp = u.knobs.x;
    let recov = u.knobs.y;
    let nf = u.knobs.z;
    let n1 = vnoise(uv * nf + vec2(u.time * 0.3, 0.0));
    let n2 = vnoise(uv * nf + vec2(0.0, u.time * 0.27));
    // 'target' is a WGSL reserved keyword — using target_pos.
    let target_pos = vec3(
      anchor_world.x + (n1 - 0.5) * amp,
      anchor_world.y + (n2 - 0.5) * amp,
      0.0,
    );
    p.pos = mix(p.pos, target_pos, clamp(recov * u.dt * 6.0, 0.0, 1.0));
    p.alpha = col.a;
  } else if (u.mode == 4u) {
    // ── HALFTONE ──
    // Snap to a coarse grid based on cell_size, then particle's
    // alpha = smoothed luminance and its rendered size scales with
    // luminance too (handled in vertex shader via meta read).
    let cs = max(u.knobs.x, 0.005);
    let grid_uv = floor(uv / cs) * cs + cs * 0.5;
    let grid_world = vec2(grid_uv.x * 2.0 - 1.0, 1.0 - grid_uv.y * 2.0);
    p.pos = vec3(grid_world, 0.0);
    // Re-sample at the cell center so dot color isn't dependent on
    // sub-cell position (avoids dot color flicker as you change
    // cell size). Apply the mirror flip to the sample only — dot
    // position stays put.
    var cell_sample_uv = grid_uv;
    if (u.fit_params.x > 0.5) { cell_sample_uv.x = 1.0 - cell_sample_uv.x; }
    let cell_col = textureSampleLevel(src, samp, cell_sample_uv, 0.0);
    let cell_l = lum(cell_col.rgb);
    p.alpha = cell_l;
    // Stash luminance in life so the vertex shader can scale dot size.
    p.life = cell_l;
  } else if (u.mode == 5u) {
    // ── STIPPLE NOISE ──
    // Tight micro-wobble using a high-frequency noise. Reads as
    // hand-drawn ink stipple shimmering. Particle alpha modulated
    // by luminance so dark areas read as denser.
    let amp = u.knobs.x;
    let freq = u.knobs.y;
    let nx = vnoise(uv * freq + vec2(u.time * 1.7, 0.0));
    let ny = vnoise(uv * freq + vec2(0.0, u.time * 1.3));
    p.pos = vec3(
      anchor_world.x + (nx - 0.5) * amp,
      anchor_world.y + (ny - 0.5) * amp,
      0.0,
    );
    // Map: dark in source = brighter dot (ink stipple is denser in
    // shadows). Subtract from 1 to invert.
    let inv_l = 1.0 - l;
    p.alpha = pow(inv_l, 1.6) * col.a;
  } else if (u.mode == 6u) {
    // ── DISSOLVE ──
    // Stateless looping cycle. Each particle progresses through
    // phase 0..1 with per-particle offset so dissolution is
    // staggered. At phase=0 the particle is
    // at its anchor with full alpha; as phase increases it drifts
    // outward in a swirl and fades; at phase=1 it loops back to the
    // anchor instantly. Continuously cycles — no black-screen
    // freeze-state.
    let spread = u.knobs.x;
    let cycle_speed = max(u.knobs.y, 0.05);   // cycles per second
    let swirl = u.knobs.z;
    let h = hash11(f32(i) * 0.193);
    let phase = fract(u.time * cycle_speed + h);
    let r = phase * spread;
    let ang = uv.x * 6.28318 + u.time * swirl + h * 6.28318;
    p.pos = vec3(
      anchor_world.x + cos(ang) * r,
      anchor_world.y + sin(ang) * r,
      0.0,
    );
    // Smooth in (snap back is gentle, not hard) + fade out as phase
    // reaches 1. Keeps the cycle visually continuous.
    let fade = smoothstep(0.0, 0.06, phase) * (1.0 - phase);
    p.alpha = fade * col.a;
  }

  particles[i] = p;
}
`,Wc=`
struct Particle {
  pos:   vec3<f32>,
  alpha: f32,
  vel:   vec3<f32>,
  life:  f32,
};

struct RU {
  // Combined view+projection (perspective so depth-shift reads).
  // Flattened row-major into 4 vec4s.
  vp:           mat4x4<f32>,
  // Aspect for billboard squareness, particle size in normalized
  // units, mode for size-modulation behaviour, opacity envelope.
  mu:           vec4<f32>,    // x=aspect_y, y=base_size, z=mode_id, w=opacity ('meta' is reserved in WGSL)
  // Per-frame flags. x=mirror_source_x (mirrors the resample UV in
  // the fragment so render-side particle re-sampling matches the
  // compute-side mirror).
  flags:        vec4<f32>,
};

@group(0) @binding(0) var<storage, read>      particles: array<Particle>;
@group(0) @binding(1) var<uniform>            u: RU;
@group(0) @binding(2) var src:                texture_2d<f32>;
@group(0) @binding(3) var samp:               sampler;

struct VSOut {
  @builtin(position) clip:  vec4<f32>,
  @location(0) uv:          vec2<f32>,
  @location(1) color:       vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var corners = array<vec2<f32>, 6>(
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
    vec2(-1.0, 1.0),  vec2(1.0, -1.0), vec2(1.0, 1.0),
  );
  let corner = corners[vid];
  let p = particles[iid];

  if (p.alpha <= 0.001) {
    var dead: VSOut;
    dead.clip = vec4(2.0, 2.0, 0.0, 1.0);
    dead.uv = vec2(0.0);
    dead.color = vec4(0.0);
    return dead;
  }

  // Halftone (mode 4) scales dot size by luminance (stored in life).
  // Default behaviour: size proportional to alpha so very-dim
  // particles barely show.
  let mode_id = u.mu.z;
  var size_mul = 0.5 + clamp(p.alpha, 0.0, 1.0) * 0.5;
  if (mode_id > 3.5 && mode_id < 4.5) {
    // Halftone: size from p.life (= luminance set by compute)
    size_mul = clamp(p.life, 0.05, 1.0) * 1.6;
  }

  let base = u.mu.y;
  let size_x = base * size_mul;
  let size_y = base * size_mul * u.mu.x;

  // Project the particle's world position via vp matrix; the
  // billboard offsets are added in clip space (post-projection)
  // so size stays constant on screen regardless of depth.
  let world = p.pos;
  let clip_center = u.vp * vec4(world, 1.0);
  // Perspective-divide the offset so size is in NDC; multiply by w
  // to keep the offset in clip space.
  let offset_clip = vec2(corner.x * size_x, corner.y * size_y) * clip_center.w;
  let clip_pos = vec4(clip_center.xy + offset_clip, clip_center.z, clip_center.w);

  // Sample source color at this particle's anchor again — for
  // identity/depth-shift modes the world-XY IS the anchor (mapped
  // back to uv), but for sand/scatter the position has moved away.
  // We stash the original sample once at compute and read it via
  // a simple re-sample using anchor bookkeeping... easier: we
  // re-sample using the world-XY converted back to UV, which is
  // close enough for static modes and gives a "wipe" smear for
  // dynamic ones (looks intentional).
  var resample_uv = vec2(world.x * 0.5 + 0.5, 1.0 - (world.y * 0.5 + 0.5));
  if (u.flags.x > 0.5) { resample_uv.x = 1.0 - resample_uv.x; }
  let c = textureSampleLevel(src, samp, clamp(resample_uv, vec2(0.0), vec2(1.0)), 0.0);
  let opacity_env = u.mu.w;
  let a = clamp(p.alpha * opacity_env, 0.0, 1.0);
  // p.vel doubles as a per-particle tint (set by compute shader for
  // lighting in depth-shift; defaults to vec3(1) for everything else).
  let tint = p.vel;
  var col_rgb = c.rgb * tint * a;
  // Halftone: render dots in source color, but boost contrast so
  // they read as proper print dots (not muted).
  if (mode_id > 3.5 && mode_id < 4.5) {
    col_rgb = c.rgb * tint * a * 1.4;
  }

  var out: VSOut;
  out.clip = clip_pos;
  out.uv = corner * 0.5 + 0.5;
  out.color = vec4(col_rgb, a);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Disc with smooth edge — looks like a soft sprite.
  let d = length(in.uv - 0.5) * 2.0;
  if (d > 1.0) { discard; }
  let edge = 1.0 - smoothstep(0.7, 1.0, d);
  let alpha = in.color.a * edge;
  return vec4(in.color.rgb * edge, alpha);
}
`;class nr{static async create(e,t){return new nr(e,t)}device;presentFormat;particleBuffer;globalsBuffer;renderUniformBuffer;sourceTexture=null;sourceSampler;computePipeline;renderPipeline;computeBindGroupLayout;renderBindGroupLayout;renderPipelineLayout;renderModule;computeBindGroup=null;renderBindGroup=null;renderPipelinesByBlend=new Map;currentBlend="add";particleCount=Gc;mode="identity";knobs=[1,0,0,0];baseSize=.005;opacity=1;anchorJitter=.6;fovDeg=50;cameraZ=2.2;cameraYaw=0;cameraPitch=0;panX=0;panY=0;lightEnabled=!1;lightPos=[1,1,1.5];lightIntensity=1.5;lightAmbient=.25;lightHeightStrength=1.5;noiseAmpXY=0;noiseAmpZ=0;noiseFreq=4;noiseSpeed=.5;fitMode=2;mirrorX=!1;texW=1;texH=1;viewportW=1920;viewportH=1080;startTime=0;lastFrameTime=0;needsParticleReset=!0;stats={framesEncoded:0,particleCount:0,hasSource:!1};constructor(e,t){this.device=e,this.presentFormat=t,this.startTime=performance.now(),this.lastFrameTime=this.startTime,this.particleBuffer=e.createBuffer({size:ns*Co,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.globalsBuffer=e.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.renderUniformBuffer=e.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.sourceSampler=e.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});const a=e.createShaderModule({code:Oc});this.computeBindGroupLayout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:2,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"float"}},{binding:3,visibility:GPUShaderStage.COMPUTE,sampler:{}}]}),this.computePipeline=e.createComputePipeline({layout:e.createPipelineLayout({bindGroupLayouts:[this.computeBindGroupLayout]}),compute:{module:a,entryPoint:"cs_main"}}),this.renderModule=e.createShaderModule({code:Wc}),this.renderBindGroupLayout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:2,visibility:GPUShaderStage.VERTEX,texture:{sampleType:"float"}},{binding:3,visibility:GPUShaderStage.VERTEX,sampler:{}}]}),this.renderPipelineLayout=e.createPipelineLayout({bindGroupLayouts:[this.renderBindGroupLayout]}),this.renderPipeline=this.getOrCreateRenderPipeline("add"),console.log("[WebGPUPixelParticles] initialised")}async setSourceImage(e){let t,a;e instanceof ImageBitmap?(t=e.width,a=e.height):e instanceof HTMLVideoElement?(t=e.videoWidth,a=e.videoHeight):e instanceof HTMLCanvasElement?(t=e.width,a=e.height):(t=e.naturalWidth,a=e.naturalHeight),!(t<=0||a<=0)&&(this.ensureSourceTexture(t,a),this.device.queue.copyExternalImageToTexture({source:e},{texture:this.sourceTexture},[t,a,1]),this.rebuildBindGroups(),this.needsParticleReset=!0,this.stats.hasSource=!0,console.log("[WebGPUPixelParticles] source uploaded:",t,"x",a,"("+e.constructor.name+")"))}updateSourceFromVideo(e){if(!e||e.readyState<2)return;const t=e.videoWidth,a=e.videoHeight;if(t<=0||a<=0)return;(!this.sourceTexture||this.texW!==t||this.texH!==a)&&(this.ensureSourceTexture(t,a),this.rebuildBindGroups(),this.stats.hasSource=!0,this.needsParticleReset=!0);try{this.device.queue.copyExternalImageToTexture({source:e},{texture:this.sourceTexture},[t,a,1])}catch{}}updateSourceFromBytes(e,t,a){if(t<=0||a<=0||e.byteLength!==t*a*4)return;(!this.sourceTexture||this.texW!==t||this.texH!==a)&&(this.ensureSourceTexture(t,a),this.rebuildBindGroups(),this.needsParticleReset=!0);try{this.device.queue.writeTexture({texture:this.sourceTexture},e,{bytesPerRow:t*4,rowsPerImage:a},[t,a,1])}catch{}}updateSourceFromCanvas(e){const t=e.width,a=e.height;if(t<=0||a<=0)return;(!this.sourceTexture||this.texW!==t||this.texH!==a)&&(this.ensureSourceTexture(t,a),this.rebuildBindGroups(),this.stats.hasSource=!0,this.needsParticleReset=!0);try{this.device.queue.copyExternalImageToTexture({source:e},{texture:this.sourceTexture},[t,a,1])}catch{}}ensureSourceTexture(e,t){if(!(this.sourceTexture&&this.texW===e&&this.texH===t)){try{this.sourceTexture?.destroy?.()}catch{}this.sourceTexture=this.device.createTexture({size:[e,t,1],format:"rgba8unorm",usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT}),this.texW=e,this.texH=t}}setMode(e){this.mode!==e&&(this.mode=e,this.needsParticleReset=!0)}setKnobs(e){this.knobs=e}setBaseSize(e){this.baseSize=Math.max(5e-4,Math.min(.05,e))}setOpacity(e){this.opacity=Math.max(0,Math.min(1,e))}setAnchorJitter(e){this.anchorJitter=Math.max(0,Math.min(1,e))}setCamera(e,t){this.fovDeg=Math.max(10,Math.min(120,e)),this.cameraZ=Math.max(.5,Math.min(10,t))}setOrbit(e,t){this.cameraYaw=e,this.cameraPitch=t}setPan(e,t){this.panX=e,this.panY=t}setLight(e,t,a,o,r,s,n){this.lightEnabled=e,this.lightPos=[t,a,o],this.lightIntensity=r,this.lightAmbient=s,this.lightHeightStrength=n}setNoise(e,t,a,o){this.noiseAmpXY=e,this.noiseAmpZ=t,this.noiseFreq=a,this.noiseSpeed=o}setFitMode(e){this.fitMode=Math.max(0,Math.min(2,Math.round(e)))}setMirrorX(e){this.mirrorX=!!e}setParticleCount(e){const t=Math.max(1024,Math.min(ns,Math.floor(e)));t!==this.particleCount&&(this.particleCount=t,this.needsParticleReset=!0)}setViewport(e,t){this.viewportW=e,this.viewportH=t}setBlendMode(e){e!==this.currentBlend&&(this.currentBlend=e,this.renderPipeline=this.getOrCreateRenderPipeline(e))}getOrCreateRenderPipeline(e){const t=this.renderPipelinesByBlend.get(e);if(t)return t;const a=this.blendDescriptorFor(e),o=this.device.createRenderPipeline({layout:this.renderPipelineLayout,vertex:{module:this.renderModule,entryPoint:"vs_main"},fragment:{module:this.renderModule,entryPoint:"fs_main",targets:[{format:this.presentFormat,blend:a}]},primitive:{topology:"triangle-list"}});return this.renderPipelinesByBlend.set(e,o),o}blendDescriptorFor(e){switch(e){case"normal":return{color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}};case"add":return{color:{srcFactor:"one",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}};case"multiply":return{color:{srcFactor:"dst",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}};case"screen":return{color:{srcFactor:"one",dstFactor:"one-minus-src",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}};case"subtract":return{color:{srcFactor:"one",dstFactor:"one",operation:"reverse-subtract"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}};case"darken":return{color:{srcFactor:"one",dstFactor:"one",operation:"min"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}};case"lighten":return{color:{srcFactor:"one",dstFactor:"one",operation:"max"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}};default:return{color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}}rebuildBindGroups(){if(!this.sourceTexture)return;const e=this.sourceTexture.createView();this.computeBindGroup=this.device.createBindGroup({layout:this.computeBindGroupLayout,entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.globalsBuffer}},{binding:2,resource:e},{binding:3,resource:this.sourceSampler}]}),this.renderBindGroup=this.device.createBindGroup({layout:this.renderBindGroupLayout,entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.renderUniformBuffer}},{binding:2,resource:e},{binding:3,resource:this.sourceSampler}]})}resetParticles(){const e=new Float32Array(this.particleCount*(Co/4));for(let t=0;t<this.particleCount;t++)e[t*8+7]=1;this.device.queue.writeBuffer(this.particleBuffer,0,e.buffer,0,this.particleCount*Co),this.needsParticleReset=!1}computeViewProjection(){const e=this.viewportW/Math.max(1,this.viewportH),t=this.fovDeg*Math.PI/180,a=.1,o=100,r=1/Math.tan(t/2),s=new Float32Array(16);s[0]=r/e,s[5]=r,s[10]=(o+a)/(a-o),s[11]=-1,s[14]=2*o*a/(a-o);const n=this.cameraYaw*Math.PI/180,l=this.cameraPitch*Math.PI/180,u=Math.cos(n),f=Math.sin(n),d=Math.cos(l),h=Math.sin(l),m=new Float32Array(16);m[0]=u,m[2]=f,m[5]=1,m[8]=-f,m[10]=u,m[15]=1;const b=new Float32Array(16);b[0]=1,b[5]=d,b[6]=h,b[9]=-h,b[10]=d,b[15]=1;const M=new Float32Array(16);M[0]=M[5]=M[10]=M[15]=1,M[12]=this.panX,M[13]=this.panY,M[14]=-this.cameraZ;const C=Po(b,m),T=Po(M,C);return Po(s,T)}encodeFrame(e,t){if(!this.sourceTexture||!this.computeBindGroup||!this.renderBindGroup)return;this.needsParticleReset&&this.resetParticles();const a=performance.now(),o=(a-this.startTime)/1e3,r=Math.min(.05,(a-this.lastFrameTime)/1e3);this.lastFrameTime=a;const s=new ArrayBuffer(112),n=new Float32Array(s),l=new Uint32Array(s);n[0]=o,n[1]=r,l[2]=this.particleCount,l[3]=ls[this.mode],n[4]=this.knobs[0],n[5]=this.knobs[1],n[6]=this.knobs[2],n[7]=this.knobs[3],n[8]=this.texW,n[9]=this.texH,n[10]=this.anchorJitter,n[11]=this.lightEnabled?1:0,n[12]=this.lightPos[0],n[13]=this.lightPos[1],n[14]=this.lightPos[2],n[15]=this.lightIntensity,n[16]=this.lightAmbient,n[17]=this.lightHeightStrength,n[20]=this.noiseAmpXY,n[21]=this.noiseAmpZ,n[22]=this.noiseFreq,n[23]=this.noiseSpeed;const u=this.fovDeg*Math.PI/180,f=this.viewportW/Math.max(1,this.viewportH),d=Math.tan(u*.5)*this.cameraZ,h=d*f;n[24]=this.mirrorX?1:0,n[25]=f,n[26]=h,n[27]=d,this.device.queue.writeBuffer(this.globalsBuffer,0,s);const m=new ArrayBuffer(96),b=new Float32Array(m),M=this.computeViewProjection();b.set(M,0),b[16]=this.viewportW/Math.max(1,this.viewportH),b[17]=this.baseSize,b[18]=ls[this.mode],b[19]=this.opacity,b[20]=this.mirrorX?1:0,this.device.queue.writeBuffer(this.renderUniformBuffer,0,m);const C=e.beginComputePass();C.setPipeline(this.computePipeline),C.setBindGroup(0,this.computeBindGroup),C.dispatchWorkgroups(Math.ceil(this.particleCount/64)),C.end();const T=e.beginRenderPass({colorAttachments:[{view:t,loadOp:"load",storeOp:"store"}]});T.setPipeline(this.renderPipeline),T.setBindGroup(0,this.renderBindGroup),T.draw(6,this.particleCount,0,0),T.end(),this.stats.framesEncoded++,this.stats.particleCount=this.particleCount}dispose(){try{this.particleBuffer?.destroy?.()}catch{}try{this.globalsBuffer?.destroy?.()}catch{}try{this.renderUniformBuffer?.destroy?.()}catch{}try{this.sourceTexture?.destroy?.()}catch{}}}const Ws=[{kind:"media-source",key:"source",label:"Source",group:"Source"},{kind:"toggle",key:"mirrorX",label:"Mirror Horizontally",group:"Source",default:!1},{kind:"select",key:"mode",label:"Mode",group:"Mode",options:[{value:"depth-shift",label:"Depth Shift"},{value:"sand-fall",label:"Sand Fall"},{value:"scatter",label:"Scatter"},{value:"halftone",label:"Halftone"},{value:"stipple-noise",label:"Stipple Ink"},{value:"dissolve",label:"Dissolve"},{value:"identity",label:"Identity"}],default:"depth-shift"},{kind:"slider",key:"depthAmount",label:"Depth",group:"Mode Params",min:0,max:3,step:.01,default:.6,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"depthSpinSpeed",label:"Auto-spin Speed",group:"Mode Params",min:-2,max:2,step:.01,default:0,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"depthSpinAxis",label:"Spin Axis (0=Y, 1=X)",group:"Mode Params",min:0,max:1,step:1,default:0,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"sandFallSpeed",label:"Fall Speed",group:"Mode Params",min:.05,max:3,step:.01,default:.4,showWhen:{mode:"sand-fall"}},{kind:"slider",key:"sandFloorY",label:"Floor Y",group:"Mode Params",min:-1.5,max:1.5,step:.01,default:-1,showWhen:{mode:"sand-fall"}},{kind:"slider",key:"sandDrift",label:"X Drift",group:"Mode Params",min:0,max:.2,step:.001,default:.02,showWhen:{mode:"sand-fall"}},{kind:"slider",key:"sandDensity",label:"Density",group:"Mode Params",min:.05,max:1,step:.01,default:1,showWhen:{mode:"sand-fall"}},{kind:"slider",key:"scatterAmp",label:"Wobble Amp",group:"Mode Params",min:0,max:.3,step:.005,default:.04,showWhen:{mode:"scatter"}},{kind:"slider",key:"scatterRecovery",label:"Recovery",group:"Mode Params",min:0,max:5,step:.05,default:1.5,showWhen:{mode:"scatter"}},{kind:"slider",key:"scatterFreq",label:"Noise Freq",group:"Mode Params",min:.5,max:30,step:.5,default:4,showWhen:{mode:"scatter"}},{kind:"slider",key:"halftoneCellSize",label:"Cell Size",group:"Mode Params",min:.003,max:.05,step:.001,default:.012,showWhen:{mode:"halftone"}},{kind:"slider",key:"stippleAmp",label:"Wobble Amp",group:"Mode Params",min:0,max:.05,step:.001,default:.008,showWhen:{mode:"stipple-noise"}},{kind:"slider",key:"stippleFreq",label:"Wobble Freq",group:"Mode Params",min:5,max:100,step:1,default:35,showWhen:{mode:"stipple-noise"}},{kind:"slider",key:"dissolveSpread",label:"Spread",group:"Mode Params",min:0,max:4,step:.05,default:1.6,showWhen:{mode:"dissolve"}},{kind:"slider",key:"dissolveSpeed",label:"Cycle Speed",group:"Mode Params",min:.05,max:3,step:.05,default:.6,showWhen:{mode:"dissolve"}},{kind:"slider",key:"dissolveSwirl",label:"Swirl",group:"Mode Params",min:-3,max:3,step:.05,default:.5,showWhen:{mode:"dissolve"}},{kind:"slider",key:"particleCount",label:"Count",group:"Particles",min:1e4,max:1e6,step:1e4,default:25e4},{kind:"slider",key:"baseSize",label:"Size",group:"Particles",min:.001,max:.02,step:5e-4,default:.005},{kind:"slider",key:"opacity",label:"Opacity",group:"Particles",min:0,max:1,step:.01,default:1},{kind:"slider",key:"anchorJitter",label:"Anchor Jitter",group:"Particles",min:0,max:1,step:.01,default:.6},{kind:"slider",key:"fovDeg",label:"FOV",group:"Camera",min:20,max:100,step:1,default:50},{kind:"slider",key:"cameraZ",label:"Distance",group:"Camera",min:.5,max:8,step:.05,default:2.2},{kind:"angle",key:"cameraYaw",label:"Yaw",group:"Camera",default:0},{kind:"angle",key:"cameraPitch",label:"Pitch",group:"Camera",default:0},{kind:"slider",key:"panX",label:"Pan X",group:"Camera",min:-1.5,max:1.5,step:.01,default:0},{kind:"slider",key:"panY",label:"Pan Y",group:"Camera",min:-1.5,max:1.5,step:.01,default:0},{kind:"toggle",key:"lightEnabled",label:"Enable Light",group:"Light",default:!1,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"lightX",label:"Light X",group:"Light",min:-2,max:2,step:.01,default:1,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"lightY",label:"Light Y",group:"Light",min:-2,max:2,step:.01,default:1,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"lightZ",label:"Light Z",group:"Light",min:.05,max:4,step:.01,default:1.5,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"lightIntensity",label:"Intensity",group:"Light",min:0,max:4,step:.01,default:1.5,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"lightAmbient",label:"Ambient",group:"Light",min:0,max:1,step:.01,default:.25,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"lightHeightStrength",label:"Surface Strength",group:"Light",min:0,max:4,step:.01,default:1.5,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"noiseAmpXY",label:"Wobble XY",group:"Noise Flow",min:0,max:.5,step:.005,default:0,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"noiseAmpZ",label:"Wobble Z",group:"Noise Flow",min:0,max:2,step:.01,default:0,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"noiseFreq",label:"Frequency",group:"Noise Flow",min:.5,max:30,step:.1,default:4,showWhen:{mode:"depth-shift"}},{kind:"slider",key:"noiseSpeed",label:"Speed",group:"Noise Flow",min:0,max:3,step:.01,default:.5,showWhen:{mode:"depth-shift"}}],Vs=ua(Ws);function Vc(i,e){switch(i){case"depth-shift":return[e.depthAmount??.6,0,e.depthSpinSpeed??0,e.depthSpinAxis??0];case"sand-fall":return[e.sandFallSpeed??.4,e.sandFloorY??-1,e.sandDrift??.02,e.sandDensity??1];case"scatter":return[e.scatterAmp??.04,e.scatterRecovery??1.5,e.scatterFreq??4,0];case"halftone":return[e.halftoneCellSize??.012,1,0,0];case"stipple-noise":return[e.stippleAmp??.008,e.stippleFreq??35,0,0];case"dissolve":return[e.dissolveSpread??1.6,e.dissolveSpeed??.6,e.dissolveSwirl??.5,0];default:return[0,0,0,0]}}class Nc{inner;constructor(e,t){this.inner=new nr(e,t)}setParams(e){const t={...Vs,...e},a=t.mode||"depth-shift";this.inner.setMode(a),this.inner.setKnobs(Vc(a,t)),this.inner.setBaseSize(t.baseSize??.005),this.inner.setOpacity(t.opacity??1),this.inner.setAnchorJitter(t.anchorJitter??.6),this.inner.setCamera(t.fovDeg??50,t.cameraZ??2.2),this.inner.setOrbit(t.cameraYaw??0,t.cameraPitch??0),this.inner.setPan(t.panX??0,t.panY??0),this.inner.setLight(!!t.lightEnabled,t.lightX??1,t.lightY??1,t.lightZ??1.5,t.lightIntensity??1.5,t.lightAmbient??.25,t.lightHeightStrength??1.5),this.inner.setNoise(t.noiseAmpXY??0,t.noiseAmpZ??0,t.noiseFreq??4,t.noiseSpeed??.5),this.inner.setParticleCount(t.particleCount??25e4),this.inner.setMirrorX(!!t.mirrorX),this.inner.setBlendMode("normal")}setSource(e){e instanceof HTMLVideoElement?this.inner.updateSourceFromVideo(e):e instanceof HTMLCanvasElement?this.inner.updateSourceFromCanvas(e):this.inner.setSourceImage(e)}setSourceFromBytes(e,t,a){this.inner.updateSourceFromBytes(e,t,a)}encodeFrame(e,t,a,o,r,s){this.inner.setViewport(o,r),e.beginRenderPass({colorAttachments:[{view:t,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]}).end(),this.inner.encodeFrame(e,t)}resize(e,t){}dispose(){try{this.inner.dispose?.()}catch{}}}const ko=48,qc=1e6,Ns=25e4;function To(i,e){const t=new Float32Array(16);for(let a=0;a<4;a++)for(let o=0;o<4;o++){let r=0;for(let s=0;s<4;s++)r+=i[s*4+o]*e[a*4+s];t[a*4+o]=r}return t}function Yc(){const i=new Float32Array(16);return i[0]=i[5]=i[10]=i[15]=1,i}function Hc(i,e,t,a){const o=1/Math.tan(i*Math.PI/180/2),r=new Float32Array(16);return r[0]=o/e,r[5]=o,r[10]=a/(t-a),r[11]=-1,r[14]=t*a/(t-a),r}function jc(i,e,t){const a=Yc();return a[12]=i,a[13]=e,a[14]=t,a}const Xc=`
struct Particle {
  pos:         vec3<f32>,
  alpha:       f32,
  vel:         vec3<f32>,
  depthAnchor: f32,
  anchor:      vec2<f32>,
  _pad:        vec2<f32>,
};

struct U {
  dt:              f32,
  time:            f32,
  flowStrength:    f32,
  flowScale:       f32,
  anchorPull:      f32,
  tunnelDepth:     f32,
  depthStrength:   f32,
  particleCount:   u32,
  flyDistance:     f32,
  _pad0:           f32,
  _pad1:           f32,
  _pad2:           f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> u: U;

// Cheap value-noise gradient hash. Good enough for the curl field —
// we're not after physically-correct flow, just smooth swirly motion.
fn hash3(p: vec3<f32>) -> f32 {
  let q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7, 74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6)),
  );
  return fract(sin(q.x + q.y + q.z) * 43758.5453);
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z) * 2.0 - 1.0;
}

// curl(noise) — divergence-free flow field, gives smooth swirly motion
// that looks like fluid. Cheap finite-difference approximation.
fn curl(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let dx = vec3<f32>(e, 0.0, 0.0);
  let dy = vec3<f32>(0.0, e, 0.0);
  let dz = vec3<f32>(0.0, 0.0, e);
  // Three independent noise fields (offset by large constants to
  // decorrelate them) define a vector potential A; curl(A) is the
  // divergence-free velocity field.
  let a_x = vec2<f32>(
    noise3(p + dy + vec3<f32>(0.0, 0.0, 11.0)),
    noise3(p - dy + vec3<f32>(0.0, 0.0, 11.0)),
  );
  let a_y = vec2<f32>(
    noise3(p + dz + vec3<f32>(31.0, 0.0, 0.0)),
    noise3(p - dz + vec3<f32>(31.0, 0.0, 0.0)),
  );
  let a_z = vec2<f32>(
    noise3(p + dx + vec3<f32>(0.0, 47.0, 0.0)),
    noise3(p - dx + vec3<f32>(0.0, 47.0, 0.0)),
  );
  let b_x = vec2<f32>(
    noise3(p + dz + vec3<f32>(0.0, 0.0, 11.0)),
    noise3(p - dz + vec3<f32>(0.0, 0.0, 11.0)),
  );
  let b_y = vec2<f32>(
    noise3(p + dx + vec3<f32>(31.0, 0.0, 0.0)),
    noise3(p - dx + vec3<f32>(31.0, 0.0, 0.0)),
  );
  let b_z = vec2<f32>(
    noise3(p + dy + vec3<f32>(0.0, 47.0, 0.0)),
    noise3(p - dy + vec3<f32>(0.0, 47.0, 0.0)),
  );
  let cx = (a_x.x - a_x.y) - (b_x.x - b_x.y);
  let cy = (a_y.x - a_y.y) - (b_y.x - b_y.y);
  let cz = (a_z.x - a_z.y) - (b_z.x - b_z.y);
  return vec3<f32>(cx, cy, cz) / (2.0 * e);
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.particleCount) { return; }
  var p = particles[i];

  // Curl-noise velocity in the slab-local frame. Scale the sample
  // position so flowScale knob is intuitive — flowScale=1 gives ~one
  // swirl across the slab; higher = tighter swirls.
  let samplePos = vec3<f32>(p.pos.x, p.pos.y, p.pos.z) * u.flowScale + vec3<f32>(0.0, 0.0, u.time * 0.1);
  let flow = curl(samplePos) * u.flowStrength;

  // Anchor pull — keeps the image legible by yanking particles
  // toward their UV-anchor home position. Without this the image
  // dissolves into chaos within a second.
  let homeXY = vec3<f32>(p.anchor.x, p.anchor.y, p.depthAnchor * u.depthStrength);
  let pull = (homeXY - p.pos) * u.anchorPull;

  // Critically-damped-ish blend toward the target velocity. dt-scaled
  // so the visual is frame-rate independent.
  let targetVel = flow + pull;
  p.vel = mix(p.vel, targetVel, clamp(u.dt * 6.0, 0.0, 1.0));

  // Integrate position.
  p.pos = p.pos + p.vel * u.dt;

  // Keep particles inside the slab Z range — the slab itself wraps
  // in the vertex shader, but per-particle Z still needs to live in
  // ~[-tunnelDepth/2, +tunnelDepth/2] or strokes will pierce slab
  // boundaries and read as glitches.
  let halfDepth = u.tunnelDepth * 0.5;
  if (p.pos.z >  halfDepth) { p.pos.z = -halfDepth; }
  if (p.pos.z < -halfDepth) { p.pos.z =  halfDepth; }

  particles[i] = p;
}
`,$c=`
struct Particle {
  pos:         vec3<f32>,
  alpha:       f32,
  vel:         vec3<f32>,
  depthAnchor: f32,
  anchor:      vec2<f32>,
  _pad:        vec2<f32>,
};

struct U {
  viewProj:        mat4x4<f32>,
  // camera-space basis for billboarding the point-topology quads
  camRight:        vec3<f32>,
  _pad0:           f32,
  camUp:           vec3<f32>,
  _pad1:           f32,
  // sizing / topology
  baseSize:        f32,        // point size in world units
  strokeLength:    f32,        // stroke length in world units
  strokeWidth:     f32,        // stroke width in world units
  topology:        u32,        // 0 = points, 1 = strokes
  // slab replication
  slabCount:       u32,
  tunnelDepth:     f32,
  flyDistance:     f32,
  particleCount:   u32,
  // depth source params (handled in fs via the sourceTexture sample)
  opacity:         f32,
  fadeNearAlpha:   f32,        // alpha at the camera-nearest slab boundary
  fadeFarAlpha:    f32,        // alpha at the farthest slab boundary
  _pad2:           f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> u: U;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv:        vec2<f32>,   // (corner-uv): for strokes, x=along, y=across; for points, classic 0..1
  @location(1) anchor:    vec2<f32>,   // texture-sample UV for color
  @location(2) alpha:     f32,
};

// Wrap the per-slab Z offset so that the K slabs continuously cycle
// past the camera as flyDistance accumulates. Slab 0 is the nearest
// to the camera by default; over time each slab slides toward the
// camera and wraps to the far end when it passes Z = -tunnelDepth/2.
fn slabZ(slabIndex: u32) -> f32 {
  let total = f32(u.slabCount) * u.tunnelDepth;
  let raw   = f32(slabIndex) * u.tunnelDepth - u.flyDistance;
  // floor-mod so negative inputs land in [0, total)
  let m     = raw - floor(raw / total) * total;
  return m - u.tunnelDepth * 0.5;
}

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  // iid encodes (slabIndex, particleIndex) packed as:
  //   particleIndex = iid % particleCount
  //   slabIndex     = iid / particleCount
  let pIdx = iid % u.particleCount;
  let sIdx = iid / u.particleCount;
  let p    = particles[pIdx];

  // Anchor color sample: use UV derived from anchor.xy (already in
  // [-1..1]; remap to [0..1] for texture sampling).
  let anchorUV = vec2<f32>(p.anchor.x * 0.5 + 0.5, 1.0 - (p.anchor.y * 0.5 + 0.5));

  // Slab-local position + slab Z offset = world position.
  let worldPos = vec3<f32>(p.pos.x, p.pos.y, p.pos.z + slabZ(sIdx));

  // Per-vertex corner offset depends on topology.
  var cornerUV: vec2<f32> = vec2<f32>(0.0, 0.0);
  var offset:   vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);

  if (u.topology == 1u) {
    // STROKE TOPOLOGY — quad extruded along velocity vector.
    //   vid 0..5: two triangles forming a quad
    //   x ∈ {0, 1} = along velocity (head, tail)
    //   y ∈ {-1, +1} = perpendicular to velocity
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(0.0,  1.0),
      vec2<f32>(0.0,  1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0,  1.0),
    );
    let q = xy[vid];
    cornerUV = vec2<f32>(q.x, q.y * 0.5 + 0.5);

    // Stroke direction is the CAMERA'S BACKWARD axis (uniformly,
    // not per-particle velocity). Reasoning: flythrough particles
    // are nearly stationary (anchor pull dominates the curl-noise
    // velocity), so velocity-aligned strokes pointed in random
    // directions for every particle. Visually that produced a
    // radial "starburst" pattern emanating from the center
    // vanishing point — with a black vertical wedge in the middle
    // where no stroke endpoints happened to land. By making every
    // stroke trail backward along the camera's flight axis we get
    // proper uniform "motion lines" that read as the camera flying
    // forward through the tunnel — and no center-column gap.
    //
    // dir = (0, 0, -1) so that -dir * q.x * strokeLength extends
    // the stroke into +Z (away from camera, deeper into the
    // tunnel). perp = (1, 0, 0) gives the stroke width along
    // screen-X.
    let dir = vec3<f32>(0.0, 0.0, -1.0);
    let perp = vec3<f32>(1.0, 0.0, 0.0);

    // Stroke tail trails AWAY from the camera (head at the
    // particle's anchor position, tail extending deeper into Z).
    offset = -dir * (q.x * u.strokeLength) + perp * (q.y * u.strokeWidth * 0.5);
  } else {
    // POINT TOPOLOGY — billboard quad facing the camera.
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
      vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
    );
    let q = xy[vid];
    cornerUV = vec2<f32>(q.x * 0.5 + 0.5, q.y * 0.5 + 0.5);
    offset = u.camRight * (q.x * u.baseSize) + u.camUp * (q.y * u.baseSize);
  }

  let finalWorld = worldPos + offset;

  // Depth-based fade so slabs fade in as they emerge from the far
  // end of the tunnel + fade out as they leave the near end. This
  // softens the wrap discontinuity — without it you can SEE slabs pop.
  let z = worldPos.z;
  let total = f32(u.slabCount) * u.tunnelDepth;
  let t = clamp((z + u.tunnelDepth * 0.5) / total, 0.0, 1.0);
  let edgeFade = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.85, 1.0, t));
  let depthAlpha = mix(u.fadeNearAlpha, u.fadeFarAlpha, t) * edgeFade;

  var out: VSOut;
  out.pos    = u.viewProj * vec4<f32>(finalWorld, 1.0);
  out.uv     = cornerUV;
  out.anchor = anchorUV;
  out.alpha  = p.alpha * depthAlpha * u.opacity;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Sample source color at the anchor's UV.
  let srcColor = textureSample(sourceTexture, sourceSampler, in.anchor);

  // Falloff shape:
  //   Points  — radial disc with soft edge
  //   Strokes — taper along x (head→tail) for streak look
  var mask: f32 = 1.0;
  if (u.topology == 1u) {
    // Stroke: alpha tapers from 1 at head (uv.x=0) to 0 at tail (uv.x=1)
    // with a soft pinch at the perpendicular edges (uv.y).
    let headTail = 1.0 - in.uv.x;
    let perp = 1.0 - abs(in.uv.y - 0.5) * 2.0;
    mask = headTail * smoothstep(0.0, 0.4, perp);
  } else {
    // Point: radial soft disc
    let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0;
    mask = smoothstep(1.0, 0.2, d);
  }
  let a = srcColor.a * in.alpha * mask;
  // Additive-friendly premultiplied alpha. The host pipeline picks
  // the blend mode via the layer setting; we just produce premul-RGBA.
  return vec4<f32>(srcColor.rgb * a, a);
}
`,Zc={topology:"strokes",depthSource:"luminance",flySpeed:.8,tunnelDepth:2,slabCount:4,flowStrength:.4,flowScale:2,anchorPull:1.2,strokeLength:.08,strokeWidth:.006,depthStrength:.5,baseSize:.005,opacity:1,fovDeg:50,cameraYaw:0,cameraPitch:0,particleCount:Ns},Kc={color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}};class Jc{device;presentFormat;particleBuffer=null;computeUniformBuffer=null;renderUniformBuffer=null;sourceTexture=null;sourceTextureView=null;sourceSampler=null;computePipeline=null;renderPipelinePoints=null;renderPipelineStrokes=null;computeBindGroup=null;renderBindGroup=null;params={...Zc};flyDistance=0;prevFrameTime=0;viewportW=1920;viewportH=1080;blendMode="add";sourceW=1;sourceH=1;particleCount=Ns;constructor(e,t){this.device=e,this.presentFormat=t,this.init()}init(){this.particleCount=Math.min(this.params.particleCount,qc),this.particleBuffer=this.device.createBuffer({size:this.particleCount*ko,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const e=new Float32Array(this.particleCount*(ko/4));for(let l=0;l<this.particleCount;l++){const u=(l+.5)/this.particleCount;let f=l;f=f>>1&1431655765|(f&1431655765)<<1,f=f>>2&858993459|(f&858993459)<<2,f=f>>4&252645135|(f&252645135)<<4,f=f>>8&16711935|(f&16711935)<<8,f=f>>16>>>0|f<<16>>>0;const d=(f>>>0)/4294967296,h=u*2-1,m=d*2-1,b=l*(ko/4);e[b+0]=h,e[b+1]=m,e[b+2]=0,e[b+3]=1,e[b+4]=0,e[b+5]=0,e[b+6]=0,e[b+7]=Math.sin(h*7.3+m*11.1)*.5+.5,e[b+8]=h,e[b+9]=m,e[b+10]=0,e[b+11]=0}this.device.queue.writeBuffer(this.particleBuffer,0,e),this.computeUniformBuffer=this.device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.renderUniformBuffer=this.device.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.sourceTexture=this.device.createTexture({size:[1,1,1],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),this.sourceTextureView=this.sourceTexture.createView(),this.sourceSampler=this.device.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"});const t=this.device.createShaderModule({code:Xc}),a=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]});this.computePipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[a]}),compute:{module:t,entryPoint:"cs_main"}}),this.computeBindGroup=this.device.createBindGroup({layout:a,entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.computeUniformBuffer}}]});const o=this.device.createShaderModule({code:$c}),r=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}]}),s=this.device.createPipelineLayout({bindGroupLayouts:[r]}),n=()=>this.device.createRenderPipeline({layout:s,vertex:{module:o,entryPoint:"vs_main"},fragment:{module:o,entryPoint:"fs_main",targets:[{format:this.presentFormat,blend:Kc}]},primitive:{topology:"triangle-list"}});this.renderPipelinePoints=n(),this.renderPipelineStrokes=this.renderPipelinePoints,this.renderBindGroup=this.device.createBindGroup({layout:r,entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.renderUniformBuffer}},{binding:2,resource:this.sourceTextureView},{binding:3,resource:this.sourceSampler}]})}resizeSourceTexture(e,t){if(this.sourceW===e&&this.sourceH===t&&this.sourceTexture)return;try{this.sourceTexture?.destroy?.()}catch{}this.sourceTexture=this.device.createTexture({size:[e,t,1],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),this.sourceTextureView=this.sourceTexture.createView(),this.sourceW=e,this.sourceH=t;const a=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{type:"filtering"}}]});this.renderBindGroup=this.device.createBindGroup({layout:a,entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.renderUniformBuffer}},{binding:2,resource:this.sourceTextureView},{binding:3,resource:this.sourceSampler}]})}async setSourceImage(e){const t=e.naturalWidth??e.width??1,a=e.naturalHeight??e.height??1;this.resizeSourceTexture(t,a);let o=null,r=e;if(e instanceof HTMLImageElement)try{o=await createImageBitmap(e,{premultiplyAlpha:"premultiply"}),r=o}catch{}try{this.device.queue.copyExternalImageToTexture({source:r,flipY:!1},{texture:this.sourceTexture,premultipliedAlpha:!0},{width:t,height:a,depthOrArrayLayers:1})}finally{if(o)try{o.close()}catch{}}}updateSourceFromCanvas(e){const t=e.width|0,a=e.height|0;if(!(t===0||a===0)){this.resizeSourceTexture(t,a);try{this.device.queue.copyExternalImageToTexture({source:e,flipY:!1},{texture:this.sourceTexture,premultipliedAlpha:!0},{width:t,height:a,depthOrArrayLayers:1})}catch{}}}updateSourceFromBytes(e,t,a){if(!(t===0||a===0)){this.resizeSourceTexture(t,a);try{this.device.queue.writeTexture({texture:this.sourceTexture},e,{bytesPerRow:t*4,rowsPerImage:a},{width:t,height:a,depthOrArrayLayers:1})}catch{}}}updateSourceFromVideo(e){if(e.readyState<2)return;const t=e.videoWidth|0,a=e.videoHeight|0;if(!(t===0||a===0)){this.resizeSourceTexture(t,a);try{this.device.queue.copyExternalImageToTexture({source:e,flipY:!1},{texture:this.sourceTexture,premultipliedAlpha:!0},{width:t,height:a,depthOrArrayLayers:1})}catch{}}}setParams(e){this.params={...this.params,...e}}setViewport(e,t){this.viewportW=e,this.viewportH=t}setBlendMode(e){this.blendMode=e}setFlyDistance(e){this.flyDistance=e}encodeFrame(e,t){if(!this.computePipeline||!this.renderPipelinePoints)return;const a=performance.now()/1e3;let o=this.prevFrameTime===0?1/60:a-this.prevFrameTime;o=Math.min(Math.max(o,.001),1/15),this.prevFrameTime=a,this.flyDistance+=this.params.flySpeed*o;const r=new Float32Array(16);r[0]=o,r[1]=a,r[2]=this.params.flowStrength,r[3]=this.params.flowScale,r[4]=this.params.anchorPull,r[5]=this.params.tunnelDepth,r[6]=this.params.depthStrength,new Uint32Array(r.buffer,r.byteOffset)[7]=this.particleCount>>>0,r[8]=this.flyDistance,this.device.queue.writeBuffer(this.computeUniformBuffer,0,r);{const te=e.beginComputePass();te.setPipeline(this.computePipeline),te.setBindGroup(0,this.computeBindGroup);const Q=Math.ceil(this.particleCount/64);te.dispatchWorkgroups(Q),te.end()}const s=this.viewportW/Math.max(1,this.viewportH),n=Hc(this.params.fovDeg,s,.05,100),l=(this.params.cameraYaw??0)*Math.PI/180,u=(this.params.cameraPitch??0)*Math.PI/180,f=Math.cos(l),d=Math.sin(l),h=Math.cos(u),m=Math.sin(u),b=new Float32Array([f,0,d,0,0,1,0,0,-d,0,f,0,0,0,0,1]),M=new Float32Array([1,0,0,0,0,h,-m,0,0,m,h,0,0,0,0,1]),C=To(b,M),T=To(C,jc(0,0,-.1)),I=To(n,T),W=[C[0],C[1],C[2]],G=[C[4],C[5],C[6]],O=new ArrayBuffer(256),L=new Float32Array(O),N=new Uint32Array(O);L.set(I,0),L[16]=W[0],L[17]=W[1],L[18]=W[2],L[19]=0,L[20]=G[0],L[21]=G[1],L[22]=G[2],L[23]=0,L[24]=this.params.baseSize,L[25]=this.params.strokeLength,L[26]=this.params.strokeWidth,N[27]=this.params.topology==="strokes"?1:0,N[28]=Math.max(1,Math.min(8,this.params.slabCount|0)),L[29]=this.params.tunnelDepth,L[30]=this.flyDistance,N[31]=this.particleCount>>>0,L[32]=this.params.opacity,L[33]=1,L[34]=1,L[35]=0,this.device.queue.writeBuffer(this.renderUniformBuffer,0,O);const ae=Math.max(1,Math.min(8,this.params.slabCount|0))*this.particleCount,se=e.beginRenderPass({colorAttachments:[{view:t,loadOp:"load",storeOp:"store"}]});se.setPipeline(this.renderPipelinePoints),se.setBindGroup(0,this.renderBindGroup),se.draw(6,ae,0,0),se.end()}dispose(){try{this.particleBuffer?.destroy?.()}catch{}try{this.computeUniformBuffer?.destroy?.()}catch{}try{this.renderUniformBuffer?.destroy?.()}catch{}try{this.sourceTexture?.destroy?.()}catch{}this.particleBuffer=null,this.computeUniformBuffer=null,this.renderUniformBuffer=null,this.sourceTexture=null,this.sourceTextureView=null,this.computePipeline=null,this.renderPipelinePoints=null,this.renderPipelineStrokes=null}}const qs=[{kind:"media-source",key:"source",label:"Source",group:"Source"},{kind:"select",key:"topology",label:"Topology",group:"Topology",options:[{value:"strokes",label:"Worm Strokes"},{value:"points",label:"Points"}],default:"strokes"},{kind:"slider",key:"strokeLength",label:"Stroke Length",group:"Topology",min:.01,max:.4,step:.005,default:.08,showWhen:{topology:"strokes"}},{kind:"slider",key:"strokeWidth",label:"Stroke Width",group:"Topology",min:.001,max:.05,step:5e-4,default:.006,showWhen:{topology:"strokes"}},{kind:"slider",key:"flySpeed",label:"Fly Speed",group:"Camera Motion",min:-2,max:6,step:.05,default:.8},{kind:"slider",key:"tunnelDepth",label:"Tunnel Depth",group:"Camera Motion",min:.5,max:6,step:.05,default:2},{kind:"slider",key:"slabCount",label:"Slab Count",group:"Camera Motion",min:2,max:8,step:1,default:4},{kind:"slider",key:"flowStrength",label:"Flow Strength",group:"Flow & Anchor",min:0,max:2,step:.01,default:.4},{kind:"slider",key:"flowScale",label:"Flow Scale",group:"Flow & Anchor",min:.5,max:8,step:.05,default:2},{kind:"slider",key:"anchorPull",label:"Anchor Pull",group:"Flow & Anchor",min:0,max:3,step:.01,default:1.2},{kind:"slider",key:"depthStrength",label:"Depth Strength",group:"Flow & Anchor",min:0,max:1.5,step:.01,default:.5},{kind:"select",key:"depthSource",label:"Depth Source",group:"Depth Source",options:[{value:"luminance",label:"Luma"},{value:"inverse-luminance",label:"Inverse Luma"},{value:"edge-density",label:"Edges"}],default:"luminance"},{kind:"slider",key:"particleCount",label:"Count",group:"Particles",min:1e4,max:1e6,step:1e4,default:25e4},{kind:"slider",key:"baseSize",label:"Point Size",group:"Particles",min:.001,max:.02,step:5e-4,default:.005,showWhen:{topology:"points"}},{kind:"slider",key:"opacity",label:"Opacity",group:"Particles",min:0,max:1,step:.01,default:1},{kind:"slider",key:"fovDeg",label:"FOV",group:"Camera Framing",min:20,max:100,step:1,default:50},{kind:"angle",key:"cameraYaw",label:"Yaw",group:"Camera Framing",default:0},{kind:"angle",key:"cameraPitch",label:"Pitch",group:"Camera Framing",default:0},{kind:"toggle",key:"audioReactive",label:"Audio Reactive",group:"Audio",default:!1}],Wo=ua(qs);class Qc{inner;bands=null;lastParams={...Wo};constructor(e,t){this.inner=new Jc(e,t)}setBands(e,t,a){this.bands={bass:e,mid:t,treble:a},this.applyParamsToInner()}setParams(e){this.lastParams={...Wo,...e},this.applyParamsToInner()}applyParamsToInner(){const e=this.lastParams,t=e.flySpeed??.8,a=e.flowStrength??.4,o=!!e.audioReactive&&this.bands,r=o?t*(1+this.bands.bass*1.8):t,s=o?a*(1+this.bands.treble*1.5):a;this.inner.setParams({topology:e.topology??"strokes",depthSource:e.depthSource??"luminance",flySpeed:r,tunnelDepth:e.tunnelDepth??2,slabCount:Math.max(2,Math.min(8,Math.round(e.slabCount??4))),flowStrength:s,flowScale:e.flowScale??2,anchorPull:e.anchorPull??1.2,strokeLength:e.strokeLength??.08,strokeWidth:e.strokeWidth??.006,depthStrength:e.depthStrength??.5,baseSize:e.baseSize??.005,opacity:e.opacity??1,fovDeg:e.fovDeg??50,cameraYaw:e.cameraYaw??0,cameraPitch:e.cameraPitch??0,particleCount:Math.round(e.particleCount??25e4)}),this.inner.setBlendMode("normal")}setSource(e){e instanceof HTMLVideoElement?this.inner.updateSourceFromVideo(e):e instanceof HTMLCanvasElement?this.inner.updateSourceFromCanvas(e):this.inner.setSourceImage(e)}setSourceFromBytes(e,t,a){this.inner.updateSourceFromBytes(e,t,a)}encodeFrame(e,t,a,o,r,s){this.inner.setViewport(o,r),e.beginRenderPass({colorAttachments:[{view:t,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]}).end(),this.inner.encodeFrame(e,t)}resize(e,t){}dispose(){try{this.inner.dispose?.()}catch{}}}const cs=32,us=48,eu=4e6,tu=.006;function Ri(i,e){const t=new Float32Array(16);for(let a=0;a<4;a++)for(let o=0;o<4;o++){let r=0;for(let s=0;s<4;s++)r+=i[s*4+o]*e[a*4+s];t[a*4+o]=r}return t}function au(){const i=new Float32Array(16);return i[0]=i[5]=i[10]=i[15]=1,i}function iu(i,e,t,a){const o=1/Math.tan(i*Math.PI/180/2),r=new Float32Array(16);return r[0]=o/e,r[5]=o,r[10]=a/(t-a),r[11]=-1,r[14]=t*a/(t-a),r}function ou(i,e,t){const a=au();return a[12]=i,a[13]=e,a[14]=t,a}const ru=`
struct Home {
  homePos:   vec3<f32>,
  _pad0:     f32,
  homeColor: vec3<f32>,
  _pad1:     f32,
};

struct Live {
  pos:   vec3<f32>,
  alpha: f32,
  vel:   vec3<f32>,
  size:  f32,
  color: vec3<f32>,
  _pad:  f32,
};

// Compute-pass uniform. Layout intentionally packed in 16-byte
// blocks so the JS-side writeBuffer math is one float[] write rather
// than a dance of typed-array views. See encodeFrame() for the
// matching CPU-side offsets.
struct U {
  // Block 0 — core timing + size (16 bytes)
  dt:                f32,
  time:              f32,
  pointCount:        u32,
  baseSize:          f32,
  // Block 1 — motion (curl wind + anchor pull + damping)
  windStrength:      f32,
  windScale:         f32,
  anchorPull:        f32,
  damping:           f32,
  // Block 2 — audio
  bass:              f32,
  treble:            f32,
  burstImpulse:      f32,
  shimmerStrength:   f32,
  // Block 3 — proximity wave center + radius
  waveCenter:        vec3<f32>,
  waveRadius:        f32,
  // Block 4 — wave + twist + voxel mix
  waveStrength:      f32,
  waveFalloff:       f32,
  twistAmount:       f32,    // height-based Y-axis torsion (radians per unit Y)
  voxelSize:         f32,    // grid cell size for voxel snapping
  // Block 5 — voxel + dissolve + hue
  voxelMix:          f32,    // 0 = no snap, 1 = full snap
  dissolveRadius:    f32,
  dissolveSoftness:  f32,
  hueShift:          f32,
  // Block 6 — color basics
  saturation:        f32,
  brightness:        f32,
  colorMode:         u32,    // 0=source 1=solid 2=grad2 3=grad3 4=palette4 5=rainbow 6=random
  colorMap:          u32,    // 0=index 1=depth-z 2=depth-cam 3=radial 4=y-axis 5=luminance 6=noise
  // Block 7 — color mix + map shaping
  colorMix:          f32,    // 0 = source color, 1 = pure custom
  colorMapScale:     f32,    // expand/compress the mapping range
  colorMapOffset:    f32,    // shift the mapping
  colorCycleOffset:  f32,    // animated phase for rainbow / palette cycling
  // Block 8 — random-hue params
  randomSat:         f32,
  randomVal:         f32,
  _pad0:             f32,
  _pad1:             f32,
  // Blocks 9-12 — palette colors (vec3 + 4 bytes pad each)
  colorA:            vec3<f32>,
  _padA:             f32,
  colorB:            vec3<f32>,
  _padB:             f32,
  colorC:            vec3<f32>,
  _padC:             f32,
  colorD:            vec3<f32>,
  _padD:             f32,
};

@group(0) @binding(0) var<storage, read>       home: array<Home>;
@group(0) @binding(1) var<storage, read_write> live: array<Live>;
@group(0) @binding(2) var<uniform>             u:    U;

fn hash3(p: vec3<f32>) -> f32 {
  let q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7,  74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6)),
  );
  return fract(sin(q.x + q.y + q.z) * 43758.5453);
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, s.x);
  let nx10 = mix(n010, n110, s.x);
  let nx01 = mix(n001, n101, s.x);
  let nx11 = mix(n011, n111, s.x);
  let nxy0 = mix(nx00, nx10, s.y);
  let nxy1 = mix(nx01, nx11, s.y);
  return mix(nxy0, nxy1, s.z) * 2.0 - 1.0;
}

// Divergence-free flow via curl of a vector noise potential. Same
// pattern as the flythrough shader — gives smooth swirly motion that
// reads as wind through the cloud rather than chaotic noise.
fn curl(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let ax1 = noise3(p + vec3<f32>(0.0,  e, 0.0) + vec3<f32>(0.0, 0.0, 11.0));
  let ax2 = noise3(p + vec3<f32>(0.0, -e, 0.0) + vec3<f32>(0.0, 0.0, 11.0));
  let ay1 = noise3(p + vec3<f32>(0.0, 0.0,  e) + vec3<f32>(31.0, 0.0, 0.0));
  let ay2 = noise3(p + vec3<f32>(0.0, 0.0, -e) + vec3<f32>(31.0, 0.0, 0.0));
  let az1 = noise3(p + vec3<f32>( e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let az2 = noise3(p + vec3<f32>(-e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let bx1 = noise3(p + vec3<f32>(0.0, 0.0,  e) + vec3<f32>(0.0, 0.0, 11.0));
  let bx2 = noise3(p + vec3<f32>(0.0, 0.0, -e) + vec3<f32>(0.0, 0.0, 11.0));
  let by1 = noise3(p + vec3<f32>( e, 0.0, 0.0) + vec3<f32>(31.0, 0.0, 0.0));
  let by2 = noise3(p + vec3<f32>(-e, 0.0, 0.0) + vec3<f32>(31.0, 0.0, 0.0));
  let bz1 = noise3(p + vec3<f32>(0.0,  e, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let bz2 = noise3(p + vec3<f32>(0.0, -e, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let cx = (ax1 - ax2) - (bx1 - bx2);
  let cy = (ay1 - ay2) - (by1 - by2);
  let cz = (az1 - az2) - (bz1 - bz2);
  return vec3<f32>(cx, cy, cz) / (2.0 * e);
}

// HSV ↔ RGB helpers for the hue-shift / saturation pass.
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  var p: vec4<f32>;
  if (c.g < c.b) {
    p = vec4<f32>(c.b, c.g, K.w, K.z);
  } else {
    p = vec4<f32>(c.g, c.b, K.x, K.y);
  }
  var q: vec4<f32>;
  if (c.r < p.x) {
    q = vec4<f32>(p.x, p.y, p.w, c.r);
  } else {
    q = vec4<f32>(c.r, p.y, p.z, p.x);
  }
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

// ── Color helpers ────────────────────────────────────────────────
// 't' is the mapping value 0..1 from the chosen colorMap. Picking
// a color from each mode is a single switch on u.colorMode.
// (Note: backticks intentionally avoided here — this WGSL string is
// a JS template literal and any backtick would terminate it early.)
fn paletteColor(t: f32, i: u32) -> vec3<f32> {
  // Mode 1 — solid
  if (u.colorMode == 1u) { return u.colorA; }
  // Mode 2 — 2-stop gradient
  if (u.colorMode == 2u) { return mix(u.colorA, u.colorB, t); }
  // Mode 3 — 3-stop gradient
  if (u.colorMode == 3u) {
    if (t < 0.5) { return mix(u.colorA, u.colorB, t * 2.0); }
    return mix(u.colorB, u.colorC, (t - 0.5) * 2.0);
  }
  // Mode 4 — 4-color palette, smooth blend across the range
  if (u.colorMode == 4u) {
    let s = t * 3.0;
    if (s < 1.0) { return mix(u.colorA, u.colorB, s); }
    if (s < 2.0) { return mix(u.colorB, u.colorC, s - 1.0); }
    return mix(u.colorC, u.colorD, s - 2.0);
  }
  // Mode 5 — rainbow cycle; colorCycleOffset animates the phase
  if (u.colorMode == 5u) {
    let phase = fract(t + u.colorCycleOffset);
    return hsv2rgb(vec3<f32>(phase, 1.0, 1.0));
  }
  // Mode 6 — random per-particle hue; deterministic so a given
  // particle keeps the same color across frames (stable look)
  if (u.colorMode == 6u) {
    let hue = hash3(vec3<f32>(f32(i) * 0.317, 13.0, 91.0));
    return hsv2rgb(vec3<f32>(fract(hue + u.colorCycleOffset), u.randomSat, u.randomVal));
  }
  // Mode 0 — source (return zero; caller falls back to homeColor)
  return vec3<f32>(0.0);
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.pointCount) { return; }
  let h = home[i];
  var l = live[i];

  // ── Effective home position (twist + voxel snap) ───────────────
  // Both effects modify the "home" target the anchor pull reaches
  // for, rather than directly displacing the live position. Lets
  // the particle motion (wind, burst, shimmer) continue to work on
  // top of a deformed cloud rather than fighting it.
  var effHome = h.homePos;
  // Twist — rotate XZ around Y by an angle proportional to Y. Gives
  // a candy-twist look; pair with auto-rotate Y for hypnotic spirals.
  let twistAngle = u.twistAmount * h.homePos.y;
  let cT = cos(twistAngle);
  let sT = sin(twistAngle);
  effHome = vec3<f32>(
    h.homePos.x * cT - h.homePos.z * sT,
    h.homePos.y,
    h.homePos.x * sT + h.homePos.z * cT,
  );
  // Voxel snap — quantize home to a 3D grid. voxelMix=0 disables;
  // voxelMix=1 fully snaps. Mix linearly so users can crossfade.
  if (u.voxelMix > 0.0 && u.voxelSize > 0.0001) {
    let snapped = round(effHome / u.voxelSize) * u.voxelSize;
    effHome = mix(effHome, snapped, u.voxelMix);
  }

  // ── Position update ────────────────────────────────────────────
  // Velocity = curl wind + bass burst + proximity wave + treble shimmer,
  // damped each frame so things settle when the audio drops.
  let pSample = effHome * u.windScale + vec3<f32>(0.0, 0.0, u.time * 0.1);
  let windV   = curl(pSample) * u.windStrength;

  // Bass burst — radial outward impulse from the cloud center.
  let outward = normalize(effHome + vec3<f32>(1e-5, 0.0, 0.0));
  let burstV  = outward * u.burstImpulse;

  // Proximity wave — a moving sphere pushes points radially outward
  // from its center, with a smooth falloff at its surface.
  let toPoint = l.pos - u.waveCenter;
  let d       = length(toPoint);
  let r       = u.waveRadius;
  let shellW  = max(u.waveFalloff, 1e-3);
  let bandT   = clamp(1.0 - abs(d - r) / shellW, 0.0, 1.0);
  let waveV   = select(vec3<f32>(0.0), normalize(toPoint) * u.waveStrength * bandT, d > 1e-4);

  // Treble shimmer — small random per-point jitter scaled by treble.
  let jitterMag = u.shimmerStrength * u.treble;
  let jx = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 0.0)) - 0.5) * 2.0;
  let jy = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 1.0)) - 0.5) * 2.0;
  let jz = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 2.0)) - 0.5) * 2.0;
  let shimmerV = vec3<f32>(jx, jy, jz) * jitterMag;

  // Anchor pull — yank toward the EFFECTIVE home (twisted + voxeled).
  let pullV = (effHome - l.pos) * u.anchorPull;

  // Integrate.
  let targetVel = windV + burstV + waveV + shimmerV + pullV;
  l.vel = mix(l.vel, targetVel, clamp(u.dt * 6.0, 0.0, 1.0));
  l.pos = l.pos + l.vel * u.dt;
  l.vel = l.vel * (1.0 - u.damping * u.dt);

  // ── Color update ───────────────────────────────────────────────
  // 1. Compute the mapping value 't' in [0,1] based on the chosen map.
  //    The map drives where each particle samples from the palette /
  //    gradient. Different maps give different aesthetics:
  //      index    — multi-color worms (particle id → palette position)
  //      depth-z  — classic depth gradient (back/front color)
  //      radial   — bullseye coloring from cloud center
  //      y-axis   — vertical gradient (sunset/sky)
  //      luminance— preserves source contrast as the palette key
  //      noise    — organic patches of color
  var t: f32 = 0.0;
  if (u.colorMap == 0u) {
    t = f32(i) / max(f32(u.pointCount), 1.0);
  } else if (u.colorMap == 1u) {
    t = effHome.z * 0.5 + 0.5;
  } else if (u.colorMap == 2u) {
    // depth-from-camera — we don't have view-space here without an
    // extra uniform, so approximate with negative Z (matches our
    // camera-looking-down-+Z convention).
    t = -effHome.z * 0.5 + 0.5;
  } else if (u.colorMap == 3u) {
    t = clamp(length(effHome), 0.0, 1.0);
  } else if (u.colorMap == 4u) {
    t = effHome.y * 0.5 + 0.5;
  } else if (u.colorMap == 5u) {
    t = dot(h.homeColor, vec3<f32>(0.299, 0.587, 0.114));
  } else if (u.colorMap == 6u) {
    t = noise3(effHome * 3.0 + vec3<f32>(0.0, 0.0, u.time * 0.2)) * 0.5 + 0.5;
  }
  // Reshape — scale + offset, then clamp.
  t = clamp(t * u.colorMapScale + u.colorMapOffset, 0.0, 1.0);

  // 2. Get the mode color (or source if mode 0). Blend with source by
  //    colorMix — useful for tinting source colors without losing them.
  var paletteC = paletteColor(t, i);
  if (u.colorMode == 0u) { paletteC = h.homeColor; }
  var c = mix(h.homeColor, paletteC, u.colorMix);

  // 3. Apply global HSV adjustments on top (hue shift, sat, bright).
  var hsv = rgb2hsv(c);
  hsv.x = fract(hsv.x + u.hueShift);
  hsv.y = clamp(hsv.y * u.saturation, 0.0, 2.0);
  hsv.z = clamp(hsv.z * u.brightness, 0.0, 4.0);
  l.color = hsv2rgb(hsv);

  // ── Size pulse ─────────────────────────────────────────────────
  let sizeBoost = 1.0 + u.bass * 1.2;
  l.size = u.baseSize * sizeBoost;

  // ── Dissolve ───────────────────────────────────────────────────
  let distFromCenter = length(h.homePos);
  let softness = max(u.dissolveSoftness, 1e-4);
  let dissolveAlpha = 1.0 - smoothstep(u.dissolveRadius, u.dissolveRadius + softness, distFromCenter);
  l.alpha = clamp(dissolveAlpha, 0.0, 1.0);

  live[i] = l;
}
`,su=`
struct Live {
  pos:   vec3<f32>,
  alpha: f32,
  vel:   vec3<f32>,
  size:  f32,
  color: vec3<f32>,
  _pad:  f32,
};

struct U {
  viewProj:     mat4x4<f32>,
  camRight:     vec3<f32>,
  _pad0:        f32,
  camUp:        vec3<f32>,
  _pad1:        f32,
  topology:     u32,        // 0=points, 1=billboards, 2=strokes
  strokeLength: f32,
  strokeWidth:  f32,
  opacity:      f32,
  pointCount:   u32,
  _pad2:        f32,
  _pad3:        f32,
  _pad4:        f32,
};

@group(0) @binding(0) var<storage, read> live: array<Live>;
@group(0) @binding(1) var<uniform>       u:    U;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv:        vec2<f32>,
  @location(1) color:     vec3<f32>,
  @location(2) alpha:     f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let p = live[iid];

  var cornerUV: vec2<f32> = vec2<f32>(0.0, 0.0);
  var offset:   vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);

  if (u.topology == 2u) {
    // STROKES — quad extruded along velocity vector.
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(0.0,  1.0),
      vec2<f32>(0.0,  1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0,  1.0),
    );
    let q = xy[vid];
    cornerUV = vec2<f32>(q.x, q.y * 0.5 + 0.5);

    let speed = length(p.vel);
    let dir = select(vec3<f32>(1.0, 0.0, 0.0), p.vel / max(speed, 1e-4), speed > 1e-4);
    let camFwd = normalize(cross(u.camRight, u.camUp));
    var perp = normalize(cross(dir, camFwd));
    if (length(perp) < 1e-3) {
      perp = normalize(cross(dir, u.camUp));
    }
    offset = -dir * (q.x * u.strokeLength) + perp * (q.y * u.strokeWidth * 0.5);
  } else {
    // POINTS / BILLBOARDS — quad facing the camera.
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
      vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
    );
    let q = xy[vid];
    cornerUV = vec2<f32>(q.x * 0.5 + 0.5, q.y * 0.5 + 0.5);
    // billboards are 2× bigger than points
    let sizeMul = select(1.0, 2.0, u.topology == 1u);
    offset = u.camRight * (q.x * p.size * sizeMul) + u.camUp * (q.y * p.size * sizeMul);
  }

  var out: VSOut;
  out.pos    = u.viewProj * vec4<f32>(p.pos + offset, 1.0);
  out.uv     = cornerUV;
  out.color  = p.color;
  out.alpha  = p.alpha * u.opacity;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var mask: f32 = 1.0;
  if (u.topology == 2u) {
    // Stroke taper — alpha drops along x (head→tail), pinches at the
    // perpendicular edges (y).
    let headTail = 1.0 - in.uv.x;
    let perp     = 1.0 - abs(in.uv.y - 0.5) * 2.0;
    mask = headTail * smoothstep(0.0, 0.4, perp);
  } else if (u.topology == 1u) {
    // Billboard — soft gaussian-ish disc
    let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0;
    mask = exp(-d * d * 3.0);
  } else {
    // Point — tighter soft disc
    let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0;
    mask = smoothstep(1.0, 0.2, d);
  }
  let a = in.alpha * mask;
  return vec4<f32>(in.color * a, a);
}
`,nu={source:0,solid:1,gradient2:2,gradient3:3,palette4:4,rainbow:5,random:6},lu={index:0,"depth-z":1,"depth-cam":2,radial:3,"y-axis":4,luminance:5,noise:6},cu={topology:"points",pointSize:tu,opacity:1,windStrength:.05,windScale:1,anchorPull:2,damping:.8,twistAmount:0,voxelMix:0,voxelSize:.1,bass:0,treble:0,shimmerStrength:.02,burstGain:.6,burstDecay:2.5,waveEnabled:!0,waveSpeed:.6,waveOrbitRadius:.8,waveRadius:.3,waveFalloff:.2,waveStrength:.8,hueShiftSpeed:.05,saturation:1,brightness:1,colorMode:"source",colorMap:"index",colorMix:1,colorMapScale:1,colorMapOffset:0,colorCycleSpeed:0,randomSat:.85,randomVal:1,colorA:[.24,.39,.94],colorB:[.94,.24,.71],colorC:[1,.78,.12],colorD:[.16,.86,.86],dissolveRadius:10,dissolveSoftness:.05,strokeLength:.04,strokeWidth:.004,fovDeg:50,cameraZ:2.5,rotateX:0,rotateY:0,rotateZ:0,autoRotateX:0,autoRotateY:8,autoRotateZ:0},uu={color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}};class du{device;presentFormat;homeBuffer=null;liveBuffer=null;computeUniformBuffer;renderUniformBuffer;computePipeline;renderPipeline;computeBindGroupLayout;renderBindGroupLayout;computeBindGroup=null;renderBindGroup=null;pointCount=0;viewportW=1920;viewportH=1080;prevFrameTime=0;params={...cu};hueShiftPhase=0;colorCyclePhase=0;burstImpulse=0;prevBass=0;waveTime=0;autoRotXPhase=0;autoRotYPhase=0;autoRotZPhase=0;constructor(e,t){this.device=e,this.presentFormat=t,this.init()}init(){this.computeUniformBuffer=this.device.createBuffer({size:288,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.renderUniformBuffer=this.device.createBuffer({size:192,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const e=this.device.createShaderModule({code:ru});this.computeBindGroupLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}}]}),this.computePipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.computeBindGroupLayout]}),compute:{module:e,entryPoint:"cs_main"}});const t=this.device.createShaderModule({code:su});this.renderBindGroupLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),this.renderPipeline=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.renderBindGroupLayout]}),vertex:{module:t,entryPoint:"vs_main"},fragment:{module:t,entryPoint:"fs_main",targets:[{format:this.presentFormat,blend:uu}]},primitive:{topology:"triangle-list"}})}setPointCloudData(e,t){const a=Math.min(eu,Math.floor(Math.min(e.length/3,t.length/3)));if(a===0)return;let o=0,r=0,s=0;for(let m=0;m<a;m++)o+=e[m*3+0],r+=e[m*3+1],s+=e[m*3+2];o/=a,r/=a,s/=a;let n=0;for(let m=0;m<a;m++){const b=e[m*3+0]-o,M=e[m*3+1]-r,C=e[m*3+2]-s,T=Math.sqrt(b*b+M*M+C*C);T>n&&(n=T)}const l=n>0?.9/n:1,u=new ArrayBuffer(a*cs),f=new Float32Array(u);for(let m=0;m<a;m++){const b=m*8;f[b+0]=(e[m*3+0]-o)*l,f[b+1]=(e[m*3+1]-r)*l,f[b+2]=(e[m*3+2]-s)*l,f[b+3]=0,f[b+4]=t[m*3+0],f[b+5]=t[m*3+1],f[b+6]=t[m*3+2],f[b+7]=0}const d=new ArrayBuffer(a*us),h=new Float32Array(d);for(let m=0;m<a;m++){const b=m*12;h[b+0]=f[m*8+0],h[b+1]=f[m*8+1],h[b+2]=f[m*8+2],h[b+3]=1,h[b+4]=0,h[b+5]=0,h[b+6]=0,h[b+7]=this.params.pointSize,h[b+8]=f[m*8+4],h[b+9]=f[m*8+5],h[b+10]=f[m*8+6],h[b+11]=0}try{this.homeBuffer?.destroy?.()}catch{}try{this.liveBuffer?.destroy?.()}catch{}this.homeBuffer=this.device.createBuffer({size:a*cs,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.liveBuffer=this.device.createBuffer({size:a*us,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.homeBuffer,0,u),this.device.queue.writeBuffer(this.liveBuffer,0,d),this.computeBindGroup=this.device.createBindGroup({layout:this.computeBindGroupLayout,entries:[{binding:0,resource:{buffer:this.homeBuffer}},{binding:1,resource:{buffer:this.liveBuffer}},{binding:2,resource:{buffer:this.computeUniformBuffer}}]}),this.renderBindGroup=this.device.createBindGroup({layout:this.renderBindGroupLayout,entries:[{binding:0,resource:{buffer:this.liveBuffer}},{binding:1,resource:{buffer:this.renderUniformBuffer}}]}),this.pointCount=a,console.log("[pointcloud-fx] loaded",a,"points (normalized to unit cube; src scale =",l.toFixed(4),")")}setParams(e){this.params={...this.params,...e}}setViewport(e,t){this.viewportW=e,this.viewportH=t}encodeFrame(e,t){if(!this.pointCount||!this.homeBuffer||!this.liveBuffer)return;const a=performance.now()/1e3;let o=this.prevFrameTime===0?1/60:a-this.prevFrameTime;o=Math.min(Math.max(o,.001),1/15),this.prevFrameTime=a,this.hueShiftPhase+=this.params.hueShiftSpeed*o,this.hueShiftPhase>1&&(this.hueShiftPhase-=Math.floor(this.hueShiftPhase)),this.hueShiftPhase<0&&(this.hueShiftPhase-=Math.floor(this.hueShiftPhase)),this.colorCyclePhase+=this.params.colorCycleSpeed*o,this.colorCyclePhase>1&&(this.colorCyclePhase-=Math.floor(this.colorCyclePhase)),this.colorCyclePhase<0&&(this.colorCyclePhase-=Math.floor(this.colorCyclePhase));const r=Math.max(0,this.params.bass-this.prevBass);r>.04&&(this.burstImpulse+=r*this.params.burstGain*8),this.burstImpulse=Math.max(0,this.burstImpulse-this.burstImpulse*this.params.burstDecay*o),this.prevBass=this.params.bass,this.waveTime+=this.params.waveSpeed*o,this.autoRotXPhase+=this.params.autoRotateX*o,this.autoRotYPhase+=this.params.autoRotateY*o,this.autoRotZPhase+=this.params.autoRotateZ*o;const s=new ArrayBuffer(288),n=new Float32Array(s),l=new Uint32Array(s);n[0]=o,n[1]=a,l[2]=this.pointCount>>>0,n[3]=this.params.pointSize,n[4]=this.params.windStrength,n[5]=this.params.windScale,n[6]=this.params.anchorPull,n[7]=this.params.damping,n[8]=this.params.bass,n[9]=this.params.treble,n[10]=this.burstImpulse,n[11]=this.params.shimmerStrength;const u=this.waveTime,f=this.params.waveEnabled?1:0;n[12]=f*Math.cos(u)*this.params.waveOrbitRadius,n[13]=f*Math.sin(u)*this.params.waveOrbitRadius*.6,n[14]=f*Math.sin(u*.7)*this.params.waveOrbitRadius*.4,n[15]=this.params.waveRadius,n[16]=this.params.waveStrength*f,n[17]=this.params.waveFalloff,n[18]=this.params.twistAmount,n[19]=this.params.voxelSize,n[20]=this.params.voxelMix,n[21]=this.params.dissolveRadius,n[22]=this.params.dissolveSoftness,n[23]=this.hueShiftPhase,n[24]=this.params.saturation,n[25]=this.params.brightness,l[26]=nu[this.params.colorMode]>>>0,l[27]=lu[this.params.colorMap]>>>0,n[28]=this.params.colorMix,n[29]=this.params.colorMapScale,n[30]=this.params.colorMapOffset,n[31]=this.colorCyclePhase,n[32]=this.params.randomSat,n[33]=this.params.randomVal,n[36]=this.params.colorA[0],n[37]=this.params.colorA[1],n[38]=this.params.colorA[2],n[40]=this.params.colorB[0],n[41]=this.params.colorB[1],n[42]=this.params.colorB[2],n[44]=this.params.colorC[0],n[45]=this.params.colorC[1],n[46]=this.params.colorC[2],n[48]=this.params.colorD[0],n[49]=this.params.colorD[1],n[50]=this.params.colorD[2],this.device.queue.writeBuffer(this.computeUniformBuffer,0,s);{const Pe=e.beginComputePass();Pe.setPipeline(this.computePipeline),Pe.setBindGroup(0,this.computeBindGroup),Pe.dispatchWorkgroups(Math.ceil(this.pointCount/64)),Pe.end()}const d=this.viewportW/Math.max(1,this.viewportH),h=iu(this.params.fovDeg,d,.05,100),m=ou(0,0,-this.params.cameraZ),b=Math.PI/180,M=(this.params.rotateX+this.autoRotXPhase)*b,C=(this.params.rotateY+this.autoRotYPhase)*b,T=(this.params.rotateZ+this.autoRotZPhase)*b,I=Math.cos(M),W=Math.sin(M),G=Math.cos(C),O=Math.sin(C),L=Math.cos(T),N=Math.sin(T),ce=new Float32Array([1,0,0,0,0,I,W,0,0,-W,I,0,0,0,0,1]),ae=new Float32Array([G,0,-O,0,0,1,0,0,O,0,G,0,0,0,0,1]),se=new Float32Array([L,N,0,0,-N,L,0,0,0,0,1,0,0,0,0,1]),te=Ri(se,Ri(ae,ce)),Q=Ri(h,Ri(m,te)),$=[1,0,0],j=[0,1,0],Ae=new ArrayBuffer(192),Ce=new Float32Array(Ae),Be=new Uint32Array(Ae);Ce.set(Q,0),Ce[16]=$[0],Ce[17]=$[1],Ce[18]=$[2],Ce[19]=0,Ce[20]=j[0],Ce[21]=j[1],Ce[22]=j[2],Ce[23]=0,Be[24]=this.params.topology==="strokes"?2:this.params.topology==="billboards"?1:0,Ce[25]=this.params.strokeLength,Ce[26]=this.params.strokeWidth,Ce[27]=this.params.opacity,Be[28]=this.pointCount>>>0,this.device.queue.writeBuffer(this.renderUniformBuffer,0,Ae);const ie=e.beginRenderPass({colorAttachments:[{view:t,loadOp:"load",storeOp:"store"}]});ie.setPipeline(this.renderPipeline),ie.setBindGroup(0,this.renderBindGroup),ie.draw(6,this.pointCount,0,0),ie.end()}dispose(){try{this.homeBuffer?.destroy?.()}catch{}try{this.liveBuffer?.destroy?.()}catch{}try{this.computeUniformBuffer?.destroy?.()}catch{}try{this.renderUniformBuffer?.destroy?.()}catch{}this.homeBuffer=null,this.liveBuffer=null,this.pointCount=0}}const Ys=[{kind:"media-source",key:"source",label:"Point Cloud (.ply / .splat)",group:"Source",sources:["file"],accept:".ply,.splat"},{kind:"select",key:"topology",label:"Topology",group:"Topology",options:[{value:"points",label:"Points"},{value:"billboards",label:"Billboards"},{value:"strokes",label:"Worm Strokes"}],default:"points"},{kind:"slider",key:"pointSize",label:"Point Size",group:"Topology",min:.001,max:.05,step:5e-4,default:.006,showWhen:{topology:"points"}},{kind:"slider",key:"pointSize",label:"Billboard Size",group:"Topology",min:.001,max:.05,step:5e-4,default:.006,showWhen:{topology:"billboards"}},{kind:"slider",key:"strokeLength",label:"Stroke Length",group:"Topology",min:.005,max:.2,step:.001,default:.04,showWhen:{topology:"strokes"}},{kind:"slider",key:"strokeWidth",label:"Stroke Width",group:"Topology",min:5e-4,max:.03,step:5e-4,default:.004,showWhen:{topology:"strokes"}},{kind:"slider",key:"opacity",label:"Opacity",group:"Topology",min:0,max:1,step:.01,default:1},{kind:"slider",key:"windStrength",label:"Wind Strength",group:"Motion",min:0,max:1,step:.005,default:.05},{kind:"slider",key:"windScale",label:"Wind Scale",group:"Motion",min:.2,max:6,step:.05,default:1},{kind:"slider",key:"anchorPull",label:"Anchor Pull",group:"Motion",min:0,max:8,step:.05,default:2},{kind:"slider",key:"damping",label:"Damping",group:"Motion",min:0,max:3,step:.01,default:.8},{kind:"toggle",key:"audioReactive",label:"Audio Reactive",group:"Audio",default:!0},{kind:"slider",key:"burstGain",label:"Bass Burst Gain",group:"Audio",min:0,max:3,step:.05,default:.6},{kind:"slider",key:"burstDecay",label:"Bass Burst Decay",group:"Audio",min:.5,max:8,step:.1,default:2.5},{kind:"slider",key:"shimmerStrength",label:"Treble Shimmer",group:"Audio",min:0,max:.2,step:.001,default:.02},{kind:"toggle",key:"waveEnabled",label:"Enable Wave",group:"Proximity Wave",default:!0},{kind:"slider",key:"waveSpeed",label:"Orbit Speed",group:"Proximity Wave",min:0,max:4,step:.01,default:.6,showWhen:{waveEnabled:!0}},{kind:"slider",key:"waveOrbitRadius",label:"Orbit Radius",group:"Proximity Wave",min:0,max:1.5,step:.01,default:.8,showWhen:{waveEnabled:!0}},{kind:"slider",key:"waveRadius",label:"Field Radius",group:"Proximity Wave",min:.05,max:1.5,step:.01,default:.3,showWhen:{waveEnabled:!0}},{kind:"slider",key:"waveFalloff",label:"Field Softness",group:"Proximity Wave",min:.02,max:1,step:.01,default:.2,showWhen:{waveEnabled:!0}},{kind:"slider",key:"waveStrength",label:"Push Strength",group:"Proximity Wave",min:0,max:3,step:.01,default:.8,showWhen:{waveEnabled:!0}},{kind:"slider",key:"twistAmount",label:"Twist (height-driven)",group:"Geometry",min:-6.28,max:6.28,step:.05,default:0},{kind:"slider",key:"voxelMix",label:"Voxelize",group:"Geometry",min:0,max:1,step:.01,default:0},{kind:"slider",key:"voxelSize",label:"Voxel Size",group:"Geometry",min:.01,max:.5,step:.005,default:.1,showWhen:{}},{kind:"select",key:"colorMode",label:"Color Mode",group:"Color Mode",options:[{value:"source",label:"Source (from file)"},{value:"solid",label:"Solid"},{value:"gradient2",label:"2-Stop Gradient"},{value:"gradient3",label:"3-Stop Gradient"},{value:"palette4",label:"4-Color Palette"},{value:"rainbow",label:"Rainbow Cycle"},{value:"random",label:"Random per Particle"}],default:"source"},{kind:"select",key:"colorMap",label:"Mapping",group:"Color Mode",options:[{value:"index",label:"Particle Index (multi-color worms)"},{value:"depth-z",label:"Depth — World Z (back/front)"},{value:"depth-cam",label:"Depth — From Camera"},{value:"radial",label:"Radial — Distance From Center"},{value:"y-axis",label:"Vertical — Y Height"},{value:"luminance",label:"Source Luminance"},{value:"noise",label:"Noise — Organic Patches"}],default:"index"},{kind:"slider",key:"colorMix",label:"Mix (source ↔ custom)",group:"Color Mode",min:0,max:1,step:.01,default:1},{kind:"slider",key:"colorMapScale",label:"Map Range",group:"Color Mode",min:.1,max:5,step:.05,default:1},{kind:"slider",key:"colorMapOffset",label:"Map Offset",group:"Color Mode",min:-1,max:1,step:.01,default:0},{kind:"slider",key:"colorCycleSpeed",label:"Cycle Speed",group:"Color Mode",min:-2,max:2,step:.01,default:0},{kind:"color",key:"colorA",label:"Color A",group:"Color Stops",default:[60,100,240]},{kind:"color",key:"colorB",label:"Color B",group:"Color Stops",default:[240,60,180]},{kind:"color",key:"colorC",label:"Color C",group:"Color Stops",default:[255,200,30]},{kind:"color",key:"colorD",label:"Color D",group:"Color Stops",default:[40,220,220]},{kind:"slider",key:"randomSat",label:"Random Saturation",group:"Random Hue",min:0,max:1,step:.01,default:.85,showWhen:{colorMode:"random"}},{kind:"slider",key:"randomVal",label:"Random Brightness",group:"Random Hue",min:.1,max:2,step:.01,default:1,showWhen:{colorMode:"random"}},{kind:"slider",key:"hueShiftSpeed",label:"Hue Shift Speed",group:"Color Adjust",min:-1,max:1,step:.005,default:.05},{kind:"slider",key:"saturation",label:"Saturation",group:"Color Adjust",min:0,max:2,step:.01,default:1},{kind:"slider",key:"brightness",label:"Brightness",group:"Color Adjust",min:.1,max:3,step:.01,default:1},{kind:"slider",key:"dissolveRadius",label:"Dissolve Radius",group:"Dissolve",min:0,max:2,step:.01,default:10},{kind:"slider",key:"dissolveSoftness",label:"Dissolve Softness",group:"Dissolve",min:.005,max:.5,step:.005,default:.05},{kind:"angle",key:"rotateX",label:"Rotate X (Pitch)",group:"Object Rotation",default:0},{kind:"angle",key:"rotateY",label:"Rotate Y (Yaw)",group:"Object Rotation",default:0},{kind:"angle",key:"rotateZ",label:"Rotate Z (Roll)",group:"Object Rotation",default:0},{kind:"slider",key:"autoRotateX",label:"Auto-Spin X",group:"Object Rotation",min:-180,max:180,step:.5,default:0},{kind:"slider",key:"autoRotateY",label:"Auto-Spin Y",group:"Object Rotation",min:-180,max:180,step:.5,default:8},{kind:"slider",key:"autoRotateZ",label:"Auto-Spin Z",group:"Object Rotation",min:-180,max:180,step:.5,default:0},{kind:"slider",key:"fovDeg",label:"FOV",group:"Camera",min:20,max:100,step:1,default:50},{kind:"slider",key:"cameraZ",label:"Distance",group:"Camera",min:.5,max:8,step:.05,default:2.5}],Vo=ua(Ys);class fu{inner;bands=null;lastParams={...Vo};loadedBufferKey="";constructor(e,t){this.inner=new du(e,t)}setBands(e,t,a){this.bands={bass:e,mid:t,treble:a},this.applyParamsToInner()}setParams(e){this.lastParams={...Vo,...e},this.applyParamsToInner()}rgb01(e,t){return!Array.isArray(e)||e.length<3?t:[Math.max(0,Math.min(1,(e[0]??0)/255)),Math.max(0,Math.min(1,(e[1]??0)/255)),Math.max(0,Math.min(1,(e[2]??0)/255))]}applyParamsToInner(){const e=this.lastParams,t=!!e.audioReactive&&this.bands,a=t?this.bands.bass:0,o=t?this.bands.treble:0;this.inner.setParams({topology:e.topology??"points",pointSize:e.pointSize??.006,opacity:e.opacity??1,windStrength:e.windStrength??.05,windScale:e.windScale??1,anchorPull:e.anchorPull??2,damping:e.damping??.8,twistAmount:e.twistAmount??0,voxelMix:e.voxelMix??0,voxelSize:e.voxelSize??.1,bass:a,treble:o,shimmerStrength:e.shimmerStrength??.02,burstGain:e.burstGain??.6,burstDecay:e.burstDecay??2.5,waveEnabled:!!e.waveEnabled,waveSpeed:e.waveSpeed??.6,waveOrbitRadius:e.waveOrbitRadius??.8,waveRadius:e.waveRadius??.3,waveFalloff:e.waveFalloff??.2,waveStrength:e.waveStrength??.8,hueShiftSpeed:e.hueShiftSpeed??.05,saturation:e.saturation??1,brightness:e.brightness??1,colorMode:e.colorMode??"source",colorMap:e.colorMap??"index",colorMix:e.colorMix??1,colorMapScale:e.colorMapScale??1,colorMapOffset:e.colorMapOffset??0,colorCycleSpeed:e.colorCycleSpeed??0,randomSat:e.randomSat??.85,randomVal:e.randomVal??1,colorA:this.rgb01(e.colorA,[.24,.39,.94]),colorB:this.rgb01(e.colorB,[.94,.24,.71]),colorC:this.rgb01(e.colorC,[1,.78,.12]),colorD:this.rgb01(e.colorD,[.16,.86,.86]),dissolveRadius:e.dissolveRadius??10,dissolveSoftness:e.dissolveSoftness??.05,strokeLength:e.strokeLength??.04,strokeWidth:e.strokeWidth??.004,fovDeg:e.fovDeg??50,cameraZ:e.cameraZ??2.5,rotateX:e.rotateX??0,rotateY:e.rotateY??0,rotateZ:e.rotateZ??0,autoRotateX:e.autoRotateX??0,autoRotateY:e.autoRotateY??8,autoRotateZ:e.autoRotateZ??0})}setSourceBuffer(e,t,a){if(a===this.loadedBufferKey)return;let o;try{o=t==="splat"?Gs(e):sr(e)}catch(l){console.warn("[pointcloud-fx] parse failed:",l?.message||l);return}if(!o.vertices||o.vertices.length===0){console.warn("[pointcloud-fx] empty point cloud — nothing to render");return}const r=o.vertices.length,s=new Float32Array(r*3),n=new Float32Array(r*3);for(let l=0;l<r;l++){const u=o.vertices[l];s[l*3+0]=u.x,s[l*3+1]=u.y,s[l*3+2]=u.z,n[l*3+0]=u.r/255,n[l*3+1]=u.g/255,n[l*3+2]=u.b/255}this.inner.setPointCloudData(s,n),this.loadedBufferKey=a}setSource(e){}encodeFrame(e,t,a,o,r,s){this.inner.setViewport(o,r),e.beginRenderPass({colorAttachments:[{view:t,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]}).end(),this.inner.encodeFrame(e,t)}resize(e,t){}dispose(){try{this.inner.dispose?.()}catch{}}}const ds=64,pu=16,Hs=8e4,hu=5e5,mu=16,fs=6e5,vu={galaxy:0,atomic:1,swarm:2,lattice:3,field:4,media:5},ps={points:0,glow:1,streaks:2,sphere:3},gu={solid:0,gradient2:1,gradient3:2,palette4:3,rainbow:4,random:5,group:6},yu={index:0,group:1,radial:2,"y-axis":3,speed:4,"depth-z":5,noise:6};function Ai(i,e){const t=new Float32Array(16);for(let a=0;a<4;a++)for(let o=0;o<4;o++){let r=0;for(let s=0;s<4;s++)r+=i[s*4+o]*e[a*4+s];t[a*4+o]=r}return t}function bu(){const i=new Float32Array(16);return i[0]=i[5]=i[10]=i[15]=1,i}function xu(i,e,t,a){const o=1/Math.tan(i*Math.PI/180/2),r=new Float32Array(16);return r[0]=o/e,r[5]=o,r[10]=a/(t-a),r[11]=-1,r[14]=t*a/(t-a),r}function wu(i,e,t){const a=bu();return a[12]=i,a[13]=e,a[14]=t,a}const Su=`
struct Particle {
  pos:   vec3<f32>, alpha: f32,
  vel:   vec3<f32>, size:  f32,
  color: vec3<f32>, life:  f32,
  group: u32, age: f32, _pad0: f32, _pad1: f32,
};

struct U {
  // Block 0 — core
  dt: f32, time: f32, pointCount: u32, baseSize: f32,
  // Block 1 — mode + flags
  mode: u32, topology: u32, connectEnabled: u32, _pad0: u32,
  // Block 2 — motion
  windStrength: f32, windScale: f32, anchorPull: f32, damping: f32,
  // Block 3 — audio
  bass: f32, treble: f32, burstImpulse: f32, shimmerStrength: f32,
  // Block 4 — galaxy params
  galaxyArms: f32, galaxyRotateInner: f32, galaxyRotateOuter: f32, galaxyTilt: f32,
  // Block 5 — atomic params
  atomicNuclei: f32, atomicShells: f32, atomicShellSpacing: f32, atomicOrbitSpeed: f32,
  // Block 6 — swarm params
  swarmCohesion: f32, swarmSeparation: f32, swarmAlignment: f32, swarmRange: f32,
  // Block 7 — lattice params
  latticeSize: f32, latticeSpacing: f32, latticeVibration: f32, _pad1: f32,
  // Block 8 — media params
  mediaDepthAmount: f32, mediaSampleScale: f32, _pad2: f32, _pad3: f32,
  // Block 9 — fog + light
  fogDensity: f32, lightX: f32, lightY: f32, lightZ: f32,
  // Block 10 — color basics
  saturation: f32, brightness: f32, colorMode: u32, colorMap: u32,
  // Block 11 — color mix + map shaping
  colorMix: f32, colorMapScale: f32, colorMapOffset: f32, colorCycleOffset: f32,
  // Block 12 — random hue + hue shift
  randomSat: f32, randomVal: f32, hueShift: f32, _pad4: f32,
  // Blocks 13-16 — palette
  colorA: vec3<f32>, _padA: f32,
  colorB: vec3<f32>, _padB: f32,
  colorC: vec3<f32>, _padC: f32,
  colorD: vec3<f32>, _padD: f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform>              u:         U;
@group(0) @binding(2) var                       mediaTex:  texture_2d<f32>;
@group(0) @binding(3) var                       mediaSamp: sampler;

// ── Helpers ─────────────────────────────────────────────────────
fn hash3(p: vec3<f32>) -> f32 {
  let q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7,  74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6)),
  );
  return fract(sin(q.x + q.y + q.z) * 43758.5453);
}
fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, s.x);
  let nx10 = mix(n010, n110, s.x);
  let nx01 = mix(n001, n101, s.x);
  let nx11 = mix(n011, n111, s.x);
  let nxy0 = mix(nx00, nx10, s.y);
  let nxy1 = mix(nx01, nx11, s.y);
  return mix(nxy0, nxy1, s.z) * 2.0 - 1.0;
}
fn curl3(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let ax1 = noise3(p + vec3<f32>(0.0,  e, 0.0));
  let ax2 = noise3(p + vec3<f32>(0.0, -e, 0.0));
  let ay1 = noise3(p + vec3<f32>(0.0, 0.0,  e) + vec3<f32>(31.0, 0.0, 0.0));
  let ay2 = noise3(p + vec3<f32>(0.0, 0.0, -e) + vec3<f32>(31.0, 0.0, 0.0));
  let az1 = noise3(p + vec3<f32>( e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let az2 = noise3(p + vec3<f32>(-e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  return vec3<f32>(ay1 - ay2, az1 - az2, ax1 - ax2) / (2.0 * e);
}
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  var p: vec4<f32>;
  if (c.g < c.b) { p = vec4<f32>(c.b, c.g, K.w, K.z); }
  else { p = vec4<f32>(c.g, c.b, K.x, K.y); }
  var q: vec4<f32>;
  if (c.r < p.x) { q = vec4<f32>(p.x, p.y, p.w, c.r); }
  else { q = vec4<f32>(c.r, p.y, p.z, p.x); }
  let d = q.x - min(q.w, q.y);
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

// ── Behavior targets ───────────────────────────────────────────
// Each behavior returns a "target velocity" the particle smoothly
// blends toward. Keeping behaviors as velocity targets (not direct
// position writes) means audio bursts + shimmer + connections can
// all layer on top without fighting.

fn behaviorGalaxy(i: u32, p: Particle) -> vec3<f32> {
  // Particles ride a logarithmic spiral. Arm index from particle id.
  // Inner radius rotates faster than outer (differential rotation =
  // the visual signature of a real galaxy).
  let arms     = u.galaxyArms;
  let armIdx   = f32(p.group);
  let armPhase = armIdx / arms;
  let r        = length(vec2<f32>(p.pos.x, p.pos.z)) + 1e-4;
  let theta    = atan2(p.pos.z, p.pos.x);
  let omega    = mix(u.galaxyRotateOuter, u.galaxyRotateInner, smoothstep(1.0, 0.0, r));
  // Target angle = current theta + omega; convert (r, theta+omega) to xz
  let nextTheta = theta + omega * u.dt;
  let tx = cos(nextTheta) * r;
  let tz = sin(nextTheta) * r;
  // Subtle vertical thickness modulated by radius (thinner at edge)
  let ty = mix(0.05, 0.0, smoothstep(0.0, 1.0, r)) * sin(p.pos.x * 7.0 + p.pos.z * 11.0);
  let targetPos = vec3<f32>(tx, ty + u.galaxyTilt * p.pos.x * 0.1, tz);
  return (targetPos - p.pos) / max(u.dt, 0.001);
}

fn behaviorAtomic(i: u32, p: Particle) -> vec3<f32> {
  // Each particle is assigned a (nucleus, shell) by its group id.
  // We orbit around its nucleus, on a tilted plane unique to the
  // shell. The shell radius determines orbital speed (closer = faster).
  let nuclei = max(1.0, floor(u.atomicNuclei));
  let nIdx = f32(p.group % u32(nuclei));
  let shellIdx = f32((p.group / u32(nuclei)) % u32(max(1.0, u.atomicShells)));
  // Nucleus position — N nuclei arranged on a unit circle.
  let nTheta = (nIdx / nuclei) * 6.2831853;
  let nucPos = vec3<f32>(cos(nTheta) * 0.5, 0.0, sin(nTheta) * 0.5);
  // Shell radius and tilt
  let r = (shellIdx + 1.0) * u.atomicShellSpacing;
  let tilt = nIdx * 0.731 + shellIdx * 1.13;
  let cosT = cos(tilt); let sinT = sin(tilt);
  // Orbital angle from particle id + time scaled by 1/r (Kepler-ish)
  let phase = f32(i) * 0.0173 + u.time * u.atomicOrbitSpeed / max(r, 0.05);
  // Position on tilted shell relative to nucleus
  let local = vec3<f32>(cos(phase) * r, sin(phase) * r * sinT, sin(phase) * r * cosT);
  let targetPos = nucPos + local;
  return (targetPos - p.pos) / max(u.dt, 0.001);
}

fn behaviorSwarm(i: u32, p: Particle) -> vec3<f32> {
  // Cheap boid analog: cohesion toward a moving "leader" attractor
  // (sin/cos of time), separation from a synthetic neighborhood
  // (use curl noise instead of true neighbor lookup to avoid the
  // cost of a real boid simulation at 100K particles), alignment
  // pushes velocity toward the curl direction.
  let leader = vec3<f32>(sin(u.time * 0.4) * 0.5, sin(u.time * 0.31) * 0.3, cos(u.time * 0.4) * 0.5);
  let cohesion = (leader - p.pos) * u.swarmCohesion;
  let flow = curl3(p.pos * u.swarmRange + vec3<f32>(0.0, 0.0, u.time * 0.3));
  let align = flow * u.swarmAlignment;
  // Pseudo-separation: random outward jitter so they don't collapse
  let n = vec3<f32>(
    hash3(p.pos * 3.1 + vec3<f32>(u.time, 0.0, 0.0)) * 2.0 - 1.0,
    hash3(p.pos * 3.1 + vec3<f32>(0.0, u.time, 0.0)) * 2.0 - 1.0,
    hash3(p.pos * 3.1 + vec3<f32>(0.0, 0.0, u.time)) * 2.0 - 1.0,
  );
  let separation = n * u.swarmSeparation;
  return cohesion + align + separation;
}

fn behaviorLattice(i: u32, p: Particle) -> vec3<f32> {
  // Each particle has a deterministic lattice site derived from its
  // id. Vibration amplitude = base + audio bass kick.
  let n = max(2.0, floor(u.latticeSize));
  let ix = f32(i % u32(n));
  let iy = f32((i / u32(n)) % u32(n));
  let iz = f32((i / (u32(n) * u32(n))) % u32(n));
  let cx = (ix / n - 0.5) * u.latticeSpacing;
  let cy = (iy / n - 0.5) * u.latticeSpacing;
  let cz = (iz / n - 0.5) * u.latticeSpacing;
  // Vibration around the lattice site
  let amp = u.latticeVibration * (1.0 + u.bass * 2.0);
  let vibe = vec3<f32>(
    sin(u.time * 3.7 + f32(i)),
    cos(u.time * 4.1 + f32(i) * 1.3),
    sin(u.time * 2.9 + f32(i) * 0.7),
  ) * amp;
  let targetPos = vec3<f32>(cx, cy, cz) + vibe;
  return (targetPos - p.pos) / max(u.dt, 0.001);
}

fn behaviorField(i: u32, p: Particle) -> vec3<f32> {
  // Pure curl-noise drift — same engine as the flythrough / point
  // cloud, here applied as a velocity field that constantly stirs
  // the swarm. Anchor pull is OFF for this mode so particles keep
  // drifting freely.
  let flow = curl3(p.pos * u.windScale + vec3<f32>(0.0, 0.0, u.time * 0.1));
  return flow * u.windStrength * 6.0;
}

fn behaviorMedia(i: u32, p: Particle) -> vec3<f32> {
  // Sample the media texture at the particle's XY projection. The
  // particle's "home" position is its UV anchor (mapped to [-1, 1]
  // XY) with the depth derived from sampled luminance.
  let homeUV = vec2<f32>(
    (f32(i % 1024u) + 0.5) / 1024.0,
    (f32((i / 1024u) % 1024u) + 0.5) / 1024.0,
  );
  let homeXY = homeUV * 2.0 - 1.0;
  let texColor = textureSampleLevel(mediaTex, mediaSamp, homeUV * u.mediaSampleScale, 0.0);
  let lum = dot(texColor.rgb, vec3<f32>(0.299, 0.587, 0.114));
  let z = (lum - 0.5) * u.mediaDepthAmount;
  let targetPos = vec3<f32>(homeXY.x, -homeXY.y, z);
  return (targetPos - p.pos) / max(u.dt, 0.001);
}

// ── Color computation ──────────────────────────────────────────
fn paletteColor(t: f32, i: u32) -> vec3<f32> {
  if (u.colorMode == 0u) { return u.colorA; }                                                // solid
  if (u.colorMode == 1u) { return mix(u.colorA, u.colorB, t); }                              // gradient2
  if (u.colorMode == 2u) {                                                                    // gradient3
    if (t < 0.5) { return mix(u.colorA, u.colorB, t * 2.0); }
    return mix(u.colorB, u.colorC, (t - 0.5) * 2.0);
  }
  if (u.colorMode == 3u) {                                                                    // palette4
    let s = t * 3.0;
    if (s < 1.0) { return mix(u.colorA, u.colorB, s); }
    if (s < 2.0) { return mix(u.colorB, u.colorC, s - 1.0); }
    return mix(u.colorC, u.colorD, s - 2.0);
  }
  if (u.colorMode == 4u) {                                                                    // rainbow
    return hsv2rgb(vec3<f32>(fract(t + u.colorCycleOffset), 1.0, 1.0));
  }
  if (u.colorMode == 5u) {                                                                    // random
    let hue = hash3(vec3<f32>(f32(i) * 0.317, 13.0, 91.0));
    return hsv2rgb(vec3<f32>(fract(hue + u.colorCycleOffset), u.randomSat, u.randomVal));
  }
  // 6 — group (each particle group gets one of the 4 palette colors)
  let g = f32(i % 4u);
  if (g < 1.0) { return u.colorA; }
  if (g < 2.0) { return u.colorB; }
  if (g < 3.0) { return u.colorC; }
  return u.colorD;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.pointCount) { return; }
  var p = particles[i];

  // Dispatch to the active behavior. Each returns a TARGET VELOCITY
  // (delta over dt) the particle's velocity blends toward.
  var targetVel = vec3<f32>(0.0);
  if      (u.mode == 0u) { targetVel = behaviorGalaxy(i, p); }
  else if (u.mode == 1u) { targetVel = behaviorAtomic(i, p); }
  else if (u.mode == 2u) { targetVel = behaviorSwarm(i, p); }
  else if (u.mode == 3u) { targetVel = behaviorLattice(i, p); }
  else if (u.mode == 4u) { targetVel = behaviorField(i, p); }
  else if (u.mode == 5u) { targetVel = behaviorMedia(i, p); }

  // Bass burst — universal radial impulse, blends with the behavior.
  let outward = normalize(p.pos + vec3<f32>(1e-5, 0.0, 0.0));
  targetVel = targetVel + outward * u.burstImpulse;

  // Treble shimmer — small random per-particle jitter.
  let jx = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 0.0)) - 0.5) * 2.0;
  let jy = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 1.0)) - 0.5) * 2.0;
  let jz = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 2.0)) - 0.5) * 2.0;
  targetVel = targetVel + vec3<f32>(jx, jy, jz) * u.shimmerStrength * u.treble;

  // Integrate.
  p.vel = mix(p.vel, targetVel, clamp(u.dt * 6.0, 0.0, 1.0));
  p.pos = p.pos + p.vel * u.dt;
  p.vel = p.vel * (1.0 - u.damping * u.dt);

  // ── Color ──────────────────────────────────────────────────────
  // Mapping value 't' (no backticks — JS template literal context).
  var t: f32 = 0.0;
  if      (u.colorMap == 0u) { t = f32(i) / max(f32(u.pointCount), 1.0); }                    // index
  else if (u.colorMap == 1u) { t = f32(p.group) / 16.0; }                                     // group
  else if (u.colorMap == 2u) { t = clamp(length(p.pos), 0.0, 1.5) / 1.5; }                    // radial
  else if (u.colorMap == 3u) { t = p.pos.y * 0.5 + 0.5; }                                     // y-axis
  else if (u.colorMap == 4u) { t = clamp(length(p.vel) * 0.3, 0.0, 1.0); }                    // speed
  else if (u.colorMap == 5u) { t = p.pos.z * 0.5 + 0.5; }                                     // depth-z
  else if (u.colorMap == 6u) { t = noise3(p.pos * 3.0 + vec3<f32>(0.0, 0.0, u.time * 0.2)) * 0.5 + 0.5; } // noise
  t = clamp(t * u.colorMapScale + u.colorMapOffset, 0.0, 1.0);

  // Mode color + mix with prior frame color (gives a small temporal
  // smoothing on color transitions — feels less popcorn-y).
  var modeColor = paletteColor(t, i);
  // In media mode, blend mode color with sampled source color for the
  // Refik look — particle is at the right pixel AND the right color.
  if (u.mode == 5u) {
    let homeUV = vec2<f32>(
      (f32(i % 1024u) + 0.5) / 1024.0,
      (f32((i / 1024u) % 1024u) + 0.5) / 1024.0,
    );
    let srcColor = textureSampleLevel(mediaTex, mediaSamp, homeUV * u.mediaSampleScale, 0.0).rgb;
    modeColor = mix(srcColor, modeColor, u.colorMix);
  } else {
    // Other modes: colorMix is interpretted as how much of the mode
    // color vs a desaturated white background to use. (1.0 default
    // = pure mode color.)
    modeColor = mix(vec3<f32>(0.6), modeColor, u.colorMix);
  }

  // HSV adjustments on top of the mode color.
  var hsv = rgb2hsv(modeColor);
  hsv.x = fract(hsv.x + u.hueShift);
  hsv.y = clamp(hsv.y * u.saturation, 0.0, 2.0);
  hsv.z = clamp(hsv.z * u.brightness, 0.0, 4.0);
  p.color = hsv2rgb(hsv);

  // Size pulse on bass.
  p.size = u.baseSize * (1.0 + u.bass * 1.2);
  p.alpha = 1.0;

  particles[i] = p;
}
`,_u=`
struct Particle {
  pos: vec3<f32>, alpha: f32,
  vel: vec3<f32>, size:  f32,
  color: vec3<f32>, life: f32,
  group: u32, age: f32, _p0: f32, _p1: f32,
};
struct Edge { i: u32, j: u32, kind: u32, _p: u32, };

struct UEdge {
  pointCount:    u32,
  partnerCount:  u32,
  maxEdges:      u32,
  _pad0:         u32,
  localRadius:   f32,
  bridgeRadius:  f32,
  _pad1:         f32,
  _pad2:         f32,
};

@group(0) @binding(0) var<storage, read>             particles: array<Particle>;
@group(0) @binding(1) var<uniform>                   u:         UEdge;
// Indirect-draw args buffer: [vertex_count, instance_count,
// first_vertex, first_instance]. We atomicAdd instance_count (slot
// 1) for each new edge so the line render pass can drawIndirect
// straight off this buffer — no CPU readback needed.
//
// This is its OWN buffer (not packed with the edges) because WebGPU
// requires storage buffer bindings to start on a 256-byte-aligned
// offset; trying to bind "the edges section starting at byte 16"
// failed validation. Two buffers, two bindings, both at offset 0.
@group(0) @binding(2) var<storage, read_write>       indirect:  array<atomic<u32>, 4>;
@group(0) @binding(3) var<storage, read_write>       edges:     array<Edge>;

@compute @workgroup_size(64)
fn cs_edges(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.pointCount) { return; }
  let pi = particles[i].pos;

  // Deterministic partner picking: each particle gets partnerCount
  // partners computed by hashing (id, slot). Stable across frames so
  // the connection graph doesn't flicker, but irregular enough that
  // the resulting edge structure looks organic rather than gridlike.
  for (var k: u32 = 0u; k < u.partnerCount; k = k + 1u) {
    // Explicit parens required — WGSL refuses to mix * and ^ without
    // them ("mixing '*' and '^' requires parenthesis").
    let seed = (i * 73856093u) ^ (k * 19349663u);
    let mixed = (seed ^ (seed >> 13u)) * 2246822519u;
    let j = (mixed ^ (mixed >> 16u)) % u.pointCount;
    if (j <= i) { continue; }  // avoid duplicate edges and self

    let pj = particles[j].pos;
    let d  = distance(pi, pj);

    var kind: u32 = 99u;
    if (d < u.localRadius)        { kind = 0u; }
    else if (d < u.bridgeRadius)  { kind = 1u; }
    if (kind > 1u) { continue; }

    let slot = atomicAdd(&indirect[1], 1u);
    if (slot < u.maxEdges) {
      edges[slot] = Edge(i, j, kind, 0u);
    } else {
      // Buffer full — roll the counter back so the next frame doesn't
      // see a stale value and skip every draw. Cheap.
      atomicStore(&indirect[1], u.maxEdges);
    }
  }
}
`,Cu=`
struct Particle {
  pos: vec3<f32>, alpha: f32,
  vel: vec3<f32>, size:  f32,
  color: vec3<f32>, life: f32,
  group: u32, age: f32, _p0: f32, _p1: f32,
};

struct UR {
  viewProj:     mat4x4<f32>,
  camRight:     vec3<f32>,
  _p0:          f32,
  camUp:        vec3<f32>,
  _p1:          f32,
  camPos:       vec3<f32>,
  topology:     u32,
  // sizing
  strokeLength: f32,
  strokeWidth:  f32,
  opacity:      f32,
  _p2:          f32,
  // atmosphere
  fogColor:     vec3<f32>,
  fogDensity:   f32,
  lightDir:     vec3<f32>,    // already normalized
  lightStrength: f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform>       u:         UR;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv:        vec2<f32>,
  @location(1) color:     vec3<f32>,
  @location(2) alpha:     f32,
  @location(3) worldDist: f32,
  // particleDir = normalize(particle.pos - cloud origin). We use it
  // in the fragment shader to fake directional lighting across all
  // topologies — dot(particleDir, lightDir) tells us whether the
  // particle is on the "lit side" (toward the light) or the "shadow
  // side" (away). This is the cheap-but-convincing self-shadowing
  // surrogate, since true per-particle shadow casting at 100K+
  // particles isn't tractable in real time without a shadow map
  // pass which we explicitly chose to skip for v1.
  @location(4) particleDir: vec3<f32>,
};

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let p = particles[iid];

  var uvOut:  vec2<f32> = vec2<f32>(0.0);
  var offset: vec3<f32> = vec3<f32>(0.0);

  if (u.topology == 2u) {
    // STREAKS — quad extruded along velocity vector.
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(0.0,  1.0),
      vec2<f32>(0.0,  1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0,  1.0),
    );
    let q = xy[vid];
    uvOut = vec2<f32>(q.x, q.y * 0.5 + 0.5);
    let speed = length(p.vel);
    let dir = select(vec3<f32>(1.0, 0.0, 0.0), p.vel / max(speed, 1e-4), speed > 1e-4);
    let fwd = normalize(cross(u.camRight, u.camUp));
    var perp = normalize(cross(dir, fwd));
    if (length(perp) < 1e-3) { perp = normalize(cross(dir, u.camUp)); }
    offset = -dir * (q.x * u.strokeLength) + perp * (q.y * u.strokeWidth * 0.5);
  } else {
    // POINTS / GLOW / SPHERE — camera-facing billboard
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
      vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
    );
    let q = xy[vid];
    uvOut = vec2<f32>(q.x, q.y);  // -1..1 — used by sphere shading
    // glow billboards are 2× the size to give a soft halo
    let scale = select(p.size, p.size * 2.0, u.topology == 1u);
    offset = u.camRight * (q.x * scale) + u.camUp * (q.y * scale);
  }

  let worldPos = p.pos + offset;
  let toCam = u.camPos - worldPos;

  // Particle direction from cloud origin — used for fake directional
  // lighting in the fragment shader. Falls back to camera-up when the
  // particle is right at the origin (degenerate case).
  let pLen = length(p.pos);
  let pDir = select(vec3<f32>(0.0, 1.0, 0.0), p.pos / max(pLen, 1e-4), pLen > 1e-4);

  var out: VSOut;
  out.pos         = u.viewProj * vec4<f32>(worldPos, 1.0);
  out.uv          = uvOut;
  out.color       = p.color;
  out.alpha       = p.alpha * u.opacity;
  out.worldDist   = length(toCam);
  out.particleDir = pDir;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var mask: f32 = 1.0;
  var shade: f32 = 1.0;

  if (u.topology == 2u) {
    // Stroke taper
    let headTail = 1.0 - in.uv.x;
    let perp     = 1.0 - abs(in.uv.y - 0.5) * 2.0;
    mask = headTail * smoothstep(0.0, 0.4, perp);
  } else if (u.topology == 1u) {
    // Glow — soft exponential disc
    let d = length(in.uv);
    if (d > 1.0) { discard; }
    mask = exp(-d * d * 2.5);
  } else if (u.topology == 3u) {
    // Sphere — reconstruct a hemisphere normal from the billboard UV,
    // shade with the light direction for a 3D-orb look.
    let d2 = dot(in.uv, in.uv);
    if (d2 > 1.0) { discard; }
    let z = sqrt(1.0 - d2);
    let n = vec3<f32>(in.uv.x, in.uv.y, z);
    let ndl = max(dot(n, u.lightDir), 0.0);
    shade = mix(1.0, ndl, u.lightStrength) + 0.15;  // ambient floor
    // Sphere fragments have edges; use a quadratic falloff for soft edge.
    mask = smoothstep(1.0, 0.85, sqrt(d2)) * 0.5 + 0.5;
  } else {
    // POINT — soft disc
    let d = length(in.uv);
    if (d > 1.0) { discard; }
    mask = smoothstep(1.0, 0.2, d);
  }

  // Per-particle directional lighting for non-sphere topologies.
  // Sphere already shaded above via the billboard-normal trick; this
  // block adds a coarser "lit side vs shadow side" tint for points /
  // glow / streaks. dot(particleDir, lightDir) ∈ [-1, 1]:
  //   +1 = particle directly toward the light (full light)
  //   -1 = particle on the far side of the cloud (deep shadow)
  // We remap to [0, 1] and blend with the unlit color. lightStrength
  // is the user-facing strength control — 0 disables (everything stays
  // unshaded), 1 maximally separates lit from shadow.
  //
  // This isn't physically accurate shadowing — but visually it reads
  // as "the cloud has a lit side and a dark side," which is what users
  // want when they put a light into a particle field.
  if (u.topology != 3u && u.lightStrength > 0.001) {
    let ndl = dot(in.particleDir, u.lightDir);          // [-1, 1]
    let lit = ndl * 0.5 + 0.5;                          // [0, 1]
    // Bias toward dark side getting darker than the unlit baseline —
    // gives the impression of self-occlusion.
    let shadeMod = mix(0.25, 1.35, lit);                // dark side ~0.25, lit side ~1.35
    shade = shade * mix(1.0, shadeMod, u.lightStrength);
  }

  // Depth-based fog. Particles farther from the camera fade INTO
  // fogColor. Combined with the fog fullscreen-fill pass that runs
  // before this one, far particles literally blend into the
  // background atmosphere — that's what makes the fog read as
  // volumetric rather than just "particles get a color tint."
  let fog = exp(-u.fogDensity * in.worldDist);
  let col = mix(u.fogColor, in.color * shade, fog);
  let a = in.alpha * mask * fog;
  return vec4<f32>(col * a, a);
}
`,Pu=`
struct UFog { color: vec3<f32>, opacity: f32, };
@group(0) @binding(0) var<uniform> u: UFog;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  // Fullscreen triangle (two triangles into one bigger one for
  // discard efficiency).
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  return vec4<f32>(positions[vid], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  // Premultiplied-alpha output so this blends cleanly with the
  // existing premult pipeline used by particles + lines.
  let a = u.opacity;
  return vec4<f32>(u.color * a, a);
}
`,ku=`
struct Particle {
  pos: vec3<f32>, alpha: f32,
  vel: vec3<f32>, size:  f32,
  color: vec3<f32>, life: f32,
  group: u32, age: f32, _p0: f32, _p1: f32,
};
struct Edge { i: u32, j: u32, kind: u32, _p: u32, };

struct UL {
  viewProj:    mat4x4<f32>,
  camPos:      vec3<f32>,
  _p0:         f32,
  colorLocal:  vec3<f32>,
  alphaLocal:  f32,
  colorBridge: vec3<f32>,
  alphaBridge: f32,
  fogColor:    vec3<f32>,
  fogDensity:  f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> edges:     array<Edge>;
@group(0) @binding(2) var<uniform>       u:         UL;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color:     vec3<f32>,
  @location(1) alpha:     f32,
  @location(2) worldDist: f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let e = edges[iid];
  // vid 0 = particle i endpoint, vid 1 = particle j endpoint
  let pIdx = select(e.j, e.i, vid == 0u);
  let p = particles[pIdx];
  let isBridge = e.kind == 1u;
  let col = select(u.colorLocal, u.colorBridge, isBridge);
  let aBase = select(u.alphaLocal, u.alphaBridge, isBridge);

  var out: VSOut;
  out.pos       = u.viewProj * vec4<f32>(p.pos, 1.0);
  out.color     = col;
  out.alpha     = aBase;
  out.worldDist = length(u.camPos - p.pos);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let fog = exp(-u.fogDensity * in.worldDist);
  let col = mix(u.fogColor, in.color, fog);
  let a = in.alpha * fog;
  return vec4<f32>(col * a, a);
}
`,Tu={mode:"galaxy",particleCount:Hs,baseSize:.006,opacity:1,windStrength:.2,windScale:2,anchorPull:0,damping:1,bass:0,treble:0,shimmerStrength:.02,burstGain:.6,burstDecay:2.5,galaxyArms:4,galaxyRotateInner:1.2,galaxyRotateOuter:.3,galaxyTilt:.1,atomicNuclei:5,atomicShells:3,atomicShellSpacing:.18,atomicOrbitSpeed:.8,swarmCohesion:.6,swarmSeparation:.05,swarmAlignment:.8,swarmRange:1.5,latticeSize:16,latticeSpacing:1.6,latticeVibration:.015,mediaDepthAmount:.6,mediaSampleScale:1,topology:"glow",strokeLength:.04,strokeWidth:.004,colorMode:"palette4",colorMap:"radial",colorMix:1,colorMapScale:1,colorMapOffset:0,colorCycleSpeed:.05,randomSat:.85,randomVal:1,hueShiftSpeed:.02,saturation:1.1,brightness:1.1,colorA:[.18,.42,1],colorB:[.95,.28,.65],colorC:[1,.78,.2],colorD:[.2,.95,.85],connectEnabled:!0,partnerCount:12,localRadius:.12,bridgeRadius:.4,colorLocal:[.4,1,1],colorBridge:[.95,.3,.8],alphaLocal:.35,alphaBridge:.12,fogDensity:.6,fogOpacity:.85,fogColor:[.02,.02,.06],lightX:.4,lightY:.6,lightZ:.7,lightStrength:.6,fovDeg:50,cameraZ:2.4,rotateX:0,rotateY:0,rotateZ:0,autoRotateX:0,autoRotateY:6,autoRotateZ:0},Mu={color:{srcFactor:"one",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}},hs={color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}};class Ru{device;presentFormat;particleBuffer=null;indirectBuffer=null;edgeBuffer=null;behaviorUniform;edgeUniform;renderUniform;lineUniform;fogUniform;mediaTex=null;mediaTexView=null;mediaSampler;mediaW=1;mediaH=1;fogPipeline;fogBindGroup=null;fogLayout;behaviorPipeline;edgePipeline;renderPipeline;linePipeline;behaviorBindGroup=null;edgeBindGroup=null;renderBindGroup=null;lineBindGroup=null;behaviorLayout;edgeLayout;renderLayout;lineLayout;params={...Tu};particleCount=Hs;partnerCount=mu;viewportW=1920;viewportH=1080;prevFrameTime=0;burstImpulse=0;prevBass=0;hueShiftPhase=0;colorCyclePhase=0;autoRotXPhase=0;autoRotYPhase=0;autoRotZPhase=0;currentMode="galaxy";constructor(e,t){this.device=e,this.presentFormat=t,this.init()}init(){this.behaviorUniform=this.device.createBuffer({size:384,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.edgeUniform=this.device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.renderUniform=this.device.createBuffer({size:192,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.lineUniform=this.device.createBuffer({size:160,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.fogUniform=this.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.allocateParticleBuffer(this.particleCount),this.indirectBuffer=this.device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.INDIRECT});const e=new Uint32Array(4);e[0]=2,e[1]=0,e[2]=0,e[3]=0,this.device.queue.writeBuffer(this.indirectBuffer,0,e),this.edgeBuffer=this.device.createBuffer({size:fs*pu,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.mediaTex=this.device.createTexture({size:[1,1,1],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),this.mediaTexView=this.mediaTex.createView(),this.mediaSampler=this.device.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.buildPipelines(),this.rebuildBindGroups()}allocateParticleBuffer(e){if(e=Math.max(1024,Math.min(hu,Math.floor(e))),this.particleBuffer)try{this.particleBuffer.destroy?.()}catch{}this.particleBuffer=this.device.createBuffer({size:e*ds,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.particleCount=e,this.seedParticles(),this.behaviorLayout&&this.rebuildBindGroups()}seedParticles(){const e=this.particleCount,t=new ArrayBuffer(e*ds),a=new Float32Array(t),o=new Uint32Array(t),r=this.params.mode;for(let s=0;s<e;s++){const n=s*16;let l=0,u=0,f=0,d=0;if(r==="galaxy"){d=s%Math.max(1,this.params.galaxyArms|0);const h=d/Math.max(1,this.params.galaxyArms),m=Math.sqrt(Math.random())*.95,b=h*Math.PI*2+m*3+(Math.random()-.5)*.4;l=Math.cos(b)*m,f=Math.sin(b)*m,u=(Math.random()-.5)*.04*(1-m)}else if(r==="atomic"){const h=Math.max(1,this.params.atomicNuclei|0),m=Math.max(1,this.params.atomicShells|0),b=s%h,M=Math.floor(s/h)%m;d=b+M*h;const C=b/h*Math.PI*2,T=(M+1)*this.params.atomicShellSpacing,I=Math.random()*Math.PI*2;l=Math.cos(C)*.5+Math.cos(I)*T,u=(Math.random()-.5)*T*.5,f=Math.sin(C)*.5+Math.sin(I)*T*.6}else if(r==="lattice"){const h=Math.max(2,this.params.latticeSize|0),m=s%h,b=Math.floor(s/h)%h,M=Math.floor(s/(h*h))%h;l=(m/h-.5)*this.params.latticeSpacing,u=(b/h-.5)*this.params.latticeSpacing,f=(M/h-.5)*this.params.latticeSpacing,d=s}else{let h=0,m=0,b=0,M=0;do h=Math.random()*2-1,m=Math.random()*2-1,b=Math.random()*2-1,M=h*h+m*m+b*b;while(M>1);l=h,u=m,f=b,d=s&15}a[n+0]=l,a[n+1]=u,a[n+2]=f,a[n+3]=1,a[n+4]=0,a[n+5]=0,a[n+6]=0,a[n+7]=this.params.baseSize,a[n+8]=.6,a[n+9]=.7,a[n+10]=.95,a[n+11]=1,o[n+12]=d>>>0,a[n+13]=0,a[n+14]=0,a[n+15]=0}this.device.queue.writeBuffer(this.particleBuffer,0,t),this.currentMode=r}buildPipelines(){const e=this.device.createShaderModule({code:Pu});this.fogLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),this.fogPipeline=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.fogLayout]}),vertex:{module:e,entryPoint:"vs_main"},fragment:{module:e,entryPoint:"fs_main",targets:[{format:this.presentFormat,blend:hs}]},primitive:{topology:"triangle-list"}}),this.fogBindGroup=this.device.createBindGroup({layout:this.fogLayout,entries:[{binding:0,resource:{buffer:this.fogUniform}}]});const t=this.device.createShaderModule({code:Su});this.behaviorLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:2,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"float"}},{binding:3,visibility:GPUShaderStage.COMPUTE,sampler:{type:"filtering"}}]}),this.behaviorPipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.behaviorLayout]}),compute:{module:t,entryPoint:"cs_main"}});const a=this.device.createShaderModule({code:_u});this.edgeLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),this.edgePipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.edgeLayout]}),compute:{module:a,entryPoint:"cs_edges"}});const o=this.device.createShaderModule({code:Cu});this.renderLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),this.renderPipeline=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.renderLayout]}),vertex:{module:o,entryPoint:"vs_main"},fragment:{module:o,entryPoint:"fs_main",targets:[{format:this.presentFormat,blend:Mu}]},primitive:{topology:"triangle-list"}});const r=this.device.createShaderModule({code:ku});this.lineLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),this.linePipeline=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.lineLayout]}),vertex:{module:r,entryPoint:"vs_main"},fragment:{module:r,entryPoint:"fs_main",targets:[{format:this.presentFormat,blend:hs}]},primitive:{topology:"line-list"}})}rebuildBindGroups(){this.behaviorBindGroup=this.device.createBindGroup({layout:this.behaviorLayout,entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.behaviorUniform}},{binding:2,resource:this.mediaTexView},{binding:3,resource:this.mediaSampler}]}),this.edgeBindGroup=this.device.createBindGroup({layout:this.edgeLayout,entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.edgeUniform}},{binding:2,resource:{buffer:this.indirectBuffer}},{binding:3,resource:{buffer:this.edgeBuffer}}]}),this.renderBindGroup=this.device.createBindGroup({layout:this.renderLayout,entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.renderUniform}}]}),this.lineBindGroup=this.device.createBindGroup({layout:this.lineLayout,entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.edgeBuffer}},{binding:2,resource:{buffer:this.lineUniform}}]})}setParams(e){const t=this.params.mode,a=this.params.particleCount;this.params={...this.params,...e},this.params.particleCount!==a?this.allocateParticleBuffer(this.params.particleCount):this.params.mode!==t&&this.seedParticles()}setViewport(e,t){this.viewportW=e,this.viewportH=t}setSourceImage(e){return new Promise(t=>{const a=e.naturalWidth??e.width??1,o=e.naturalHeight??e.height??1;this.resizeMediaTexture(a,o);try{this.device.queue.copyExternalImageToTexture({source:e,flipY:!1},{texture:this.mediaTex,premultipliedAlpha:!0},{width:a,height:o,depthOrArrayLayers:1})}catch{}t()})}updateSourceFromVideo(e){if(e.readyState<2)return;const t=e.videoWidth|0,a=e.videoHeight|0;if(!(!t||!a)){this.resizeMediaTexture(t,a);try{this.device.queue.copyExternalImageToTexture({source:e,flipY:!1},{texture:this.mediaTex,premultipliedAlpha:!0},{width:t,height:a,depthOrArrayLayers:1})}catch{}}}updateSourceFromCanvas(e){const t=e.width|0,a=e.height|0;if(!(!t||!a)){this.resizeMediaTexture(t,a);try{this.device.queue.copyExternalImageToTexture({source:e,flipY:!1},{texture:this.mediaTex,premultipliedAlpha:!0},{width:t,height:a,depthOrArrayLayers:1})}catch{}}}resizeMediaTexture(e,t){if(!(this.mediaW===e&&this.mediaH===t)){try{this.mediaTex?.destroy?.()}catch{}this.mediaTex=this.device.createTexture({size:[e,t,1],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),this.mediaTexView=this.mediaTex.createView(),this.mediaW=e,this.mediaH=t,this.rebuildBindGroups()}}encodeFrame(e,t){const a=performance.now()/1e3;let o=this.prevFrameTime===0?1/60:a-this.prevFrameTime;o=Math.min(Math.max(o,.001),1/15),this.prevFrameTime=a,this.hueShiftPhase=(this.hueShiftPhase+this.params.hueShiftSpeed*o)%1,this.colorCyclePhase=(this.colorCyclePhase+this.params.colorCycleSpeed*o)%1;const r=Math.max(0,this.params.bass-this.prevBass);r>.04&&(this.burstImpulse+=r*this.params.burstGain*8),this.burstImpulse=Math.max(0,this.burstImpulse-this.burstImpulse*this.params.burstDecay*o),this.prevBass=this.params.bass,this.autoRotXPhase+=this.params.autoRotateX*o,this.autoRotYPhase+=this.params.autoRotateY*o,this.autoRotZPhase+=this.params.autoRotateZ*o;const s=new ArrayBuffer(384),n=new Float32Array(s),l=new Uint32Array(s);if(n[0]=o,n[1]=a,l[2]=this.particleCount>>>0,n[3]=this.params.baseSize,l[4]=vu[this.params.mode]>>>0,l[5]=ps[this.params.topology]>>>0,l[6]=this.params.connectEnabled?1:0,n[8]=this.params.windStrength,n[9]=this.params.windScale,n[10]=this.params.anchorPull,n[11]=this.params.damping,n[12]=this.params.bass,n[13]=this.params.treble,n[14]=this.burstImpulse,n[15]=this.params.shimmerStrength,n[16]=this.params.galaxyArms,n[17]=this.params.galaxyRotateInner,n[18]=this.params.galaxyRotateOuter,n[19]=this.params.galaxyTilt,n[20]=this.params.atomicNuclei,n[21]=this.params.atomicShells,n[22]=this.params.atomicShellSpacing,n[23]=this.params.atomicOrbitSpeed,n[24]=this.params.swarmCohesion,n[25]=this.params.swarmSeparation,n[26]=this.params.swarmAlignment,n[27]=this.params.swarmRange,n[28]=this.params.latticeSize,n[29]=this.params.latticeSpacing,n[30]=this.params.latticeVibration,n[32]=this.params.mediaDepthAmount,n[33]=this.params.mediaSampleScale,n[36]=this.params.fogDensity,n[37]=this.params.lightX,n[38]=this.params.lightY,n[39]=this.params.lightZ,n[40]=this.params.saturation,n[41]=this.params.brightness,l[42]=gu[this.params.colorMode]>>>0,l[43]=yu[this.params.colorMap]>>>0,n[44]=this.params.colorMix,n[45]=this.params.colorMapScale,n[46]=this.params.colorMapOffset,n[47]=this.colorCyclePhase,n[48]=this.params.randomSat,n[49]=this.params.randomVal,n[50]=this.hueShiftPhase,n[52]=this.params.colorA[0],n[53]=this.params.colorA[1],n[54]=this.params.colorA[2],n[56]=this.params.colorB[0],n[57]=this.params.colorB[1],n[58]=this.params.colorB[2],n[60]=this.params.colorC[0],n[61]=this.params.colorC[1],n[62]=this.params.colorC[2],n[64]=this.params.colorD[0],n[65]=this.params.colorD[1],n[66]=this.params.colorD[2],this.device.queue.writeBuffer(this.behaviorUniform,0,s),this.params.connectEnabled){this.device.queue.writeBuffer(this.indirectBuffer,4,new Uint32Array([0]));const Ve=new ArrayBuffer(64),_t=new Float32Array(Ve),Lt=new Uint32Array(Ve);Lt[0]=this.particleCount>>>0,Lt[1]=Math.max(1,Math.min(32,this.params.partnerCount|0)),Lt[2]=fs>>>0,_t[4]=this.params.localRadius,_t[5]=this.params.bridgeRadius,this.device.queue.writeBuffer(this.edgeUniform,0,Ve)}{const Ve=e.beginComputePass();Ve.setPipeline(this.behaviorPipeline),Ve.setBindGroup(0,this.behaviorBindGroup),Ve.dispatchWorkgroups(Math.ceil(this.particleCount/64)),Ve.end()}if(this.params.connectEnabled){const Ve=e.beginComputePass();Ve.setPipeline(this.edgePipeline),Ve.setBindGroup(0,this.edgeBindGroup),Ve.dispatchWorkgroups(Math.ceil(this.particleCount/64)),Ve.end()}const u=this.viewportW/Math.max(1,this.viewportH),f=xu(this.params.fovDeg,u,.05,100),d=wu(0,0,-this.params.cameraZ),h=Math.PI/180,m=(this.params.rotateX+this.autoRotXPhase)*h,b=(this.params.rotateY+this.autoRotYPhase)*h,M=(this.params.rotateZ+this.autoRotZPhase)*h,C=Math.cos(m),T=Math.sin(m),I=Math.cos(b),W=Math.sin(b),G=Math.cos(M),O=Math.sin(M),L=new Float32Array([1,0,0,0,0,C,T,0,0,-T,C,0,0,0,0,1]),N=new Float32Array([I,0,-W,0,0,1,0,0,W,0,I,0,0,0,0,1]),ce=new Float32Array([G,O,0,0,-O,G,0,0,0,0,1,0,0,0,0,1]),ae=Ai(ce,Ai(N,L)),se=Ai(f,Ai(d,ae)),te=[0,0,this.params.cameraZ],Q=this.params.lightX,$=this.params.lightY,j=this.params.lightZ,Ae=Math.sqrt(Q*Q+$*$+j*j)||1,Ce=[Q/Ae,$/Ae,j/Ae],Be=new ArrayBuffer(192),ie=new Float32Array(Be),Pe=new Uint32Array(Be);ie.set(se,0),ie[16]=1,ie[17]=0,ie[18]=0,ie[20]=0,ie[21]=1,ie[22]=0,ie[24]=te[0],ie[25]=te[1],ie[26]=te[2],Pe[27]=ps[this.params.topology]>>>0,ie[28]=this.params.strokeLength,ie[29]=this.params.strokeWidth,ie[30]=this.params.opacity,ie[32]=this.params.fogColor[0],ie[33]=this.params.fogColor[1],ie[34]=this.params.fogColor[2],ie[35]=this.params.fogDensity,ie[36]=Ce[0],ie[37]=Ce[1],ie[38]=Ce[2],ie[39]=this.params.lightStrength,this.device.queue.writeBuffer(this.renderUniform,0,Be);const Ke=new ArrayBuffer(160),K=new Float32Array(Ke);K.set(se,0),K[16]=te[0],K[17]=te[1],K[18]=te[2],K[20]=this.params.colorLocal[0],K[21]=this.params.colorLocal[1],K[22]=this.params.colorLocal[2],K[23]=this.params.alphaLocal,K[24]=this.params.colorBridge[0],K[25]=this.params.colorBridge[1],K[26]=this.params.colorBridge[2],K[27]=this.params.alphaBridge,K[28]=this.params.fogColor[0],K[29]=this.params.fogColor[1],K[30]=this.params.fogColor[2],K[31]=this.params.fogDensity,this.device.queue.writeBuffer(this.lineUniform,0,Ke);const We=new ArrayBuffer(16),pe=new Float32Array(We);pe[0]=this.params.fogColor[0],pe[1]=this.params.fogColor[1],pe[2]=this.params.fogColor[2],pe[3]=this.params.fogOpacity,this.device.queue.writeBuffer(this.fogUniform,0,We);const ze=e.beginRenderPass({colorAttachments:[{view:t,loadOp:"load",storeOp:"store"}]});this.params.fogOpacity>.001&&(ze.setPipeline(this.fogPipeline),ze.setBindGroup(0,this.fogBindGroup),ze.draw(3,1,0,0)),ze.setPipeline(this.renderPipeline),ze.setBindGroup(0,this.renderBindGroup),ze.draw(6,this.particleCount,0,0),this.params.connectEnabled&&(ze.setPipeline(this.linePipeline),ze.setBindGroup(0,this.lineBindGroup),ze.drawIndirect(this.indirectBuffer,0)),ze.end()}dispose(){try{this.particleBuffer?.destroy?.()}catch{}try{this.indirectBuffer?.destroy?.()}catch{}try{this.edgeBuffer?.destroy?.()}catch{}try{this.behaviorUniform?.destroy?.()}catch{}try{this.edgeUniform?.destroy?.()}catch{}try{this.renderUniform?.destroy?.()}catch{}try{this.lineUniform?.destroy?.()}catch{}try{this.fogUniform?.destroy?.()}catch{}try{this.mediaTex?.destroy?.()}catch{}this.particleBuffer=null,this.indirectBuffer=null,this.edgeBuffer=null}}const js=[{kind:"select",key:"mode",label:"Behavior",group:"Mode",options:[{value:"galaxy",label:"Galaxy — spiral arms"},{value:"atomic",label:"Atomic — orbital shells"},{value:"swarm",label:"Swarm — flocking"},{value:"lattice",label:"Lattice — crystalline grid"},{value:"field",label:"Field — curl-noise drift"},{value:"media",label:"Media — image/video driven"}],default:"galaxy"},{kind:"media-source",key:"source",label:"Source",group:"Source",showWhen:{mode:"media"}},{kind:"slider",key:"particleCount",label:"Count",group:"Particles",min:5e3,max:5e5,step:1e3,default:8e4},{kind:"slider",key:"baseSize",label:"Size",group:"Particles",min:.001,max:.04,step:5e-4,default:.006},{kind:"slider",key:"opacity",label:"Opacity",group:"Particles",min:0,max:1,step:.01,default:1},{kind:"select",key:"topology",label:"Topology",group:"Topology",options:[{value:"points",label:"Points — sharp dots"},{value:"glow",label:"Glow — soft halos (stars)"},{value:"streaks",label:"Streaks — velocity trails"},{value:"sphere",label:"Sphere — fake-3D orbs"}],default:"glow"},{kind:"slider",key:"strokeLength",label:"Streak Length",group:"Topology",min:.005,max:.2,step:.001,default:.04,showWhen:{topology:"streaks"}},{kind:"slider",key:"strokeWidth",label:"Streak Width",group:"Topology",min:5e-4,max:.03,step:5e-4,default:.004,showWhen:{topology:"streaks"}},{kind:"slider",key:"galaxyArms",label:"Arms",group:"Galaxy Mode",min:1,max:8,step:1,default:4,showWhen:{mode:"galaxy"}},{kind:"slider",key:"galaxyRotateInner",label:"Inner Rotation",group:"Galaxy Mode",min:0,max:3,step:.01,default:1.2,showWhen:{mode:"galaxy"}},{kind:"slider",key:"galaxyRotateOuter",label:"Outer Rotation",group:"Galaxy Mode",min:0,max:3,step:.01,default:.3,showWhen:{mode:"galaxy"}},{kind:"slider",key:"galaxyTilt",label:"Tilt",group:"Galaxy Mode",min:-.5,max:.5,step:.01,default:.1,showWhen:{mode:"galaxy"}},{kind:"slider",key:"atomicNuclei",label:"Nuclei Count",group:"Atomic Mode",min:1,max:12,step:1,default:5,showWhen:{mode:"atomic"}},{kind:"slider",key:"atomicShells",label:"Shells per Nucleus",group:"Atomic Mode",min:1,max:6,step:1,default:3,showWhen:{mode:"atomic"}},{kind:"slider",key:"atomicShellSpacing",label:"Shell Spacing",group:"Atomic Mode",min:.05,max:.4,step:.005,default:.18,showWhen:{mode:"atomic"}},{kind:"slider",key:"atomicOrbitSpeed",label:"Orbit Speed",group:"Atomic Mode",min:0,max:3,step:.01,default:.8,showWhen:{mode:"atomic"}},{kind:"slider",key:"swarmCohesion",label:"Cohesion",group:"Swarm Mode",min:0,max:3,step:.01,default:.6,showWhen:{mode:"swarm"}},{kind:"slider",key:"swarmSeparation",label:"Separation",group:"Swarm Mode",min:0,max:1,step:.005,default:.05,showWhen:{mode:"swarm"}},{kind:"slider",key:"swarmAlignment",label:"Alignment",group:"Swarm Mode",min:0,max:3,step:.01,default:.8,showWhen:{mode:"swarm"}},{kind:"slider",key:"swarmRange",label:"Flow Scale",group:"Swarm Mode",min:.2,max:5,step:.05,default:1.5,showWhen:{mode:"swarm"}},{kind:"slider",key:"latticeSize",label:"Grid Size",group:"Lattice Mode",min:4,max:32,step:1,default:16,showWhen:{mode:"lattice"}},{kind:"slider",key:"latticeSpacing",label:"Spacing",group:"Lattice Mode",min:.5,max:3,step:.01,default:1.6,showWhen:{mode:"lattice"}},{kind:"slider",key:"latticeVibration",label:"Vibration",group:"Lattice Mode",min:0,max:.2,step:.001,default:.015,showWhen:{mode:"lattice"}},{kind:"slider",key:"windStrength",label:"Wind",group:"Field Mode",min:0,max:1,step:.005,default:.2,showWhen:{mode:"field"}},{kind:"slider",key:"windScale",label:"Wind Scale",group:"Field Mode",min:.5,max:8,step:.05,default:2,showWhen:{mode:"field"}},{kind:"slider",key:"mediaDepthAmount",label:"Depth From Luma",group:"Media Mode",min:0,max:2,step:.01,default:.6,showWhen:{mode:"media"}},{kind:"slider",key:"mediaSampleScale",label:"Sample Scale",group:"Media Mode",min:.1,max:4,step:.01,default:1,showWhen:{mode:"media"}},{kind:"toggle",key:"connectEnabled",label:"Enable Connections",group:"Connections",default:!0},{kind:"slider",key:"partnerCount",label:"Partners per Particle",group:"Connections",min:4,max:32,step:1,default:12,showWhen:{connectEnabled:!0}},{kind:"slider",key:"localRadius",label:"Local Radius",group:"Connections",min:.01,max:.5,step:.005,default:.12,showWhen:{connectEnabled:!0}},{kind:"slider",key:"bridgeRadius",label:"Bridge Radius",group:"Connections",min:.05,max:1.5,step:.01,default:.4,showWhen:{connectEnabled:!0}},{kind:"color",key:"colorLocal",label:"Local Color",group:"Connections",default:[100,255,255],showWhen:{connectEnabled:!0}},{kind:"color",key:"colorBridge",label:"Bridge Color",group:"Connections",default:[240,80,200],showWhen:{connectEnabled:!0}},{kind:"slider",key:"alphaLocal",label:"Local Alpha",group:"Connections",min:0,max:1,step:.01,default:.35,showWhen:{connectEnabled:!0}},{kind:"slider",key:"alphaBridge",label:"Bridge Alpha",group:"Connections",min:0,max:1,step:.01,default:.12,showWhen:{connectEnabled:!0}},{kind:"slider",key:"fogDensity",label:"Fog Density (depth fade)",group:"Atmosphere",min:0,max:3,step:.01,default:.6},{kind:"slider",key:"fogOpacity",label:"Fog Opacity (background)",group:"Atmosphere",min:0,max:1,step:.01,default:.85},{kind:"color",key:"fogColor",label:"Fog Color",group:"Atmosphere",default:[5,5,15]},{kind:"slider",key:"lightX",label:"Light X",group:"Atmosphere",min:-2,max:2,step:.01,default:.4},{kind:"slider",key:"lightY",label:"Light Y",group:"Atmosphere",min:-2,max:2,step:.01,default:.6},{kind:"slider",key:"lightZ",label:"Light Z",group:"Atmosphere",min:-2,max:2,step:.01,default:.7},{kind:"slider",key:"lightStrength",label:"Light Strength",group:"Atmosphere",min:0,max:1,step:.01,default:.6},{kind:"toggle",key:"audioReactive",label:"Audio Reactive",group:"Audio",default:!0},{kind:"slider",key:"burstGain",label:"Bass Burst Gain",group:"Audio",min:0,max:3,step:.05,default:.6},{kind:"slider",key:"burstDecay",label:"Bass Burst Decay",group:"Audio",min:.5,max:8,step:.1,default:2.5},{kind:"slider",key:"shimmerStrength",label:"Treble Shimmer",group:"Audio",min:0,max:.2,step:.001,default:.02},{kind:"slider",key:"damping",label:"Damping",group:"Motion",min:0,max:3,step:.01,default:1},{kind:"select",key:"colorMode",label:"Color Mode",group:"Color Mode",options:[{value:"solid",label:"Solid"},{value:"gradient2",label:"2-Stop Gradient"},{value:"gradient3",label:"3-Stop Gradient"},{value:"palette4",label:"4-Color Palette"},{value:"rainbow",label:"Rainbow Cycle"},{value:"random",label:"Random per Particle"},{value:"group",label:"Group Color (one per cluster)"}],default:"palette4"},{kind:"select",key:"colorMap",label:"Mapping",group:"Color Mode",options:[{value:"index",label:"Particle Index"},{value:"group",label:"Cluster / Group"},{value:"radial",label:"Radial Distance"},{value:"y-axis",label:"Y Height"},{value:"speed",label:"Velocity Magnitude"},{value:"depth-z",label:"Depth (World Z)"},{value:"noise",label:"Noise — Organic Patches"}],default:"radial"},{kind:"slider",key:"colorMix",label:"Mix",group:"Color Mode",min:0,max:1,step:.01,default:1},{kind:"slider",key:"colorMapScale",label:"Map Range",group:"Color Mode",min:.1,max:5,step:.05,default:1},{kind:"slider",key:"colorMapOffset",label:"Map Offset",group:"Color Mode",min:-1,max:1,step:.01,default:0},{kind:"slider",key:"colorCycleSpeed",label:"Cycle Speed",group:"Color Mode",min:-2,max:2,step:.01,default:.05},{kind:"color",key:"colorA",label:"Color A",group:"Color Stops",default:[45,105,255]},{kind:"color",key:"colorB",label:"Color B",group:"Color Stops",default:[245,70,165]},{kind:"color",key:"colorC",label:"Color C",group:"Color Stops",default:[255,200,50]},{kind:"color",key:"colorD",label:"Color D",group:"Color Stops",default:[50,245,215]},{kind:"slider",key:"randomSat",label:"Random Sat",group:"Random Hue",min:0,max:1,step:.01,default:.85,showWhen:{colorMode:"random"}},{kind:"slider",key:"randomVal",label:"Random Brightness",group:"Random Hue",min:.1,max:2,step:.01,default:1,showWhen:{colorMode:"random"}},{kind:"slider",key:"hueShiftSpeed",label:"Hue Shift Speed",group:"Color Adjust",min:-1,max:1,step:.005,default:.02},{kind:"slider",key:"saturation",label:"Saturation",group:"Color Adjust",min:0,max:2,step:.01,default:1.1},{kind:"slider",key:"brightness",label:"Brightness",group:"Color Adjust",min:.1,max:3,step:.01,default:1.1},{kind:"angle",key:"rotateX",label:"Rotate X",group:"Object Rotation",default:0},{kind:"angle",key:"rotateY",label:"Rotate Y",group:"Object Rotation",default:0},{kind:"angle",key:"rotateZ",label:"Rotate Z",group:"Object Rotation",default:0},{kind:"slider",key:"autoRotateX",label:"Auto-Spin X",group:"Object Rotation",min:-180,max:180,step:.5,default:0},{kind:"slider",key:"autoRotateY",label:"Auto-Spin Y",group:"Object Rotation",min:-180,max:180,step:.5,default:6},{kind:"slider",key:"autoRotateZ",label:"Auto-Spin Z",group:"Object Rotation",min:-180,max:180,step:.5,default:0},{kind:"slider",key:"fovDeg",label:"FOV",group:"Camera",min:20,max:100,step:1,default:50},{kind:"slider",key:"cameraZ",label:"Distance",group:"Camera",min:.5,max:8,step:.05,default:2.4}],No=ua(js);class Au{inner;bands=null;lastParams={...No};constructor(e,t){this.inner=new Ru(e,t)}setBands(e,t,a){this.bands={bass:e,mid:t,treble:a},this.applyParamsToInner()}setParams(e){this.lastParams={...No,...e},this.applyParamsToInner()}rgb01(e,t){return!Array.isArray(e)||e.length<3?t:[Math.max(0,Math.min(1,(e[0]??0)/255)),Math.max(0,Math.min(1,(e[1]??0)/255)),Math.max(0,Math.min(1,(e[2]??0)/255))]}applyParamsToInner(){const e=this.lastParams,t=!!e.audioReactive&&this.bands,a=t?this.bands.bass:0,o=t?this.bands.treble:0;this.inner.setParams({mode:e.mode??"galaxy",particleCount:Math.round(e.particleCount??8e4),baseSize:e.baseSize??.006,opacity:e.opacity??1,windStrength:e.windStrength??.2,windScale:e.windScale??2,anchorPull:e.anchorPull??0,damping:e.damping??1,bass:a,treble:o,shimmerStrength:e.shimmerStrength??.02,burstGain:e.burstGain??.6,burstDecay:e.burstDecay??2.5,galaxyArms:e.galaxyArms??4,galaxyRotateInner:e.galaxyRotateInner??1.2,galaxyRotateOuter:e.galaxyRotateOuter??.3,galaxyTilt:e.galaxyTilt??.1,atomicNuclei:e.atomicNuclei??5,atomicShells:e.atomicShells??3,atomicShellSpacing:e.atomicShellSpacing??.18,atomicOrbitSpeed:e.atomicOrbitSpeed??.8,swarmCohesion:e.swarmCohesion??.6,swarmSeparation:e.swarmSeparation??.05,swarmAlignment:e.swarmAlignment??.8,swarmRange:e.swarmRange??1.5,latticeSize:e.latticeSize??16,latticeSpacing:e.latticeSpacing??1.6,latticeVibration:e.latticeVibration??.015,mediaDepthAmount:e.mediaDepthAmount??.6,mediaSampleScale:e.mediaSampleScale??1,topology:e.topology??"glow",strokeLength:e.strokeLength??.04,strokeWidth:e.strokeWidth??.004,colorMode:e.colorMode??"palette4",colorMap:e.colorMap??"radial",colorMix:e.colorMix??1,colorMapScale:e.colorMapScale??1,colorMapOffset:e.colorMapOffset??0,colorCycleSpeed:e.colorCycleSpeed??.05,randomSat:e.randomSat??.85,randomVal:e.randomVal??1,hueShiftSpeed:e.hueShiftSpeed??.02,saturation:e.saturation??1.1,brightness:e.brightness??1.1,colorA:this.rgb01(e.colorA,[.18,.42,1]),colorB:this.rgb01(e.colorB,[.95,.28,.65]),colorC:this.rgb01(e.colorC,[1,.78,.2]),colorD:this.rgb01(e.colorD,[.2,.95,.85]),connectEnabled:!!e.connectEnabled,partnerCount:Math.max(1,Math.min(32,Math.round(e.partnerCount??12))),localRadius:e.localRadius??.12,bridgeRadius:e.bridgeRadius??.4,colorLocal:this.rgb01(e.colorLocal,[.4,1,1]),colorBridge:this.rgb01(e.colorBridge,[.95,.3,.8]),alphaLocal:e.alphaLocal??.35,alphaBridge:e.alphaBridge??.12,fogDensity:e.fogDensity??.6,fogOpacity:e.fogOpacity??.85,fogColor:this.rgb01(e.fogColor,[.02,.02,.06]),lightX:e.lightX??.4,lightY:e.lightY??.6,lightZ:e.lightZ??.7,lightStrength:e.lightStrength??.6,fovDeg:e.fovDeg??50,cameraZ:e.cameraZ??2.4,rotateX:e.rotateX??0,rotateY:e.rotateY??0,rotateZ:e.rotateZ??0,autoRotateX:e.autoRotateX??0,autoRotateY:e.autoRotateY??6,autoRotateZ:e.autoRotateZ??0})}setSource(e){e instanceof HTMLVideoElement?this.inner.updateSourceFromVideo(e):e instanceof HTMLCanvasElement?this.inner.updateSourceFromCanvas(e):this.inner.setSourceImage(e)}encodeFrame(e,t,a,o,r,s){this.inner.setViewport(o,r),e.beginRenderPass({colorAttachments:[{view:t,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]}).end(),this.inner.encodeFrame(e,t)}resize(e,t){}dispose(){try{this.inner.dispose()}catch{}}}const ms=64,Xs=15e4,Bu=6e5,na=8;function Bi(i,e){const t=new Float32Array(16);for(let a=0;a<4;a++)for(let o=0;o<4;o++){let r=0;for(let s=0;s<4;s++)r+=i[s*4+o]*e[a*4+s];t[a*4+o]=r}return t}function Eu(){const i=new Float32Array(16);return i[0]=i[5]=i[10]=i[15]=1,i}function Fu(i,e,t,a){const o=1/Math.tan(i*Math.PI/180/2),r=new Float32Array(16);return r[0]=o/e,r[5]=o,r[10]=a/(t-a),r[11]=-1,r[14]=t*a/(t-a),r}function Lu(i,e,t){const a=Eu();return a[12]=i,a[13]=e,a[14]=t,a}const Du=`
struct Particle {
  pos:      vec3<f32>, age:      f32,
  vel:      vec3<f32>, lifetime: f32,
  color:    vec3<f32>, size:     f32,
  home:     vec3<f32>, emitter:  u32,
};

struct Emitter {
  pos:   vec3<f32>, _p0: f32,
  color: vec3<f32>, _p1: f32,
};

struct U {
  // Block 0 — timing
  dt: f32, time: f32, particleCount: u32, emitterCount: u32,
  // Block 1 — lifetime
  avgLifetime: f32, lifetimeVar: f32, sizeStart: f32, sizeEnd: f32,
  // Block 2 — color evolution
  fadeColor: vec3<f32>, colorFadeAmount: f32,
  // Block 3 — forces
  buoyancy: f32, damping: f32, spawnJitter: f32, audioBurst: f32,
  // Block 4 — wind
  wind: vec3<f32>, _p2: f32,
  // Block 5 — curl octave 1
  curl1Strength: f32, curl1Scale: f32, curl1TimeFlow: f32, _p3: f32,
  // Block 6 — curl octave 2
  curl2Strength: f32, curl2Scale: f32, curl2TimeFlow: f32, _p4: f32,
  // Block 7 — vortex
  vortexCenter: vec3<f32>, vortexStrength: f32,
  vortexAxis:   vec3<f32>, vortexRadius:   f32,
  // Block 8 — audio
  bass: f32, treble: f32, shimmerStrength: f32, _p5: f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform>             u:         U;
// Up to MAX_EMITTERS emitter records. We size the array generously
// in WGSL but only the first u.emitterCount entries are actually
// populated on the CPU side.
@group(0) @binding(2) var<storage, read>       emitters:  array<Emitter, ${na}>;

fn hash3(p: vec3<f32>) -> f32 {
  let q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7,  74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6)),
  );
  return fract(sin(q.x + q.y + q.z) * 43758.5453);
}
fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, s.x);
  let nx10 = mix(n010, n110, s.x);
  let nx01 = mix(n001, n101, s.x);
  let nx11 = mix(n011, n111, s.x);
  let nxy0 = mix(nx00, nx10, s.y);
  let nxy1 = mix(nx01, nx11, s.y);
  return mix(nxy0, nxy1, s.z) * 2.0 - 1.0;
}
fn curl(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let ax1 = noise3(p + vec3<f32>(0.0,  e, 0.0));
  let ax2 = noise3(p + vec3<f32>(0.0, -e, 0.0));
  let ay1 = noise3(p + vec3<f32>(0.0, 0.0,  e) + vec3<f32>(31.0, 0.0, 0.0));
  let ay2 = noise3(p + vec3<f32>(0.0, 0.0, -e) + vec3<f32>(31.0, 0.0, 0.0));
  let az1 = noise3(p + vec3<f32>( e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let az2 = noise3(p + vec3<f32>(-e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  return vec3<f32>(ay1 - ay2, az1 - az2, ax1 - ax2) / (2.0 * e);
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.particleCount) { return; }
  var p = particles[i];

  // ── Lifecycle / respawn ────────────────────────────────────────
  // Audio burst can artificially "kill" a chunk of particles by
  // forcing their age past lifetime. The chunk is hashed by particle
  // id so each bass hit refreshes a different subset, giving the
  // visible burst effect rather than a synchronized reset.
  let burstTrigger = u.audioBurst > 0.5 && hash3(vec3<f32>(f32(i) * 0.027, u.time, 1.0)) < u.audioBurst;

  if (p.age >= p.lifetime || burstTrigger) {
    // Respawn at the assigned emitter's position with a small jitter
    // so the spawn region has volume rather than a single point.
    let em = emitters[p.emitter];
    let r1 = (hash3(vec3<f32>(f32(i) * 0.13, u.time, 0.0)) - 0.5) * 2.0;
    let r2 = (hash3(vec3<f32>(f32(i) * 0.13, u.time, 1.0)) - 0.5) * 2.0;
    let r3 = (hash3(vec3<f32>(f32(i) * 0.13, u.time, 2.0)) - 0.5) * 2.0;
    p.pos      = em.pos + vec3<f32>(r1, r2, r3) * u.spawnJitter;
    p.home     = em.pos;
    p.color    = em.color;
    p.vel      = vec3<f32>(0.0, 0.0, 0.0);
    p.age      = 0.0;
    // Per-particle lifetime variance so dispersal isn't synchronized.
    let r4 = hash3(vec3<f32>(f32(i) * 0.077, u.time, 5.0)) * 2.0 - 1.0;
    p.lifetime = u.avgLifetime * (1.0 + r4 * u.lifetimeVar);
    p.size     = u.sizeStart;
  }

  // ── Forces ─────────────────────────────────────────────────────
  // Buoyancy — constant upward force; smoke rises.
  var force = vec3<f32>(0.0, u.buoyancy, 0.0);
  // Wind — directional force (user-controllable).
  force = force + u.wind;
  // Curl noise octave 1 — primary swirl.
  let p1 = p.pos * u.curl1Scale + vec3<f32>(0.0, 0.0, u.time * u.curl1TimeFlow);
  force = force + curl(p1) * u.curl1Strength;
  // Curl noise octave 2 — fine wispy detail at higher frequency.
  let p2 = p.pos * u.curl2Scale + vec3<f32>(11.0, 0.0, u.time * u.curl2TimeFlow);
  force = force + curl(p2) * u.curl2Strength;
  // Vortex — rotational pull around a moving center, in a plane
  // perpendicular to vortexAxis. Strength tapers smoothly with
  // distance from the axis line so the swirl has a soft falloff.
  if (u.vortexStrength > 0.001) {
    let toCenter = p.pos - u.vortexCenter;
    let axisN    = normalize(u.vortexAxis);
    let proj     = dot(toCenter, axisN) * axisN;
    let radial   = toCenter - proj;
    let rLen     = length(radial);
    if (rLen > 1e-4) {
      let tangent = normalize(cross(axisN, radial));
      let falloff = exp(-rLen * rLen / max(u.vortexRadius * u.vortexRadius, 1e-4));
      force = force + tangent * u.vortexStrength * falloff;
    }
  }
  // Treble shimmer — small per-particle noise added to velocity.
  let jx = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 0.0)) - 0.5) * 2.0;
  let jy = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 1.0)) - 0.5) * 2.0;
  let jz = (hash3(vec3<f32>(f32(i) * 0.13, u.time * 17.0, 2.0)) - 0.5) * 2.0;
  force = force + vec3<f32>(jx, jy, jz) * u.shimmerStrength * u.treble;

  // Integrate.
  p.vel = p.vel + force * u.dt;
  p.vel = p.vel * (1.0 - u.damping * u.dt);
  p.pos = p.pos + p.vel * u.dt;
  p.age = p.age + u.dt;

  // ── Visual evolution over life ──────────────────────────────────
  // Normalized life 0..1. Used to grow size and decay color/alpha.
  let lifeT = clamp(p.age / max(p.lifetime, 0.001), 0.0, 1.0);
  // Size: linear interpolation from sizeStart to sizeEnd. Particles
  // typically grow as they age (smoke disperses outward).
  p.size = mix(u.sizeStart, u.sizeEnd, lifeT);
  // Color: blend toward the user-set fade color over life. With fade
  // = dark, particles dim into the background as they die. With
  // fade = white, they brighten before vanishing (softer ending).
  let evolvedColor = mix(emitters[p.emitter].color, u.fadeColor, lifeT * u.colorFadeAmount);
  p.color = evolvedColor;

  particles[i] = p;
}
`,zu=`
struct Particle {
  pos:      vec3<f32>, age:      f32,
  vel:      vec3<f32>, lifetime: f32,
  color:    vec3<f32>, size:     f32,
  home:     vec3<f32>, emitter:  u32,
};

struct UR {
  viewProj:    mat4x4<f32>,
  camRight:    vec3<f32>,
  _p0:         f32,
  camUp:       vec3<f32>,
  _p1:         f32,
  // particle render params
  brightness:  f32,
  alphaScale:  f32,
  density:     f32,        // soft-edge falloff exponent in fragment
  _p2:         f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform>       u:         UR;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv:        vec2<f32>,
  @location(1) color:     vec3<f32>,
  @location(2) alpha:     f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let p = particles[iid];

  let xy = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
  );
  let q = xy[vid];
  let offset = u.camRight * (q.x * p.size) + u.camUp * (q.y * p.size);
  let worldPos = p.pos + offset;

  // Alpha: fade in from spawn (first 10% of life) + fade out near
  // death (last 30% of life). Without the spawn fade-in, particles
  // pop in at their full alpha which looks discrete; the smooth
  // ramp makes the emission look continuous and dust-like.
  let lifeT = clamp(p.age / max(p.lifetime, 0.001), 0.0, 1.0);
  let fadeIn  = smoothstep(0.0, 0.1, lifeT);
  let fadeOut = 1.0 - smoothstep(0.7, 1.0, lifeT);
  let lifeAlpha = fadeIn * fadeOut;

  var out: VSOut;
  out.pos   = u.viewProj * vec4<f32>(worldPos, 1.0);
  out.uv    = q;                                 // -1..1 for radial fragment shader
  out.color = p.color * u.brightness;
  out.alpha = lifeAlpha * u.alphaScale;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let d = length(in.uv);
  if (d > 1.0) { discard; }
  // Soft exponential disc — the high overlap of premultiplied-alpha
  // discs gives the volumetric density. u.density exponent shapes
  // the edge softness: low = fluffy halos, high = sharper puffs.
  let mask = exp(-d * d * u.density);
  let a = in.alpha * mask;
  // Premultiplied output — composites cleanly with the bg fill +
  // other particles in the same render pass.
  return vec4<f32>(in.color * a, a);
}
`,Iu=`
struct UB { color: vec3<f32>, opacity: f32, };
@group(0) @binding(0) var<uniform> u: UB;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  return vec4<f32>(positions[vid], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  let a = u.opacity;
  return vec4<f32>(u.color * a, a);
}
`,Uu={particleCount:Xs,emitterCount:4,spread:.4,spawnY:-.4,spawnJitter:.04,avgLifetime:3,lifetimeVar:.3,sizeStart:.008,sizeEnd:.05,fadeColor:[.04,.05,.1],colorFadeAmount:1,buoyancy:.18,damping:.6,windX:0,windY:0,windZ:0,curl1Strength:.3,curl1Scale:1.6,curl1TimeFlow:.15,curl2Strength:.18,curl2Scale:5,curl2TimeFlow:.4,vortexEnabled:!1,vortexStrength:.6,vortexRadius:.5,vortexAxisX:0,vortexAxisY:1,vortexAxisZ:0,bass:0,treble:0,audioBurstStrength:.3,shimmerStrength:.04,brightness:1.2,alphaScale:.55,density:2.5,bgColor:[.04,.04,.08],bgOpacity:1,emitterColors:[[1,.4,.18],[.18,.78,1],[.85,.2,.85],[.2,.95,.55],[1,.85,.3],[.5,.3,1],[1,.3,.55],[.3,1,.95]],fovDeg:50,cameraZ:2.4,rotateX:0,rotateY:0,rotateZ:0,autoRotateX:0,autoRotateY:0,autoRotateZ:0},vs={color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}};class Gu{device;presentFormat;particleBuffer=null;simUniform;renderUniform;bgUniform;emitterBuffer;bgPipeline;bgLayout;bgBindGroup=null;simPipeline;simLayout;simBindGroup=null;renderPipeline;renderLayout;renderBindGroup=null;params={...Uu};particleCount=Xs;viewportW=1920;viewportH=1080;prevFrameTime=0;autoRotXPhase=0;autoRotYPhase=0;autoRotZPhase=0;burstHoldTimer=0;prevBass=0;constructor(e,t){this.device=e,this.presentFormat=t,this.init()}init(){this.simUniform=this.device.createBuffer({size:192,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.renderUniform=this.device.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.bgUniform=this.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.emitterBuffer=this.device.createBuffer({size:na*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.allocateParticleBuffer(this.particleCount),this.buildPipelines(),this.rebuildBindGroups(),this.writeEmitterBuffer()}allocateParticleBuffer(e){if(e=Math.max(1024,Math.min(Bu,Math.floor(e))),this.particleBuffer)try{this.particleBuffer.destroy?.()}catch{}this.particleBuffer=this.device.createBuffer({size:e*ms,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.particleCount=e,this.seedParticles(),this.simLayout&&this.rebuildBindGroups()}seedParticles(){const e=this.particleCount,t=new ArrayBuffer(e*ms),a=new Float32Array(t),o=new Uint32Array(t),r=Math.max(1,Math.min(na,this.params.emitterCount|0));for(let s=0;s<e;s++){const n=s*16,l=Math.random()*this.params.avgLifetime,u=this.params.avgLifetime;a[n+0]=0,a[n+1]=0,a[n+2]=0,a[n+3]=l,a[n+4]=0,a[n+5]=0,a[n+6]=0,a[n+7]=u,a[n+8]=0,a[n+9]=0,a[n+10]=0,a[n+11]=this.params.sizeStart,a[n+12]=0,a[n+13]=0,a[n+14]=0,o[n+15]=s%r>>>0}this.device.queue.writeBuffer(this.particleBuffer,0,t)}writeEmitterBuffer(){const e=new ArrayBuffer(na*32),t=new Float32Array(e),a=Math.max(1,Math.min(na,this.params.emitterCount|0));for(let o=0;o<na;o++){const r=o*8,s=a>1?o/a*Math.PI*2:0;t[r+0]=Math.cos(s)*this.params.spread,t[r+1]=this.params.spawnY,t[r+2]=Math.sin(s)*this.params.spread;const n=this.params.emitterColors[o%this.params.emitterColors.length]??[1,1,1];t[r+4]=n[0],t[r+5]=n[1],t[r+6]=n[2]}this.device.queue.writeBuffer(this.emitterBuffer,0,e)}buildPipelines(){const e=this.device.createShaderModule({code:Iu});this.bgLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),this.bgPipeline=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.bgLayout]}),vertex:{module:e,entryPoint:"vs_main"},fragment:{module:e,entryPoint:"fs_main",targets:[{format:this.presentFormat,blend:vs}]},primitive:{topology:"triangle-list"}});const t=this.device.createShaderModule({code:Du});this.simLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}}]}),this.simPipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.simLayout]}),compute:{module:t,entryPoint:"cs_main"}});const a=this.device.createShaderModule({code:zu});this.renderLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),this.renderPipeline=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.renderLayout]}),vertex:{module:a,entryPoint:"vs_main"},fragment:{module:a,entryPoint:"fs_main",targets:[{format:this.presentFormat,blend:vs}]},primitive:{topology:"triangle-list"}})}rebuildBindGroups(){this.bgBindGroup=this.device.createBindGroup({layout:this.bgLayout,entries:[{binding:0,resource:{buffer:this.bgUniform}}]}),this.simBindGroup=this.device.createBindGroup({layout:this.simLayout,entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.simUniform}},{binding:2,resource:{buffer:this.emitterBuffer}}]}),this.renderBindGroup=this.device.createBindGroup({layout:this.renderLayout,entries:[{binding:0,resource:{buffer:this.particleBuffer}},{binding:1,resource:{buffer:this.renderUniform}}]})}setParams(e){const t=this.params.particleCount,a=this.params.emitterCount,o=this.params.spread,r=this.params.spawnY,s=this.params.emitterColors;this.params={...this.params,...e},this.params.particleCount!==t&&this.allocateParticleBuffer(this.params.particleCount);const n=s!==this.params.emitterColors;(this.params.emitterCount!==a||this.params.spread!==o||this.params.spawnY!==r||n)&&this.writeEmitterBuffer()}setViewport(e,t){this.viewportW=e,this.viewportH=t}encodeFrame(e,t){const a=performance.now()/1e3;let o=this.prevFrameTime===0?1/60:a-this.prevFrameTime;o=Math.min(Math.max(o,.001),1/15),this.prevFrameTime=a,Math.max(0,this.params.bass-this.prevBass)>.05&&(this.burstHoldTimer=Math.max(this.burstHoldTimer,.15)),this.burstHoldTimer=Math.max(0,this.burstHoldTimer-o),this.prevBass=this.params.bass;const s=this.burstHoldTimer>0?this.params.audioBurstStrength:0;this.autoRotXPhase+=this.params.autoRotateX*o,this.autoRotYPhase+=this.params.autoRotateY*o,this.autoRotZPhase+=this.params.autoRotateZ*o;const n=new ArrayBuffer(192),l=new Float32Array(n),u=new Uint32Array(n);l[0]=o,l[1]=a,u[2]=this.particleCount>>>0,u[3]=Math.max(1,Math.min(na,this.params.emitterCount|0))>>>0,l[4]=this.params.avgLifetime,l[5]=this.params.lifetimeVar,l[6]=this.params.sizeStart,l[7]=this.params.sizeEnd,l[8]=this.params.fadeColor[0],l[9]=this.params.fadeColor[1],l[10]=this.params.fadeColor[2],l[11]=this.params.colorFadeAmount,l[12]=this.params.buoyancy,l[13]=this.params.damping,l[14]=this.params.spawnJitter,l[15]=s,l[16]=this.params.windX,l[17]=this.params.windY,l[18]=this.params.windZ,l[20]=this.params.curl1Strength,l[21]=this.params.curl1Scale,l[22]=this.params.curl1TimeFlow,l[24]=this.params.curl2Strength,l[25]=this.params.curl2Scale,l[26]=this.params.curl2TimeFlow;const f=this.params.vortexEnabled?1:0;l[28]=0,l[29]=0,l[30]=0,l[31]=this.params.vortexStrength*f,l[32]=this.params.vortexAxisX,l[33]=this.params.vortexAxisY,l[34]=this.params.vortexAxisZ,l[35]=this.params.vortexRadius,l[36]=this.params.bass,l[37]=this.params.treble,l[38]=this.params.shimmerStrength,this.device.queue.writeBuffer(this.simUniform,0,n);{const ie=e.beginComputePass();ie.setPipeline(this.simPipeline),ie.setBindGroup(0,this.simBindGroup),ie.dispatchWorkgroups(Math.ceil(this.particleCount/64)),ie.end()}const d=this.viewportW/Math.max(1,this.viewportH),h=Fu(this.params.fovDeg,d,.05,100),m=Lu(0,0,-this.params.cameraZ),b=Math.PI/180,M=(this.params.rotateX+this.autoRotXPhase)*b,C=(this.params.rotateY+this.autoRotYPhase)*b,T=(this.params.rotateZ+this.autoRotZPhase)*b,I=Math.cos(M),W=Math.sin(M),G=Math.cos(C),O=Math.sin(C),L=Math.cos(T),N=Math.sin(T),ce=new Float32Array([1,0,0,0,0,I,W,0,0,-W,I,0,0,0,0,1]),ae=new Float32Array([G,0,-O,0,0,1,0,0,O,0,G,0,0,0,0,1]),se=new Float32Array([L,N,0,0,-N,L,0,0,0,0,1,0,0,0,0,1]),te=Bi(se,Bi(ae,ce)),Q=Bi(h,Bi(m,te)),$=new ArrayBuffer(128),j=new Float32Array($);j.set(Q,0),j[16]=1,j[17]=0,j[18]=0,j[20]=0,j[21]=1,j[22]=0,j[24]=this.params.brightness,j[25]=this.params.alphaScale,j[26]=this.params.density,this.device.queue.writeBuffer(this.renderUniform,0,$);const Ae=new ArrayBuffer(16),Ce=new Float32Array(Ae);Ce[0]=this.params.bgColor[0],Ce[1]=this.params.bgColor[1],Ce[2]=this.params.bgColor[2],Ce[3]=this.params.bgOpacity,this.device.queue.writeBuffer(this.bgUniform,0,Ae);const Be=e.beginRenderPass({colorAttachments:[{view:t,loadOp:"load",storeOp:"store"}]});this.params.bgOpacity>.001&&(Be.setPipeline(this.bgPipeline),Be.setBindGroup(0,this.bgBindGroup),Be.draw(3,1,0,0)),Be.setPipeline(this.renderPipeline),Be.setBindGroup(0,this.renderBindGroup),Be.draw(6,this.particleCount,0,0),Be.end()}dispose(){try{this.particleBuffer?.destroy?.()}catch{}try{this.simUniform?.destroy?.()}catch{}try{this.renderUniform?.destroy?.()}catch{}try{this.bgUniform?.destroy?.()}catch{}try{this.emitterBuffer?.destroy?.()}catch{}this.particleBuffer=null}}const $s=[{kind:"slider",key:"emitterCount",label:"Emitter Count",group:"Emitters",min:1,max:8,step:1,default:4},{kind:"slider",key:"spread",label:"Spread (orbital radius)",group:"Emitters",min:0,max:1.5,step:.01,default:.4},{kind:"slider",key:"spawnY",label:"Spawn Y",group:"Emitters",min:-1.5,max:1.5,step:.01,default:-.4},{kind:"slider",key:"spawnJitter",label:"Spawn Jitter",group:"Emitters",min:0,max:.5,step:.005,default:.04},{kind:"color",key:"emitterColor1",label:"Color 1",group:"Emitter Colors",default:[255,100,45]},{kind:"color",key:"emitterColor2",label:"Color 2",group:"Emitter Colors",default:[45,200,255]},{kind:"color",key:"emitterColor3",label:"Color 3",group:"Emitter Colors",default:[220,50,220]},{kind:"color",key:"emitterColor4",label:"Color 4",group:"Emitter Colors",default:[50,245,140]},{kind:"color",key:"emitterColor5",label:"Color 5",group:"Emitter Colors",default:[255,215,75]},{kind:"color",key:"emitterColor6",label:"Color 6",group:"Emitter Colors",default:[130,75,255]},{kind:"color",key:"emitterColor7",label:"Color 7",group:"Emitter Colors",default:[255,75,140]},{kind:"color",key:"emitterColor8",label:"Color 8",group:"Emitter Colors",default:[75,255,240]},{kind:"slider",key:"particleCount",label:"Count",group:"Particles",min:1e4,max:6e5,step:5e3,default:15e4},{kind:"slider",key:"avgLifetime",label:"Lifetime (s)",group:"Particles",min:.5,max:10,step:.05,default:3},{kind:"slider",key:"lifetimeVar",label:"Lifetime Variation",group:"Particles",min:0,max:1,step:.01,default:.3},{kind:"slider",key:"sizeStart",label:"Size at Spawn",group:"Particles",min:.001,max:.05,step:5e-4,default:.008},{kind:"slider",key:"sizeEnd",label:"Size at Death",group:"Particles",min:.005,max:.2,step:.001,default:.05},{kind:"slider",key:"colorFadeAmount",label:"Fade Strength",group:"Color Evolution",min:0,max:1,step:.01,default:1},{kind:"color",key:"fadeColor",label:"Fade-to Color",group:"Color Evolution",default:[10,12,26]},{kind:"slider",key:"buoyancy",label:"Buoyancy (up)",group:"Motion",min:-.5,max:1,step:.01,default:.18},{kind:"slider",key:"damping",label:"Damping",group:"Motion",min:0,max:3,step:.01,default:.6},{kind:"slider",key:"windX",label:"Wind X",group:"Motion",min:-1,max:1,step:.01,default:0},{kind:"slider",key:"windY",label:"Wind Y",group:"Motion",min:-1,max:1,step:.01,default:0},{kind:"slider",key:"windZ",label:"Wind Z",group:"Motion",min:-1,max:1,step:.01,default:0},{kind:"slider",key:"curl1Strength",label:"Octave 1 Strength",group:"Curl Noise",min:0,max:2,step:.01,default:.3},{kind:"slider",key:"curl1Scale",label:"Octave 1 Scale",group:"Curl Noise",min:.3,max:8,step:.05,default:1.6},{kind:"slider",key:"curl1TimeFlow",label:"Octave 1 Time Flow",group:"Curl Noise",min:0,max:2,step:.01,default:.15},{kind:"slider",key:"curl2Strength",label:"Octave 2 Strength",group:"Curl Noise",min:0,max:2,step:.01,default:.18},{kind:"slider",key:"curl2Scale",label:"Octave 2 Scale",group:"Curl Noise",min:1,max:20,step:.1,default:5},{kind:"slider",key:"curl2TimeFlow",label:"Octave 2 Time Flow",group:"Curl Noise",min:0,max:3,step:.01,default:.4},{kind:"toggle",key:"vortexEnabled",label:"Enable Vortex",group:"Vortex",default:!1},{kind:"slider",key:"vortexStrength",label:"Vortex Strength",group:"Vortex",min:0,max:3,step:.01,default:.6,showWhen:{vortexEnabled:!0}},{kind:"slider",key:"vortexRadius",label:"Vortex Falloff",group:"Vortex",min:.05,max:2,step:.01,default:.5,showWhen:{vortexEnabled:!0}},{kind:"slider",key:"vortexAxisX",label:"Vortex Axis X",group:"Vortex",min:-1,max:1,step:.01,default:0,showWhen:{vortexEnabled:!0}},{kind:"slider",key:"vortexAxisY",label:"Vortex Axis Y",group:"Vortex",min:-1,max:1,step:.01,default:1,showWhen:{vortexEnabled:!0}},{kind:"slider",key:"vortexAxisZ",label:"Vortex Axis Z",group:"Vortex",min:-1,max:1,step:.01,default:0,showWhen:{vortexEnabled:!0}},{kind:"toggle",key:"audioReactive",label:"Audio Reactive",group:"Audio",default:!0},{kind:"slider",key:"audioBurstStrength",label:"Bass Burst (refresh ratio)",group:"Audio",min:0,max:1,step:.01,default:.3},{kind:"slider",key:"shimmerStrength",label:"Treble Shimmer",group:"Audio",min:0,max:.3,step:.001,default:.04},{kind:"slider",key:"brightness",label:"Brightness",group:"Render",min:.1,max:4,step:.01,default:1.2},{kind:"slider",key:"alphaScale",label:"Density (alpha)",group:"Render",min:0,max:1.5,step:.01,default:.55},{kind:"slider",key:"density",label:"Edge Softness",group:"Render",min:.5,max:8,step:.05,default:2.5},{kind:"color",key:"bgColor",label:"Background Color",group:"Background",default:[10,10,20]},{kind:"slider",key:"bgOpacity",label:"Background Opacity",group:"Background",min:0,max:1,step:.01,default:1},{kind:"angle",key:"rotateX",label:"Rotate X",group:"Object Rotation",default:0},{kind:"angle",key:"rotateY",label:"Rotate Y",group:"Object Rotation",default:0},{kind:"angle",key:"rotateZ",label:"Rotate Z",group:"Object Rotation",default:0},{kind:"slider",key:"autoRotateX",label:"Auto-Spin X",group:"Object Rotation",min:-180,max:180,step:.5,default:0},{kind:"slider",key:"autoRotateY",label:"Auto-Spin Y",group:"Object Rotation",min:-180,max:180,step:.5,default:0},{kind:"slider",key:"autoRotateZ",label:"Auto-Spin Z",group:"Object Rotation",min:-180,max:180,step:.5,default:0},{kind:"slider",key:"fovDeg",label:"FOV",group:"Camera",min:20,max:100,step:1,default:50},{kind:"slider",key:"cameraZ",label:"Distance",group:"Camera",min:.5,max:8,step:.05,default:2.4}],qo=ua($s);class Ou{inner;bands=null;lastParams={...qo};constructor(e,t){this.inner=new Gu(e,t)}setBands(e,t,a){this.bands={bass:e,mid:t,treble:a},this.applyParamsToInner()}setParams(e){this.lastParams={...qo,...e},this.applyParamsToInner()}rgb01(e,t){return!Array.isArray(e)||e.length<3?t:[Math.max(0,Math.min(1,(e[0]??0)/255)),Math.max(0,Math.min(1,(e[1]??0)/255)),Math.max(0,Math.min(1,(e[2]??0)/255))]}applyParamsToInner(){const e=this.lastParams,t=!!e.audioReactive&&this.bands,a=t?this.bands.bass:0,o=t?this.bands.treble:0;this.inner.setParams({particleCount:Math.round(e.particleCount??15e4),emitterCount:Math.max(1,Math.min(8,Math.round(e.emitterCount??4))),spread:e.spread??.4,spawnY:e.spawnY??-.4,spawnJitter:e.spawnJitter??.04,avgLifetime:e.avgLifetime??3,lifetimeVar:e.lifetimeVar??.3,sizeStart:e.sizeStart??.008,sizeEnd:e.sizeEnd??.05,fadeColor:this.rgb01(e.fadeColor,[.04,.05,.1]),colorFadeAmount:e.colorFadeAmount??1,buoyancy:e.buoyancy??.18,damping:e.damping??.6,windX:e.windX??0,windY:e.windY??0,windZ:e.windZ??0,curl1Strength:e.curl1Strength??.3,curl1Scale:e.curl1Scale??1.6,curl1TimeFlow:e.curl1TimeFlow??.15,curl2Strength:e.curl2Strength??.18,curl2Scale:e.curl2Scale??5,curl2TimeFlow:e.curl2TimeFlow??.4,vortexEnabled:!!e.vortexEnabled,vortexStrength:e.vortexStrength??.6,vortexRadius:e.vortexRadius??.5,vortexAxisX:e.vortexAxisX??0,vortexAxisY:e.vortexAxisY??1,vortexAxisZ:e.vortexAxisZ??0,bass:a,treble:o,audioBurstStrength:e.audioBurstStrength??.3,shimmerStrength:e.shimmerStrength??.04,brightness:e.brightness??1.2,alphaScale:e.alphaScale??.55,density:e.density??2.5,bgColor:this.rgb01(e.bgColor,[.04,.04,.08]),bgOpacity:e.bgOpacity??1,emitterColors:[this.rgb01(e.emitterColor1,[1,.4,.18]),this.rgb01(e.emitterColor2,[.18,.78,1]),this.rgb01(e.emitterColor3,[.85,.2,.85]),this.rgb01(e.emitterColor4,[.2,.95,.55]),this.rgb01(e.emitterColor5,[1,.85,.3]),this.rgb01(e.emitterColor6,[.5,.3,1]),this.rgb01(e.emitterColor7,[1,.3,.55]),this.rgb01(e.emitterColor8,[.3,1,.95])],fovDeg:e.fovDeg??50,cameraZ:e.cameraZ??2.4,rotateX:e.rotateX??0,rotateY:e.rotateY??0,rotateZ:e.rotateZ??0,autoRotateX:e.autoRotateX??0,autoRotateY:e.autoRotateY??0,autoRotateZ:e.autoRotateZ??0})}encodeFrame(e,t,a,o,r,s){this.inner.setViewport(o,r),e.beginRenderPass({colorAttachments:[{view:t,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]}).end(),this.inner.encodeFrame(e,t)}resize(e,t){}dispose(){try{this.inner.dispose()}catch{}}}const Ei=48,Wu=20,Vu=64,Fi=8;function Li(i,e){const t=new Float32Array(16);for(let a=0;a<4;a++)for(let o=0;o<4;o++){let r=0;for(let s=0;s<4;s++)r+=i[s*4+o]*e[a*4+s];t[a*4+o]=r}return t}function Zs(){const i=new Float32Array(16);return i[0]=i[5]=i[10]=i[15]=1,i}function Nu(i){const e=new Float32Array(16),t=i[0],a=i[1],o=i[2],r=i[3],s=i[4],n=i[5],l=i[6],u=i[7],f=i[8],d=i[9],h=i[10],m=i[11],b=i[12],M=i[13],C=i[14],T=i[15],I=t*n-a*s,W=t*l-o*s,G=t*u-r*s,O=a*l-o*n,L=a*u-r*n,N=o*u-r*l,ce=f*M-d*b,ae=f*C-h*b,se=f*T-m*b,te=d*C-h*M,Q=d*T-m*M,$=h*T-m*C;let j=I*$-W*Q+G*te+O*se-L*ae+N*ce;return Math.abs(j)<1e-12?Zs():(j=1/j,e[0]=(n*$-l*Q+u*te)*j,e[1]=(o*Q-a*$-r*te)*j,e[2]=(M*N-C*L+T*O)*j,e[3]=(h*L-d*N-m*O)*j,e[4]=(l*se-s*$-u*ae)*j,e[5]=(t*$-o*se+r*ae)*j,e[6]=(C*G-b*N-T*W)*j,e[7]=(f*N-h*G+m*W)*j,e[8]=(s*Q-n*se+u*ce)*j,e[9]=(a*se-t*Q-r*ce)*j,e[10]=(b*L-M*G+T*I)*j,e[11]=(d*G-f*L-m*I)*j,e[12]=(n*ae-s*te-l*ce)*j,e[13]=(t*te-a*ae+o*ce)*j,e[14]=(M*W-b*O-C*I)*j,e[15]=(f*O-d*W+h*I)*j,e)}function qu(i,e,t,a){const o=1/Math.tan(i*Math.PI/180/2),r=new Float32Array(16);return r[0]=o/e,r[5]=o,r[10]=a/(t-a),r[11]=-1,r[14]=t*a/(t-a),r}function Yu(i,e,t){const a=Zs();return a[12]=i,a[13]=e,a[14]=t,a}const Da=`
// Sim-wide uniform — gridSize, dt, decays, emitter count, audio
// burst flag. Emitter records live in a SEPARATE storage buffer
// (Emitter[]) so all emitters splat in a single compute dispatch
// without the per-dispatch writeBuffer coalescing bug that bites
// when you try to push different uniform values for back-to-back
// dispatches inside one command encoder.
struct SimGlobals {
  gridX: u32, gridY: u32, gridZ: u32, emitterCount: u32,
  dt:    f32, time: f32, burstMul: f32, _pad0: f32,
  densityDecay: f32, velocityDecay: f32, splatRadius: f32, _pad1: f32,
  // Wind = constant directional force added each frame; great for
  // sideways drift or pulling smoke toward one side. Turbulence =
  // 3D curl-noise force that swirls the velocity field organically;
  // gives the smoke "personality" beyond just rising in a column.
  windX: f32, windY: f32, windZ: f32, turbStrength: f32,
  turbScale: f32, _pad2: f32, _pad3: f32, _pad4: f32,
};

struct Emitter {
  center:   vec3<f32>, radius:   f32,
  color:    vec3<f32>, strength: f32,
  velocity: vec3<f32>, _pad:     f32,
};
`,za=`
fn flatIdx(p: vec3<i32>) -> u32 {
  return u32(p.x) + u32(p.y) * sim.gridX + u32(p.z) * sim.gridX * sim.gridY;
}

fn clampGrid(p: vec3<i32>) -> vec3<i32> {
  let mx = vec3<i32>(i32(sim.gridX) - 1, i32(sim.gridY) - 1, i32(sim.gridZ) - 1);
  return clamp(p, vec3<i32>(0), mx);
}

fn sampleVel3D(uv: vec3<f32>) -> vec3<f32> {
  let dim = vec3<f32>(f32(sim.gridX), f32(sim.gridY), f32(sim.gridZ));
  let p = uv * dim - 0.5;
  let p0 = vec3<i32>(floor(p));
  let f = p - vec3<f32>(p0);
  let v000 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 0, 0)))].xyz;
  let v100 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 0, 0)))].xyz;
  let v010 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 1, 0)))].xyz;
  let v110 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 1, 0)))].xyz;
  let v001 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 0, 1)))].xyz;
  let v101 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 0, 1)))].xyz;
  let v011 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 1, 1)))].xyz;
  let v111 = velocityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 1, 1)))].xyz;
  let vx00 = mix(v000, v100, f.x);
  let vx10 = mix(v010, v110, f.x);
  let vx01 = mix(v001, v101, f.x);
  let vx11 = mix(v011, v111, f.x);
  let vxy0 = mix(vx00, vx10, f.y);
  let vxy1 = mix(vx01, vx11, f.y);
  return mix(vxy0, vxy1, f.z);
}

// 3D value noise + analytic curl — used by the wind/turbulence pass
// to add divergence-free swirling forces to the velocity field.
// "curl of a noise vector field" produces motion that looks like
// natural turbulence without the unrealistic compression/expansion
// you'd get from sampling raw noise directly as a velocity.
fn hash13(p: vec3<f32>) -> f32 {
  let q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7,  74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6)),
  );
  return fract(sin(q.x + q.y + q.z) * 43758.5453);
}
fn vnoise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let n000 = hash13(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash13(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash13(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash13(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash13(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash13(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash13(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash13(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, s.x);
  let nx10 = mix(n010, n110, s.x);
  let nx01 = mix(n001, n101, s.x);
  let nx11 = mix(n011, n111, s.x);
  let nxy0 = mix(nx00, nx10, s.y);
  let nxy1 = mix(nx01, nx11, s.y);
  return mix(nxy0, nxy1, s.z) * 2.0 - 1.0;
}
fn curl3D(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let ax1 = vnoise3(p + vec3<f32>(0.0,  e, 0.0));
  let ax2 = vnoise3(p + vec3<f32>(0.0, -e, 0.0));
  let ay1 = vnoise3(p + vec3<f32>(0.0, 0.0,  e) + vec3<f32>(31.0, 0.0, 0.0));
  let ay2 = vnoise3(p + vec3<f32>(0.0, 0.0, -e) + vec3<f32>(31.0, 0.0, 0.0));
  let az1 = vnoise3(p + vec3<f32>( e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  let az2 = vnoise3(p + vec3<f32>(-e, 0.0, 0.0) + vec3<f32>(0.0, 47.0, 0.0));
  return vec3<f32>(ay1 - ay2, az1 - az2, ax1 - ax2) / (2.0 * e);
}

fn sampleDen3D(uv: vec3<f32>) -> vec4<f32> {
  let dim = vec3<f32>(f32(sim.gridX), f32(sim.gridY), f32(sim.gridZ));
  let p = uv * dim - 0.5;
  let p0 = vec3<i32>(floor(p));
  let f = p - vec3<f32>(p0);
  let v000 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 0, 0)))];
  let v100 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 0, 0)))];
  let v010 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 1, 0)))];
  let v110 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 1, 0)))];
  let v001 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 0, 1)))];
  let v101 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 0, 1)))];
  let v011 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(0, 1, 1)))];
  let v111 = densityIn[flatIdx(clampGrid(p0 + vec3<i32>(1, 1, 1)))];
  let vx00 = mix(v000, v100, f.x);
  let vx10 = mix(v010, v110, f.x);
  let vx01 = mix(v001, v101, f.x);
  let vx11 = mix(v011, v111, f.x);
  let vxy0 = mix(vx00, vx10, f.y);
  let vxy1 = mix(vx01, vx11, f.y);
  return mix(vxy0, vxy1, f.z);
}
`,Hu=`
${Da}
@group(0) @binding(0) var<uniform>             sim:        SimGlobals;
@group(0) @binding(1) var<storage, read_write> velocityIn: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> densityIn:  array<vec4<f32>>;
@group(0) @binding(3) var<storage, read>       emitters:   array<Emitter>;

${za}
@compute @workgroup_size(4, 4, 4)
fn cs_splat(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let uv = (vec3<f32>(gid) + 0.5) / vec3<f32>(f32(sim.gridX), f32(sim.gridY), f32(sim.gridZ));
  let i = flatIdx(vec3<i32>(gid));
  // Sum contribution from EVERY active emitter in a single dispatch.
  // The previous design did one dispatch per emitter, but back-to-back
  // queue.writeBuffer calls all coalesced before the encoder ran, so
  // every dispatch saw only the last emitter's uniform. By making
  // splat aware of all emitters at once via a storage buffer, we
  // sidestep the issue entirely (and run faster — one buffer
  // read/write per voxel instead of N).
  var addedDensity:  f32       = 0.0;
  var addedColor:    vec3<f32> = vec3<f32>(0.0);
  var addedVelocity: vec3<f32> = vec3<f32>(0.0);
  let n = sim.emitterCount;
  for (var e: u32 = 0u; e < n; e = e + 1u) {
    let em = emitters[e];
    let toSplat = uv - em.center;
    let d = length(toSplat);
    let r = max(em.radius, 0.001);
    let w = exp(-d * d / (r * r));
    if (w < 0.0005) { continue; }
    let strength = em.strength * sim.burstMul;
    let dContrib = strength * w;
    addedDensity  = addedDensity  + dContrib;
    addedColor    = addedColor    + em.color * dContrib;
    addedVelocity = addedVelocity + em.velocity * w;
  }
  if (addedDensity < 1e-5 && length(addedVelocity) < 1e-5) { return; }
  // Mix into existing density (proportional color blending so colors
  // mix realistically when emitters overlap).
  let cur = densityIn[i];
  let newDensity = cur.w + addedDensity;
  let blendedColor = (cur.xyz * cur.w + addedColor) / max(newDensity, 1e-4);
  densityIn[i] = vec4<f32>(blendedColor, newDensity);
  // Add velocity additively.
  let curV = velocityIn[i];
  velocityIn[i] = vec4<f32>(curV.xyz + addedVelocity, 0.0);
}
`,ju=`
${Da}
@group(0) @binding(0) var<uniform>             sim:         SimGlobals;
@group(0) @binding(1) var<storage, read>       velocityIn:  array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> densityIn:   array<vec4<f32>>;  // unused but bound for SHARED_HELPERS
@group(0) @binding(3) var<storage, read_write> velocityOut: array<vec4<f32>>;

${za}
@compute @workgroup_size(4, 4, 4)
fn cs_advect_vel(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let dim = vec3<f32>(f32(sim.gridX), f32(sim.gridY), f32(sim.gridZ));
  let uv = (vec3<f32>(gid) + 0.5) / dim;
  // Backtrace: where did the fluid that's HERE come from one timestep ago?
  let v = velocityIn[flatIdx(vec3<i32>(gid))].xyz;
  let prevUV = uv - v * sim.dt;
  var advected = sampleVel3D(prevUV);

  // ── Wind: constant directional force (added per-frame). ─────
  let wind = vec3<f32>(sim.windX, sim.windY, sim.windZ);
  advected = advected + wind * sim.dt;

  // ── Turbulence: 3D curl-noise force, animated over time so the
  //    swirls don't lock into one pattern. Sampled in WORLD coords
  //    (uv ∈ [0,1]) scaled by turbScale so the user can dial swirl
  //    size from "single huge vortex" to "fine wispy detail." Time
  //    drift moves the noise field through space, giving smoke that
  //    reads as alive even when nothing else is happening. ─────
  if (sim.turbStrength > 0.0001) {
    let p = uv * sim.turbScale + vec3<f32>(0.0, 0.0, sim.time * 0.2);
    let turb = curl3D(p) * sim.turbStrength;
    advected = advected + turb * sim.dt;
  }

  velocityOut[flatIdx(vec3<i32>(gid))] = vec4<f32>(advected * sim.velocityDecay, 0.0);
}
`,Xu=`
${Da}
@group(0) @binding(0) var<uniform>             sim:        SimGlobals;
@group(0) @binding(1) var<storage, read>       velocityIn: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> densityIn:  array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> divOut:     array<f32>;

${za}
@compute @workgroup_size(4, 4, 4)
fn cs_divergence(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let p = vec3<i32>(gid);
  // Central differences. Edges clamp via clampGrid in flatIdx.
  let vL = velocityIn[flatIdx(clampGrid(p + vec3<i32>(-1, 0, 0)))].xyz;
  let vR = velocityIn[flatIdx(clampGrid(p + vec3<i32>( 1, 0, 0)))].xyz;
  let vD = velocityIn[flatIdx(clampGrid(p + vec3<i32>(0, -1, 0)))].xyz;
  let vU = velocityIn[flatIdx(clampGrid(p + vec3<i32>(0,  1, 0)))].xyz;
  let vB = velocityIn[flatIdx(clampGrid(p + vec3<i32>(0, 0, -1)))].xyz;
  let vF = velocityIn[flatIdx(clampGrid(p + vec3<i32>(0, 0,  1)))].xyz;
  let div = 0.5 * ((vR.x - vL.x) + (vU.y - vD.y) + (vF.z - vB.z));
  divOut[flatIdx(p)] = div;
}
`,$u=`
${Da}
@group(0) @binding(0) var<uniform>             sim:         SimGlobals;
@group(0) @binding(1) var<storage, read>       velocityIn:  array<vec4<f32>>;  // bound for SHARED_HELPERS, unused
@group(0) @binding(2) var<storage, read_write> densityIn:   array<vec4<f32>>;  // bound for SHARED_HELPERS, unused
@group(0) @binding(3) var<storage, read>       divIn:       array<f32>;
@group(0) @binding(4) var<storage, read>       pressureIn:  array<f32>;
@group(0) @binding(5) var<storage, read_write> pressureOut: array<f32>;

${za}
@compute @workgroup_size(4, 4, 4)
fn cs_jacobi(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let p = vec3<i32>(gid);
  // 6-neighbor average of pressure minus the divergence at this cell.
  let pL = pressureIn[flatIdx(clampGrid(p + vec3<i32>(-1, 0, 0)))];
  let pR = pressureIn[flatIdx(clampGrid(p + vec3<i32>( 1, 0, 0)))];
  let pD = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0, -1, 0)))];
  let pU = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0,  1, 0)))];
  let pB = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0, 0, -1)))];
  let pF = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0, 0,  1)))];
  let d = divIn[flatIdx(p)];
  pressureOut[flatIdx(p)] = (pL + pR + pD + pU + pB + pF - d) / 6.0;
}
`,Zu=`
${Da}
@group(0) @binding(0) var<uniform>             sim:         SimGlobals;
@group(0) @binding(1) var<storage, read>       velocityIn:  array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> densityIn:   array<vec4<f32>>;  // unused, bound for SHARED_HELPERS
@group(0) @binding(3) var<storage, read>       pressureIn:  array<f32>;
@group(0) @binding(4) var<storage, read_write> velocityOut: array<vec4<f32>>;

${za}
@compute @workgroup_size(4, 4, 4)
fn cs_subtract_grad(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let p = vec3<i32>(gid);
  let pL = pressureIn[flatIdx(clampGrid(p + vec3<i32>(-1, 0, 0)))];
  let pR = pressureIn[flatIdx(clampGrid(p + vec3<i32>( 1, 0, 0)))];
  let pD = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0, -1, 0)))];
  let pU = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0,  1, 0)))];
  let pB = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0, 0, -1)))];
  let pF = pressureIn[flatIdx(clampGrid(p + vec3<i32>(0, 0,  1)))];
  let v = velocityIn[flatIdx(p)].xyz;
  let grad = vec3<f32>(pR - pL, pU - pD, pF - pB) * 0.5;
  velocityOut[flatIdx(p)] = vec4<f32>(v - grad, 0.0);
}
`,Ku=`
${Da}
@group(0) @binding(0) var<uniform>             sim:        SimGlobals;
@group(0) @binding(1) var<storage, read>       velocityIn: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       densityIn:  array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> densityOut: array<vec4<f32>>;

${za}
@compute @workgroup_size(4, 4, 4)
fn cs_advect_den(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sim.gridX || gid.y >= sim.gridY || gid.z >= sim.gridZ) { return; }
  let dim = vec3<f32>(f32(sim.gridX), f32(sim.gridY), f32(sim.gridZ));
  let uv = (vec3<f32>(gid) + 0.5) / dim;
  let v = velocityIn[flatIdx(vec3<i32>(gid))].xyz;
  let prevUV = uv - v * sim.dt;
  let d = sampleDen3D(prevUV);
  densityOut[flatIdx(vec3<i32>(gid))] = vec4<f32>(d.xyz, d.w * sim.densityDecay);
}
`,Ju=`
struct RenderUniforms {
  invViewProj:    mat4x4<f32>,
  cameraPos:      vec3<f32>,
  emission:       f32,
  volumeScale:    vec3<f32>,
  density:        f32,
  fogColor:       vec3<f32>,
  fogOpacity:     f32,
  gridX: u32, gridY: u32, gridZ: u32, _pad0: u32,
  // Lighting: directional light + ambient. lightDir should be a
  // pre-normalized direction TOWARD the light (so dot-product with
  // surface normal gives the right sign). lightColor is RGB; ambient
  // adds an unconditional brightness floor so the dark side isn't
  // pitch black.
  lightDir:       vec3<f32>,
  lightStrength:  f32,
  lightColor:     vec3<f32>,
  ambient:        f32,
  // Number of "shadow march" steps along the light direction at
  // each main raymarch sample. More steps = softer/more accurate
  // shadows but slower. 0 disables self-shadowing entirely (just
  // ambient + constant light).
  shadowSteps:    u32,
  shadowStepLen:  f32,
  _pad1: f32, _pad2: f32,
};

@group(0) @binding(0) var<uniform>           u:        RenderUniforms;
@group(0) @binding(1) var<storage, read>     densBuf:  array<vec4<f32>>;

fn flatI(p: vec3<i32>) -> u32 {
  return u32(p.x) + u32(p.y) * u.gridX + u32(p.z) * u.gridX * u.gridY;
}

fn sampleDensityRM(uv: vec3<f32>) -> vec4<f32> {
  let dim = vec3<f32>(f32(u.gridX), f32(u.gridY), f32(u.gridZ));
  let p = clamp(uv, vec3<f32>(0.001), vec3<f32>(0.999)) * dim - 0.5;
  let p0 = vec3<i32>(floor(p));
  let f = p - vec3<f32>(p0);
  let mx = vec3<i32>(i32(u.gridX) - 1, i32(u.gridY) - 1, i32(u.gridZ) - 1);
  let v000 = densBuf[flatI(clamp(p0 + vec3<i32>(0, 0, 0), vec3<i32>(0), mx))];
  let v100 = densBuf[flatI(clamp(p0 + vec3<i32>(1, 0, 0), vec3<i32>(0), mx))];
  let v010 = densBuf[flatI(clamp(p0 + vec3<i32>(0, 1, 0), vec3<i32>(0), mx))];
  let v110 = densBuf[flatI(clamp(p0 + vec3<i32>(1, 1, 0), vec3<i32>(0), mx))];
  let v001 = densBuf[flatI(clamp(p0 + vec3<i32>(0, 0, 1), vec3<i32>(0), mx))];
  let v101 = densBuf[flatI(clamp(p0 + vec3<i32>(1, 0, 1), vec3<i32>(0), mx))];
  let v011 = densBuf[flatI(clamp(p0 + vec3<i32>(0, 1, 1), vec3<i32>(0), mx))];
  let v111 = densBuf[flatI(clamp(p0 + vec3<i32>(1, 1, 1), vec3<i32>(0), mx))];
  let vx00 = mix(v000, v100, f.x);
  let vx10 = mix(v010, v110, f.x);
  let vx01 = mix(v001, v101, f.x);
  let vx11 = mix(v011, v111, f.x);
  let vxy0 = mix(vx00, vx10, f.y);
  let vxy1 = mix(vx01, vx11, f.y);
  return mix(vxy0, vxy1, f.z);
}

fn hash12(p: vec2<f32>) -> f32 {
  let p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  let p3y = p3 + dot(p3, p3.yxz + 33.33);
  return fract((p3y.x + p3y.y) * p3y.z);
}

// Slab method ray-AABB intersection with the box [-1,1]^3 (then
// scaled by volumeScale). Returns (tEntry, tExit). If they're
// the wrong order, the ray missed.
fn intersectBox(ro: vec3<f32>, rd: vec3<f32>, boxMin: vec3<f32>, boxMax: vec3<f32>) -> vec2<f32> {
  let invD = 1.0 / rd;
  let t0 = (boxMin - ro) * invD;
  let t1 = (boxMax - ro) * invD;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tEntry = max(max(tmin.x, tmin.y), tmin.z);
  let tExit  = min(min(tmax.x, tmax.y), tmax.z);
  return vec2<f32>(tEntry, tExit);
}

struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) ndc: vec2<f32>, };

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  // Fullscreen triangle (one big triangle that covers the screen)
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  let p = positions[vid];
  var out: VSOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.ndc = p;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // 1. Build world-space ray from this pixel
  let ndc = in.ndc;
  let nearW = u.invViewProj * vec4<f32>(ndc, 0.0, 1.0);
  let farW  = u.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let nearP = nearW.xyz / nearW.w;
  let farP  = farW.xyz  / farW.w;
  let rd = normalize(farP - nearP);
  let ro = nearP;

  // 2. Volume bounding box, scaled by volumeScale
  let boxMin = -u.volumeScale;
  let boxMax =  u.volumeScale;
  let t = intersectBox(ro, rd, boxMin, boxMax);
  if (t.y < t.x || t.y < 0.0) {
    // Missed the volume entirely — show fog background.
    return vec4<f32>(u.fogColor * u.fogOpacity, u.fogOpacity);
  }
  let tStart = max(t.x, 0.0);
  let tEnd   = t.y;

  // 3. Blue-noise-like dither offset on ray start. hash12 gives a
  //    decorrelated value per pixel that breaks the regular sample
  //    pattern that causes step banding.
  let dither = hash12(in.pos.xy);

  let nSteps = ${Vu};
  let stepLen = (tEnd - tStart) / f32(nSteps);
  var t0 = tStart + stepLen * dither;

  // 4. Front-to-back accumulation with per-step self-shadowing.
  //    For each main raymarch sample, optionally march toward the
  //    light source for u.shadowSteps short steps and accumulate
  //    density along that direction. Use exp(-shadowDensity) as a
  //    transmittance factor: dense regions cast shadows on themselves
  //    and on neighbors, giving the cloud a clear LIT side and dark
  //    side. shadowSteps=0 disables self-shadowing (cheaper).
  var accum = vec4<f32>(0.0);
  let lightStepLen = max(u.shadowStepLen, 0.001);
  let extentRange = boxMax - boxMin;
  for (var i = 0; i < nSteps; i = i + 1) {
    if (t0 > tEnd || accum.a > 0.99) { break; }
    let pos = ro + rd * t0;
    let uvw = (pos - boxMin) / extentRange;
    let s = sampleDensityRM(uvw);

    // Light-march for self-shadowing. We accumulate optical depth
    // along the light direction and convert via Beer-Lambert
    // (exp(-depth)) into a transmittance factor.
    var shadow: f32 = 1.0;
    if (u.shadowSteps > 0u && s.w > 0.001) {
      var lightDepth: f32 = 0.0;
      var lp = pos;
      let steps = u.shadowSteps;
      for (var li: u32 = 0u; li < steps; li = li + 1u) {
        lp = lp + u.lightDir * lightStepLen;
        // Bail out if we've left the volume — no more occluders.
        if (lp.x < boxMin.x || lp.y < boxMin.y || lp.z < boxMin.z ||
            lp.x > boxMax.x || lp.y > boxMax.y || lp.z > boxMax.z) {
          break;
        }
        let luvw = (lp - boxMin) / extentRange;
        let ls = sampleDensityRM(luvw);
        lightDepth = lightDepth + ls.w * lightStepLen * u.density;
      }
      shadow = exp(-lightDepth);
    }

    // Final lit contribution = (ambient + lit*shadow) tinted by both
    // the smoke's own color (s.xyz) AND the light's color when the
    // light is the dominant source.
    let lit = u.ambient + u.lightStrength * shadow;
    let litColor = s.xyz * mix(vec3<f32>(1.0), u.lightColor, u.lightStrength * shadow);
    let alpha = clamp(s.w * stepLen * u.density, 0.0, 1.0);
    let col = litColor * u.emission * lit;

    // Premultiplied front-to-back accumulation. Full-vector
    // assignment because Chromium's WGSL rejects swizzle-write.
    let oneMinusA = 1.0 - accum.a;
    let newRGB = accum.rgb + col * alpha * oneMinusA;
    let newA   = accum.a + alpha * oneMinusA;
    accum = vec4<f32>(newRGB, newA);
    t0 = t0 + stepLen;
  }

  // 5. Composite the accumulated smoke OVER the fog background. The
  //    fog fills any unoccluded portion of the pixel.
  let bgRGBA = vec4<f32>(u.fogColor * u.fogOpacity, u.fogOpacity);
  let outA = accum.a + bgRGBA.a * (1.0 - accum.a);
  let outRGB = accum.rgb + bgRGBA.rgb * (1.0 - accum.a);
  return vec4<f32>(outRGB, outA);
}
`,Qu={gridSize:48,emission:2.5,density:3,velocityDecay:.985,densityDecay:.992,emitterCount:4,spread:.3,spawnY:-.5,splatRadius:.1,splatStrength:3,splatVelocityMag:.6,splatRate:60,bass:0,treble:0,audioBurst:.5,emitterColors:[[1,.4,.18],[.18,.78,1],[.85,.2,.85],[.2,.95,.55],[1,.85,.3],[.5,.3,1],[1,.3,.55],[.3,1,.95]],volumeScaleX:1.6,volumeScaleZ:1,windX:0,windY:0,windZ:0,turbStrength:.5,turbScale:2.5,fovDeg:50,cameraZ:2.7,rotateX:0,rotateY:0,rotateZ:0,autoRotateX:0,autoRotateY:0,autoRotateZ:0,fogColor:[.08,.1,.18],fogOpacity:1,lightDirX:.4,lightDirY:.6,lightDirZ:.7,lightStrength:.8,lightColor:[1,.95,.85],ambient:.25,shadowSteps:4,shadowStepLen:.06},ed={color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}};class td{device;presentFormat;grid=Ei;cellCount=Ei*Ei*Ei;velA=null;velB=null;denA=null;denB=null;divBuf=null;prsA=null;prsB=null;velFlip=!1;denFlip=!1;prsFlip=!1;simUniform;renderUniform;emitterBuffer;splatPipeline;splatLayout;advectVelPipeline;advectVelLayout;divPipeline;divLayout;jacobiPipeline;jacobiLayout;subtractGradPipeline;subtractGradLayout;advectDenPipeline;advectDenLayout;renderPipeline;renderLayout;params={...Qu};viewportW=1920;viewportH=1080;prevFrameTime=0;autoRotXPhase=0;autoRotYPhase=0;autoRotZPhase=0;splatTimer=0;prevBass=0;burstHoldTimer=0;_loggedFirstFrame=!1;constructor(e,t){this.device=e,this.presentFormat=t,this.allocateGrid(this.grid),this.simUniform=e.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.renderUniform=e.createBuffer({size:192,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.emitterBuffer=e.createBuffer({size:Fi*48,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.buildPipelines()}allocateGrid(e){this.grid=e;const t=e*e*e;this.cellCount=t;const a=t*16,o=t*4;[this.velA,this.velB,this.denA,this.denB,this.divBuf,this.prsA,this.prsB].forEach(l=>{try{l?.destroy?.()}catch{}});const r=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;this.velA=this.device.createBuffer({size:a,usage:r}),this.velB=this.device.createBuffer({size:a,usage:r}),this.denA=this.device.createBuffer({size:a,usage:r}),this.denB=this.device.createBuffer({size:a,usage:r}),this.divBuf=this.device.createBuffer({size:o,usage:r}),this.prsA=this.device.createBuffer({size:o,usage:r}),this.prsB=this.device.createBuffer({size:o,usage:r});const s=new Float32Array(t*4),n=new Float32Array(t);this.device.queue.writeBuffer(this.velA,0,s),this.device.queue.writeBuffer(this.velB,0,s),this.device.queue.writeBuffer(this.denA,0,s),this.device.queue.writeBuffer(this.denB,0,s),this.device.queue.writeBuffer(this.divBuf,0,n),this.device.queue.writeBuffer(this.prsA,0,n),this.device.queue.writeBuffer(this.prsB,0,n)}buildPipelines(){this.splatLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}}]}),this.splatPipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.splatLayout]}),compute:{module:this.device.createShaderModule({code:Hu}),entryPoint:"cs_splat"}}),this.advectVelLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),this.advectVelPipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.advectVelLayout]}),compute:{module:this.device.createShaderModule({code:ju}),entryPoint:"cs_advect_vel"}}),this.divLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),this.divPipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.divLayout]}),compute:{module:this.device.createShaderModule({code:Xu}),entryPoint:"cs_divergence"}}),this.jacobiLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),this.jacobiPipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.jacobiLayout]}),compute:{module:this.device.createShaderModule({code:$u}),entryPoint:"cs_jacobi"}}),this.subtractGradLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),this.subtractGradPipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.subtractGradLayout]}),compute:{module:this.device.createShaderModule({code:Zu}),entryPoint:"cs_subtract_grad"}}),this.advectDenLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),this.advectDenPipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.advectDenLayout]}),compute:{module:this.device.createShaderModule({code:Ku}),entryPoint:"cs_advect_den"}}),this.renderLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"read-only-storage"}}]});const e=this.device.createShaderModule({code:Ju});this.renderPipeline=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.renderLayout]}),vertex:{module:e,entryPoint:"vs_main"},fragment:{module:e,entryPoint:"fs_main",targets:[{format:this.presentFormat,blend:ed}]},primitive:{topology:"triangle-list"}})}setParams(e){const t=this.params.gridSize;this.params={...this.params,...e},this.params.gridSize!==t&&this.allocateGrid(this.params.gridSize)}setViewport(e,t){this.viewportW=e,this.viewportH=t}encodeFrame(e,t){this._loggedFirstFrame||(this._loggedFirstFrame=!0,console.log("[3D Smoke] first frame — grid:",this.grid,"cells:",this.cellCount,"viewport:",this.viewportW,"x",this.viewportH,"cameraZ:",this.params.cameraZ,"fogColor:",this.params.fogColor));const a=performance.now()/1e3;let o=this.prevFrameTime===0?1/60:a-this.prevFrameTime;o=Math.min(Math.max(o,.001),1/15),this.prevFrameTime=a,this.autoRotXPhase+=this.params.autoRotateX*o,this.autoRotYPhase+=this.params.autoRotateY*o,this.autoRotZPhase+=this.params.autoRotateZ*o,Math.max(0,this.params.bass-this.prevBass)>.05&&(this.burstHoldTimer=Math.max(this.burstHoldTimer,.15)),this.burstHoldTimer=Math.max(0,this.burstHoldTimer-o),this.prevBass=this.params.bass;const s=this.burstHoldTimer>0;this.splatTimer+=o;const n=1/Math.max(.1,this.params.splatRate),l=this.splatTimer>=n;l&&(this.splatTimer=0);const u=l||s,f=Math.max(1,Math.min(Fi,this.params.emitterCount|0)),d=s?2.5:1,h=new ArrayBuffer(Fi*48),m=new Float32Array(h);for(let Ee=0;Ee<Fi;Ee++){const ke=Ee*12;if(Ee<f){const Ue=f>1?Ee/f*Math.PI*2:0,je=Math.cos(Ue)*this.params.spread,Je=Math.sin(Ue)*this.params.spread,rt=je*.5+.5,dt=this.params.spawnY*.5+.5,oi=Je*.5+.5,da=this.params.emitterColors[Ee%this.params.emitterColors.length]??[1,1,1],Bt=Math.cos(Ue),fa=Math.sin(Ue),Nt=this.params.splatVelocityMag;m[ke+0]=rt,m[ke+1]=dt,m[ke+2]=oi,m[ke+3]=this.params.splatRadius,m[ke+4]=da[0],m[ke+5]=da[1],m[ke+6]=da[2],m[ke+7]=this.params.splatStrength,m[ke+8]=Bt*Nt*.3,m[ke+9]=Nt,m[ke+10]=fa*Nt*.3}else for(let Ue=0;Ue<12;Ue++)m[ke+Ue]=0}this.device.queue.writeBuffer(this.emitterBuffer,0,h);const b=new ArrayBuffer(96),M=new Float32Array(b),C=new Uint32Array(b);C[0]=this.grid>>>0,C[1]=this.grid>>>0,C[2]=this.grid>>>0,C[3]=f>>>0,M[4]=o,M[5]=a,M[6]=u?d:0,M[8]=this.params.densityDecay,M[9]=this.params.velocityDecay,M[10]=this.params.splatRadius,M[12]=this.params.windX,M[13]=this.params.windY,M[14]=this.params.windZ,M[15]=this.params.turbStrength,M[16]=this.params.turbScale,this.device.queue.writeBuffer(this.simUniform,0,b);const T=Math.ceil(this.grid/4);if(u){const Ee=this.device.createBindGroup({layout:this.splatLayout,entries:[{binding:0,resource:{buffer:this.simUniform}},{binding:1,resource:{buffer:this.velFlip?this.velB:this.velA}},{binding:2,resource:{buffer:this.denFlip?this.denB:this.denA}},{binding:3,resource:{buffer:this.emitterBuffer}}]}),ke=e.beginComputePass();ke.setPipeline(this.splatPipeline),ke.setBindGroup(0,Ee),ke.dispatchWorkgroups(T,T,T),ke.end()}{const Ee=this.velFlip?this.velB:this.velA,ke=this.velFlip?this.velA:this.velB,Ue=this.denFlip?this.denB:this.denA,je=this.device.createBindGroup({layout:this.advectVelLayout,entries:[{binding:0,resource:{buffer:this.simUniform}},{binding:1,resource:{buffer:Ee}},{binding:2,resource:{buffer:Ue}},{binding:3,resource:{buffer:ke}}]}),Je=e.beginComputePass();Je.setPipeline(this.advectVelPipeline),Je.setBindGroup(0,je),Je.dispatchWorkgroups(T,T,T),Je.end(),this.velFlip=!this.velFlip}{const Ee=this.velFlip?this.velB:this.velA,ke=this.denFlip?this.denB:this.denA,Ue=this.device.createBindGroup({layout:this.divLayout,entries:[{binding:0,resource:{buffer:this.simUniform}},{binding:1,resource:{buffer:Ee}},{binding:2,resource:{buffer:ke}},{binding:3,resource:{buffer:this.divBuf}}]}),je=e.beginComputePass();je.setPipeline(this.divPipeline),je.setBindGroup(0,Ue),je.dispatchWorkgroups(T,T,T),je.end()}for(let Ee=0;Ee<Wu;Ee++){const ke=this.velFlip?this.velB:this.velA,Ue=this.denFlip?this.denB:this.denA,je=this.prsFlip?this.prsB:this.prsA,Je=this.prsFlip?this.prsA:this.prsB,rt=this.device.createBindGroup({layout:this.jacobiLayout,entries:[{binding:0,resource:{buffer:this.simUniform}},{binding:1,resource:{buffer:ke}},{binding:2,resource:{buffer:Ue}},{binding:3,resource:{buffer:this.divBuf}},{binding:4,resource:{buffer:je}},{binding:5,resource:{buffer:Je}}]}),dt=e.beginComputePass();dt.setPipeline(this.jacobiPipeline),dt.setBindGroup(0,rt),dt.dispatchWorkgroups(T,T,T),dt.end(),this.prsFlip=!this.prsFlip}{const Ee=this.velFlip?this.velB:this.velA,ke=this.velFlip?this.velA:this.velB,Ue=this.denFlip?this.denB:this.denA,je=this.prsFlip?this.prsB:this.prsA,Je=this.device.createBindGroup({layout:this.subtractGradLayout,entries:[{binding:0,resource:{buffer:this.simUniform}},{binding:1,resource:{buffer:Ee}},{binding:2,resource:{buffer:Ue}},{binding:3,resource:{buffer:je}},{binding:4,resource:{buffer:ke}}]}),rt=e.beginComputePass();rt.setPipeline(this.subtractGradPipeline),rt.setBindGroup(0,Je),rt.dispatchWorkgroups(T,T,T),rt.end(),this.velFlip=!this.velFlip}{const Ee=this.velFlip?this.velB:this.velA,ke=this.denFlip?this.denB:this.denA,Ue=this.denFlip?this.denA:this.denB,je=this.device.createBindGroup({layout:this.advectDenLayout,entries:[{binding:0,resource:{buffer:this.simUniform}},{binding:1,resource:{buffer:Ee}},{binding:2,resource:{buffer:ke}},{binding:3,resource:{buffer:Ue}}]}),Je=e.beginComputePass();Je.setPipeline(this.advectDenPipeline),Je.setBindGroup(0,je),Je.dispatchWorkgroups(T,T,T),Je.end(),this.denFlip=!this.denFlip}const I=this.viewportW/Math.max(1,this.viewportH),W=qu(this.params.fovDeg,I,.01,100),G=Yu(0,0,-this.params.cameraZ),O=Math.PI/180,L=(this.params.rotateX+this.autoRotXPhase)*O,N=(this.params.rotateY+this.autoRotYPhase)*O,ce=(this.params.rotateZ+this.autoRotZPhase)*O,ae=Math.cos(L),se=Math.sin(L),te=Math.cos(N),Q=Math.sin(N),$=Math.cos(ce),j=Math.sin(ce),Ae=new Float32Array([1,0,0,0,0,ae,se,0,0,-se,ae,0,0,0,0,1]),Ce=new Float32Array([te,0,-Q,0,0,1,0,0,Q,0,te,0,0,0,0,1]),Be=new Float32Array([$,j,0,0,-j,$,0,0,0,0,1,0,0,0,0,1]),ie=Li(Be,Li(Ce,Ae)),Pe=Li(W,Li(G,ie)),Ke=Nu(Pe),K=[0,0,this.params.cameraZ],We=new ArrayBuffer(192),pe=new Float32Array(We),ze=new Uint32Array(We);pe.set(Ke,0),pe[16]=K[0],pe[17]=K[1],pe[18]=K[2],pe[19]=this.params.emission,pe[20]=this.params.volumeScaleX,pe[21]=1,pe[22]=this.params.volumeScaleZ,pe[23]=this.params.density,pe[24]=this.params.fogColor[0],pe[25]=this.params.fogColor[1],pe[26]=this.params.fogColor[2],pe[27]=this.params.fogOpacity,ze[28]=this.grid>>>0,ze[29]=this.grid>>>0,ze[30]=this.grid>>>0;const Ve=this.params.lightDirX,_t=this.params.lightDirY,Lt=this.params.lightDirZ,At=Math.sqrt(Ve*Ve+_t*_t+Lt*Lt)||1;pe[32]=Ve/At,pe[33]=_t/At,pe[34]=Lt/At,pe[35]=this.params.lightStrength,pe[36]=this.params.lightColor[0],pe[37]=this.params.lightColor[1],pe[38]=this.params.lightColor[2],pe[39]=this.params.ambient,ze[40]=Math.max(0,Math.min(16,Math.round(this.params.shadowSteps)))>>>0,pe[41]=this.params.shadowStepLen,this.device.queue.writeBuffer(this.renderUniform,0,We);const Ia=this.denFlip?this.denB:this.denA,Ki=this.device.createBindGroup({layout:this.renderLayout,entries:[{binding:0,resource:{buffer:this.renderUniform}},{binding:1,resource:{buffer:Ia}}]}),mt=e.beginRenderPass({colorAttachments:[{view:t,loadOp:"load",storeOp:"store"}]});mt.setPipeline(this.renderPipeline),mt.setBindGroup(0,Ki),mt.draw(3),mt.end()}dispose(){[this.velA,this.velB,this.denA,this.denB,this.divBuf,this.prsA,this.prsB,this.simUniform,this.renderUniform,this.emitterBuffer].forEach(e=>{try{e?.destroy?.()}catch{}})}}const Ks=[{kind:"select",key:"gridSize",label:"Resolution",group:"Grid",options:[{value:"32",label:"32³ (fast, integrated GPU friendly)"},{value:"48",label:"48³ (balanced — recommended)"},{value:"64",label:"64³ (high detail, discrete GPU)"}],default:"48"},{kind:"slider",key:"volumeScaleX",label:"Volume Width",group:"Volume Shape",min:.5,max:4,step:.05,default:1.6},{kind:"slider",key:"volumeScaleZ",label:"Volume Depth",group:"Volume Shape",min:.3,max:4,step:.05,default:1},{kind:"slider",key:"emitterCount",label:"Emitter Count",group:"Emitters",min:1,max:8,step:1,default:4},{kind:"slider",key:"spread",label:"Spread (radius)",group:"Emitters",min:0,max:1,step:.01,default:.3},{kind:"slider",key:"spawnY",label:"Spawn Height",group:"Emitters",min:-1,max:1,step:.01,default:-.5},{kind:"slider",key:"splatRadius",label:"Splat Softness",group:"Emitters",min:.01,max:.2,step:.005,default:.1},{kind:"slider",key:"splatStrength",label:"Splat Strength",group:"Emitters",min:.1,max:5,step:.05,default:3},{kind:"slider",key:"splatVelocityMag",label:"Splat Velocity (upward)",group:"Emitters",min:0,max:3,step:.01,default:.6},{kind:"slider",key:"splatRate",label:"Splat Rate (Hz)",group:"Emitters",min:.5,max:60,step:.5,default:60},{kind:"color",key:"emitterColor1",label:"Color 1",group:"Emitter Colors",default:[255,100,45]},{kind:"color",key:"emitterColor2",label:"Color 2",group:"Emitter Colors",default:[45,200,255]},{kind:"color",key:"emitterColor3",label:"Color 3",group:"Emitter Colors",default:[220,50,220]},{kind:"color",key:"emitterColor4",label:"Color 4",group:"Emitter Colors",default:[50,245,140]},{kind:"color",key:"emitterColor5",label:"Color 5",group:"Emitter Colors",default:[255,215,75]},{kind:"color",key:"emitterColor6",label:"Color 6",group:"Emitter Colors",default:[130,75,255]},{kind:"color",key:"emitterColor7",label:"Color 7",group:"Emitter Colors",default:[255,75,140]},{kind:"color",key:"emitterColor8",label:"Color 8",group:"Emitter Colors",default:[75,255,240]},{kind:"slider",key:"velocityDecay",label:"Velocity Persistence",group:"Simulation",min:.9,max:1,step:.001,default:.985},{kind:"slider",key:"densityDecay",label:"Density Persistence",group:"Simulation",min:.9,max:1,step:.001,default:.992},{kind:"slider",key:"windX",label:"Wind X",group:"Wind & Turbulence",min:-3,max:3,step:.01,default:0},{kind:"slider",key:"windY",label:"Wind Y",group:"Wind & Turbulence",min:-3,max:3,step:.01,default:0},{kind:"slider",key:"windZ",label:"Wind Z",group:"Wind & Turbulence",min:-3,max:3,step:.01,default:0},{kind:"slider",key:"turbStrength",label:"Turbulence Strength",group:"Wind & Turbulence",min:0,max:4,step:.01,default:.5},{kind:"slider",key:"turbScale",label:"Turbulence Scale",group:"Wind & Turbulence",min:.5,max:12,step:.05,default:2.5},{kind:"slider",key:"lightDirX",label:"Light Direction X",group:"Lighting",min:-1,max:1,step:.01,default:.4},{kind:"slider",key:"lightDirY",label:"Light Direction Y",group:"Lighting",min:-1,max:1,step:.01,default:.6},{kind:"slider",key:"lightDirZ",label:"Light Direction Z",group:"Lighting",min:-1,max:1,step:.01,default:.7},{kind:"slider",key:"lightStrength",label:"Light Strength",group:"Lighting",min:0,max:2,step:.01,default:.8},{kind:"color",key:"lightColor",label:"Light Color",group:"Lighting",default:[255,242,217]},{kind:"slider",key:"ambient",label:"Ambient",group:"Lighting",min:0,max:1,step:.01,default:.25},{kind:"slider",key:"shadowSteps",label:"Shadow Steps (0 = off)",group:"Lighting",min:0,max:12,step:1,default:4},{kind:"slider",key:"shadowStepLen",label:"Shadow Step Length",group:"Lighting",min:.01,max:.2,step:.005,default:.06},{kind:"slider",key:"emission",label:"Emission",group:"Render",min:.1,max:6,step:.05,default:2.5},{kind:"slider",key:"density",label:"Density (alpha)",group:"Render",min:.1,max:8,step:.05,default:3},{kind:"color",key:"fogColor",label:"Fog Color",group:"Atmosphere",default:[20,26,46]},{kind:"slider",key:"fogOpacity",label:"Fog Opacity",group:"Atmosphere",min:0,max:1,step:.01,default:1},{kind:"toggle",key:"audioReactive",label:"Audio Reactive",group:"Audio",default:!0},{kind:"slider",key:"audioBurst",label:"Bass Burst Strength",group:"Audio",min:0,max:2,step:.01,default:.5,showWhen:{audioReactive:!0}},{kind:"angle",key:"rotateX",label:"Rotate X",group:"Object Rotation",default:0},{kind:"angle",key:"rotateY",label:"Rotate Y",group:"Object Rotation",default:0},{kind:"angle",key:"rotateZ",label:"Rotate Z",group:"Object Rotation",default:0},{kind:"slider",key:"autoRotateX",label:"Auto-Spin X",group:"Object Rotation",min:-180,max:180,step:.5,default:0},{kind:"slider",key:"autoRotateY",label:"Auto-Spin Y",group:"Object Rotation",min:-180,max:180,step:.5,default:0},{kind:"slider",key:"autoRotateZ",label:"Auto-Spin Z",group:"Object Rotation",min:-180,max:180,step:.5,default:0},{kind:"slider",key:"fovDeg",label:"FOV",group:"Camera",min:20,max:100,step:1,default:50},{kind:"slider",key:"cameraZ",label:"Distance",group:"Camera",min:1,max:8,step:.05,default:2.7}],Yo=ua(Ks);class ad{inner;bands=null;lastParams={...Yo};constructor(e,t){this.inner=new td(e,t)}setBands(e,t,a){this.bands={bass:e,mid:t,treble:a},this.applyParamsToInner()}setParams(e){this.lastParams={...Yo,...e},this.applyParamsToInner()}rgb01(e,t){return!Array.isArray(e)||e.length<3?t:[Math.max(0,Math.min(1,(e[0]??0)/255)),Math.max(0,Math.min(1,(e[1]??0)/255)),Math.max(0,Math.min(1,(e[2]??0)/255))]}applyParamsToInner(){const e=this.lastParams,t=!!e.audioReactive&&this.bands,a=t?this.bands.bass:0,o=t?this.bands.treble:0,r=e.gridSize??"48",s=r==="32"||r==="64"?Number(r):48;this.inner.setParams({gridSize:s,emission:e.emission??1.4,density:e.density??1.5,velocityDecay:e.velocityDecay??.985,densityDecay:e.densityDecay??.992,emitterCount:Math.max(1,Math.min(8,Math.round(e.emitterCount??4))),spread:e.spread??.3,spawnY:e.spawnY??-.5,splatRadius:e.splatRadius??.06,splatStrength:e.splatStrength??1.4,splatVelocityMag:e.splatVelocityMag??.6,splatRate:e.splatRate??6,bass:a,treble:o,audioBurst:e.audioBurst??.5,emitterColors:[this.rgb01(e.emitterColor1,[1,.4,.18]),this.rgb01(e.emitterColor2,[.18,.78,1]),this.rgb01(e.emitterColor3,[.85,.2,.85]),this.rgb01(e.emitterColor4,[.2,.95,.55]),this.rgb01(e.emitterColor5,[1,.85,.3]),this.rgb01(e.emitterColor6,[.5,.3,1]),this.rgb01(e.emitterColor7,[1,.3,.55]),this.rgb01(e.emitterColor8,[.3,1,.95])],volumeScaleX:e.volumeScaleX??1.6,volumeScaleZ:e.volumeScaleZ??1,windX:e.windX??0,windY:e.windY??0,windZ:e.windZ??0,turbStrength:e.turbStrength??.5,turbScale:e.turbScale??2.5,lightDirX:e.lightDirX??.4,lightDirY:e.lightDirY??.6,lightDirZ:e.lightDirZ??.7,lightStrength:e.lightStrength??.8,lightColor:this.rgb01(e.lightColor,[1,.95,.85]),ambient:e.ambient??.25,shadowSteps:Math.max(0,Math.min(12,Math.round(e.shadowSteps??4))),shadowStepLen:e.shadowStepLen??.06,fovDeg:e.fovDeg??50,cameraZ:e.cameraZ??2.7,rotateX:e.rotateX??0,rotateY:e.rotateY??0,rotateZ:e.rotateZ??0,autoRotateX:e.autoRotateX??0,autoRotateY:e.autoRotateY??0,autoRotateZ:e.autoRotateZ??0,fogColor:this.rgb01(e.fogColor,[.08,.1,.18]),fogOpacity:e.fogOpacity??1})}encodeFrame(e,t,a,o,r,s){this.inner.setViewport(o,r),e.beginRenderPass({colorAttachments:[{view:t,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]}).end(),this.inner.encodeFrame(e,t)}resize(e,t){}dispose(){try{this.inner.dispose()}catch{}}}const id={id:"planet",label:"Planet",description:"Ray-traced procedural planet — Earth, Mars, Jupiter, Saturn. Volumetric clouds, polar aurora, atmosphere, star field, Milky Way, and Saturn rings, all generated in one fragment shader.",category:"Generative",paramSchema:Os,defaultParams:Oo,needsSource:!1,create:(i,e)=>new Uc(i,e)},od={id:"pixel-particles",label:"Pixel Particles",description:"",category:"Source-driven",paramSchema:Ws,defaultParams:Vs,needsSource:!0,create:(i,e)=>new Nc(i,e)},rd={id:"flythrough",label:"Flythrough",description:"Endless tunnel of the source image / video: replicated into N slabs along Z, with the camera continuously flying through them. Particles swirl under curl-noise flow. Toggle between billboard points and worm-stroke topology for two distinct looks.",category:"Source-driven",paramSchema:qs,defaultParams:Wo,needsSource:!0,create:(i,e)=>new Qc(i,e)},sd={id:"point-cloud-fx",label:"Point Cloud FX",description:"Drop a .ply or .splat. Audio-reactive bass bursts, curl-noise wind, an orbiting proximity-wave field, dissolve, hue cycling — turn any point cloud into a living visual instrument. Worm-stroke topology gives the volumetric brush look as the cloud breathes.",category:"Source-driven",paramSchema:Ys,defaultParams:Vo,needsSource:!0,create:(i,e)=>new fu(i,e)},nd={id:"particle-field",label:"Particle Field",description:"A particle universe: galaxy arms, atomic orbital shells, boid swarms, vibrating crystalline lattices, curl-noise fields, or image/video-driven Refik-style spawns. Optional cellular scaffold layer with local + long-range connection lines in their own colors. Fog, lighting, and the full palette/mapping system on top. Make it look like outer space, sub-atomic, or anywhere in between.",category:"Source-driven",paramSchema:js,defaultParams:No,needsSource:!0,create:(i,e)=>new Au(i,e)},ld={id:"ink-cloud",label:"Ink Cloud",description:'Volumetric smoke / ink-in-water simulator. Up to 8 colored emitters spawn particles that age, disperse via multi-octave curl-noise turbulence, and respawn — the look of real ink dropped in water. Bass triggers fresh "bursts" of particles, treble adds shimmer, optional vortex pulls the cloud into a tornado.',category:"Generative",paramSchema:$s,defaultParams:qo,needsSource:!1,create:(i,e)=>new Ou(i,e)},cd={id:"smoke-3d",label:"3D Smoke",description:"True volumetric 3D smoke — voxel-grid Navier-Stokes simulation rendered by GPU raymarching. Real depth, real occlusion, real perspective foreshortening. Auto-orbital colored emitters splat density and velocity into the volume; bass kicks trigger synchronized bursts. Heavier than the 2D Fluid Smoke (try 32³ on integrated GPUs, 48³ as default, 64³ if you have a discrete GPU).",category:"Generative",paramSchema:Ks,defaultParams:Yo,needsSource:!1,create:(i,e)=>new ad(i,e)},ud=[id,od,rd,sd,nd,ld,cd],dd=new Map(ud.map(i=>[i.id,i]));function Ho(i){return dd.get(i)}class fd{state=null;startPromise=null;get senderName(){return this.state?.senderName??""}getLatestFrame(){return this.state?.latestFrame??null}get frameCount(){return this.state?.latestFrame?.frameId??0}async setSender(e){if(this.state?.senderName!==e&&(this.stop(),!!e)){this.startPromise=this.startInternal(e);try{await this.startPromise}finally{this.startPromise=null}}}async startInternal(e){let t=1920,a=1080;try{const r=await Se("spout_start_receiver",{senderName:e});r?.width&&(t=r.width),r?.height&&(a=r.height)}catch(r){console.warn("[SpoutCanvasReceiver] start failed (will retry on poll):",r)}const o={senderName:e,width:t,height:a,active:!0,rafId:null,inFlight:!1,reuseBuf:null,latestFrame:null,errorLogCount:0};this.state=o,Cl?this.startElectronPoll(o):this.startTauriPoll(o)}startElectronPoll(e){const t=()=>{if(e.active){if(e.inFlight){e.rafId=requestAnimationFrame(t);return}e.inFlight=!0,Se("spout_receive_frame").then(a=>{if(e.inFlight=!1,!e.active||!a||!a.data){e.active&&(e.rafId=requestAnimationFrame(t));return}this.acceptFrame(e,a.data,a.width,a.height),e.active&&(e.rafId=requestAnimationFrame(t))}).catch(a=>{e.inFlight=!1,e.errorLogCount<3&&(console.warn("[SpoutCanvasReceiver] IPC poll error:",a?.message||a),e.errorLogCount++),e.active&&(e.rafId=requestAnimationFrame(t))})}};e.rafId=requestAnimationFrame(t)}startTauriPoll(e){const t=async()=>{if(e.active){if(e.inFlight){e.rafId=requestAnimationFrame(t);return}e.inFlight=!0;try{const a=await fetch(`http://127.0.0.1:9002/spout/receive/${encodeURIComponent(e.senderName)}`);if(a.ok&&a.status!==204){const o=await a.arrayBuffer();this.acceptFrame(e,o,e.width,e.height)}}catch(a){e.errorLogCount<3&&(console.warn("[SpoutCanvasReceiver] HTTP poll error:",a),e.errorLogCount++)}finally{e.inFlight=!1}e.active&&(e.rafId=requestAnimationFrame(t))}};e.rafId=requestAnimationFrame(t)}acceptFrame(e,t,a,o){const r=a*o*4,s=new Uint8Array(t);if(s.byteLength!==r)return;(!e.reuseBuf||e.reuseBuf.byteLength!==r)&&(e.reuseBuf=new Uint8Array(r)),e.reuseBuf.set(s),e.width=a,e.height=o;const n=e.latestFrame;e.latestFrame={data:e.reuseBuf,width:a,height:o,frameId:(n?.frameId??0)+1}}stop(){const e=this.state;e&&(e.active=!1,e.rafId!==null&&(cancelAnimationFrame(e.rafId),e.rafId=null),Se("spout_stop_receiver",{senderName:e.senderName}).catch(()=>{}),this.state=null)}dispose(){this.stop()}}class pd{device;presentFormat;canvas;context;impl=null;currentShaderId=null;lastFrameTime=performance.now();configuredW=0;configuredH=0;cachedVideoEl=null;cachedVideoSrc="";lastResolvedSourceKey="";pendingImage=null;cameraStream=null;cameraDeviceId="";spoutReceiver=null;lastSpoutFrameId=0;constructor(e,t,a=1920,o=1080){this.device=e,this.presentFormat=t,this.canvas=document.createElement("canvas"),this.canvas.width=a,this.canvas.height=o;const r=this.canvas.getContext("webgpu");if(!r)throw new Error("webgpu context unavailable on gpu-layer canvas");this.context=r,this.context.configure({device:this.device,format:this.presentFormat,alphaMode:"premultiplied"}),this.configuredW=a,this.configuredH=o}renderFrame(e,t,a,o,r,s){if((!this.impl||this.currentShaderId!==e)&&this.swapShader(e),!this.impl)return;(a!==this.configuredW||o!==this.configuredH)&&this.resize(a,o),this.impl.setParams(t),s&&typeof this.impl.setBands=="function"&&this.impl.setBands(s.bass,s.mid,s.treble),Ho(e)?.needsSource&&this.impl.setSource&&r&&this.feedSource(t,r);const l=performance.now(),u=Math.min(.1,(l-this.lastFrameTime)/1e3);this.lastFrameTime=l;const f=this.device.createCommandEncoder();try{const d=this.context.getCurrentTexture().createView();this.impl.encodeFrame(f,d,this.presentFormat,this.canvas.width,this.canvas.height,u)}catch(d){console.warn("[gpuLayerRenderer] encode failed:",d?.message||d);return}this.device.queue.submit([f.finish()])}feedSource(e,t){if(!this.impl?.setSource)return;const a=e.source;if(this.cameraStream&&(!a||a.type!=="camera")&&this.releaseCamera(),this.spoutReceiver&&(!a||a.type!=="spout")&&(this.spoutReceiver.dispose(),this.spoutReceiver=null,this.lastSpoutFrameId=0),!!a){if(a.type==="media"&&a.mediaId){const o=t.mediaItems.find(r=>r.id===a.mediaId);if(!o)return;if(o.type==="video"){const r=o.videoElement||(o.src?this.ensureVideo(o.src):void 0);r&&(this.impl.setSource(r),this.lastResolvedSourceKey=`media:${o.id}:video`)}else if(o.src){const r=`media:${o.id}:${o.src}`;r!==this.lastResolvedSourceKey&&(this.lastResolvedSourceKey=r,this.loadImage(o.src))}}else if(a.type==="layer"&&a.layerId){const o=t.layers.find(r=>r.id===a.layerId);if(o&&o.source){const r=o.source,s=r.videoElement||(r.type==="video"&&r.src?this.ensureVideo(r.src):void 0);if(s)this.impl.setSource(s),this.lastResolvedSourceKey=`layer:${a.layerId}:video`;else if(r.src){const n=`layer:${a.layerId}:${r.src}`;n!==this.lastResolvedSourceKey&&(this.lastResolvedSourceKey=n,this.loadImage(r.src))}}}else if(a.type==="file"&&a.url){const o=a.name??a.url,r=a.mime?.startsWith("video/")||/\.(mp4|webm|mov|m4v)(\?|$)/i.test(o),s=/\.ply(\?|$)/i.test(o),n=/\.splat(\?|$)/i.test(o);if(s||n)if(typeof this.impl.setSourceBuffer!="function")this.lastResolvedSourceKey!==`pcerr:${a.url}`&&(this.lastResolvedSourceKey=`pcerr:${a.url}`,console.warn("[gpuLayerRenderer] active shader does not consume point clouds; pick a different shader (e.g. Point Cloud FX) to use this file."));else{const u=`pc:${a.url}`;if(u!==this.lastResolvedSourceKey){this.lastResolvedSourceKey=u;const f=this.impl;fetch(a.url).then(d=>d.arrayBuffer()).then(d=>{this.impl===f&&f.setSourceBuffer(d,n?"splat":"ply",u)}).catch(d=>console.warn("[gpuLayerRenderer] point cloud fetch failed:",d?.message||d))}}else if(r){const l=this.ensureVideo(a.url);l&&this.impl.setSource(l)}else{const l=`file:${a.url}`;l!==this.lastResolvedSourceKey&&(this.lastResolvedSourceKey=l,this.loadImage(a.url))}}else if(a.type==="camera"){const o=a.deviceId||"";(!this.cameraStream||this.cameraDeviceId!==o)&&this.startCamera(o),this.cachedVideoEl&&this.cameraStream&&(this.impl.setSource(this.cachedVideoEl),this.lastResolvedSourceKey=`camera:${o||"default"}`)}else if(a.type==="spout"&&a.senderName){this.spoutReceiver||(this.spoutReceiver=new fd,this.lastSpoutFrameId=0),this.spoutReceiver.senderName!==a.senderName&&(this.spoutReceiver.setSender(a.senderName),this.lastSpoutFrameId=0);const o=this.spoutReceiver.getLatestFrame();o&&o.frameId!==this.lastSpoutFrameId&&this.impl.setSourceFromBytes&&(this.impl.setSourceFromBytes(o.data,o.width,o.height),this.lastSpoutFrameId=o.frameId,this.lastResolvedSourceKey=`spout:${a.senderName}`)}}}async startCamera(e){if(this.releaseCamera(),this.cachedVideoEl&&this.cachedVideoSrc){try{this.cachedVideoEl.pause(),this.cachedVideoEl.removeAttribute("src"),this.cachedVideoEl.load()}catch{}this.cachedVideoSrc=""}try{const t={video:e?{deviceId:{exact:e}}:!0,audio:!1},a=await navigator.mediaDevices.getUserMedia(t);this.cameraStream=a,this.cameraDeviceId=e;const o=this.cachedVideoEl??document.createElement("video");o.muted=!0,o.playsInline=!0,o.autoplay=!0,o.srcObject=a,this.cachedVideoEl=o;try{await o.play()}catch{}}catch(t){console.warn("[gpuLayerRenderer] getUserMedia failed:",t?.message||t),this.cameraStream=null,this.cameraDeviceId=""}}releaseCamera(){if(this.cameraStream){try{this.cameraStream.getTracks().forEach(e=>e.stop())}catch{}this.cameraStream=null}if(this.cameraDeviceId="",this.cachedVideoEl&&this.cachedVideoEl.srcObject)try{this.cachedVideoEl.srcObject=null}catch{}}ensureVideo(e){if(this.cachedVideoEl&&this.cachedVideoSrc===e)return this.cachedVideoEl;if(this.cachedVideoEl&&this.cachedVideoSrc!==e)try{this.cachedVideoEl.pause(),this.cachedVideoEl.removeAttribute("src"),this.cachedVideoEl.load()}catch{}const t=this.cachedVideoEl??document.createElement("video");return t.muted=!0,t.playsInline=!0,t.loop=!0,t.autoplay=!0,t.crossOrigin=/^(https?:|ghost-asset:)/i.test(e)?"anonymous":null,t.src=e,this.cachedVideoSrc=e,this.cachedVideoEl=t,t.play().catch(()=>{}),t}loadImage(e){const t=new Image;/^(https?:|ghost-asset:)/i.test(e)&&(t.crossOrigin="anonymous"),t.onload=()=>{this.impl?.setSource&&this.impl.setSource(t)},t.onerror=a=>console.warn("[gpuLayerRenderer] image load failed",e,a),t.src=e,this.pendingImage=t}swapShader(e){const t=Ho(e);if(!t){console.warn("[gpuLayerRenderer] unknown shader id:",e),this.disposeImpl();return}this.disposeImpl();try{this.impl=t.create(this.device,this.presentFormat),this.currentShaderId=e,console.log("[gpuLayerRenderer] active shader:",e)}catch(a){console.error("[gpuLayerRenderer] failed to create shader",e,a?.message||a),this.impl=null,this.currentShaderId=null}}resize(e,t){e<=0||t<=0||(this.canvas.width=e,this.canvas.height=t,this.context.configure({device:this.device,format:this.presentFormat,alphaMode:"premultiplied"}),this.configuredW=e,this.configuredH=t,this.impl?.resize&&this.impl.resize(e,t))}disposeImpl(){if(this.impl){try{this.impl.dispose()}catch{}this.impl=null,this.currentShaderId=null}}dispose(){if(this.disposeImpl(),this.releaseCamera(),this.spoutReceiver&&(this.spoutReceiver.dispose(),this.spoutReceiver=null),this.cachedVideoEl){try{this.cachedVideoEl.pause(),this.cachedVideoEl.removeAttribute("src"),this.cachedVideoEl.load()}catch{}this.cachedVideoEl=null}}}const jo=ii([]);function ra(i,e="error"){const t=Date.now();jo.update(a=>[...a,{id:t,message:i,type:e}]),setTimeout(()=>{jo.update(a=>a.filter(o=>o.id!==t))},5e3)}function Ep(i){jo.update(e=>e.filter(t=>t.id!==i))}function hd(i,e,t,a){if(a==="none")return!1;switch(i.fillStyle="#000",i.fillRect(0,0,e,t),a){case"grid":md(i,e,t);break;case"crosshair":vd(i,e,t);break;case"color-bars":gd(i,e,t);break;case"white":i.fillStyle="#fff",i.fillRect(0,0,e,t);break;case"gradient":yd(i,e,t);break;case"checkerboard":bd(i,e,t);break}return i.fillStyle="rgba(255, 255, 255, 0.6)",i.font=`${Math.max(14,t/50)}px monospace`,i.textAlign="left",i.textBaseline="top",i.fillText(`${e}×${t}`,10,10),!0}function md(i,e,t){const a=Math.max(e,t)/16;i.strokeStyle="#333",i.lineWidth=1,i.beginPath();for(let l=a;l<e;l+=a)i.moveTo(l,0),i.lineTo(l,t);for(let l=a;l<t;l+=a)i.moveTo(0,l),i.lineTo(e,l);i.stroke(),i.strokeStyle="#fff",i.lineWidth=2,i.strokeRect(2,2,e-4,t-4),i.strokeStyle="#f00",i.lineWidth=1,i.beginPath(),i.moveTo(e/2,0),i.lineTo(e/2,t),i.moveTo(0,t/2),i.lineTo(e,t/2),i.stroke(),i.beginPath(),i.arc(e/2,t/2,Math.min(e,t)/8,0,Math.PI*2),i.stroke();const o=a*2;i.strokeStyle="#0f0",i.lineWidth=2;const r=[[0,0],[e,0],[0,t],[e,t]];for(const[l,u]of r){const f=l===0?1:-1,d=u===0?1:-1;i.beginPath(),i.moveTo(l+f*o,u),i.lineTo(l,u),i.lineTo(l,u+d*o),i.stroke()}i.strokeStyle="rgba(0, 128, 255, 0.4)",i.lineWidth=1,i.setLineDash([8,4]);const s=e*.05,n=t*.05;i.strokeRect(s,n,e*.9,t*.9),i.setLineDash([])}function vd(i,e,t){const a=e/2,o=t/2,r=Math.min(e,t)*.35;i.strokeStyle="#fff",i.lineWidth=1,i.beginPath(),i.moveTo(a,0),i.lineTo(a,t),i.moveTo(0,o),i.lineTo(e,o),i.stroke(),i.strokeStyle="#888";for(let s=r;s>10;s-=r/5)i.beginPath(),i.arc(a,o,s,0,Math.PI*2),i.stroke();i.fillStyle="#f00",i.beginPath(),i.arc(a,o,4,0,Math.PI*2),i.fill(),i.strokeStyle="#fff",i.lineWidth=2,i.strokeRect(1,1,e-2,t-2)}function gd(i,e,t){const a=["#fff","#ff0","#0ff","#0f0","#f0f","#f00","#00f","#000"],o=e/a.length,r=t*.67;for(let d=0;d<a.length;d++)i.fillStyle=a[d],i.fillRect(d*o,0,o+1,r);const s=["#00f","#000","#f0f","#000","#0ff","#000","#fff"],n=e/s.length,l=t*.08;for(let d=0;d<s.length;d++)i.fillStyle=s[d],i.fillRect(d*n,r,n+1,l);const u=r+l,f=t-u;for(let d=0;d<e;d++){const h=Math.round(d/e*255);i.fillStyle=`rgb(${h},${h},${h})`,i.fillRect(d,u,1,f)}}function yd(i,e,t){const a=i.createLinearGradient(0,0,e,0);a.addColorStop(0,"#000"),a.addColorStop(1,"#fff"),i.fillStyle=a,i.fillRect(0,0,e,t*.5);const o=i.createLinearGradient(0,t*.5,0,t);o.addColorStop(0,"#000"),o.addColorStop(1,"#fff"),i.fillStyle=o,i.fillRect(0,t*.5,e,t*.5);const r=t*.1,s=t*.45,n=16,l=e/n;for(let u=0;u<n;u++){const f=Math.round(u/(n-1)*255);i.fillStyle=`rgb(${f},${f},${f})`,i.fillRect(u*l,s,l+1,r)}}function bd(i,e,t){const a=Math.max(e,t)/32;for(let o=0;o<t;o+=a)for(let r=0;r<e;r+=a){const s=(Math.floor(r/a)+Math.floor(o/a))%2===0;i.fillStyle=s?"#fff":"#000",i.fillRect(r,o,a,a)}}const xd={blackout:!1,brightness:1,gamma:1,contrast:1,edgeBlendLeft:0,edgeBlendRight:0,edgeBlendTop:0,edgeBlendBottom:0,edgeBlendGamma:2.2};function gs(i,e,t,a){const o={...xd,...a},r=o.edgeBlendGamma;if(o.edgeBlendLeft>0){const s=Math.round(e*o.edgeBlendLeft);for(let n=0;n<s;n++){const l=n/s,u=1-Math.pow(l,1/r);i.fillStyle=`rgba(0,0,0,${u})`,i.fillRect(n,0,1,t)}}if(o.edgeBlendRight>0){const s=Math.round(e*o.edgeBlendRight);for(let n=0;n<s;n++){const l=n/s,u=1-Math.pow(l,1/r);i.fillStyle=`rgba(0,0,0,${u})`,i.fillRect(e-1-n,0,1,t)}}if(o.edgeBlendTop>0){const s=Math.round(t*o.edgeBlendTop);for(let n=0;n<s;n++){const l=n/s,u=1-Math.pow(l,1/r);i.fillStyle=`rgba(0,0,0,${u})`,i.fillRect(0,n,e,1)}}if(o.edgeBlendBottom>0){const s=Math.round(t*o.edgeBlendBottom);for(let n=0;n<s;n++){const l=n/s,u=1-Math.pow(l,1/r);i.fillStyle=`rgba(0,0,0,${u})`,i.fillRect(0,t-1-n,e,1)}}}let lt=null,Xo=null,Js=null,ys=null,$a=null,xt=null,Ut=null;const wd=new Map;let Xt=null,Na=null,bs=0,xs=0;const Pt=32,Sd=`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`,Qs=`
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uSource;
  // Crop region for rect mode (normalized 0..1 on master canvas).
  uniform vec4 uCrop;          // (x, y, w, h)
  // Warp mode discriminator: 0 = rect, 1 = corners, 2 = mesh.
  uniform int uWarpMode;
  // Corners mode: 4 sample positions on the master canvas. UV order:
  //   TL = (uCornerTL.xy), TR = (uCornerTR.xy)
  //   BL = (uCornerBL.xy), BR = (uCornerBR.xy)
  // Bilinear interpolated across vUv to produce the source sample.
  uniform vec2 uCornerTL;
  uniform vec2 uCornerTR;
  uniform vec2 uCornerBL;
  uniform vec2 uCornerBR;
  // Mesh mode: control-point texture (RG float, MAX_MESH × MAX_MESH).
  // Each texel encodes one point's (x, y) on the master canvas.
  // Only the (uMeshRows × uMeshCols) sub-rect is meaningful.
  uniform sampler2D uMeshTex;
  uniform int uMeshRows;
  uniform int uMeshCols;

  // Rotation: 0/1/2/3 = 0/90/180/270 degrees.
  uniform int uRotation;
  // Color correction (linear-space).
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uGamma;
  // Edge blend widths per edge (0..0.5 of the slice).
  uniform vec4 uBlendW;        // (left, right, top, bottom)
  uniform vec4 uBlendG;        // (left, right, top, bottom) S-curve power
  uniform vec3 uBlackLevel;
  uniform float uBlackFeather;
  // Stage-effect intensity multiplier (0..1). Modulates the screen's
  // brightness based on the bound stage effect's per-frame value.
  // Defaults to 1.0 when no stage effect is bound.
  uniform float uStageIntensity;

  vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  vec3 linearToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  float blendCurve(float x, float p) {
    if (x < 0.5) return 0.5 * pow(2.0 * x, p);
    return 1.0 - 0.5 * pow(2.0 * (1.0 - x), p);
  }

  // Read one mesh control point from the texture. Texels are
  // center-sampled so (col + 0.5) / texDim avoids edge bleeding.
  vec2 meshAt(int ri, int ci) {
    float texDim = ${Pt}.0;
    vec2 uv = vec2((float(ci) + 0.5) / texDim, (float(ri) + 0.5) / texDim);
    return texture2D(uMeshTex, uv).rg;
  }

  // Inverse bilinear: given a point p and a quad (a, b, c, d) where
  // bilinear(a, b, c, d, u, v) = mix(mix(a, b, u), mix(d, c, u), v),
  // find (u, v) such that the formula equals p. Returns (-1, -1) if
  // p is outside the quad. Closed-form solution from Inigo Quilez:
  // https://www.iquilezles.org/www/articles/ibilinear/ibilinear.htm
  // Quad winding here: a=TL, b=TR, c=BR, d=BL.
  float cross2D(vec2 v, vec2 w) { return v.x * w.y - v.y * w.x; }
  vec2 invBilinear(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
    vec2 e = b - a;
    vec2 f = d - a;
    vec2 g = a - b + c - d;
    vec2 h = p - a;
    float k2 = cross2D(g, f);
    float k1 = cross2D(e, f) + cross2D(h, g);
    float k0 = cross2D(h, e);
    if (abs(k2) < 0.0001) {
      // Degenerate to a parallelogram (k2 ≈ 0): linear solve.
      float v = -k0 / k1;
      float denomU = e.x + g.x * v;
      float u = abs(denomU) > 0.0001
        ? (h.x - f.x * v) / denomU
        : (h.y - f.y * v) / (e.y + g.y * v);
      return vec2(u, v);
    }
    float w = k1 * k1 - 4.0 * k0 * k2;
    if (w < 0.0) return vec2(-1.0);
    w = sqrt(w);
    float v1 = (-k1 - w) / (2.0 * k2);
    float v2 = (-k1 + w) / (2.0 * k2);
    // Pick the root that lies in [0, 1].
    float v = (v1 >= 0.0 && v1 <= 1.0) ? v1 : v2;
    float denomU = e.x + g.x * v;
    float u = abs(denomU) > 0.0001
      ? (h.x - f.x * v) / denomU
      : (h.y - f.y * v) / (e.y + g.y * v);
    return vec2(u, v);
  }

  void main() {
    vec2 uv = vUv;
    // Rotate the projector-side UV first so "left" / "top" in the
    // operator's mental model always match the projector's physical
    // edges, independent of which way the screen is mounted.
    if (uRotation == 1) uv = vec2(uv.y, 1.0 - uv.x);
    else if (uRotation == 2) uv = vec2(1.0 - uv.x, 1.0 - uv.y);
    else if (uRotation == 3) uv = vec2(1.0 - uv.y, uv.x);

    // ─ Forward map: projector UV → master canvas sample position. ─
    vec2 srcUv;
    if (uWarpMode == 1) {
      // Corners: bilinear interpolation of the 4 corner positions.
      // Top row = mix(TL, TR), bottom row = mix(BL, BR), then mix
      // them down by uv.y. This is the same projective approximation
      // MadMapper / Resolume use for their quad-warp.
      vec2 top    = mix(uCornerTL, uCornerTR, uv.x);
      vec2 bottom = mix(uCornerBL, uCornerBR, uv.x);
      srcUv = mix(top, bottom, uv.y);
    } else if (uWarpMode == 2 && uMeshRows > 1 && uMeshCols > 1) {
      // Mesh: find the cell containing this UV, then bilinear-interp
      // the cell's 4 corner sample positions.
      float fx = uv.x * float(uMeshCols - 1);
      float fy = uv.y * float(uMeshRows - 1);
      int ci = int(clamp(floor(fx), 0.0, float(uMeshCols - 2)));
      int ri = int(clamp(floor(fy), 0.0, float(uMeshRows - 2)));
      float u = clamp(fx - float(ci), 0.0, 1.0);
      float v = clamp(fy - float(ri), 0.0, 1.0);
      vec2 p00 = meshAt(ri,     ci);
      vec2 p10 = meshAt(ri,     ci + 1);
      vec2 p01 = meshAt(ri + 1, ci);
      vec2 p11 = meshAt(ri + 1, ci + 1);
      srcUv = mix(mix(p00, p10, u), mix(p01, p11, u), v);
    } else if (uWarpMode == 3) {
      // ─ Master warp: FORWARD / destination semantics (matches the
      //   layer "map mode" feel). The four corners are where the
      //   content's corners LAND on the output, and the mesh (if any)
      //   deforms WITHIN that corner-pinned quad. We invert that forward
      //   map to sample: output uv → quad-local q (inverse-bilinear over
      //   the corner quad) → if a mesh is present, invert the mesh
      //   deformation per-cell → content UV. Pixels outside the quad are
      //   black — so pulling a corner inward crops/keystones the image,
      //   exactly like dragging a layer's corner in map mode.
      vec2 q = invBilinear(uv, uCornerTL, uCornerTR, uCornerBR, uCornerBL);
      if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      if (uMeshRows > 1 && uMeshCols > 1) {
        // Invert the mesh deformation: the mesh control points are in
        // quad-local 0..1 coords, so find the deformed cell containing q
        // and inverse-bilinear to recover the content UV.
        bool found = false;
        vec2 cellUv = vec2(0.0);
        for (int ri = 0; ri < ${Pt} - 1; ri++) {
          if (ri >= uMeshRows - 1) break;
          for (int ci = 0; ci < ${Pt} - 1; ci++) {
            if (ci >= uMeshCols - 1) break;
            if (found) continue;
            vec2 a = meshAt(ri,     ci);
            vec2 b = meshAt(ri,     ci + 1);
            vec2 c = meshAt(ri + 1, ci + 1);
            vec2 d = meshAt(ri + 1, ci);
            vec2 t = invBilinear(q, a, b, c, d);
            if (t.x >= 0.0 && t.x <= 1.0 && t.y >= 0.0 && t.y <= 1.0) {
              float gu = (float(ci) + t.x) / float(uMeshCols - 1);
              float gv = (float(ri) + t.y) / float(uMeshRows - 1);
              cellUv = vec2(gu, gv);
              found = true;
            }
          }
        }
        if (!found) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        srcUv = cellUv;
      } else {
        srcUv = q;
      }
    } else {
      // Rect (default fallback): the original axis-aligned crop.
      srcUv = uCrop.xy + uv * uCrop.zw;
    }

    vec4 src = texture2D(uSource, srcUv);
    vec3 col = srgbToLinear(src.rgb);

    col *= uBrightness;
    col = (col - 0.5) * uContrast + 0.5;
    col = pow(max(col, 0.0), vec3(1.0 / uGamma));

    // Edge blend alpha — projector-side UV, so "left" is always the
    // physical left edge of the projected image.
    float aL = uBlendW.x > 0.0 ? blendCurve(clamp(vUv.x / uBlendW.x, 0.0, 1.0), uBlendG.x) : 1.0;
    float aR = uBlendW.y > 0.0 ? blendCurve(clamp((1.0 - vUv.x) / uBlendW.y, 0.0, 1.0), uBlendG.y) : 1.0;
    float aT = uBlendW.z > 0.0 ? blendCurve(clamp((1.0 - vUv.y) / uBlendW.z, 0.0, 1.0), uBlendG.z) : 1.0;
    float aB = uBlendW.w > 0.0 ? blendCurve(clamp(vUv.y / uBlendW.w, 0.0, 1.0), uBlendG.w) : 1.0;
    float alpha = aL * aR * aT * aB;

    float liftMix = mix(alpha, smoothstep(0.0, 1.0, alpha), uBlackFeather);
    col += uBlackLevel * liftMix;

    col *= alpha * uStageIntensity;

    gl_FragColor = vec4(linearToSrgb(clamp(col, 0.0, 1.0)), 1.0);
  }
`;function Za(){if(Ut)return Ut;const i=new Float32Array(Pt*Pt*2);return Ut=new St(i,Pt,Pt,Ds,zs),Ut.magFilter=Wi,Ut.minFilter=Wi,Ut.wrapS=Tt,Ut.wrapT=Tt,Ut.needsUpdate=!0,Ut}function _d(i){const e=i.meshGrid;return e?`${e.rows}x${e.cols}:${JSON.stringify(e.points)}`:"none"}function Cd(i,e,t,a){if(!t||t.rows<2||t.cols<2)return Za();const o=i.get(e);if(o&&o.hash===a)return o.tex;const r=new Float32Array(Pt*Pt*2);for(let n=0;n<t.rows;n++)for(let l=0;l<t.cols;l++){const u=t.points[n]?.[l],f=(n*Pt+l)*2;r[f]=u?.x??0,r[f+1]=u?.y??0}if(o)return o.tex.image.data.set(r),o.tex.needsUpdate=!0,i.set(e,{tex:o.tex,hash:a,cols:t.cols,rows:t.rows}),o.tex;const s=new St(r,Pt,Pt,Ds,zs);return s.magFilter=Wi,s.minFilter=Wi,s.wrapS=Tt,s.wrapT=Tt,s.needsUpdate=!0,i.set(e,{tex:s,hash:a,cols:t.cols,rows:t.rows}),s}function ws(i){return Cd(wd,i.id,i.meshGrid,_d(i))}function en(i,e){if(lt&&Xt){const t=Xt.width,a=Xt.height;if(t<i||a<e)try{lt.setSize(Math.max(t,i),Math.max(a,e),!1)}catch{return!1}return!0}try{return typeof OffscreenCanvas<"u"?Xt=new OffscreenCanvas(i,e):(Xt=document.createElement("canvas"),Xt.width=i,Xt.height=e),lt=new rr({canvas:Xt,antialias:!1,alpha:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1}),lt.setPixelRatio(1),lt.setSize(i,e,!1),lt.outputColorSpace=Ea,Xo=new ea,Js=new Ra(-1,1,1,-1,0,1),$a=new ai({vertexShader:Sd,fragmentShader:Qs,uniforms:{uSource:{value:null},uCrop:{value:new ot(0,0,1,1)},uWarpMode:{value:0},uCornerTL:{value:new fe(0,0)},uCornerTR:{value:new fe(1,0)},uCornerBL:{value:new fe(0,1)},uCornerBR:{value:new fe(1,1)},uMeshTex:{value:Za()},uMeshRows:{value:0},uMeshCols:{value:0},uRotation:{value:0},uBrightness:{value:1},uContrast:{value:1},uGamma:{value:1},uBlendW:{value:new ot(0,0,0,0)},uBlendG:{value:new ot(2.2,2.2,2.2,2.2)},uBlackLevel:{value:new He(0,0,0)},uBlackFeather:{value:.5},uStageIntensity:{value:1}},depthTest:!1,depthWrite:!1}),ys=new Ba(new Aa(2,2),$a),Xo.add(ys),!0}catch(t){return console.warn("[blendRenderer] WebGL init failed; falling back to 2D canvas path",t),lt=null,!1}}function Pd(i){(!xt||xt.image!==i)&&(xt&&xt.dispose(),xt=new Zt(i),xt.flipY=!1,xt.minFilter=le,xt.magFilter=le,xt.wrapS=Tt,xt.wrapT=Tt,xt.colorSpace=Ea),xt.needsUpdate=!0,$a&&($a.uniforms.uSource.value=xt)}function tn(i,e,t,a){i.uCrop.value.set(e.cropX,e.cropY,e.cropW,e.cropH);const o=e.warpMode??"rect";if(a){const n=e.corners??{topLeft:{x:0,y:0},topRight:{x:1,y:0},bottomLeft:{x:0,y:1},bottomRight:{x:1,y:1}};i.uWarpMode.value=3,i.uCornerTL.value.set(n.topLeft.x,n.topLeft.y),i.uCornerTR.value.set(n.topRight.x,n.topRight.y),i.uCornerBL.value.set(n.bottomLeft.x,n.bottomLeft.y),i.uCornerBR.value.set(n.bottomRight.x,n.bottomRight.y),e.meshGrid&&e.meshGrid.rows>=2&&e.meshGrid.cols>=2?(i.uMeshRows.value=e.meshGrid.rows,i.uMeshCols.value=e.meshGrid.cols,i.uMeshTex.value=ws(e)):(i.uMeshRows.value=1,i.uMeshCols.value=1,i.uMeshTex.value=Za())}else if(o==="corners"){const n=e.corners??{topLeft:{x:e.cropX,y:e.cropY},topRight:{x:e.cropX+e.cropW,y:e.cropY},bottomLeft:{x:e.cropX,y:e.cropY+e.cropH},bottomRight:{x:e.cropX+e.cropW,y:e.cropY+e.cropH}};i.uWarpMode.value=1,i.uCornerTL.value.set(n.topLeft.x,n.topLeft.y),i.uCornerTR.value.set(n.topRight.x,n.topRight.y),i.uCornerBL.value.set(n.bottomLeft.x,n.bottomLeft.y),i.uCornerBR.value.set(n.bottomRight.x,n.bottomRight.y)}else o==="mesh"&&e.meshGrid&&e.meshGrid.rows>=2&&e.meshGrid.cols>=2?(i.uWarpMode.value=2,i.uMeshRows.value=e.meshGrid.rows,i.uMeshCols.value=e.meshGrid.cols,i.uMeshTex.value=ws(e)):(i.uWarpMode.value=0,i.uMeshTex.value=Za());const r=e.rotation===90?1:e.rotation===180?2:e.rotation===270?3:0;i.uRotation.value=r,i.uBrightness.value=e.brightness,i.uContrast.value=e.contrast,i.uGamma.value=e.gamma,i.uBlendW.value.set(e.edgeBlendLeft,e.edgeBlendRight,e.edgeBlendTop,e.edgeBlendBottom);const s=e.edgeBlendGamma;i.uBlendG.value.set(e.edgeBlendLeftGamma??s,e.edgeBlendRightGamma??s,e.edgeBlendTopGamma??s,e.edgeBlendBottomGamma??s),i.uBlackLevel.value.set(e.blackLevelR??0,e.blackLevelG??0,e.blackLevelB??0),i.uBlackFeather.value=e.blackLevelFeather??.5,i.uStageIntensity.value=Math.max(0,Math.min(1,t))}function kd(i,e,t,a,o=1,r=!0,s=!1){if(t<=0||a<=0||!en(t,a))return null;Pd(i),tn($a.uniforms,e,o,s);try{lt.setViewport(0,0,t,a),lt.setScissor(0,0,t,a),lt.setScissorTest(!0),lt.render(Xo,Js);const n=lt.getContext();return(!Na||bs!==t||xs!==a)&&(Na=new Uint8Array(t*a*4),bs=t,xs=a),n.readPixels(0,0,t,a,n.RGBA,n.UNSIGNED_BYTE,Na),r&&Bd(Na,t,a),Na}catch(n){return console.warn("[blendRenderer] render/readback failed",n),null}finally{lt&&lt.setScissorTest(!1)}}let Mo=null;const Td=`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Negate Y so the rendered framebuffer matches the orientation the old
    // readPixels(flip=false)+putImageData path produced (see note above).
    gl_Position = vec4(position.x, -position.y, position.z, 1.0);
  }
`;let $t=null,it=null,$o=null,an=null,Vi=null,Ss=null,wt=null;function on(i,e){if($t&&it)return(it.width!==i||it.height!==e)&&(it.width=i,it.height=e,$t.setSize(i,e,!1)),!0;try{return it=document.createElement("canvas"),it.width=i,it.height=e,it.setAttribute("aria-hidden","true"),it.style.cssText="position:fixed;left:-99999px;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;",document.body.appendChild(it),$t=new rr({canvas:it,antialias:!1,alpha:!1,preserveDrawingBuffer:!0,premultipliedAlpha:!1}),$t.setPixelRatio(1),$t.setSize(i,e,!1),$t.outputColorSpace=Ea,$o=new ea,an=new Ra(-1,1,1,-1,0,1),Vi=new ai({vertexShader:Td,fragmentShader:Qs,uniforms:{uSource:{value:null},uCrop:{value:new ot(0,0,1,1)},uWarpMode:{value:0},uCornerTL:{value:new fe(0,0)},uCornerTR:{value:new fe(1,0)},uCornerBL:{value:new fe(0,1)},uCornerBR:{value:new fe(1,1)},uMeshTex:{value:Za()},uMeshRows:{value:0},uMeshCols:{value:0},uRotation:{value:0},uBrightness:{value:1},uContrast:{value:1},uGamma:{value:1},uBlendW:{value:new ot(0,0,0,0)},uBlendG:{value:new ot(2.2,2.2,2.2,2.2)},uBlackLevel:{value:new He(0,0,0)},uBlackFeather:{value:.5},uStageIntensity:{value:1}},depthTest:!1,depthWrite:!1}),Ss=new Ba(new Aa(2,2),Vi),$o.add(Ss),!0}catch(t){return console.warn("[blendRenderer] master renderer init failed",t),$t=null,it=null,!1}}function Md(i,e,t,a){if(t<=0||a<=0||!on(t,a))return null;Mo||(Mo=kl("__master_warp__","Master","master"));const o=Mo;o.cropX=0,o.cropY=0,o.cropW=1,o.cropH=1,o.warpMode="corners",o.corners=e.corners??Pl(),o.meshGrid=e.meshGrid&&e.meshGrid.rows>=2&&e.meshGrid.cols>=2?e.meshGrid:void 0,o.rotation=0,o.brightness=1,o.contrast=1,o.gamma=1,o.edgeBlendLeft=0,o.edgeBlendRight=0,o.edgeBlendTop=0,o.edgeBlendBottom=0,o.blackLevelR=0,o.blackLevelG=0,o.blackLevelB=0,(!wt||wt.image!==i)&&(wt&&wt.dispose(),wt=new Zt(i),wt.flipY=!1,wt.minFilter=le,wt.magFilter=le,wt.wrapS=Tt,wt.wrapT=Tt,wt.colorSpace=Ea),wt.needsUpdate=!0,Vi.uniforms.uSource.value=wt,tn(Vi.uniforms,o,1,!0);try{return $t.render($o,an),it}catch(r){return console.warn("[blendRenderer] master warp render failed",r),null}}function Rd(){return it}function Ad(i,e){return i<=0||e<=0||!on(i,e)?null:it}function Bd(i,e,t){const a=e*4,o=new Uint8Array(a);for(let r=0;r<t>>1;r++){const s=r*a,n=(t-1-r)*a;o.set(i.subarray(s,s+a)),i.copyWithin(s,n,n+a),i.set(o,n)}}function rn(){return lt?!0:en(1920,1080)}const Fp=[{id:"demucs-4",name:"Demucs / 4-stem stereo (BlackHole 8ch+)",channelCount:8,stems:[{id:"drums",label:"Drums",channels:[0,1]},{id:"bass",label:"Bass",channels:[2,3]},{id:"vocals",label:"Vocals",channels:[4,5]},{id:"other",label:"Other",channels:[6,7]}]},{id:"stereo-mono-4",name:"4 mono stems (BlackHole 4ch)",channelCount:4,stems:[{id:"stem1",label:"Stem 1",channels:[0]},{id:"stem2",label:"Stem 2",channels:[1]},{id:"stem3",label:"Stem 3",channels:[2]},{id:"stem4",label:"Stem 4",channels:[3]}]},{id:"octo-mono-8",name:"8 mono stems (BlackHole 8ch)",channelCount:8,stems:[{id:"stem1",label:"Stem 1",channels:[0]},{id:"stem2",label:"Stem 2",channels:[1]},{id:"stem3",label:"Stem 3",channels:[2]},{id:"stem4",label:"Stem 4",channels:[3]},{id:"stem5",label:"Stem 5",channels:[4]},{id:"stem6",label:"Stem 6",channels:[5]},{id:"stem7",label:"Stem 7",channels:[6]},{id:"stem8",label:"Stem 8",channels:[7]}]}];class Ed{stream=null;audioCtx=null;streamSource=null;splitter=null;stems=[];deviceId=null;layout=null;async start(e,t){await this.stop();const a=Gt.getOrCreateAudioContext();this.audioCtx=a,this.deviceId=e,this.layout=t;const o={audio:{deviceId:{exact:e},echoCancellation:!1,noiseSuppression:!1,autoGainControl:!1,channelCount:{exact:t.channelCount}}};this.stream=await navigator.mediaDevices.getUserMedia(o),this.streamSource=a.createMediaStreamSource(this.stream),this.splitter=a.createChannelSplitter(t.channelCount),this.streamSource.connect(this.splitter),this.stems=t.stems.map(r=>{const s=a.createGain();s.gain.value=r.channels.length>1?1/r.channels.length:1;for(const l of r.channels)this.splitter.connect(s,l);const n=a.createAnalyser();return n.fftSize=1024,n.smoothingTimeConstant=.6,s.connect(n),{id:r.id,label:r.label,channels:r.channels,sourceNode:s,analyser:n}})}getStems(){return this.stems}getStem(e){return this.stems.find(t=>t.id===e)??null}getLayout(){return this.layout}getDeviceId(){return this.deviceId}isRunning(){return this.stems.length>0}async stop(){if(this.streamSource){try{this.streamSource.disconnect()}catch{}this.streamSource=null}if(this.splitter){try{this.splitter.disconnect()}catch{}this.splitter=null}for(const e of this.stems)try{e.sourceNode.disconnect()}catch{}this.stems=[],this.stream&&(this.stream.getTracks().forEach(e=>e.stop()),this.stream=null),this.deviceId=null,this.layout=null}}const _s=new Ed,Cs=200,Ps=2e3;class Fd{audioCtx;chains=[];bassSum;midSum;trebSum;output;matrix={};constructor(e){this.audioCtx=e,this.bassSum=e.createGain(),this.midSum=e.createGain(),this.trebSum=e.createGain(),this.output=e.createGain(),this.bassSum.connect(this.output),this.midSum.connect(this.output),this.trebSum.connect(this.output)}setStems(e){this.disposeChains();for(const t of e){const a=this.audioCtx.createBiquadFilter();a.type="lowpass",a.frequency.value=Cs,a.Q.value=.7;const o=this.audioCtx.createBiquadFilter();o.type="bandpass",o.frequency.value=Math.sqrt(Cs*Ps),o.Q.value=.7;const r=this.audioCtx.createBiquadFilter();r.type="highpass",r.frequency.value=Ps,r.Q.value=.7;const s=this.audioCtx.createGain(),n=this.audioCtx.createGain(),l=this.audioCtx.createGain();s.gain.value=this._matGain(t.id,"bass"),n.gain.value=this._matGain(t.id,"mid"),l.gain.value=this._matGain(t.id,"treb"),t.sourceNode.connect(a),t.sourceNode.connect(o),t.sourceNode.connect(r),a.connect(s),o.connect(n),r.connect(l),s.connect(this.bassSum),n.connect(this.midSum),l.connect(this.trebSum),this.chains.push({stemId:t.id,source:t.sourceNode,bassFilter:a,midFilter:o,trebFilter:r,bassGain:s,midGain:n,trebGain:l})}}setMatrix(e){this.matrix=e;for(const t of this.chains){const a=this.audioCtx.currentTime;try{t.bassGain.gain.setTargetAtTime(this._matGain(t.stemId,"bass"),a,.03)}catch{}try{t.midGain.gain.setTargetAtTime(this._matGain(t.stemId,"mid"),a,.03)}catch{}try{t.trebGain.gain.setTargetAtTime(this._matGain(t.stemId,"treb"),a,.03)}catch{}}}getOutput(){return this.output}dispose(){this.disposeChains();try{this.bassSum.disconnect()}catch{}try{this.midSum.disconnect()}catch{}try{this.trebSum.disconnect()}catch{}try{this.output.disconnect()}catch{}}disposeChains(){for(const e of this.chains){try{e.source.disconnect(e.bassFilter)}catch{}try{e.source.disconnect(e.midFilter)}catch{}try{e.source.disconnect(e.trebFilter)}catch{}try{e.bassFilter.disconnect()}catch{}try{e.midFilter.disconnect()}catch{}try{e.trebFilter.disconnect()}catch{}try{e.bassGain.disconnect()}catch{}try{e.midGain.disconnect()}catch{}try{e.trebGain.disconnect()}catch{}}this.chains=[]}_matGain(e,t){const a=this.matrix[e];if(!a)return 0;const o=a[t];return typeof o=="number"?Math.max(0,o):0}}const sn="ghost-arcade.milkdrop.favorites.v1";function Ld(){if(typeof localStorage>"u")return new Set;try{const i=localStorage.getItem(sn);if(!i)return new Set;const e=JSON.parse(i);return new Set(Array.isArray(e)?e:[])}catch{return new Set}}function Dd(i){if(!(typeof localStorage>"u"))try{localStorage.setItem(sn,JSON.stringify([...i]))}catch{}}const wa=ii({commands:{},currentPreset:{},locked:{},favorites:Ld()});let zd=1;const sa={subscribe:wa.subscribe,command(i,e,t){wa.update(a=>(a.commands[i]={layerId:i,kind:e,tag:zd++,presetName:t},e==="lock"?a.locked[i]=!0:e==="unlock"&&(a.locked[i]=!1),a))},reportPreset(i,e){wa.update(t=>(t.currentPreset[i]===e||(t.currentPreset[i]=e),t))},toggleFavorite(i){wa.update(e=>(e.favorites.has(i)?e.favorites.delete(i):e.favorites.add(i),Dd(e.favorites),e))},isFavorite(i){return we(wa).favorites.has(i)},dropLayer(i){wa.update(e=>(delete e.commands[i],delete e.currentPreset[i],delete e.locked[i],e))}},nn="ghost-arcade.hydra.favorites.v1";function Id(){if(typeof localStorage>"u")return new Set;try{const i=localStorage.getItem(nn);return new Set(i?JSON.parse(i):[])}catch{return new Set}}function Ud(i){if(!(typeof localStorage>"u"))try{localStorage.setItem(nn,JSON.stringify([...i]))}catch{}}const qa=ii({commands:{},currentPreset:{},favorites:Id()});let Gd=1;const Ro={subscribe:qa.subscribe,command(i,e,t){qa.update(a=>(a.commands[i]={layerId:i,kind:e,tag:Gd++,presetName:t},a))},reportPreset(i,e){qa.update(t=>(t.currentPreset[i]===e||(t.currentPreset[i]=e),t))},toggleFavorite(i){qa.update(e=>(e.favorites.has(i)?e.favorites.delete(i):e.favorites.add(i),Ud(e.favorites),e))},isFavorite(i){return we(qa).favorites.has(i)}},Od="ghostarcade-state-sync";let Re=null,ut=null,Ca=[],Pa=null;const Wd=50;let Zo={},Ko={},Jo={},ln={},Qo="",Ha=new Map,Ao=null;function Ni(i){return i==null?i:JSON.parse(JSON.stringify(i))}function Vd(i){if(!i)return i;const{texture:e,videoElement:t,isPlaying:a,synthVisionCanvas:o,threejsCanvas:r,iframeElement:s,...n}=i;return n}function cn(i){const{corners:e,opacity:t,meshGrid:a,source:o,_seqOrigOpacity:r,...s}=i;return JSON.stringify({...s,source:Vd(o)})}function un(i=we($e)){const e={},t={},a={},o={},r=[];for(const s of i.layers)r.push(s.id),e[s.id]=Ni(s.corners),t[s.id]=s.opacity,a[s.id]=Ni(s.meshGrid),o[s.id]=cn(s);Qo=r.join("|"),Zo=e,Ko=t,Jo=a,ln=o}function Nd(){if(!Re||ut!=="sender"||Ha.size===0)return;const i=Array.from(Ha.values());Ha.clear();try{Re.postMessage({type:"layer-patch",data:i,timestamp:Date.now()})}catch{}}function qd(i=we($e).layers){if(!Re||ut!=="sender")return!1;const e=[];for(const t of i){const a=Zo[t.id],o=Ko[t.id],r=Jo[t.id],s=!a||JSON.stringify(t.corners)!==JSON.stringify(a),n=o!==t.opacity,l=JSON.stringify(t.meshGrid)!==JSON.stringify(r);if(s||n||l){const u={id:t.id};s&&(u.corners=t.corners),l&&(u.meshGrid=t.meshGrid),n&&(u.opacity=t.opacity),e.push(u),Zo[t.id]=Ni(t.corners),Ko[t.id]=t.opacity,Jo[t.id]=Ni(t.meshGrid)}}if(e.length>0){for(const t of e)Ha.set(t.id,{...Ha.get(t.id),...t});Ao||(Ao=setTimeout(()=>{Ao=null,Nd()},16))}return!0}function Yd(){if(!Re||ut!=="sender"||!Fa)return!0;const e=we($e).layers,t=e.map(a=>a.id).join("|");if(!Qo||t!==Qo)return!1;for(const a of e){const o=cn(a);if(ln[a.id]!==o)return!1}return qd(e)}function Hd(){if(!(!Re||ut!=="sender"))try{const i=$e.exportProject(),e=we(ca),t=we(Oe),a=e.blocks.map(n=>({...n,clipGrid:Kt(n.clipGrid),bankBClipGrid:n.bankBClipGrid?Kt(n.bankBClipGrid):void 0})),o=Kt(e.clipGrid),r=e.bankBClipGrid?Kt(e.bankBClipGrid):void 0,s={...i,vjClipLauncher:{blocks:a,activeBlockId:e.activeBlockId,clipGrid:o,bankBClipGrid:r,layerStates:qi(e.layerStates),bankBLayerStates:qi(e.bankBLayerStates),compositionEffects:e.compositionEffects,masterOpacity:e.masterOpacity,isOpen:e.isOpen,isLive:e.isLive},settings:{output:t?.output}};Re.postMessage({type:"project-state",data:JSON.parse(JSON.stringify(s)),timestamp:Date.now()}),un(),console.log("[StateSync] Full state sent to OSR")}catch(i){console.error("[StateSync] Failed to send full state:",i)}}let Fa=!1;function jd(){!Re||ut!=="sender"||!Fa||(Pa&&clearTimeout(Pa),Pa=setTimeout(()=>{try{const i=$e.exportProject();Re.postMessage({type:"project-state",data:i,timestamp:Date.now()}),un()}catch(i){console.error("[StateSync] Failed to broadcast project:",i)}},Wd))}let Bo=null;const Xd=33;function dn(i){if(!i)return i;const{synthVisionCanvas:e,videoElement:t,iframeElement:a,threejsCanvas:o,...r}=i;return r}function Kt(i){return i.map(e=>e.map(dn))}function qi(i){return i&&i.map(e=>({...e,activeClip:dn(e?.activeClip)}))}function $d(){if(!(!Re||ut!=="sender"||!Fa))try{const i=we(ca),e=i.blocks.map(r=>({...r,clipGrid:Kt(r.clipGrid),bankBClipGrid:r.bankBClipGrid?Kt(r.bankBClipGrid):void 0})),t=Kt(i.clipGrid),a=i.bankBClipGrid?Kt(i.bankBClipGrid):void 0,o={blocks:e,activeBlockId:i.activeBlockId,clipGrid:t,bankBClipGrid:a,layerStates:qi(i.layerStates),bankBLayerStates:qi(i.bankBLayerStates),compositionEffects:i.compositionEffects,masterOpacity:i.masterOpacity,isOpen:i.isOpen,isLive:i.isLive};Re.postMessage({type:"vj-state",data:JSON.parse(JSON.stringify(o)),timestamp:Date.now()})}catch(i){console.error("[StateSync] Failed to broadcast VJ state:",i)}}function Zd(){!Re||ut!=="sender"||!Fa||Bo===null&&(Bo=setTimeout(()=>{Bo=null,$d()},Xd))}function Kd(){if(!Re)return;Re.onmessage=o=>{o.data?.type==="osr-request-state"&&(console.log("[StateSync] OSR requested full state — activating broadcast"),Fa=!0,Hd())};const i=$e.subscribe(()=>{Yd()||jd()});Ca.push(i);const e=ca.subscribe(()=>{Zd()});Ca.push(e);let t="";const a=Oe.subscribe(o=>{if(!Fa)return;const r=JSON.stringify(o.output);r!==t&&(t=r,Eo&&clearTimeout(Eo),Eo=setTimeout(()=>{if(!(!Re||ut!=="sender"))try{Re.postMessage({type:"settings-update",data:{output:JSON.parse(r)},timestamp:Date.now()})}catch(s){console.error("[StateSync] Failed to broadcast settings:",s)}},16))});Ca.push(a),console.log("[StateSync] Sender initialized")}let Eo=null,Yi=!1;function Jd(i){const e=i.data;if(!(!e||!e.type))switch(e.type){case"project-state":{if(e.data)try{$e.importProject(e.data),e.data.settings?.output&&Oe.update(t=>({...t,output:{...t.output,...e.data.settings.output}})),Yi||(Yi=!0,console.log("[StateSync] First project state received"))}catch(t){console.error("[StateSync] Failed to import project state:",t)}break}case"output-frozen":{e.data&&at(async()=>{const{outputFrozen:t}=await import("./modulationBroadcast-DDTQeuhI.js").then(a=>a.aB);return{outputFrozen:t}},__vite__mapDeps([0,1,2,3,4,5]),import.meta.url).then(({outputFrozen:t})=>{t.set(!!e.data.frozen)}).catch(()=>{});break}case"cursor-visibility":{e.data&&(Qa=e.data.show,document.body.style.cursor=e.data.show?"default":"none",er());break}case"cursor-position":{e.data?(Ka=e.data.x,Ja=e.data.y):(Ka=null,Ja=null),er();break}case"layer-patch":{if(e.data&&Array.isArray(e.data))try{$e.update(t=>{const a=[...t.layers];for(const o of e.data){const r=a.findIndex(n=>n.id===o.id);if(r<0)continue;const s={...a[r]};o.corners&&(s.corners=o.corners),o.meshGrid&&(s.meshGrid=o.meshGrid),o.opacity!==void 0&&(s.opacity=o.opacity),a[r]=s}return{...t,layers:a}})}catch{}break}case"vj-state":{if(e.data)try{ca.update(t=>({...t,...e.data}))}catch(t){console.error("[StateSync] Failed to import VJ state:",t)}break}case"settings-update":{if(e.data)try{typeof e.data?.output?.spoutEnabled=="boolean"&&Oe.setSpoutEnabled(!!e.data.output.spoutEnabled),typeof e.data?.output?.spoutName=="string"&&Oe.setSpoutName(e.data.output.spoutName),(e.data?.output?.spoutResolution==="match"||e.data?.output?.spoutResolution==="1080p"||e.data?.output?.spoutResolution==="4K")&&Oe.setSpoutResolution(e.data.output.spoutResolution),typeof e.data?.output?.outputWindowOpen=="boolean"&&Oe.setOutputWindowOpen(!!e.data.output.outputWindowOpen),e.data?.output&&Oe.update(t=>({...t,output:{...t.output,...e.data.output}}))}catch(t){console.error("[StateSync] Failed to import settings:",t)}break}}}function Qd(){if(!Re)return;Re.onmessage=Jd;const i=Oe.subscribe(e=>{const t=!!e.output.outputShowCursor;t!==Qa&&(Qa=t,document.body.style.cursor="none",er())});Ca.push(i),Re.postMessage({type:"osr-request-state",timestamp:Date.now()}),console.log("[StateSync] Receiver initialized, requesting state")}function ef(i){if(!(!Re||ut!=="sender"))try{Re.postMessage({type:"output-frozen",data:{frozen:i},timestamp:Date.now()})}catch{}}function tf(i){if(!(!Re||ut!=="sender"))try{Re.postMessage({type:"cursor-visibility",data:{show:i},timestamp:Date.now()})}catch{}}function af(i,e){if(!(!Re||ut!=="sender"))try{Re.postMessage({type:"cursor-position",data:{x:i,y:e},timestamp:Date.now()})}catch{}}function of(){if(!(!Re||ut!=="sender"))try{Re.postMessage({type:"cursor-position",data:null,timestamp:Date.now()})}catch{}}let Ka=null,Ja=null,Qa=!1;function fn(i){if(Re){console.warn("[StateSync] Already initialized as",ut);return}Re=new BroadcastChannel(Od),ut=i,i==="sender"?Kd():Qd()}function rf(){return Yi}function er(){let i=document.getElementById("cursor-overlay");if(!(Qa&&Ka!==null&&Ja!==null)){i&&(i.style.display="none");return}i||(i=document.createElement("div"),i.id="cursor-overlay",i.style.cssText="position:fixed;inset:0;pointer-events:none;z-index:99999;",i.innerHTML=`
      <div id="ch-vbg" style="position:absolute;top:0;bottom:0;width:3px;background:rgba(0,0,0,0.6);transform:translateX(-50%);"></div>
      <div id="ch-hbg" style="position:absolute;left:0;right:0;height:3px;background:rgba(0,0,0,0.6);transform:translateY(-50%);"></div>
      <div id="ch-vline" style="position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.9);transform:translateX(-50%);"></div>
      <div id="ch-hline" style="position:absolute;left:0;right:0;height:1px;background:rgba(255,255,255,0.9);transform:translateY(-50%);"></div>
      <div id="ch-ring" style="position:absolute;width:18px;height:18px;border-radius:50%;border:2px solid rgba(0,0,0,0.7);box-sizing:border-box;transform:translate(-50%,-50%);"></div>
      <div id="ch-ring2" style="position:absolute;width:18px;height:18px;border-radius:50%;border:1px solid rgba(255,255,255,0.95);box-sizing:border-box;transform:translate(-50%,-50%);"></div>
    `,document.body.appendChild(i)),i.style.display="block";const t=Ka*100,a=(1-Ja)*100,o=document.getElementById("ch-vbg"),r=document.getElementById("ch-hbg"),s=document.getElementById("ch-vline"),n=document.getElementById("ch-hline"),l=document.getElementById("ch-ring"),u=document.getElementById("ch-ring2");o&&(o.style.left=t+"%"),s&&(s.style.left=t+"%"),r&&(r.style.top=a+"%"),n&&(n.style.top=a+"%"),l&&(l.style.left=t+"%",l.style.top=a+"%"),u&&(u.style.left=t+"%",u.style.top=a+"%")}function pn(){for(const i of Ca)try{i()}catch{}Ca=[],Pa&&(clearTimeout(Pa),Pa=null),Re&&(Re.close(),Re=null),ut=null,Yi=!1,console.log("[StateSync] Destroyed")}const Lp=Object.freeze(Object.defineProperty({__proto__:null,broadcastCursorClear:of,broadcastCursorPosition:af,broadcastCursorVisibility:tf,broadcastFrozenState:ef,destroyStateBroadcast:pn,hasReceivedState:rf,initStateBroadcast:fn,get outputCursorVisible(){return Qa},get outputCursorX(){return Ka},get outputCursorY(){return Ja}},Symbol.toStringTag,{value:"Module"}));let Hi=null,Wt=new Map,ja=null;const sf=16;function nf(i){const e=Wt.get(i.id);if(e&&e.controller.ledCount===i.ledCount)return e.controller=i,e;e&&Wt.delete(i.id);const t=document.createElement("canvas");t.width=Math.max(1,Math.min(490,i.ledCount)),t.height=1;const a=t.getContext("2d",{willReadFrequently:!0});if(!a)throw new Error("Failed to acquire 2D context for WLED tap canvas");const o={controller:i,tapCanvas:t,tapCtx:a,rgbBuffer:new Uint8Array(t.width*3),lastSendMs:0,inFlight:!1,lastErrorAt:0};return Wt.set(i.id,o),o}function hn(i){Wt.get(i)&&(Wt.delete(i),Se("wled_close_socket",{controllerId:i}).catch(()=>{}))}function Fo(i,e){return e===1||e<=0?i:Math.pow(i/255,e)*255}function lf(i){const{tapCtx:e,rgbBuffer:t,controller:a,tapCanvas:o}=i,s=e.getImageData(0,0,o.width,1).data,n=a.brightness??1,l=a.gamma??1;for(let u=0,f=0;u<s.length;u+=4,f+=3){let d=s[u]*n,h=s[u+1]*n,m=s[u+2]*n;l!==1&&(d=Fo(d,l),h=Fo(h,l),m=Fo(m,l)),t[f]=Math.max(0,Math.min(255,d|0)),t[f+1]=Math.max(0,Math.min(255,h|0)),t[f+2]=Math.max(0,Math.min(255,m|0))}}function cf(){if(!Hi||Wt.size===0)return;const i=performance.now();for(const e of Wt.values())if(e.controller.enabled&&!e.inFlight&&!(i-e.lastSendMs<sf)){try{e.tapCtx.save(),e.tapCtx.scale(1,-1),e.tapCtx.drawImage(Hi,0,-1,e.tapCanvas.width,1),e.tapCtx.restore(),lf(e)}catch{continue}e.lastSendMs=i,e.inFlight=!0,Se("wled_send_frame",{controllerId:e.controller.id,ip:e.controller.ipAddr,port:e.controller.port,pixels:e.rgbBuffer}).then(t=>{e.inFlight=!1,t&&!t.ok&&i-e.lastErrorAt>5e3&&(e.lastErrorAt=i,console.warn("[WLED] send failed for",e.controller.name,t.error))}).catch(()=>{e.inFlight=!1})}}function uf(i){ja||(Hi=i,ja=$e.subscribe(e=>{const t=new Set;for(const a of e.wledControllers??[])t.add(a.id),nf(a);for(const a of Array.from(Wt.keys()))t.has(a)||hn(a)}))}function df(){ja&&(ja(),ja=null);for(const i of Array.from(Wt.keys()))hn(i);Hi=null}const ks="ghostarcade-output-pixels";let Xe=null,ka=null,kt=null,Ta=null,mn=60,vn=8e7,gn="maintain-resolution",tr="auto";const ji=[];let lr=!1,Gi=null;function ff(i,e=60,t){if(Ta===i&&kt)return;Ta!==i&&cr(),Ta=i,mn=e,t?.maxBitrate!==void 0&&(vn=t.maxBitrate),t?.degradationPreference!==void 0&&(gn=t.degradationPreference),t?.codecPreference!==void 0&&(tr=t.codecPreference);try{kt=new BroadcastChannel(ks)}catch(r){console.warn("[OutputPixelBroadcast] BroadcastChannel unavailable:",r);return}kt.onmessage=async r=>{const s=r.data;if(!(!s||typeof s!="object")&&s.from!=="editor")try{s.type==="ready"?await mf():s.type==="answer"&&Xe?(await Xe.setRemoteDescription(s.sdp),lr=!0,await hf(),console.log("[OutputPixelBroadcast] answer received, peer should connect")):s.type==="ice"&&s.candidate?await pf(s.candidate):s.type==="bye"&&Xa()}catch(n){console.error("[OutputPixelBroadcast] signaling error:",n?.message??n)}};let a="";const o=r=>{if(!kt)return;const s={rotation:r.output?.outputRotation??0,brightness:r.output?.brightness??1,contrast:r.output?.contrast??1,fit:r.output?.outputFit??"cover"},n=JSON.stringify(s);if(n!==a){a=n;try{kt.postMessage({type:"transform",from:"editor",payload:s})}catch{}}};o(we(Oe)),Gi=Oe.subscribe(o),console.log(`[OutputPixelBroadcast] editor-side peer ready, listening on "${ks}"`)}function cr(){if(Xa(),Gi){try{Gi()}catch{}Gi=null}if(kt){try{kt.close()}catch{}kt=null}Ta=null}function Xa(){if(Xe){try{Xe.close()}catch{}Xe=null}if(ka){try{ka.getTracks().forEach(i=>i.stop())}catch{}ka=null}ji.length=0,lr=!1}async function pf(i){if(Xe){if(!lr){ji.push(i);return}try{await Xe.addIceCandidate(i)}catch(e){console.warn("[OutputPixelBroadcast] addIceCandidate failed:",e?.message??e)}}}async function hf(){if(Xe)for(;ji.length;){const i=ji.shift();if(i)try{await Xe.addIceCandidate(i)}catch(e){console.warn("[OutputPixelBroadcast] queued addIceCandidate failed:",e?.message??e)}}}async function mf(){if(!Ta||!kt||Xe&&Xe.connectionState==="connected")return;console.log("[OutputPixelBroadcast] output window ready — building peer + capturing canvas"),Xa(),Xe=new RTCPeerConnection,Xe.onicecandidate=a=>{a.candidate&&kt&&kt.postMessage({type:"ice",from:"editor",candidate:a.candidate.toJSON()})},Xe.onconnectionstatechange=()=>{console.log("[OutputPixelBroadcast] peer connection state:",Xe?.connectionState),Xe?.connectionState==="failed"&&Xa()},ka=Ta.captureStream(mn);const i=ka.getVideoTracks();if(i.length===0){console.error("[OutputPixelBroadcast] canvas.captureStream returned no video tracks"),Xa();return}const e=[];for(const a of i)e.push(Xe.addTrack(a,ka));for(const a of e)try{const o=a.getParameters();(!o.encodings||o.encodings.length===0)&&(o.encodings=[{}]);for(const r of o.encodings)r.maxBitrate=vn,r.scaleResolutionDownBy=1,r.networkPriority="high";o.degradationPreference=gn,await a.setParameters(o)}catch(o){console.warn("[OutputPixelBroadcast] sender.setParameters failed (proceeding with defaults):",o?.message??o)}try{const a=Xe.getTransceivers(),o=RTCRtpSender.getCapabilities?.("video")?.codecs??[];if(o.length){let r;tr==="h264"?r=["video/H264","video/VP9","video/VP8","video/AV1"]:tr==="vp8"?r=["video/VP8","video/VP9","video/H264","video/AV1"]:r=["video/VP9","video/AV1","video/H264","video/VP8"];const s=r.map(u=>o.find(f=>f.mimeType===u)).filter(Boolean),n=o.filter(u=>!s.includes(u)),l=[...s,...n];for(const u of a)if(u.sender&&u.sender.track&&u.sender.track.kind==="video")try{u.setCodecPreferences(l)}catch{}}}catch(a){console.warn("[OutputPixelBroadcast] codec preference setup failed (proceeding with default):",a?.message??a)}const t=await Xe.createOffer();await Xe.setLocalDescription(t),kt.postMessage({type:"offer",from:"editor",sdp:t})}let Vt=null,Xi=60;const Ye=new Map;let Rt=null,ei=null,ct=null,Jt=!1,Qt=null,Ts=!1,Ie={framesTransferred:0,framesDroppedNoPort:0,framesDroppedTransferError:0,lastFormat:"",formatHistogram:new Map,fps:0,startedAt:0,lastFrameAt:0};function yn(){return!(typeof window>"u"||window.__OUTPUT_WINDOW_MODE__||window.__SPOUT_OSR_MODE__)}function vf(){Ts||typeof window>"u"||(window.addEventListener("message",i=>{if(!i?.data||typeof i.data!="object")return;const e=i.data;if(e.type==="ghostarcade-output-ready"){let t=null;if(i.source){for(const[a,o]of Ye)if(i.source===o.window){t=a;break}}if(!t){const a=Array.from(Ye.entries()).filter(([,o])=>!o.port);a.length===1&&(t=a[0][0])}t&&gf(t)}else if(e.type==="ghostarcade-output-bye"){let t=null;if(i.source){for(const[a,o]of Ye)if(i.source===o.window){t=a;break}}if(t)console.log(`[OutputSharedTexture] target ${t} said bye — detaching`),La(t);else if(Ye.size===1){const[a]=Ye.keys();La(a)}}}),Ts=!0)}function gf(i){const e=Ye.get(i);if(e){if(e.port){try{e.port.close()}catch{}e.port=null}try{e.pendingChannel=new MessageChannel,e.window.postMessage({type:"ghostarcade-output-transport-port"},"*",[e.pendingChannel.port2]),e.port=e.pendingChannel.port1,e.pendingChannel=null,e.lastTransformJson="",console.log(`[OutputSharedTexture] MessageChannel established with target ${i}`),bn(e,we(Oe)),wn()}catch(t){console.error(`[OutputSharedTexture] failed to establish channel for ${i}:`,t)}}}function bn(i,e){if(!i.port)return;const t={type:"transform",rotation:e.output?.outputRotation??0,brightness:e.output?.brightness??1,contrast:e.output?.contrast??1,gamma:e.output?.gamma??1,fit:e.output?.outputFit??"cover"},a=JSON.stringify(t);if(a!==i.lastTransformJson){i.lastTransformJson=a;try{i.port.postMessage(t)}catch{}}}function yf(i){for(const e of Ye.values())bn(e,i)}let Ms="";function bf(i,e,t){if(Ye.size===0)return;const a={type:"cursor",x:Math.max(0,Math.min(1,i)),y:Math.max(0,Math.min(1,e)),visible:t},o=JSON.stringify(a);if(o!==Ms){Ms=o;for(const r of Ye.values())if(r.port)try{r.port.postMessage(a)}catch{}}}let Rs="";function xf(i){if(Ye.size===0)return;const e={type:"cursorStyle",...i},t=JSON.stringify(e);if(t!==Rs){Rs=t;for(const a of Ye.values())if(a.port)try{a.port.postMessage(e)}catch{}}}function xn(i,e=60){if(yn()){if(Vt===i){Xi=e;return}if(Vt){if(Jt=!1,ct){try{ct.cancel("canvas swap")}catch{}try{ct.releaseLock()}catch{}ct=null}if(ei=null,Rt){try{Rt.getTracks().forEach(t=>t.stop())}catch{}Rt=null}}Vt=i,Xi=e,wn()}}function wf(i,e="main"){if(!yn())return;vf();const t=Ye.get(e);if(t){if(t.window===i&&t.port)return;if(t.port)try{t.port.close()}catch{}Ye.delete(e)}Ye.set(e,{window:i,port:null,pendingChannel:null,lastTransformJson:""}),Qt||(Qt=Oe.subscribe(yf));try{i.postMessage({type:"ghostarcade-editor-attach"},"*")}catch(a){console.warn(`[OutputSharedTexture] could not post editor-attach probe to ${e}:`,a)}console.log(`[OutputSharedTexture] attached output window ${e} — awaiting ready handshake`)}function La(i="main"){const e=Ye.get(i);if(e){if(e.port)try{e.port.close()}catch{}if(e.pendingChannel){try{e.pendingChannel.port1.close()}catch{}try{e.pendingChannel.port2.close()}catch{}}if(Ye.delete(i),Ye.size===0){if(Jt=!1,ct){try{ct.cancel("all targets detached")}catch{}try{ct.releaseLock()}catch{}ct=null}if(ei=null,Rt){try{Rt.getTracks().forEach(t=>t.stop())}catch{}Rt=null}if(Qt){try{Qt()}catch{}Qt=null}}}}function $i(){if(Jt=!1,ct){try{ct.cancel("presenter stopped")}catch{}try{ct.releaseLock()}catch{}ct=null}if(ei=null,Rt){try{Rt.getTracks().forEach(i=>i.stop())}catch{}Rt=null}if(Qt){try{Qt()}catch{}Qt=null}for(const i of Ye.values())if(i.port)try{i.port.close()}catch{}Ye.clear(),Vt=null,Sf()}function Sf(){Ie={framesTransferred:0,framesDroppedNoPort:0,framesDroppedTransferError:0,lastFormat:"",formatHistogram:new Map,fps:0,startedAt:0,lastFrameAt:0}}function _f(){for(const i of Ye.values())if(i.port)return!0;return!1}function Cf(){const i=[];for(const[e,t]of Array.from(Ye.entries())){try{if(t.window.closed){La(e);continue}}catch{}t.port&&i.push({id:e,port:t.port})}return i}function Pf(i){try{const e=i.clone?.();if(e)return e}catch{}if(!Vt)return null;try{return new VideoFrame(Vt,{timestamp:i.timestamp})}catch{return null}}function wn(){if(!Jt&&Vt&&_f()){if(typeof MediaStreamTrackProcessor>"u"){console.warn("[OutputSharedTexture] MediaStreamTrackProcessor unavailable — Chromium feature flag may be off");return}try{Rt=Vt.captureStream(Xi);const i=Rt.getVideoTracks()[0];if(!i){console.error("[OutputSharedTexture] captureStream returned no video tracks"),$i();return}ei=new MediaStreamTrackProcessor({track:i}),ct=ei.readable.getReader(),Jt=!0,Ie.startedAt=performance.now(),console.log("[OutputSharedTexture] pump started — publishing frames at",Xi,"fps target"),kf().catch(e=>{e?.name!=="AbortError"&&console.error("[OutputSharedTexture] pump terminated with error:",e),Jt=!1})}catch(i){console.error("[OutputSharedTexture] failed to start pump:",i),$i()}}}async function kf(){if(ct)for(;Jt;){let i,e=!1;try{const r=await ct.read();e=r.done,i=r.value}catch{break}if(e)break;if(!i)continue;const t=Cf();if(t.length===0){Ie.framesDroppedNoPort++;try{i.close()}catch{}continue}const a=i.format??"unknown";Ie.lastFormat=a,Ie.formatHistogram.set(a,(Ie.formatHistogram.get(a)??0)+1),Ie.framesTransferred<5&&console.log(`[OutputSharedTexture] frame ${Ie.framesTransferred+1} format=${a} dim=${i.codedWidth}x${i.codedHeight} ts=${i.timestamp} fanout=${t.length}`);const o=performance.now();if(Ie.lastFrameAt>0){const r=o-Ie.lastFrameAt,s=1e3/Math.max(1,r);Ie.fps=Ie.fps===0?s:Ie.fps*.9+s*.1}if(Ie.lastFrameAt=o,t.length===1){try{t[0].port.postMessage(i,[i]),Ie.framesTransferred++}catch(r){Ie.framesDroppedTransferError++;try{i.close()}catch{}console.warn(`[OutputSharedTexture] postMessage to ${t[0].id} failed:`,r?.message??r),La(t[0].id)}continue}try{const r=[i];for(let n=1;n<t.length;n++)r.push(Pf(i));let s=!1;for(let n=0;n<t.length;n++){const l=r[n];if(l)try{t[n].port.postMessage(l,[l]),s=!0}catch(u){try{l.close()}catch{}console.warn(`[OutputSharedTexture] postMessage to ${t[n].id} failed:`,u?.message??u),La(t[n].id)}}s?Ie.framesTransferred++:Ie.framesDroppedTransferError++}catch(r){Ie.framesDroppedTransferError++;try{i.close()}catch{}console.warn("[OutputSharedTexture] fan-out failed:",r?.message??r)}}}function Sn(){const i={};Ie.formatHistogram.forEach((a,o)=>{i[o]=a});let e=0,t=0;for(const a of Ye.values())e++,a.port&&t++;return{active:!!Vt,pumpRunning:Jt,portConnected:t>0,targetAttached:e>0,targetCount:e,targetsWithPort:t,framesTransferred:Ie.framesTransferred,framesDroppedNoPort:Ie.framesDroppedNoPort,framesDroppedTransferError:Ie.framesDroppedTransferError,lastFormat:Ie.lastFormat,formatHistogram:i,fps:Ie.fps,uptimeMs:Ie.startedAt?performance.now()-Ie.startedAt:0}}const Dp=Object.freeze(Object.defineProperty({__proto__:null,attachOutputWindow:wf,detachOutputWindow:La,getOutputSharedTexturePresenterStats:Sn,registerEditorCanvas:xn,setOutputCursor:bf,setOutputCursorStyle:xf,stopOutputSharedTexturePresenter:$i},Symbol.toStringTag,{value:"Module"}));let ti=!1,_n=null,Cn=null;function Pn(){return typeof window>"u"?!1:window.__MWARP_DEBUG__!==!1}function Zi(...i){Pn()&&console.log("[mwarp]",...i)}let Tf=0;function Mf(i,e){_n=i,Cn=e;const t=e(),a=Math.max(2,Math.round(t.w)),o=Math.max(2,Math.round(t.h)),r=Ad(a,o),s=ti;return ti=!0,s||Zi("startMasterWarpOutput → active",{w:a,h:o,canvas:!!r}),r}function kn(){ti&&Zi("stopMasterWarpOutput → inactive"),ti=!1}function Rf(i){if(!ti)return;const e=_n?.(),t=Cn?.()??{w:1920,h:1080},a=Math.max(2,Math.round(t.w)),o=Math.max(2,Math.round(t.h));let r=!1;const s=rn();e?.enabled&&s&&(r=!!Md(i,e,a,o)),Pn()&&Tf++%60===0&&console.log("[mwarp] tick — blendAvail=",s,"drew=",r,"enabled=",e?.enabled,"srcW=",i?.width,"srcH=",i?.height,"out=",a,"x",o)}function Af(){return Rd()}let Ma=null,Oi="",Lo=!1;function Bf(i){const{baseSource:e,warpActive:t,zeroCopy:a,webrtc:o,getWarp:r,getSize:s,perf:n}=i,l=`${t?1:0}${a?1:0}${o?1:0}`;if(e===Ma&&l===Oi)return;Zi("reconcile",{base:e?.className||e?.id||"canvas",warpActive:t,zeroCopy:a,webrtc:o,prevFlags:Oi,newFlags:l,baseChanged:e!==Ma}),Ma=e,Oi=l;const f=(t?Mf(r,s):(kn(),null))??e,d=n?.frameRate??60;xn(f,d);const h=Sn();Zi("registered",t?"WARPED outCanvas":"base source",{w:f.width,h:f.height,presenterActive:h.active,pumpRunning:h.pumpRunning,targetAttached:h.targetAttached,portConnected:h.portConnected}),!a&&o?(ff(f,d,{maxBitrate:n?.maxBitrate,degradationPreference:n?.degradationPreference,codecPreference:n?.codecPreference}),Lo=!0):Lo&&(cr(),Lo=!1)}function Ef(...i){i.length>0&&Ma&&!i.includes(Ma)||(Ma=null,Oi="")}async function Ff(i){return Se("native_renderer_start",{config:{backend:i?.backend??"d3d11",width:i?.width??1920,height:i?.height??1080,command_queue_capacity:i?.command_queue_capacity??8192,command_drain_limit:i?.command_drain_limit??1024,auto_present_on_state_change:i?.auto_present_on_state_change??!0,decode_store_cpu_backup_frames:i?.decode_store_cpu_backup_frames??!1,decode_allow_synthetic_fallback:i?.decode_allow_synthetic_fallback??!1,media_queue_capacity:i?.media_queue_capacity??2048,decode_handoff_queue_capacity:i?.decode_handoff_queue_capacity??4096,media_high_burst_limit:i?.media_high_burst_limit??7,prefetch_cache_max_entries:i?.prefetch_cache_max_entries??4096,prefetch_cache_prune_count:i?.prefetch_cache_prune_count??256,target_fps:i?.target_fps??60,present_mode:i?.present_mode??"vsync",allow_tearing:i?.allow_tearing??!1,max_frame_latency:i?.max_frame_latency??2,use_waitable_object:i?.use_waitable_object??!1,vram_budget_mb:i?.vram_budget_mb??4096,decode_backend:i?.decode_backend??"ffmpeg_d3d11va",decode_preview_size:i?.decode_preview_size??96,decode_preview_cache_mb:i?.decode_preview_cache_mb??128,decode_upload_queue_cap_mb:i?.decode_upload_queue_cap_mb??256,decode_handoff_byte_cap_mb:i?.decode_handoff_byte_cap_mb??128,decode_handoff_predecode_shed_pct:i?.decode_handoff_predecode_shed_pct??90,decode_predecode_estimate_cache_cap_entries:i?.decode_predecode_estimate_cache_cap_entries??8192,vertex_shader_cache_cap:i?.vertex_shader_cache_cap??512,pixel_shader_cache_cap:i?.pixel_shader_cache_cap??1024,shader_precompile_queue_cap:i?.shader_precompile_queue_cap??4096,shader_precompile_per_frame:i?.shader_precompile_per_frame??4,shader_metadata_cache_cap:i?.shader_metadata_cache_cap??16384,pipeline_metadata_cache_cap:i?.pipeline_metadata_cache_cap??16384,texture_pool_cap_mb:i?.texture_pool_cap_mb??512,ffmpeg_path:i?.ffmpeg_path??null,decode_gpu_bridge_path:i?.decode_gpu_bridge_path??null}})}async function Lf(){return Se("native_renderer_stop")}async function Df(i){return Se("native_renderer_submit_batch",{batch:i})}async function As(i,e,t=1){return Se("native_renderer_prefetch_media",{source_id:i,uri:e,priority:t})}async function zf(){return Se("native_renderer_clear_decode_preview_cache")}async function If(i){return Se("native_renderer_clear_runtime_caches",{config:i})}async function Uf(i){return Se("native_renderer_set_target_fps",{config:i})}async function Gf(i){return Se("native_renderer_set_command_drain_policy",{config:i})}async function Of(i){return Se("native_renderer_set_auto_present_policy",{config:i})}async function Wf(i){return Se("native_renderer_set_decode_cpu_backup_policy",{config:i})}async function Vf(i){return Se("native_renderer_set_decode_synthetic_fallback_policy",{config:i})}async function Nf(i){return Se("native_renderer_set_texture_pool_cap",{config:i})}async function qf(i){return Se("native_renderer_set_shader_precompile_policy",{config:i})}async function Bs(i){return Se("native_renderer_set_media_prefetch_policy",{config:i})}async function Yf(i){return Se("native_renderer_set_media_drop_policy",{config:i})}async function Hf(i){return Se("native_renderer_set_decode_preview_policy",{config:i})}async function jf(i){return Se("native_renderer_set_decode_target_policy",{config:i})}async function Xf(i){return Se("native_renderer_set_decode_upload_policy",{config:i})}async function $f(i){return Se("native_renderer_set_decode_handoff_policy",{config:i})}async function Zf(i){return Se("native_renderer_set_decode_estimate_cache_policy",{config:i})}async function Kf(i){return Se("native_renderer_set_present_policy",{config:i})}async function Es(i){return Se("native_renderer_attach_output_window",{label:i??null})}async function Jf(){return Se("native_renderer_detach_output_window")}async function Di(){return Se("native_renderer_get_status")}async function Qf(){return Se("native_renderer_reset_stats")}const ep={};function Fs(i){const e=String(i||"").trim().toLowerCase();return e==="plus"||e==="linear_dodge"||e==="linear-dodge"||e==="lineardodge"?"add":e==="minus"||e==="linear_burn"||e==="linear-burn"||e==="linearburn"?"subtract":e==="hard_light"||e==="hard-light"?"hardlight":e==="soft_light"||e==="soft-light"?"softlight":e==="pin_light"||e==="pin-light"?"pin-light":e==="vivid_light"||e==="vivid-light"?"vivid-light":e==="linearlight"||e==="linear_light"?"linear-light":e==="hardmix"||e==="hard_mix"?"hard-mix":e==="avg"?"average":e==="color_dodge"||e==="colordodge"||e==="dodge"?"color-dodge":e==="color_burn"||e==="colorburn"||e==="burn"?"color-burn":e==="luma"?"luminosity":e||"normal"}function ar(i){let e=2166136261;for(let t=0;t<i.length;t++)e^=i.charCodeAt(t),e=Math.imul(e,16777619);return(e>>>0).toString(16)}function tp(i){const e=i.source;return e?`${e.type}:${e.id}:${e.src}:${e.name}:${e.shaderCode?ar(e.shaderCode):"no-shader"}`:"none"}function ap(i){const e=i.effects||[];return e.length?e.filter(t=>t&&t.enabled!==!1).map(t=>ip(t)).filter(t=>!!t):[]}function Sa(i){return typeof i!="number"||!Number.isFinite(i)?null:i>=-1&&i<=1?Math.max(.001,1+i):Math.max(.001,i)}function zi(i,e=1){return typeof i!="number"||!Number.isFinite(i)?e:Math.max(.001,i)}function Do(i){return typeof i!="number"||!Number.isFinite(i)?null:i>=-1&&i<=1?i:i/360}function ip(i){if(!i||i.enabled===!1)return null;const e=String(i.type||"").toLowerCase(),t=i.params||{};if(!e)return null;if(e==="invert")return"invert";if(e==="grayscale"||e==="greyscale")return"grayscale";if(e==="brightness")return`brightness:${(Sa(t.brightnessAmount)??Sa(t.amount)??zi(t.brightness,1)).toFixed(4)}`;if(e==="contrast")return`contrast:${(Sa(t.contrastAmount)??Sa(t.amount)??zi(t.contrast,1)).toFixed(4)}`;if(e==="gamma")return`gamma:${zi(t.gamma??t.amount,1).toFixed(4)}`;if(e==="saturation")return`saturation:${(Sa(t.saturationAmount)??Sa(t.amount)??zi(t.saturation,1)).toFixed(4)}`;if(e==="hue")return`hue:${(Do(t.hueShift)??Do(t.shift)??Do(t.amount)??0).toFixed(4)}`;if(e==="posterize"){const o=(typeof t.posterizeLevels=="number"&&Number.isFinite(t.posterizeLevels)?t.posterizeLevels:null)??(typeof t.amount=="number"&&Number.isFinite(t.amount)?t.amount:null)??8;return`posterize:${Math.max(2,Math.min(64,Math.round(o))).toFixed(0)}`}if(e==="noise"){const o=(typeof t.noiseAmount=="number"&&Number.isFinite(t.noiseAmount)?t.noiseAmount:null)??(typeof t.amount=="number"&&Number.isFinite(t.amount)?t.amount:null)??.25;return`noise:${Math.max(0,Math.min(1,o)).toFixed(4)}`}const a=typeof i.id=="string"?i.id.trim():"";return a.includes(":")?a.toLowerCase():null}function op(i,e,t){const a=(i%360+360)%360,o=Math.max(0,Math.min(1,e/100)),r=Math.max(0,Math.min(1,t/100)),s=(1-Math.abs(2*r-1))*o,n=s*(1-Math.abs(a/60%2-1)),l=r-s/2;let u=0,f=0,d=0;return a<60?(u=s,f=n,d=0):a<120?(u=n,f=s,d=0):a<180?(u=0,f=s,d=n):a<240?(u=0,f=n,d=s):a<300?(u=n,f=0,d=s):(u=s,f=0,d=n),[u+l,f+l,d+l]}function Tn(i){if(i.type!=="color"||!i.colorContent)return null;const e=i.colorContent,[t,a,o]=op(e.hue,e.saturation,e.lightness),r=Math.max(0,Math.min(1,e.alpha));return[t,a,o,r]}function rp(i){const e=Tn(i);return e?`${e[0].toFixed(4)}:${e[1].toFixed(4)}:${e[2].toFixed(4)}:${e[3].toFixed(4)}`:"none"}function sp(i){const e=i.source;if(!e)return"none";if(ir(e.src))return"video";const t=e.type||"";return t||"none"}function ir(i){if(!i)return!1;const e=String(i).trim().toLowerCase();return e.startsWith("sharedtex:")||e.startsWith("sharedtex://")}class np{running=!1;frameId=0;pendingSync=!1;desiredWidth=0;desiredHeight=0;latestLayers=[];shaderAnimationRaf=null;sentWidth=0;sentHeight=0;lastLayers=new Map;precompiledShaders=new Set;prefetchedSources=new Set;videoRefreshAt=new Map;presentProfile="low-latency-safe";targetFps=60;commandDrainLimit=1024;autoPresentOnStateChange=!0;decodeStoreCpuBackupFrames=!1;decodeAllowSyntheticFallback=!1;texturePoolCapMb=512;shaderPrecompileQueueCap=4096;shaderPrecompilePerFrame=4;mediaHighBurstLimit=7;prefetchCacheMaxEntries=4096;prefetchCachePruneCount=256;decodePreviewSize=96;decodePreviewCacheMb=128;decodeUseOutputResolution=!0;decodeUploadQueueCapMb=256;decodeHandoffByteCapMb=128;decodeHandoffPredecodeShedPct=90;decodePredecodeEstimateCacheCapEntries=8192;mediaDropCommandPressurePct=90;mediaDropDecodePressurePct=90;mediaDropIoPressurePct=90;mediaDropDecodePriorityCutoff=180;mediaDropIoPriorityCutoff=128;adaptiveOverloadPrefetchState=null;adaptiveOverloadHandoffState=null;adaptiveOverloadEstimateCacheState=null;nextStatusPollAt=0;degradedModeActive=!1;decodeBackpressureActive=!1;decodeHandoffBackpressureActive=!1;decodeHandoffUtilizationPct=0;decodePendingUploadBackpressureActive=!1;decodePendingUploadUtilizationPct=0;decodeFramePoolBackpressureActive=!1;decodeFramePoolUtilizationPct=0;decodeEstimateCacheBackpressureActive=!1;commandBackpressureActive=!1;decodeGpuBridgePath=ep?.VITE_DECODE_GPU_BRIDGE_PATH||void 0;assertD3D11Ready(e){if(!e)throw new Error("Native renderer status unavailable after startup");if(e.backend!=="d3d11")throw new Error(`Native renderer backend is '${e.backend}', expected 'd3d11'`);if(!e.backend_ready)throw new Error("Native D3D11 backend reported not ready")}sourceCacheKey(e,t){return`${e}::${t}`}async start(e,t){if(this.running)return;await Ff({backend:"d3d11",decode_backend:"ffmpeg_d3d11va",width:e,height:t,target_fps:60,present_mode:"immediate",allow_tearing:!1,max_frame_latency:2,use_waitable_object:!0,shader_metadata_cache_cap:16384,pipeline_metadata_cache_cap:16384,vram_budget_mb:4096,decode_upload_queue_cap_mb:this.decodeUploadQueueCapMb,decode_handoff_byte_cap_mb:this.decodeHandoffByteCapMb,decode_handoff_predecode_shed_pct:this.decodeHandoffPredecodeShedPct,decode_predecode_estimate_cache_cap_entries:this.decodePredecodeEstimateCacheCapEntries,decode_use_output_resolution:this.decodeUseOutputResolution,decode_gpu_bridge_path:this.decodeGpuBridgePath});const a=await Di().catch(()=>null);this.assertD3D11Ready(a),console.log(`[NativeRendererSync] GPU pipeline active: backend=${a?.backend}, adapter=${a?.adapter_name??"unknown"}`),this.running=!0,await Qf().catch(()=>{}),await Es("output").catch(()=>Es("main")).catch(()=>{}),await this.applyPresentPolicyProfile(this.presentProfile).catch(()=>{}),await this.setTargetFps(this.targetFps).catch(()=>{}),await this.setCommandDrainPolicy(this.commandDrainLimit).catch(()=>{}),await this.setAutoPresentPolicy(this.autoPresentOnStateChange).catch(()=>{}),await this.setDecodeCpuBackupPolicy(this.decodeStoreCpuBackupFrames).catch(()=>{}),await this.setDecodeSyntheticFallbackPolicy(this.decodeAllowSyntheticFallback).catch(()=>{}),await this.setTexturePoolCapMb(this.texturePoolCapMb).catch(()=>{}),await this.setShaderPrecompilePolicy(this.shaderPrecompileQueueCap,this.shaderPrecompilePerFrame).catch(()=>{}),await this.setMediaPrefetchPolicy(this.mediaHighBurstLimit,this.prefetchCacheMaxEntries,this.prefetchCachePruneCount).catch(()=>{}),await this.setDecodePreviewPolicy(this.decodePreviewSize,this.decodePreviewCacheMb).catch(()=>{}),await this.setDecodeTargetPolicy(this.decodeUseOutputResolution).catch(()=>{}),await this.setDecodeUploadPolicy(this.decodeUploadQueueCapMb).catch(()=>{}),await this.setDecodeHandoffPolicy(this.decodeHandoffByteCapMb,this.decodeHandoffPredecodeShedPct).catch(()=>{}),await this.setDecodeEstimateCachePolicy(this.decodePredecodeEstimateCacheCapEntries).catch(()=>{}),await this.setMediaDropPolicy(this.mediaDropCommandPressurePct,this.mediaDropDecodePressurePct,this.mediaDropIoPressurePct,this.mediaDropDecodePriorityCutoff,this.mediaDropIoPriorityCutoff).catch(()=>{}),this.desiredWidth=e,this.desiredHeight=t,this.sentWidth=0,this.sentHeight=0}async stop(){this.running&&(this.running=!1,this.stopShaderAnimation(),this.lastLayers.clear(),this.latestLayers=[],this.precompiledShaders.clear(),this.prefetchedSources.clear(),this.videoRefreshAt.clear(),await zf().catch(()=>{}),await this.clearRuntimeCaches({clear_precompiled_shaders:!1,clear_texture_pool:!1,clear_metadata_caches:!1,clear_prefetch_cache:!0}).catch(()=>{}),await Jf().catch(()=>{}),await Lf().catch(()=>{}))}scheduleSync(e,t,a){if(!this.running)return;this.desiredWidth=e,this.desiredHeight=t,this.latestLayers=a;const o=a.some(r=>r.visible&&r.source?.type==="shader"&&r.source?.shaderCode);if(o&&this.shaderAnimationRaf===null){const r=()=>{if(!this.running){this.stopShaderAnimation();return}this.flush(this.desiredWidth,this.desiredHeight,this.latestLayers),this.shaderAnimationRaf=requestAnimationFrame(r)};this.shaderAnimationRaf=requestAnimationFrame(r)}else!o&&this.shaderAnimationRaf!==null&&this.stopShaderAnimation();this.pendingSync||(this.pendingSync=!0,setTimeout(()=>{this.pendingSync=!1,this.flush(this.desiredWidth,this.desiredHeight,this.latestLayers)},16))}stopShaderAnimation(){this.shaderAnimationRaf!==null&&(cancelAnimationFrame(this.shaderAnimationRaf),this.shaderAnimationRaf=null)}async flush(e,t,a){if(!this.running)return;const o=[],r=new Map,s=new Set;(e!==this.sentWidth||t!==this.sentHeight)&&(o.push({type:"set_output",width:e,height:t,refresh_hz:60}),this.sentWidth=e,this.sentHeight=t);const n=Date.now();if(n>=this.nextStatusPollAt){this.nextStatusPollAt=n+500;const m=await Di().catch(()=>null);m&&(this.degradedModeActive=!!m.degraded_mode_active,this.decodeBackpressureActive=!!m.decode_backpressure_active,this.decodeHandoffBackpressureActive=!!m.decode_handoff_backpressure_active,this.decodeHandoffUtilizationPct=Math.max(0,Math.min(100,Math.round(m.decode_handoff_utilization_pct??0))),this.decodePendingUploadBackpressureActive=!!m.decode_pending_upload_backpressure_active,this.decodePendingUploadUtilizationPct=Math.max(0,Math.min(100,Math.round(m.decode_pending_upload_utilization_pct??0))),this.decodeFramePoolBackpressureActive=!!m.decode_frame_pool_backpressure_active,this.decodeFramePoolUtilizationPct=Math.max(0,Math.min(100,Math.round(m.decode_frame_pool_utilization_pct??0))),this.decodeEstimateCacheBackpressureActive=!!m.decode_predecode_estimate_cache_backpressure_active,this.commandBackpressureActive=!!m.command_backpressure_active)}const l=this.degradedModeActive||this.decodeBackpressureActive||this.decodeHandoffBackpressureActive||this.decodeHandoffUtilizationPct>=85||this.decodePendingUploadBackpressureActive||this.decodePendingUploadUtilizationPct>=85||this.decodeFramePoolBackpressureActive||this.decodeFramePoolUtilizationPct>=85||this.decodeEstimateCacheBackpressureActive||this.commandBackpressureActive;if(this.adaptiveOverloadPrefetchState!==l){this.adaptiveOverloadPrefetchState=l;const m=Math.max(1,Math.floor(this.mediaHighBurstLimit/2)),b=Math.min(16384,Math.max(this.prefetchCachePruneCount,Math.floor(this.prefetchCacheMaxEntries/8)));Bs({media_high_burst_limit:l?m:this.mediaHighBurstLimit,prefetch_cache_max_entries:this.prefetchCacheMaxEntries,prefetch_cache_prune_count:l?b:this.prefetchCachePruneCount}).catch(()=>{})}if(this.adaptiveOverloadHandoffState!==l){this.adaptiveOverloadHandoffState=l;const m=Math.max(50,Math.min(99,this.decodeHandoffPredecodeShedPct-10));this.setDecodeHandoffPolicy(this.decodeHandoffByteCapMb,l?m:this.decodeHandoffPredecodeShedPct).catch(()=>{})}if(this.adaptiveOverloadEstimateCacheState!==l){this.adaptiveOverloadEstimateCacheState=l;const m=Math.max(256,Math.floor(this.decodePredecodeEstimateCacheCapEntries/2));this.setDecodeEstimateCachePolicy(l?m:this.decodePredecodeEstimateCacheCapEntries).catch(()=>{})}const u=l?160:80,f=l?140:180,d=l?72:96;if(a.forEach((m,b)=>{const M=sp(m),C=ap(m),T=C.length?C.join("|"):"none",I={id:m.id,z:b,visible:m.visible,blend:Fs(m.blendMode),opacity:m.opacity,sourceSig:tp(m),effectsSig:T,colorSig:rp(m)};r.set(m.id,I);const W=this.lastLayers.get(m.id);if((!W||W.z!==I.z||W.visible!==I.visible||W.blend!==I.blend||W.opacity!==I.opacity)&&(o.push({type:"upsert_layer",layer_id:m.id,z_index:b,blend_mode:Fs(m.blendMode),opacity:m.opacity}),o.push({type:"set_layer_visibility",layer_id:m.id,visible:m.visible})),!W||W.sourceSig!==I.sourceSig){const L=m.source;if(L){o.push({type:"bind_media_source",layer_id:m.id,source_id:L.id,uri:L.src,source_type:M});const N=this.sourceCacheKey(L.id,L.src);if(!ir(L.src)&&!this.prefetchedSources.has(N)){this.prefetchedSources.add(N);const ae=M==="video"?f:d;As(L.id,L.src,ae).catch(()=>{})}if(M==="video"?this.videoRefreshAt.set(N,n+u):this.videoRefreshAt.delete(N),L.shaderCode){const ae=`${L.id}:${ar(L.shaderCode)}`;this.precompiledShaders.has(ae)||(this.precompiledShaders.add(ae),o.push({type:"precompile_shader",shader_id:ae,stage:"pixel",source:L.shaderCode,entry:"main"})),o.push({type:"bind_isf_shader",layer_id:m.id,shader_id:ae})}}else o.push({type:"bind_media_source",layer_id:m.id,source_id:`none:${m.id}`,uri:"",source_type:"none"})}const G=m.source;if(G&&M==="video"){const L=this.sourceCacheKey(G.id,G.src);s.add(L);const N=this.videoRefreshAt.get(L)??0;!ir(G.src)&&n>=N&&(this.videoRefreshAt.set(L,n+u),As(G.id,G.src,f).catch(()=>{}))}if(!W||W.colorSig!==I.colorSig){const L=Tn(m);L&&o.push({type:"set_layer_color",layer_id:m.id,rgba:L})}(!W||W.effectsSig!==I.effectsSig)&&o.push({type:"set_effect_chain",layer_id:m.id,effect_ids:C});const O=m.source;if(O?.shaderCode&&m.visible){const L=`${O.id}:${ar(O.shaderCode)}`,N=new Date,ce=N.getHours()*3600+N.getMinutes()*60+N.getSeconds()+N.getMilliseconds()/1e3,ae={},se={},te={};if(O.shaderValues)for(const[Q,$]of Object.entries(O.shaderValues))typeof $=="number"?ae[Q]=$:typeof $=="boolean"?ae[Q]=$?1:0:Array.isArray($)&&($.length===2?se[Q]=[$[0],$[1]]:$.length>=4&&(te[Q]=[$[0],$[1],$[2],$[3]]));o.push({type:"update_isf_uniforms",shader_id:L,time:n/1e3,time_delta:1/this.targetFps,frame_index:this.frameId,render_width:this.desiredWidth||1920,render_height:this.desiredHeight||1080,date:[N.getFullYear(),N.getMonth()+1,N.getDate(),ce],audio_level:0,audio_bass:0,audio_mid:0,audio_high:0,audio_beat:0,audio_beat_phase:0,audio_bpm:0,audio_spectral_centroid:0,float_inputs:ae,point_inputs:se,color_inputs:te}),o.push({type:"render_isf_to_layer",layer_id:m.id})}}),this.lastLayers.forEach((m,b)=>{r.has(b)||o.push({type:"remove_layer",layer_id:b})}),this.videoRefreshAt.forEach((m,b)=>{s.has(b)||this.videoRefreshAt.delete(b)}),!o.length)return;o.push({type:"present"});const h={frame_id:++this.frameId,commands:o};await Df(h),this.lastLayers=r}async logStatus(){if(!this.running)return;const e=await Di().catch(()=>null);e&&console.log("[NativeRendererSync] status",e)}async applyPresentPolicyProfile(e=this.presentProfile){if(!this.running)return;this.presentProfile=e;const t=await Di().catch(()=>null);if(!t)return;const a=!!t.supports_tearing,o=!!t.supports_waitable_object;let r;e==="vsync-live"?r={present_mode:"vsync",allow_tearing:!1,max_frame_latency:2,use_waitable_object:!1}:e==="low-latency-aggressive"?r={present_mode:"immediate",allow_tearing:a,max_frame_latency:1,use_waitable_object:o}:r={present_mode:"immediate",allow_tearing:!1,max_frame_latency:2,use_waitable_object:o},await Kf(r).catch(()=>{})}async setTargetFps(e){const t=Math.max(1,Math.min(480,Math.round(e)));this.targetFps=t,this.running&&await Uf({target_fps:t}).catch(()=>{})}async setCommandDrainPolicy(e){const t=Math.max(64,Math.min(16384,Math.round(e)));this.commandDrainLimit=t,this.running&&await Gf({max_commands_per_tick:t}).catch(()=>{})}async setAutoPresentPolicy(e){this.autoPresentOnStateChange=!!e,this.running&&await Of({auto_present_on_state_change:this.autoPresentOnStateChange}).catch(()=>{})}async setDecodeCpuBackupPolicy(e){this.decodeStoreCpuBackupFrames=!!e,this.running&&await Wf({decode_store_cpu_backup_frames:this.decodeStoreCpuBackupFrames}).catch(()=>{})}async setDecodeSyntheticFallbackPolicy(e){this.decodeAllowSyntheticFallback=!!e,this.running&&await Vf({decode_allow_synthetic_fallback:this.decodeAllowSyntheticFallback}).catch(()=>{})}async setTexturePoolCapMb(e){const t=Math.max(64,Math.min(16384,Math.round(e)));this.texturePoolCapMb=t,this.running&&await Nf({texture_pool_cap_mb:t}).catch(()=>{})}async setShaderPrecompilePolicy(e,t){const a=Math.max(64,Math.min(65536,Math.round(e))),o=Math.max(1,Math.min(128,Math.round(t)));this.shaderPrecompileQueueCap=a,this.shaderPrecompilePerFrame=o,this.running&&await qf({shader_precompile_queue_cap:a,shader_precompile_per_frame:o}).catch(()=>{})}async setMediaPrefetchPolicy(e,t,a){const o=Math.max(1,Math.min(255,Math.round(e))),r=Math.max(256,Math.min(262144,Math.round(t))),s=Math.max(16,Math.min(16384,Math.round(a)));this.mediaHighBurstLimit=o,this.prefetchCacheMaxEntries=r,this.prefetchCachePruneCount=s,this.adaptiveOverloadPrefetchState=null,this.running&&await Bs({media_high_burst_limit:o,prefetch_cache_max_entries:r,prefetch_cache_prune_count:s}).catch(()=>{})}async setDecodePreviewPolicy(e,t){const a=Math.max(16,Math.min(4096,Math.round(e))),o=Math.max(16,Math.min(1024,Math.round(t)));this.decodePreviewSize=a,this.decodePreviewCacheMb=o,this.running&&await Hf({decode_preview_size:a,decode_preview_cache_mb:o}).catch(()=>{})}async setDecodeTargetPolicy(e){this.decodeUseOutputResolution=!!e,this.running&&await jf({decode_use_output_resolution:this.decodeUseOutputResolution}).catch(()=>{})}async setDecodeUploadPolicy(e){const t=Math.max(16,Math.min(1024,Math.round(e)));this.decodeUploadQueueCapMb=t,this.running&&await Xf({decode_upload_queue_cap_mb:t}).catch(()=>{})}async setDecodeHandoffPolicy(e,t){const a=Math.max(16,Math.min(1024,Math.round(e))),o=Math.max(50,Math.min(99,Math.round(t)));this.decodeHandoffByteCapMb=a,this.decodeHandoffPredecodeShedPct=o,this.running&&await $f({decode_handoff_byte_cap_mb:a,decode_handoff_predecode_shed_pct:o}).catch(()=>{})}async setDecodeEstimateCachePolicy(e){const t=Math.max(256,Math.min(262144,Math.round(e)));this.decodePredecodeEstimateCacheCapEntries=t,this.running&&await Zf({decode_predecode_estimate_cache_cap_entries:t}).catch(()=>{})}setDecodeGpuBridgePath(e){const t=(e||"").trim();this.decodeGpuBridgePath=t.length?t:void 0}async clearRuntimeCaches(e){await If(e).catch(()=>{})}async setMediaDropPolicy(e,t,a,o,r){const s=Math.max(50,Math.min(99,Math.round(e))),n=Math.max(50,Math.min(99,Math.round(t))),l=Math.max(50,Math.min(99,Math.round(a))),u=Math.max(0,Math.min(255,Math.round(o))),f=Math.max(0,Math.min(255,Math.round(r)));this.mediaDropCommandPressurePct=s,this.mediaDropDecodePressurePct=n,this.mediaDropIoPressurePct=l,this.mediaDropDecodePriorityCutoff=u,this.mediaDropIoPriorityCutoff=f,this.running&&await Yf({command_pressure_pct:s,decode_queue_pressure_pct:n,io_queue_pressure_pct:l,decode_priority_cutoff:u,io_priority_cutoff:f}).catch(()=>{})}}function lp(){const i=we($e);return{width:i.width||1920,height:i.height||1080}}const cp=ii(0),Mn={active:!1,inactiveReason:"pilot not initialized",adapter:"",webgpuRenderMs:0,handoffUploadMs:0,mainRenderMs:0,pilotDims:"",pilotFramesRendered:0,pilotFramesFailed:0,lastError:null,glContextCount:0,gpuMemMb:null,viewportLabel:"",outputWindowActive:!1,updatedAt:0},Ya=ii({...Mn});function Ls(){Ya.set({...Mn})}var up=Is('<div class="blackout-overlay svelte-o4ydsk"></div>'),dp=Is('<div><div><canvas></canvas> <canvas class="output-overlay svelte-o4ydsk"></canvas> <!></div></div>');function zp(i,e){hl(e,!1);const t=()=>Ft(Oe,"$settings",h),a=()=>Ft($e,"$project",h),o=()=>Ft(Al,"$outputFrozen",h),r=()=>Ft(Nr,"$vjOutputLayers",h),s=()=>Ft(ki,"$layers",h),n=()=>Ft(ca,"$vjClipLauncher",h),l=()=>Ft(Ol,"$compositions",h),u=()=>Ft(Wl,"$macros",h),f=()=>Ft(Ti,"$mediaLibrary",h),d=()=>Ft(Mi,"$audioStore",h),[h,m]=_l();let b=null,M=null,C=null,T=null,I=null,W=null,G=null,O=null,L=null,N=null,ce=null,ae=null,se=null,te=null;const Q=new Set;function $(g,v){Q.has(g)||(Q.add(g),v().catch(_=>{console.warn(`[Canvas] lazy-load ${g} failed:`,_),Q.delete(g)}))}let j=0,Ae=performance.now(),Ce=0;const Be=Fl||typeof window<"u"&&!!window.__ELECTRON__,ie=typeof window<"u"&&!!window.__ELECTRON__;let Pe=nt(!1),Ke=!1,K=null,We=0,pe=0,ze=!1,Ve=0,_t=nt(0);const Lt=typeof window<"u"&&!!window.__TAURI_INTERNALS__;let At=new Set;const Ia=new Set,Ki=typeof navigator<"u"&&/Mac/.test(navigator.platform);let mt=null,Ee=null,ke=null,Ue=null,je=null,Je=null,rt=null,dt=null,oi=0,da=0,Bt=null,fa=null,Nt=null,ri=null;const pa=new Map,Ua=new Map,si=new Map;function Rn(g){return JSON.parse(JSON.stringify(g,(v,_)=>{if(!(v==="texture"||v==="videoElement"||v==="renderTarget"||v==="iframeElement"||v==="synthVisionCanvas")&&!(typeof v=="string"&&v.startsWith("_"))&&!(_&&typeof _=="object"&&_.constructor?.name?.startsWith("_")))return _}))}function An(g,v,_,y,x){const B={id:g,name:`MAP L${_+1}: ${v.name}`,type:"group",visible:!0,locked:!1,opacity:y,blendMode:x,source:null,linesContent:null,svgContent:null,colorContent:null,lightPaintingContent:null,advLightPaintingContent:null,textContent:null,splatContent:null,model3dContent:null,pixelFXContent:null,gpuLayerContent:null,position:{x:0,y:0},scale:{x:1,y:1},rotation:0,flipH:!1,flipV:!1,warpMode:"none",corners:{topLeft:{x:0,y:1},topRight:{x:1,y:1},bottomLeft:{x:0,y:0},bottomRight:{x:1,y:0}},meshGrid:null,mask:null,cropRegion:null,layerShape:null,effects:[],edgeEffects:null,groupConfig:{shaderMode:"individual",overrideStyles:!1,shaderSource:null}},R=[];for(const S of v.layers){const F=Rn(S);F.id=`${g}::${F.id}`,F.parentGroupId=g,F.bank=void 0,R.push(F)}return{compositionRef:v,group:B,layers:R}}let _e=nt(),he=nt(null),ni,vt=nt(),ft=nt(),pt=nt(),Qe=null,li=!1,ci=null,ui=null;function Bn(g,v,_,y,x,B){if(!P(pt))return;const R=P(pt).parentElement?.clientWidth||1920,S=P(pt).parentElement?.clientHeight||1080,F=Ge&&window.devicePixelRatio||1,z=Math.max(1,Math.round(R*F)),Y=Math.max(1,Math.round(S*F));P(pt).width!==z&&jt(pt,P(pt).width=z),P(pt).height!==Y&&jt(pt,P(pt).height=Y);const D=P(pt).getContext("2d");D&&(D.setTransform(F,0,0,F,0,0),D.clearRect(0,0,R,S),g&&g!=="none"&&hd(D,R,S,g),(v>0||_>0||y>0||x>0)&&gs(D,R,S,{edgeBlendLeft:v,edgeBlendRight:_,edgeBlendTop:y,edgeBlendBottom:x,edgeBlendGamma:B}))}let Ji=0,Qi=0,ha=!1,ur=.5,dr=.5;const Me=new Map,fr=64;typeof window<"u"&&(window.__textureCache=Me,window.__loadingTextures=null);const Et=new Set;typeof window<"u"&&(window.__loadingTextures=Et);const di=new Set,fi=3,pi=new Map;function En(g){const v=Me.get(g);v&&(Me.delete(g),Me.set(g,v))}function hi(){if(Me.size<=fr)return;const g=new Set,v=x=>{if(x)for(const B of x){if(!B?.source)continue;const R=B.source.src==="ai-generated"||B.source.src==="js-animation",S=B.source.type==="synthvision"||!B.source.src&&B.source.synthVisionCanvas||B.source.type==="threejs"&&B.source.threejsCanvas&&!B.source.src,F=B.source.type==="video"&&typeof B.id=="string"&&B.id.startsWith("vj-layer-"),z=R||S?B.source.id:F?`${B.id}:${B.source.src}`:B.source.src,D=B.source.type==="shader"?`${B.id}:${z}`:z;D&&g.add(D)}};v(we(ki)),v(we(Nr));const _=Math.max(fr,g.size);if(Me.size<=_)return;const y=[];for(const x of Me.keys()){if(Me.size-y.length<=_)break;g.has(x)||y.push(x)}window.__VIDEO_DEBUG__&&y.length>0&&console.log("[textureCache] evicting",y.length,"of",Me.size,"— pinned:",g.size,"keys:",y);for(const x of y){const B=Me.get(x);B&&B.dispose(),Me.delete(x)}Me.size>_&&window.__VIDEO_DEBUG__&&console.warn("[textureCache] cache size",Me.size,"exceeds target",_,"— all entries pinned, allowing growth")}const Dt=new Map,gt=new Map,Ga=new Map,eo=new Map,Fn=/(^|_)(speed|rate|tempo|timescale)(_|$)/i;let mi=null;function Ln(){if(!mi){const v=new Uint8Array(16384);for(let _=0;_<64;_++)for(let y=0;y<64;y++){const x=(_*64+y)*4;(Math.floor(y/8)+Math.floor(_/8))%2===0?(v[x]=180,v[x+1]=100,v[x+2]=220):(v[x]=60,v[x+1]=160,v[x+2]=200),v[x+3]=255}mi=new St(v,64,64,qe),mi.needsUpdate=!0}return mi}const to=new Map;let ao,io,oo,yt=nt(null);const pr=()=>{P(yt)&&P(yt).resetAnimationTimes()},ma=new Map,qt=new Map,va=new Map;let hr=0;const vi=new Map;let mr=0,Oa=null,vr=null;const gi=new Map;let gr=0;const Ct=new Map,yi=new Map,bi=new Map;let yr=!1;function Dn(){yr||(yr=!0,Ll().catch(g=>console.warn("[Canvas] gpu-layer: WebGPU init failed",g?.message||g)))}const Yt=new Map,ht=new Map;let br=0;const xr={live:{scale:.65,minSize:256,pressureIterations:10},balanced:{scale:.78,minSize:256,pressureIterations:14},quality:{scale:1,minSize:384,pressureIterations:20}};let ga=nt(xr.live);function wr(g,v){return{width:Math.max(P(ga).minSize,Math.round(g*P(ga).scale)),height:Math.max(P(ga).minSize,Math.round(v*P(ga).scale))}}let xi=!1;function zn(g,v,_,y){const x=_/y;return g/v>x?{w:Math.round(v*x),h:Math.round(v)}:{w:Math.round(g),h:Math.round(g/x)}}function ro(g,v){const _=a().width||1920,y=a().height||1080;if(tt||Ge)jt(vt,P(vt).style.width="100%"),jt(vt,P(vt).style.height="100%");else{const{w:x,h:B}=zn(g,v,_,y);jt(vt,P(vt).style.width=x+"px"),jt(vt,P(vt).style.height=B+"px"),P(_e)&&(jt(_e,P(_e).style.width=x+"px"),jt(_e,P(_e).style.height=B+"px"))}}function Sr(){return{w:P(ft).offsetWidth,h:P(ft).offsetHeight}}bl(()=>{const{w:g,h:v}=Sr(),_=a().width||1920,y=a().height||1080;Ze(he,new Tl(P(_e),_,y,{preserveDrawingBuffer:!1})),at(async()=>{const{offlineRender:p}=await import("./offlineRender-C5AIhNay.js").then(w=>w.d);return{offlineRender:p}},__vite__mapDeps([6,1,2,7,0,3,4,5]),import.meta.url).then(({offlineRender:p})=>{p.registerEngine(P(he),P(_e))}),uf(P(_e)),ro(g,v);const x=Oe.subscribe(p=>{if(!P(he))return;const w=Si()&&!Ge&&!tt&&!!p.experimental?.editorWebGPU;P(he).setDomeEnabled(w?!1:p.output.domeEnabled),P(he).setDomeSettings({mode:p.output.domeMode,fov:p.output.domeFOV,rotation:p.output.domeRotation,tilt:p.output.domeTilt,offsetX:p.output.domeOffsetX,offsetY:p.output.domeOffsetY,curvature:p.output.domeCurvature,truncation:p.output.domeTruncation}),P(he).setOutputTransform({rotation:Ge?p.output.outputRotation??0:0,cropX:Ge?p.output.outputCropX??0:0,cropY:Ge?p.output.outputCropY??0:0,cropWidth:Ge?p.output.outputCropWidth??1:1,cropHeight:Ge?p.output.outputCropHeight??1:1,brightness:Ge?p.output.brightness??1:1,contrast:Ge?p.output.contrast??1:1,gamma:Ge?p.output.gamma??1:1})});if(!tt&&!Ge&&(fn("sender"),Yl(),Ml()),!tt&&!Ge&&!Si()&&P(_e)){const p=P(_e);ui=Oe.subscribe(w=>{const k=w?.performance;Bf({baseSource:p,warpActive:Wr(w.output?.masterWarp),zeroCopy:!!w.experimental?.outputZeroCopy,webrtc:!!w.experimental?.outputWebRTC,getWarp:()=>we(Oe).output?.masterWarp,getSize:()=>({w:we(Oe).output?.masterCanvasWidth??1920,h:we(Oe).output?.masterCanvasHeight??1080}),perf:{frameRate:k?.outputFrameRate??60,maxBitrate:k?.outputMaxBitrate,degradationPreference:k?.outputDegradationPreference,codecPreference:k?.outputCodecPreference}})})}if(jl().then(()=>{const p=$r();Ya.update(w=>({...w,adapter:p.description||`${p.vendor??"?"}/${p.architecture??"?"}`,inactiveReason:p.supported?w.inactiveReason||"pilot disabled in settings":`WebGPU not supported (${p.failReason||"reason unknown"})`,updatedAt:Date.now()}))}),ci=Oe.subscribe(async p=>{const w=!Ge&&!tt&&Zr(!!p.experimental?.webgpuPilot);if(w&&!Qe&&!li){li=!0;try{const{WebGPUPilot:k}=await at(async()=>{const{WebGPUPilot:A}=await import("./webgpuPilot-CkJUfvLn.js");return{WebGPUPilot:A}},__vite__mapDeps([8,2,9,1]),import.meta.url);if(!Zr(!!we(Oe).experimental?.webgpuPilot)){li=!1;return}if(Qe=await k.create({width:512,height:512}),Qe){const A=$r();Ya.update(E=>({...E,active:!0,inactiveReason:"",adapter:A.description||`${A.vendor??"?"}/${A.architecture??"?"}`,pilotDims:`${Qe.metrics.outputWidth}×${Qe.metrics.outputHeight}`,updatedAt:Date.now()}))}}catch(k){Ya.update(A=>({...A,active:!1,inactiveReason:`pilot create failed: ${k?.message??k}`,updatedAt:Date.now()}))}finally{li=!1}}else if(!w&&Qe){const k=Qe;Qe=null,await k.dispose(),Ls()}}),Lt&&!tt&&!Ge){Bt=new np;const p=lp();Bt.start(p.width,p.height).then(()=>{fa=setInterval(()=>{Bt?.logStatus()},1e4)}).catch(w=>{console.warn("[NativeRendererSync] failed to start native renderer:",w)}),Nt=ki.subscribe(w=>{const k=we($e);Bt?.scheduleSync(k.width||1920,k.height||1080,w)}),ri=$e.subscribe(w=>{Bt?.scheduleSync(w.width||1920,w.height||1080,w.layers||[])})}window.electronOSR?.onOsrStatus&&window.electronOSR.onOsrStatus(p=>{ze=p.active,p.active?console.log("[Canvas] OSR zero-copy active — disabling readPixels send"):console.log("[Canvas] OSR inactive (reason:",p.reason,") — re-enabling CPU send path")}),window.__ghostarcadeOutputCanvas=P(_e),ao=new ea,io=new Ra(-1,1,1,-1,.1,10),io.position.z=1;const B=new Aa(2,2);oo=new Ba(B),ao.add(oo);const R=P(he).getRenderer();Ze(yt,new ec(R,_,y)),P(he).setDrawingRenderer(P(yt));const S=new ic(R,_,y);P(he).setShapeRenderer(S),window.addEventListener("lines-reset-animations",pr);const F=R.domElement;F.addEventListener("webglcontextlost",kr,!1),F.addEventListener("webglcontextrestored",Tr,!1),P(_e).addEventListener("mousemove",_r),P(_e).addEventListener("mouseleave",Cr),P(_e).addEventListener("mouseenter",Pr);function z(p,w){const k=w!==null||!(we(ca).stageMode&&we(ca).isLive);try{In(p,k)}catch(E){console.error("[Canvas] Media texture error:",E)}try{Wn(p)}catch(E){console.error("[Canvas] Shader update error:",E)}try{$n(p)}catch(E){console.error("[Canvas] Integrated effect error:",E)}const A=w||p;try{Vn(A)}catch(E){console.error("[Canvas] Lines update error:",E)}try{Nn(A)}catch(E){console.error("[Canvas] SVG update error:",E)}try{qn(A)}catch(E){console.error("[Canvas] Light painting error:",E)}try{Yn(A)}catch(E){console.error("[Canvas] Text update error:",E)}try{Hn(A)}catch(E){console.error("[Canvas] Splat update error:",E)}try{Xn(A)}catch(E){console.error("[Canvas] Model3D update error:",E)}try{jn(A)}catch(E){console.error("[Canvas] GPU layer update error:",E)}}let Y=0,D=0;function c(){window.__animTick||(window.__animTick=0),window.__animTick<3&&(window.__animTick++,console.log("[animate-tick] frame",window.__animTick,"— engine=",!!P(he),"contextLost=",xi,"outputFrozen=",o(),"spoutOutputActive=",P(Pe),"outputWindowOpen=",t()?.output?.outputWindowOpen,"glCanvas=",!!F));const p=t()?.performance?.editorMaxFps??0;if(p>0){const w=performance.now(),k=1e3/p;if(w-D<k){ni=requestAnimationFrame(c);return}D=w}try{if(P(he)&&!xi&&!o()){const A=r(),E=s(),U=n();let H,q,X=!1;if(U.stoppedAll&&U.isLive)H=[],q=void 0;else if(U.mapMode&&U.isLive){const ne=[],V=U.layerStates,be=V.some(et=>et.solo),Fe=new Set;for(let et=0;et<V.length;et++){const J=V[et];if(J.mute||be&&!J.solo)continue;const re=J.activeClip;if(!re||re.type!=="preset"||!re.presetId)continue;const ue=l().find(ye=>ye.id===re.presetId);if(!ue)continue;const Le=J.opacity*(U.masterOpacity??1);if(Le<=0)continue;const xe=`mapvj-${et}-${re.id}`;Fe.add(xe);let ge=si.get(xe);(!ge||ge.compositionRef!==ue)&&(ge=An(xe,ue,et,Le,J.blendMode),si.set(xe,ge)),ge.group.opacity=Le,ge.group.blendMode=J.blendMode,ge.group.name=`MAP L${et+1}: ${ue.name}`,ge.group._postCompositeEffects=J.effects??[],ne.push(ge.group);for(const ye of ge.layers)ne.push(ye)}for(const et of si.keys())Fe.has(et)||si.delete(et);H=ne,q=U.compositionEffects,z(H,null),X=!0}else if(U.stageMode&&U.isLive){const ne=[...A||[],...E];z(ne,E),X=!0;const V=J=>{if(!J?.source)return null;if(J.source.type==="shader"&&J.source.src){const re=`${J.id}:${J.source.src}`,ue=gt.get(re);if(ue)return ue.texture}return J.source.texture??null},be=new Map;if(A)for(const J of A){const re=J.id.match(/^vj-layer-(\d+)(?:-([AB]))?$/);if(!re)continue;const ue=parseInt(re[1]),Le=re[2],xe=be.get(ue)??{};Le==="A"?xe.a=J:Le==="B"?xe.b=J:xe.single=J,be.set(ue,xe)}const Fe=new Map;for(const[J,re]of be.entries()){if(re.single){const ue=V(re.single);ue&&Fe.set(J,{layer:re.single,texture:ue});continue}if(re.a&&!re.b){const ue=V(re.a);ue&&Fe.set(J,{layer:re.a,texture:ue});continue}if(re.b&&!re.a){const ue=V(re.b);ue&&Fe.set(J,{layer:re.b,texture:ue});continue}if(re.a&&re.b){const ue=V(re.a),Le=V(re.b);if(!ue&&!Le)continue;const xe=P(he).getOrCreateVJCrossfadeTarget(J);P(he).renderVJCrossfadeToTarget(xe,ue,Le),Fe.set(J,{layer:re.a,texture:xe.texture})}}H=E.map(J=>{if(J.vjLayerIndex!==void 0){const re=Fe.get(J.vjLayerIndex);if(re){const ue={...re.layer.source,texture:re.texture,__vjStage:!0};return J.type==="group"?{...J,source:ue}:{...J,source:ue,effects:[...re.layer.effects||[],...J.effects]}}}return J}),q=U.compositionEffects}else A?(H=A,q=U.compositionEffects):(H=E,q=void 0);const ee=we(Vr),Te=ee.config.isPlaying?ee.activeOverrides:{},oe=[];if(ee.config.isPlaying&&Object.keys(Te).length>0){const ne=performance.now();(!window._kfCanvasLogTime||ne-window._kfCanvasLogTime>1e3)&&(window._kfCanvasLogTime=ne,console.log("[KF Canvas] applying overrides:",JSON.stringify(Te),"layers:",H.map(V=>V.id)))}for(let ne=0;ne<H.length;ne++){const V=H[ne],Fe=V.id?.startsWith("vj-layer-")&&V.source?.id?`vj-${V.source.id}`:V.id,et=Te[Fe];if(et){for(const[J,re]of Object.entries(et))if(J==="layer:opacity")oe.push({layer:V,key:J,orig:V.opacity,target:V,prop:"opacity"}),V.opacity=re;else if(J.startsWith("shader:")&&V.source?.shaderValues){const ue=J.slice(7);oe.push({layer:V,key:J,orig:V.source.shaderValues[ue],target:V.source.shaderValues,prop:ue}),V.source.shaderValues[ue]=re}else if(J.startsWith("fx:")){const ue=J.split(":"),Le=ue[1],xe=ue[2],ge=V.effects?.find(ye=>ye.id===Le);ge&&(xe==="enabled"?(oe.push({layer:V,key:J,orig:ge.enabled,target:ge,prop:"enabled"}),ge.enabled=re):xe==="opacity"?(oe.push({layer:V,key:J,orig:ge.opacity,target:ge,prop:"opacity"}),ge.opacity=re):(oe.push({layer:V,key:J,orig:ge.params?.[xe],target:ge.params,prop:xe}),ge.params&&(ge.params[xe]=re)))}else if(J.startsWith("edge:")){const ue=J.split(":"),Le=ue[1],xe=ue[2],ge=V.edgeEffects?.effects?.find(ye=>ye.id===Le);ge&&(xe==="enabled"?(oe.push({layer:V,key:J,orig:ge.enabled,target:ge,prop:"enabled"}),ge.enabled=re):xe==="opacity"&&(oe.push({layer:V,key:J,orig:ge.opacity,target:ge,prop:"opacity"}),ge.opacity=re))}else if(J.startsWith("model3d:")&&V.model3dContent){const ue=J.slice(8).split("."),Le=ue.pop();let xe=V.model3dContent;for(const ge of ue){if(xe?.[ge]==null){xe=null;break}xe=xe[ge]}xe&&(oe.push({layer:V,key:J,orig:xe[Le],target:xe,prop:Le}),xe[Le]=re)}else if(J.startsWith("gpu:")&&V.gpuLayerContent){const ue=J.slice(4),Le=V.gpuLayerContent.params||(V.gpuLayerContent.params={});oe.push({layer:V,key:J,orig:Le[ue],target:Le,prop:ue}),Le[ue]=re}}}const me=Object.keys(Te).length>0;(!X||me)&&z(H,null),ee.config.isPlaying||eo.clear();const de=we(Ul),ve=de.isPlaying||Object.keys(de.opacityOverrides).length>0?de.opacityOverrides:null,st=we(Gl);if(st.sliceOutputs.size>0&&st.layerToSlice.size>0)for(let ne=0;ne<H.length;ne++){const V=H[ne],be=st.layerToSlice.get(V.id);if(!be)continue;const Fe=st.sliceOutputs.get(be);Fe===void 0||Fe>=1||(V._stageOrigOpacity=V.opacity,V.opacity=V.opacity*Fe)}if(ve){const ne=de.pattern?.continuousLayers??{};for(let V=0;V<H.length;V++){const be=H[V],Fe=ve[be.id];Fe!==void 0&&(ne[be.id]?be._seqGate=Fe:Fe<1&&(be._seqOrigOpacity=be.opacity,be.opacity=be.opacity*Fe))}}try{const ne=n().crossfaderEnabled===!0&&n().isLive;P(he).setCrossfade(ne,n().crossfaderValue??0,n().crossfaderTransition||"dissolve",n().crossfaderCurve||"constant-power",n().crossfaderBlendMode||"normal");const V=u();let be;for(const Fe of V.macros)Fe.value>.001&&Fe.effects.length>0&&(be||(be=[]),be.push({id:Fe.id,value:Fe.value,effects:Fe.effects}));Qe&&!Ge&&!tt&&(Qe.tick(),Ya.update(Fe=>({...Fe,webgpuRenderMs:Math.round(Qe.metrics.webgpuRenderMs*100)/100,pilotFramesRendered:Qe.metrics.framesRendered,pilotFramesFailed:Qe.metrics.framesFailed,lastError:Qe.metrics.lastError,updatedAt:Date.now()}))),P(he).render(H,null,q,be)}catch(ne){console.error("[Canvas] Render error:",ne)}for(const ne of oe)ne.orig===void 0?delete ne.target[ne.prop]:ne.target[ne.prop]=ne.orig;for(let ne=0;ne<H.length;ne++){const V=H[ne];V._seqOrigOpacity!==void 0&&(V.opacity=V._seqOrigOpacity,delete V._seqOrigOpacity),V._seqGate!==void 0&&delete V._seqGate,V._stageOrigOpacity!==void 0&&(V.opacity=V._stageOrigOpacity,delete V._stageOrigOpacity)}!tt&&!Ge&&!Si()&&P(_e)&&Rf(P(_e));const bt=t()?.output?.outputWindowOpen??!1,Dr=(t()?.output?.slices??[]).filter(ne=>ne.enabled);if((!P(Pe)||!F||ze||tt||Ge)&&window.__SPOUT_DEBUG__){const ne=Date.now();(!window.__spoutInnerDbgLast||ne-window.__spoutInnerDbgLast>1e3)&&(window.__spoutInnerDbgLast=ne,console.log("[syphon-gate] send skipped — spoutOutputActive=",P(Pe),"outputWindowOpen=",bt,"glCanvas=",!!F,"osrSpoutActive=",ze,"isOsrMode=",tt,"isOutputMode=",Ge))}if(P(Pe)&&F&&!ze&&!tt&&!Ge&&(Ve++,!(Ve%2!==0&&!Ke))){const ne=t()?.output?.spoutResolution||"match";let V=1920,be=1080;ne==="4K"?(V=3840,be=2160):ne==="720p"?(V=1280,be=720):ne==="WXGA"?(V=1280,be=800):ne==="WUXGA"?(V=1920,be=1200):ne==="custom"?(V=t()?.output?.customWidth||1920,be=t()?.output?.customHeight||1080):ne==="output"&&P(Ht)?(V=P(Ht).width,be=P(Ht).height):ne==="match"?(V=F.width,be=F.height):(V=1920,be=1080);const Fe=F.width,et=F.height,J=V!==Fe||be!==et;(!rt||oi!==V||da!==be)&&(rt=document.createElement("canvas"),rt.width=V,rt.height=be,dt=rt.getContext("2d",{willReadFrequently:!0}),oi=V,da=be);const re=Wr(t()?.output?.masterWarp)?Af():null,ue=re&&re.width>0?re:F;dt.save(),dt.scale(1,-1),dt.drawImage(ue,0,-be,V,be),dt.restore();const Le=V,xe=be;if(Dr.length>0){je=rt,Je=dt;const ge=rn();for(const ye of Dr){if(At.has(ye.id))continue;const De=Math.round(ye.cropW*Le),Ne=Math.round(ye.cropH*xe);if(De<=0||Ne<=0)continue;let zt=null;if(ge&&(zt=kd(je,ye,De,Ne)),!zt){const ho=Math.round(ye.cropX*Le),mo=Math.round(ye.cropY*xe);(!mt||mt.width!==De||mt.height!==Ne)&&(mt=document.createElement("canvas"),mt.width=De,mt.height=Ne,Ee=mt.getContext("2d")),Ee.clearRect(0,0,De,Ne),ye.rotation===0?Ee.drawImage(je,ho,mo,De,Ne,0,0,De,Ne):(Ee.save(),Ee.translate(De/2,Ne/2),Ee.rotate(ye.rotation*Math.PI/180),ye.rotation===90||ye.rotation===270?Ee.drawImage(je,ho,mo,De,Ne,-Ne/2,-De/2,Ne,De):Ee.drawImage(je,ho,mo,De,Ne,-De/2,-Ne/2,De,Ne),Ee.restore()),ye.edgeBlendLeft>0||ye.edgeBlendRight>0||ye.edgeBlendTop>0||ye.edgeBlendBottom>0?((!ke||ke.width!==De||ke.height!==Ne)&&(ke=document.createElement("canvas"),ke.width=De,ke.height=Ne,Ue=ke.getContext("2d")),Ue.clearRect(0,0,De,Ne),Ue.drawImage(mt,0,0),gs(Ue,De,Ne,{edgeBlendLeft:ye.edgeBlendLeft,edgeBlendRight:ye.edgeBlendRight,edgeBlendTop:ye.edgeBlendTop,edgeBlendBottom:ye.edgeBlendBottom,edgeBlendGamma:ye.edgeBlendGamma}),zt=Ue.getImageData(0,0,De,Ne).data):zt=Ee.getImageData(0,0,De,Ne).data}At.add(ye.id);const ta=ye.spoutName||`ghostArcade-${ye.name}`;if((ye.targetType??"sender")==="display"){At.delete(ye.id);continue}const el=ye.outputType??(ie&&Ki?"syphon":"spout"),po=zt instanceof Uint8Array?zt:new Uint8Array(zt.buffer,zt.byteOffset,zt.byteLength);el==="ndi"&&ie?(Ia.has(ta)||(Ia.add(ta),window.ghostNDI?.createSender(ta).catch(()=>{Ia.delete(ta)})),window.ghostNDI?.sendImage(ta,po,De,Ne).catch(()=>{}).finally(()=>{At.delete(ye.id)})):ie?Se("spout_send_image",{data:po,width:De,height:Ne,senderName:ta}).catch(()=>{}).finally(()=>{At.delete(ye.id)}):fetch(`http://127.0.0.1:9002/spout/send?width=${De}&height=${Ne}&sender=${encodeURIComponent(ta)}`,{method:"POST",body:po}).catch(()=>{}).finally(()=>{At.delete(ye.id)})}}else if(!Ke){const ge=dt.getImageData(0,0,Le,xe),ye=Le*xe*4;(!K||K.byteLength!==ye)&&(K=new Uint8Array(ye)),K.set(new Uint8Array(ge.data.buffer,ge.data.byteOffset,ge.data.byteLength)),We=Le,pe=xe,Ke=!0,ie?Se("spout_send_image",{data:K,width:Le,height:xe}).catch(()=>{}).finally(()=>{Ke=!1}):fetch(`http://127.0.0.1:9002/spout/send?width=${Le}&height=${xe}`,{method:"POST",body:K}).then(De=>{!De.ok&&P(_t)<5&&(Gr(_t),console.warn(`Spout send HTTP ${De.status}: ${De.statusText}`))}).catch(De=>{P(_t)<5&&(Gr(_t),console.warn("Spout send fetch error:",De))}).finally(()=>{Ke=!1})}}}j++;const w=performance.now(),k=w-Ae;if(k>=500){const A=Math.round(j*1e3/k);if(cp.set(A),j=0,Ae=w,!(Ce++%10)){const E=a()?.layers?.length??0,U=window.devicePixelRatio||1,H=P(_e).clientWidth,q=P(_e).clientHeight;console.log(`[GPU] mode=${Ge?"output":"main"} FPS=${A}  layers=${E}  drawingBuffer=${P(_e).width}x${P(_e).height}  display=${H}x${q}  dpr=${U}`),Ge&&(Math.abs(P(_e).width-Math.round(H*U))>1||Math.abs(P(_e).height-Math.round(q*U))>1)&&console.warn(`[Output] Canvas backing store ${P(_e).width}x${P(_e).height} does not match display ${H}x${q} @ DPR ${U}. Use fullscreen output or Match Output Display to avoid compositor scaling.`)}}cf(),Y=0}catch(w){if(Y++,console.error(`[Canvas] animate() frame error #${Y}:`,w),Y>5){ni=setTimeout(c,1e3);return}}ni=requestAnimationFrame(c)}c();const Z=new ResizeObserver(()=>{const{w:p,h:w}=Sr();if(P(he)&&p>0&&w>0){const k=a().width||1920,A=a().height||1080;ro(p,w),P(he).resize(k,A),P(yt)&&P(yt).resize(k,A);for(const E of qt.values())E.resize(k,A);for(const E of va.values())E.setSize(k,A);for(const[E,U]of gt.entries()){const H=Ga.get(E)??1,q=Math.max(64,Math.round(k*H)),X=Math.max(64,Math.round(A*H));U.setSize(q,X)}}});return Z.observe(P(ft)),()=>{x(),Z.disconnect(),F.removeEventListener("webglcontextlost",kr),F.removeEventListener("webglcontextrestored",Tr),P(_e).removeEventListener("mousemove",_r),P(_e).removeEventListener("mouseleave",Cr),P(_e).removeEventListener("mouseenter",Pr)}});let so=nt(new Set),no=nt(null),lo=nt(null);function _r(g){const v=P(_e).getBoundingClientRect();Ji=(g.clientX-v.left)/v.width*2-1,Qi=-((g.clientY-v.top)/v.height)*2+1,ur=(g.clientX-v.left)/v.width,dr=(g.clientY-v.top)/v.height,ha=!0}function Cr(){ha=!1}function Pr(){ha=!0}let Ht=nt(null);Se("get_displays").then(g=>{if(Array.isArray(g)&&g.length>0){const _=g.find(x=>!(x.isPrimary??x.primary))||g[0],y=_?.bounds||_;y&&Ze(Ht,{width:y.width,height:y.height})}}).catch(()=>{});let wi=nt(!1),Wa=nt(!1);function kr(g){g.preventDefault(),console.warn("[Canvas] WebGL context lost - disposing GPU resources and pausing");for(const v of ht.values()){try{v.fluid?.dispose()}catch(_){console.warn("[Canvas] fluid dispose error:",_)}try{v.particles?.dispose()}catch(_){console.warn("[Canvas] particles dispose error:",_)}try{v.milkdrop?.dispose()}catch(_){console.warn("[Canvas] milkdrop dispose error:",_)}try{v.milkdropStemRouter?.dispose()}catch{}try{v.audiomotion?.dispose()}catch(_){console.warn("[Canvas] audiomotion dispose error:",_)}try{v.wavejs?.dispose()}catch(_){console.warn("[Canvas] wavejs dispose error:",_)}try{v.hydra?.dispose()}catch(_){console.warn("[Canvas] hydra dispose error:",_)}try{v.ghostfx?.dispose()}catch(_){console.warn("[Canvas] ghostfx dispose error:",_)}try{v.analyzerlab?.dispose()}catch(_){console.warn("[Canvas] analyzerlab dispose error:",_)}try{v.handfx?.dispose()}catch(_){console.warn("[Canvas] handfx dispose error:",_)}try{v.cameraTexture&&(v.cameraTexture.dispose(),v.cameraTexture=void 0)}catch{}try{v.prevCameraTarget&&(v.prevCameraTarget.dispose(),v.prevCameraTarget=void 0)}catch{}try{v.cameraStream?.getTracks().forEach(_=>_.stop())}catch{}try{v.renderTarget.dispose()}catch{}}ht.clear(),xi=!0}function Tr(){console.log("[Canvas] WebGL context restored - clearing caches and resuming"),xi=!1;try{P(he)?.reinitAfterContextRestore?.()}catch(g){console.warn("[Canvas] engine reinit error:",g)}for(const g of Me.values())g.dispose();Me.clear(),Et.clear();for(const g of Dt.values())g.material.dispose();Dt.clear();for(const g of gt.values())g.dispose();gt.clear();for(const g of ma.values())g.dispose();ma.clear();for(const g of qt.values())g.dispose();qt.clear();for(const g of va.values())g.dispose();va.clear();for(const g of ht.values()){g.fluid?.dispose(),g.particles?.dispose(),g.milkdrop?.dispose();try{g.milkdropStemRouter?.dispose()}catch{}g.audiomotion?.dispose(),g.wavejs?.dispose(),g.hydra?.dispose(),g.ghostfx?.dispose(),g.analyzerlab?.dispose(),g.handfx?.dispose(),g.renderTarget.dispose()}ht.clear();for(const g of Ct.values())g.renderer.dispose(),g.renderTarget.dispose();Ct.clear();for(const g of Yt.values())g.renderer.dispose(),g.renderTarget.dispose();Yt.clear()}xl(()=>{if(cancelAnimationFrame(ni),df(),P(he)?.dispose(),ci){try{ci()}catch{}ci=null}if(Qe){const g=Qe;Qe=null,g.dispose(),Ls()}if(ui){try{ui()}catch{}ui=null}cr(),$i(),kn(),Ef(P(_e)),fa&&(clearInterval(fa),fa=null),Nt&&(Nt(),Nt=null),ri&&(ri(),ri=null),Bt&&(Bt.stop(),Bt=null),pn(),Hl(),Rl();for(const g of Me.values())g.dispose();Me.clear();for(const g of Dt.values())g.material.dispose();Dt.clear();for(const g of gt.values())g.dispose();gt.clear(),P(yt)&&P(yt).dispose(),window.removeEventListener("lines-reset-animations",pr);for(const g of ma.values())g.dispose();ma.clear();for(const g of qt.values())g.dispose();qt.clear();for(const g of va.values())g.dispose();va.clear();for(const g of ht.values()){g.fluid?.dispose(),g.particles?.dispose(),g.milkdrop?.dispose();try{g.milkdropStemRouter?.dispose()}catch{}g.audiomotion?.dispose(),g.wavejs?.dispose(),g.hydra?.dispose(),g.ghostfx?.dispose(),g.analyzerlab?.dispose(),g.handfx?.dispose(),g.renderTarget.dispose()}ht.clear();for(const g of Ct.values())g.renderer.dispose(),g.renderTarget.dispose();Ct.clear();for(const g of Yt.values())g.renderer.dispose(),g.renderTarget.dispose();Yt.clear();for(const g of pa.values()){if(g._stopPolling&&g._stopPolling(),g.frameWs){try{g.frameWs.send(JSON.stringify({type:"unsubscribe_spout"}))}catch{}g.frameWs.close()}g.texture.dispose(),Se("spout_stop_receiver",{senderName:g.senderName}).catch(()=>{})}pa.clear();for(const g of Ua.values())g._stopPolling&&g._stopPolling(),g.texture.dispose(),window.ghostNDI?.destroyReceiver(g.sourceName).catch(()=>{});Ua.clear()});const ya=new Map;function In(g,v=!0){const _=new Set;for(const y of g){if(_.add(y.id),!y.source){const c=ya.get(y.id);c&&(co(y.id,c),ya.delete(y.id));continue}if(y.source.__vjStage)continue;const x=y.source.src==="ai-generated"||y.source.src==="js-animation",B=y.source.type==="synthvision"||!y.source.src&&y.source.synthVisionCanvas||y.source.type==="threejs"&&y.source.threejsCanvas&&!y.source.src,R=y.source.type==="video"&&typeof y.id=="string"&&y.id.startsWith("vj-layer-"),S=x||B?y.source.id:R?`${y.id}:${y.source.src}`:y.source.src,F=`${y.id}:${S}`,z=ya.get(y.id);z&&z!==S&&co(y.id,z),ya.set(y.id,S);const D=y.source.type==="shader"?F:S;if(Me.has(D)){const c=Me.get(D);B&&y.source.threejsCanvas&&c.image!==y.source.threejsCanvas?(console.log("[Canvas] SynthVision canvas changed, invalidating stale texture for:",D),c.dispose(),Me.delete(D),Et.delete(D)):(y.source.texture=c,En(D))}if(!Me.has(D)&&!Et.has(D)&&!di.has(D)&&(Et.add(D),Un(y.id,y.source,D)),y.source.type==="video"){const c=y.source.videoElement,Z=!!c&&c.readyState>=2&&c.videoWidth>0&&c.videoHeight>0;if(y.source.texture&&Z&&(y.source.texture.needsUpdate=!0),window.__VIDEO_DEBUG__){const w=y.source.texture,k=`__vidDbg_${y.id}`,A=c;c&&!A.__gaElId&&(A.__gaElId=`el#${Math.floor(Math.random()*65535).toString(16)}`);const E={ready:Z,paused:!!c?.paused,readyState:c?.readyState??-1,videoWidth:c?.videoWidth??0,videoHeight:c?.videoHeight??0,currentTime:c?.currentTime?.toFixed(2)??"n/a",duration:c?.duration?.toFixed(2)??"n/a",srcShort:(c?.src||"").slice(-50),hasTexture:!!w,textureImageMatchesElement:w?.image===c,elId:A?.__gaElId??"n/a",textureImageElId:w?.image?.__gaElId??"n/a"},U=window[k];if(!U||U.ready!==E.ready||U.paused!==E.paused||U.readyState!==E.readyState||U.hasTexture!==E.hasTexture||U.textureImageMatchesElement!==E.textureImageMatchesElement||U.srcShort!==E.srcShort||U.elId!==E.elId||U.textureImageElId!==E.textureImageElId){window[k]=E;const q=E.textureImageMatchesElement?"OK":"MISMATCH";console.log(`[VIDEO] layer=${y.id.slice(0,8)}`,`el=${E.elId}`,`texEl=${E.textureImageElId}`,`match=${q}`,`tex=${E.hasTexture}`,`rs=${E.readyState}`,`dim=${E.videoWidth}x${E.videoHeight}`,`t=${E.currentTime}`,`paused=${E.paused}`,`src=${E.srcShort}`)}}const p=y.source.videoElement;if(p&&isFinite(p.duration)&&p.duration>0){const w=y.source,k=w.playbackMode||"loop",A=w.playbackRate??1,E=w.trimStart??0,U=w.trimEnd??1,H=E*p.duration,q=U*p.duration,X=w.isPlaying!==!1;p.loop=!1,k!=="timelapse"&&Math.abs(p.playbackRate-A)>.01&&(p.playbackRate=A),k==="timelapse"?p.paused||p.pause():k==="loop"?(p.paused&&X&&p.play().catch(()=>{}),p.currentTime>=q-.05&&(p.currentTime=H)):k==="once"&&(p.currentTime>=q-.08?p.paused||(p.pause(),w.isPlaying=!1):p.paused&&X&&p.play().catch(()=>{})),k!=="timelapse"&&p.currentTime<H-.15&&(p.currentTime=H)}}if(y.source.type==="threejs"&&!y.source.jsAnimation)if(y.source.threejsCanvas&&!Pi(y.source.id))y.source.texture&&(y.source.texture.needsUpdate=!0);else{const c=Pi(y.source.id);c&&(c.updateTexture(),y.source.texture&&(y.source.texture.needsUpdate=!0))}if((y.source.type==="threejs"||y.source.type==="p5js")&&y.source.jsAnimation){const c=qr(y.source.id);c&&c.updateTexture()}}if(v)for(const[y,x]of ya.entries())_.has(y)||(co(y,x),ya.delete(y))}function co(g,v){const _=`${g}:${v}`,y=Dt.get(_);if(y){y.material.dispose();for(const S of y.inputTextures.values())S.dispose();Dt.delete(_),console.log("[Canvas] Disposed shader instance:",_)}const x=gt.get(_);x&&(x.dispose(),gt.delete(_));const B=Me.get(_);B&&(B.dispose(),Me.delete(_));const R=Me.get(v);R&&(R.dispose(),Me.delete(v),console.log("[Canvas] Disposed stale texture for source:",v)),Et.delete(v)}async function Un(g,v,_){try{let y=null;if(v.type==="image")y=await Yr(v.src);else if(v.type==="video"){let x=v.videoElement;if(!x){x=document.createElement("video"),v.src.startsWith("blob:")||(x.crossOrigin="anonymous"),x.loop=!0,x.muted=!0,x.playsInline=!0,x.preload="auto",x.src=v.src,await new Promise((S,F)=>{const z=x,Y=()=>{c(),S()},D=()=>{c(),F(new Error("Video failed to load"))},c=()=>{z.removeEventListener("loadeddata",Y),z.removeEventListener("error",D)};z.addEventListener("loadeddata",Y,{once:!0}),z.addEventListener("error",D,{once:!0}),z.load()});const R=s().find(S=>S.id===g);R?.source&&(R.source.videoElement=x)}if(x.readyState<2&&await new Promise(B=>{const R=()=>{x.readyState>=2?B():requestAnimationFrame(R)};x.oncanplay=()=>B(),R()}),x.paused)try{await x.play()}catch(B){console.warn("Video play failed:",B)}await new Promise(B=>requestAnimationFrame(B)),y=Hr(x),v.isPlaying=!x.paused}else if(v.type==="shader"&&v.shaderCode){console.log("Creating ISF shader for layer:",g,"shader:",v.name);const x=Zl(v.id,v.name,v.shaderCode);if(x){console.log("Shader instance created successfully for:",v.name),Dt.set(_,x);const B=we($e),R=B.width||1920,S=B.height||1080,z=we(ki).find(Z=>Z.id===g)?.renderQuality??yo[we(Oe).ui.shaderQuality]??1,Y=Math.max(64,Math.round(R*z)),D=Math.max(64,Math.round(S*z));console.log(`Creating shader render target: ${Y}x${D} (quality: ${z})`);const c=new la(Y,D,{minFilter:le,magFilter:le,format:qe});if(gt.set(_,c),Ga.set(_,z),v.shaderValues)for(const[Z,p]of Object.entries(v.shaderValues))ts(x,Z,p);y=c.texture,console.log("Shader render target texture assigned:",y)}else{console.error("Shader creation failed, using fallback magenta texture"),ra("Shader compilation failed for: "+(v.name||"unknown"));const B=new Uint8Array([255,0,170,255]);y=new St(B,1,1,qe),y.needsUpdate=!0}}else if(v.type==="threejs"&&!v.jsAnimation&&v.threejsCanvas&&!Pi(v.id)){const x=new Zt(v.threejsCanvas);x.minFilter=le,x.magFilter=le,x.format=qe,y=x,console.log("Direct canvas texture assigned for:",v.name)}else if(v.type==="threejs"&&!v.jsAnimation){let x=Pi(v.id);if(!x&&v.src&&(console.log("Creating ThreeJS iframe context for:",v.name,v.src),x=Bl(v.id,v.src)),x)await new Promise(B=>setTimeout(B,1e3)),x.updateTexture(),y=x.texture,console.log("ThreeJS iframe texture assigned for:",v.name);else{console.warn("ThreeJS iframe context not found for:",v.id);const B=new Uint8Array([255,165,0,255]);y=new St(B,1,1,qe),y.needsUpdate=!0}}else if((v.type==="threejs"||v.type==="p5js")&&v.jsAnimation){let x=qr(v.id);if(!x&&v.jsAnimation&&(console.log("Creating JS animation context for:",v.name,v.type),x=El(v.id,v.jsAnimation)),x)await new Promise(B=>setTimeout(B,1500)),x.updateTexture(),y=x.texture,console.log("JS animation texture assigned for:",v.name,v.jsAnimation?.animationType);else{console.warn("JS animation context not found for:",v.id);const B=new Uint8Array([255,100,150,255]);y=new St(B,1,1,qe),y.needsUpdate=!0}}else if(v.type==="spout"&&v.spoutSource&&Be&&!tt){const x=v.spoutSource.senderName;console.log("[Spout] Creating receiver for:",x);let B=pa.get(_);if(!B)try{console.log("[Spout] Calling spout_start_receiver for:",x);const R=await Se("spout_start_receiver",{senderName:x});console.log("[Spout] Receiver started, info:",R);const S=R.width||v.spoutSource.width||1920,F=R.height||v.spoutSource.height||1080,z=new Uint8Array(S*F*4);for(let D=0;D<z.length;D+=4)z[D]=128,z[D+1]=0,z[D+2]=128,z[D+3]=255;const Y=new St(z,S,F,qe);if(Y.minFilter=le,Y.magFilter=le,Y.needsUpdate=!0,B={senderName:x,texture:Y,frameWs:null,width:S,height:F},pa.set(_,B),ie){let D=!0,c=0;const Z=_;let p=0,w=Date.now(),k=null,A=!1,E=null;const U=()=>{if(!D)return;const H=pa.get(Z);if(!H){console.log("[Spout] Polling stopped: receiver removed from cache for",x),D=!1;return}if(A){k=requestAnimationFrame(U);return}A=!0,Se("spout_receive_frame").then(q=>{if(A=!1,!!D)if(q&&q.data){const X=q.width,ee=q.height,Te=X*ee*4;!E||E.byteLength!==Te?E=new Uint8Array(q.data):E.set(new Uint8Array(q.data));const oe=E;if(c++,c<=3){let de=0;const ve=Math.min(oe.length,4e3);for(let st=0;st<ve;st++)oe[st]!==0&&de++;console.log(`[Spout] IPC frame #${c} for:`,x,X,"x",ee,"bytes:",oe.length,"nonZero:",de+"/"+ve)}if(oe.length!==Te)return;const me=H.texture;if(me.image.width!==X||me.image.height!==ee){console.log("[Spout] Resizing texture to:",X,"x",ee);const de=new Uint8Array(oe),ve=new St(de,X,ee,qe);ve.minFilter=le,ve.magFilter=le,ve.needsUpdate=!0,H.texture=ve,H.width=X,H.height=ee,me.dispose(),Me.set(Z,ve),hi()}else me.image.data&&(me.image.data.set(oe),me.needsUpdate=!0);p=0}else{p++;const X=Date.now();X-w>5e3&&(console.log(`[Spout] Recv poll: ${c} frames, ${p} nulls, active=${D}`,x),w=X)}}).catch(q=>{A=!1,console.error("[Spout] Recv poll error:",q?.message||q)}),D&&(k=requestAnimationFrame(U))};k=requestAnimationFrame(U),B._stopPolling=()=>{D=!1,k!==null&&(cancelAnimationFrame(k),k=null)}}else{const D=_;let c=!0,Z=0,p=!1;const w=async()=>{if(!c)return;const k=pa.get(D);if(!k){c=!1;return}if(p){requestAnimationFrame(w);return}p=!0;try{const A=await fetch(`http://127.0.0.1:9002/spout/receive/${encodeURIComponent(x)}`);if(A.status===204||!A.ok){p=!1,c&&requestAnimationFrame(w);return}const E=await A.arrayBuffer(),U=new Uint8Array(E),H=k.width,q=k.height,X=H*q*4;if(Z++,Z<=3&&console.log(`[Spout] HTTP recv #${Z}:`,x,H,"x",q,"bytes:",U.length),U.length===X){const ee=k.texture;ee.image.data&&(ee.image.data.set(U),ee.needsUpdate=!0)}}catch(A){Z<3&&console.warn("[Spout] HTTP recv error:",A)}p=!1,c&&requestAnimationFrame(w)};requestAnimationFrame(w),B._stopPolling=()=>{c=!1}}console.log("[Spout] Receiver created for:",x,"resolution:",S,"x",F,ie?"(IPC)":"(WS)")}catch(R){console.error("[Spout] Failed to start receiver:",R);const S=new Uint8Array([0,255,255,255]);y=new St(S,1,1,qe),y.needsUpdate=!0}B&&(y=B.texture)}if(v.type==="spout"&&v.ndiSource&&ie&&!tt){const x=v.ndiSource.senderName;let B=Ua.get(_);if(!B)try{const R=window.ghostNDI;if(R){await R.createReceiver(x);const S=v.ndiSource.width||1920,F=v.ndiSource.height||1080,z=new Uint8Array(S*F*4);for(let k=0;k<z.length;k+=4)z[k]=20,z[k+1]=50,z[k+2]=70,z[k+3]=255;const Y=new St(z,S,F,qe);Y.minFilter=le,Y.magFilter=le,Y.needsUpdate=!0,B={sourceName:x,texture:Y,width:S,height:F,lastFrameCounter:0},Ua.set(_,B);let D=!0,c=!1,Z=null;const p=_,w=()=>{if(!D)return;const k=Ua.get(p);if(!k){D=!1;return}if(c){Z=requestAnimationFrame(w);return}c=!0,R.receiveFrame(x).then(A=>{if(c=!1,!D)return;if(!A||!A.data){Z=requestAnimationFrame(w);return}if(A.frame===k.lastFrameCounter){Z=requestAnimationFrame(w);return}k.lastFrameCounter=A.frame;const E=A.width,U=A.height,H=new Uint8Array(A.data),q=k.texture;if(q.image.width!==E||q.image.height!==U){const X=new St(H,E,U,qe);X.minFilter=le,X.magFilter=le,X.needsUpdate=!0,k.texture=X,k.width=E,k.height=U,q.dispose(),Me.set(p,X),hi()}else q.image.data&&(q.image.data.set(H),q.needsUpdate=!0);Z=requestAnimationFrame(w)}).catch(()=>{c=!1,D&&(Z=requestAnimationFrame(w))})};Z=requestAnimationFrame(w),B._stopPolling=()=>{D=!1,Z!==null&&(cancelAnimationFrame(Z),Z=null)}}}catch(R){console.error("[NDI] create receiver failed:",R)}B&&(y=B.texture)}y&&(Me.set(_,y),hi(),console.log("Texture loaded for layer:",g,"type:",v.type),$e.updateLayer(g,{}))}catch(y){di.add(_);const x=(pi.get(_)??0)+1;pi.set(_,x),x<=fi&&console.error(`Failed to load texture (${_}):`,y,x===fi?"— further retries suppressed":"")}finally{Et.delete(_)}}function Gn(g,v){if(g.type==="layer"){const _=v.find(y=>y.id===g.id);if(_?.source?.texture)return _.source.texture}else if(g.type==="media"){const _=`media-input:${g.id}`,y=to.get(_);if(y)return y instanceof Ii&&(y.needsUpdate=!0),y;const B=f().find(R=>R.id===g.id);if(B){if(B.texture){if(B.type==="video"&&B.texture instanceof Ii){const S=B.videoElement;S&&S.readyState>=2&&S.videoWidth>0&&S.videoHeight>0&&(B.texture.needsUpdate=!0)}return to.set(_,B.texture),B.texture}const R=`media:${B.id}`;!Et.has(R)&&!di.has(R)&&(Et.add(R),console.log("[ISF Image Input] Loading texture for media item:",B.name,B.src),On(B,R).then(()=>{const S=we(Ti).find(F=>F.id===g.id);S?.texture&&(to.set(_,S.texture),console.log("[ISF Image Input] Texture loaded and cached for:",B.name))}))}else console.warn("[ISF Image Input] Media item not found for ref:",g.id,g.name)}return null}async function On(g,v){try{let _=null;if(g.type==="image")console.log("[Media Texture] Loading image texture:",g.name,g.src?.substring(0,50)),_=await Yr(g.src);else if(g.type==="video"&&g.videoElement){const y=g.videoElement;if(y.readyState<2&&await new Promise(x=>{const B=()=>{y.readyState>=2?x():requestAnimationFrame(B)};y.oncanplay=()=>x(),B()}),y.paused)try{await y.play()}catch(x){console.warn("Media video play failed:",x)}_=Hr(y)}_?(console.log("[Media Texture] Successfully loaded texture for:",g.name,"size:",_.image?.width,"x",_.image?.height),Ti.setTexture(g.id,_)):console.warn("[Media Texture] No texture created for:",g.name,"type:",g.type)}catch(_){di.add(v);const y=(pi.get(v)??0)+1;pi.set(v,y),y<=fi&&console.error("[Media Texture] Failed to load media texture:",g.name,g.src,_,y===fi?"— further retries suppressed":"")}finally{Et.delete(v)}}function Wn(g){if(!P(he))return;const v=P(he).getRenderer(),_=a(),y=_.width||1920,x=_.height||1080,B=d(),R=aa();R&&B.isActive?(Uo.update(R),Xr(R,!0)):R&&Xr(R,!1);for(const S of g){if(!S.source||S.source.type!=="shader"||S.source.__vjStage)continue;const z=S.source.src==="ai-generated"||S.source.src==="js-animation"?S.source.id:S.source.src,Y=`${S.id}:${z}`;let D=Dt.get(Y),c=gt.get(Y);if(!D||!c){for(const[U,H]of Dt.entries())if(U.endsWith(`:${z}`)||U===z){D=H,c=gt.get(U);break}}if(!D||!c)continue;const Z=S.renderQuality??yo[we(Oe).ui.shaderQuality]??1,p=Ga.get(Y)??1;if(Math.abs(Z-p)>.01){const U=Math.max(64,Math.round(y*Z)),H=Math.max(64,Math.round(x*Z));c.setSize(U,H),Ga.set(Y,Z),console.log(`[ISF] Resized render target to ${U}x${H} (quality: ${Z})`)}if(S.source.shaderValues)for(const[U,H]of Object.entries(S.source.shaderValues))ts(D,U,H);if(S.source.shaderImageInputs&&Object.keys(S.source.shaderImageInputs).length>0)for(const[U,H]of Object.entries(S.source.shaderImageInputs)){const q=Gn(H,g);q&&(D.inputTextures.get(U)!==q&&console.log("[ISF Image Input] Binding texture for",U,"from",H.type,H.name),as(D,U,q))}for(const U of D.metadata.INPUTS)U.TYPE==="image"&&!D.inputTextures.has(U.NAME)&&(console.log("[ISF Image Input] Auto-binding default texture for",U.NAME,"in",S.source.name),as(D,U.NAME,Ln()));const w=c.width,k=c.height;Kl(D,w,k,void 0,B);const A=we(Vr);let E=null;if(A.config.isPlaying){const H=S.id?.startsWith("vj-layer-")&&S.source?.id?`vj-${S.source.id}`:S.id,q=A.activeOverrides[H];if(q)for(const[X,ee]of Object.entries(q)){if(!X.startsWith("shader:"))continue;const Te=X.slice(7);if(!Fn.test(Te)||typeof ee!="number"||!D.uniforms?.TIME)continue;const oe=A.config.currentTime,me=`${S.id}:${Te}`;let de=eo.get(me);de||(de={phase:0,lastPlaybackTime:oe},eo.set(me,de));const ve=oe-de.lastPlaybackTime;ve<0||ve>1?de.phase=0:de.phase+=ve*ee,de.lastPlaybackTime=oe,E={origTime:D.uniforms.TIME.value,origParam:D.uniforms[Te]?.value??1,paramName:Te},D.uniforms.TIME.value=de.phase,D.uniforms[Te]&&(D.uniforms[Te].value=1);break}}oo.material=D.material,v.setRenderTarget(c),v.clear(),v.render(ao,io),v.setRenderTarget(null),E&&(D.uniforms.TIME.value=E.origTime,D.uniforms[E.paramName]&&(D.uniforms[E.paramName].value=E.origParam))}}function Vn(g){if(!P(he)||!P(yt))return;P(he).getRenderer();const v=a(),_=v.width||1920,y=v.height||1080;for(const x of g){if(x.type!=="lines"||!x.linesContent)continue;let B=ma.get(x.id);B||(B=new la(_,y,{minFilter:le,magFilter:le,format:qe}),ma.set(x.id,B));let R=null;if(x.linesContent.sharedShaderMode&&x.linesContent.sharedShaderSourceId){const F=x.linesContent.sharedShaderSourceId;for(const z of g){if(!z.source||z.id===x.id)continue;const Y=z.source.src;if(Y===F||z.source.id===F||z.source.name===F){const Z=Y==="ai-generated"||Y==="js-animation"?z.source.id:Y,p=`${z.id}:${Z}`,w=gt.get(p);if(w){R=w.texture;break}const k=Me.get(Z);if(k){R=k;break}}}}const S=x.linesContent.elements;if(S.length>0){const F=P(yt).renderElements(S,B,x.linesContent.globalDrawSpeed,x.linesContent.staggerMode,x.linesContent.staggerDelay,R,x.linesContent.waveWindowSize??3);x.source||(x._linesTexture=F)}}}function Nn(g){if(!P(he))return;const v=a(),_=v.width||1920,y=v.height||1080,x=performance.now()/1e3,B=x-hr;hr=x;for(const R of g){if(R.type!=="svg"||!R.svgContent)continue;let S=qt.get(R.id);if(S)S.resize(_,y);else{if(!b){$("svg",async()=>{b=(await at(async()=>{const{SVGLayerRenderer:p}=await import("./renderer-AcCe0mxh.js");return{SVGLayerRenderer:p}},__vite__mapDeps([10,2]),import.meta.url)).SVGLayerRenderer});continue}const Z=P(he).getRenderer();S=new b(_,y,Z),qt.set(R.id,S),R.svgContent.svgSource&&(S.parseSVG(R.svgContent.svgSource),S.buildScene(R.svgContent))}const F=R.svgContent.svgSource,z=S._lastSvgSource||"",Y=S.needsRebuild();(F!==z||Y)&&(S._lastSvgSource=F,F&&(S.parseSVG(F),S.buildScene(R.svgContent)));const D=[R.svgContent.fillMode,R.svgContent.colorMode,R.svgContent.liquidEnabled,R.svgContent.particlesEnabled,R.svgContent.energyEnabled,R.svgContent.connectionsEnabled,R.svgContent.glowEnabled,R.svgContent.ripplesEnabled,R.svgContent.lightningEnabled,R.svgContent.edgeFlowEnabled,R.svgContent.innerGlowEnabled,R.svgContent.nebulaEnabled,R.svgContent.heartbeatEnabled,R.svgContent.plasmaEnabled,R.svgContent.particleLinksEnabled,R.svgContent.particleLinkMaxLinks,R.svgContent.echoEnabled,R.svgContent.arcBridgesEnabled].join(","),c=S._lastEffectsKey||"";if(D!==c&&F&&(S._lastEffectsKey=D,S.buildScene(R.svgContent)),R.svgContent.svgSource){S.animate(Math.min(B,.1),R.svgContent);const Z=S.render();R._svgTexture=Z}}}function qn(g){if(!P(he))return;const v=a(),_=v.width||1920,y=v.height||1080,x=performance.now()/1e3,B=x-mr;mr=x;for(const z of g){if(z.type!=="lightpainting"||!z.lightPaintingContent)continue;let Y=vi.get(z.id);if(Y)Y.resize(_,y);else{const c=t()?.performance?.useWebGL2LightPainting!==!1;try{Y=c?new yc(_,y):new jr(_,y)}catch(Z){console.warn("[Canvas] WebGL2 light painting init failed, falling back to Canvas2D:",Z?.message||Z),Y=new jr(_,y)}vi.set(z.id,Y)}const D=Y.render(z.lightPaintingContent,Math.min(B,.1));z._lightPaintingTexture=D}const R=bc(),S=g.filter(z=>z.type==="lightpainting");let F=null;for(const z of S)(!F||g.indexOf(z)<g.indexOf(F))&&(F=z);for(const z of S)z===F&&R&&R.width>1?((!Oa||vr!==R)&&(Oa=new Zt(R),Oa.colorSpace=Ea,vr=R),Oa.needsUpdate=!0,z._lightPaintingGPUTexture=Oa):z._lightPaintingGPUTexture=null;for(const[z,Y]of vi)g.find(D=>D.id===z&&D.type==="lightpainting")||(Y.dispose(),vi.delete(z))}function Yn(g){if(!P(he))return;const v=a(),_=v.width||1920,y=v.height||1080,x=performance.now()/1e3,B=x-gr;gr=x;for(const R of g){if(R.type!=="text"||!R.textContent)continue;let S=gi.get(R.id);S?S.resize(_,y):(S=new xc(_,y),gi.set(R.id,S));const F=S.render(R.textContent,Math.min(B,.1));R._textTexture=F}for(const[R,S]of gi)g.find(F=>F.id===R&&F.type==="text")||(S.dispose(),gi.delete(R))}function Hn(g){if(!P(he))return;const v=a(),_=v.width||1920,y=v.height||1080,x=P(he).getRenderer(),B=we(Mi),R=B?.amplitude||0;for(const S of g){if(S.type!=="splat"||!S.splatContent)continue;let F=Ct.get(S.id);if(!F){const w=new _c(_,y),k=new la(_,y,{minFilter:le,magFilter:le,format:qe,type:or});F={renderer:w,renderTarget:k,plyUrl:null,loadingPly:!1},Ct.set(S.id,F),console.log("[Canvas] Created splat renderer for layer:",S.id,"(WebGLRenderTarget)")}const z=S.splatContent.filePath||null;if(z&&z!==F.plyUrl&&!F.loadingPly){F.loadingPly=!0,F.plyUrl=z;const w=S.splatContent._originalFileName||"";if(w.toLowerCase().endsWith(".splat")){console.log("[Canvas] Loading .splat file:",w);const A=S.id;Dc(z).then(E=>{console.log("[Canvas] .splat loaded:",E.vertices.length,"splats");const U=Ct.get(A);U&&(U.renderer.loadData(E),U.loadingPly=!1,$e.updateSplatContent(A,{pointCount:E.vertices.length}))}).catch(E=>{console.error("[Canvas] Failed to load .splat:",E),ra("Failed to load .splat file: "+(E instanceof Error?E.message:String(E)));const U=Ct.get(A);U&&(U.loadingPly=!1,U.plyUrl=null)})}else{console.log("[Canvas] Loading PLY file:",z);const A=S.id;Rc(z).then(E=>{console.log("[Canvas] PLY loaded:",E.vertices.length,"vertices");const U=Ct.get(A);U&&(U.renderer.loadData(E),U.loadingPly=!1,$e.updateSplatContent(A,{pointCount:E.vertices.length}))}).catch(E=>{console.error("[Canvas] Failed to load PLY:",E),ra("Failed to load PLY file: "+(E instanceof Error?E.message:String(E)));const U=Ct.get(A);U&&(U.loadingPly=!1,U.plyUrl=null)})}}(F.renderTarget.width!==_||F.renderTarget.height!==y)&&(F.renderTarget.setSize(_,y),F.renderer.resize(_,y)),ha?F.renderer.setMouseNormalized(Ji,Qi):F.renderer.clearMousePosition(),S.splatContent.textureEnabled&&S.splatContent.texturePath?F.renderer.setTexture(S.splatContent.texturePath,S.splatContent.textureType||"image"):S.splatContent.textureEnabled||F.renderer.setTexture("");const Y=S.splatContent.audioBand||"all",D=Y==="all"?R:B?.bands?.[Y]||0,c=S.splatContent.audioSensitivity||1;F.renderer.update(S.splatContent,D*c,B);const Z=x.getClearColor(new gl),p=x.getClearAlpha();F.renderer.renderTo(x,F.renderTarget),x.setClearColor(Z,p),S._splatTexture=F.renderTarget.texture}for(const[S,F]of Ct)g.find(z=>z.id===S&&z.type==="splat")||(F.renderer.dispose(),F.renderTarget.dispose(),Ct.delete(S),console.log("[Canvas] Disposed splat renderer for layer:",S))}function jn(g){if(!P(he)||(Dn(),!Dl()))return;const v=zl(),_=Il();if(!v)return;const y=a(),x=y?.width||1920,B=y?.height||1080,R=new Set;for(const S of g){if(S.type!=="gpu"||!S.gpuLayerContent||!S.visible)continue;R.add(S.id);const F=S.gpuLayerContent;let z=yi.get(S.id);if(!z)try{z=new pd(v,_,x,B),yi.set(S.id,z)}catch(Z){console.warn("[Canvas] gpu-layer: failed to create renderer for",S.id,Z?.message||Z);continue}const Y=Ho(F.shaderId),D=Y?{...Y.defaultParams,...F.params}:F.params;try{const Z={layers:y?.layers??[],mediaItems:we(Ti)},p=we(ql),w=S.renderQuality??yo[we(Oe).ui.shaderQuality]??1,k=Math.max(64,Math.round(x*w)),A=Math.max(64,Math.round(B*w));z.renderFrame(F.shaderId,D,k,A,Z,{bass:p.bass??0,mid:p.mid??0,treble:p.treble??0})}catch(Z){console.warn("[Canvas] gpu-layer: render failed",Z?.message||Z);continue}let c=bi.get(S.id);c||(c=new Zt(z.canvas),c.minFilter=le,c.magFilter=le,c.generateMipmaps=!1,c.colorSpace=Ea,c.flipY=!0,bi.set(S.id,c)),c.needsUpdate=!0,S._gpuLayerTexture=c}for(const[S,F]of yi)if(!R.has(S)){try{F.dispose()}catch{}yi.delete(S);const z=bi.get(S);try{z?.dispose()}catch{}bi.delete(S)}}function Xn(g){if(!P(he))return;const v=a(),_=v.width||1920,y=v.height||1080;P(he).getRenderer();const x=we(Mi),B=x?.amplitude||0;for(const R of g){if(R.type!=="model3d"||!R.model3dContent)continue;let S=Yt.get(R.id);if(!S){if(!M){$("model3d",async()=>{M=(await at(async()=>{const{Model3DRenderer:H}=await import("./Model3DRenderer-DiaA9ieO.js");return{Model3DRenderer:H}},__vite__mapDeps([11,2]),import.meta.url)).Model3DRenderer});continue}const p=Math.round(_/2),w=Math.round(y/2),k=document.createElement("canvas");k.width=p,k.height=w,k.style.display="none",document.body.appendChild(k);const A=new M(k,w),E=new Zt(k);E.minFilter=le,E.magFilter=le,S={renderer:A,renderTarget:{width:_,height:y,texture:E,setSize(H,q){this.width=H,this.height=q},dispose(){E.dispose()}},modelUrl:null,loadingModel:!1},S._offCanvas=k,S._canvasTex=E,Yt.set(R.id,S),console.log("[Canvas] Created model3d renderer for layer:",R.id,"(separate WebGL context)")}const F=R.model3dContent.modelData||null,z=S._failedUrl;if(F&&F!==S.modelUrl&&F!==z&&!S.loadingModel){S.loadingModel=!0,S.modelUrl=F,console.log("[Canvas] Loading 3D model:",R.model3dContent.modelName);const p=S;p.renderer.loadModel(F,R.model3dContent.modelFormat).then(w=>{const{vertexCount:k,faceCount:A}=w,E=w.hasAnimations??!1;console.log("[Canvas] Model loaded:",k,"vertices,",A,"faces",E?`(${E} animations)`:""),$e.updateModel3DContent(R.id,{vertexCount:k,faceCount:A,hasFileAnimations:E}),p.loadingModel=!1,p._failedUrl=null}).catch(w=>{console.error("[Canvas] Failed to load model:",w),ra("3D model could not be loaded. Re-add the model file to this layer."),p.loadingModel=!1,p._failedUrl=F,p.modelUrl=F})}if(S.renderTarget.width!==_||S.renderTarget.height!==y){S.renderTarget.setSize(_,y);const p=S._offCanvas;p&&(p.width=_,p.height=y),S.renderer.resize(_,y)}const Y=R.model3dContent,D=Y.audio?.audioBand||"all",c=D==="all"?B:x?.bands?.[D]||0;S.renderer.update(Y,c,x),S.renderer.render();const Z=S._canvasTex;Z&&(Z.needsUpdate=!0),R._model3dTexture=Z||S.renderTarget.texture}for(const[R,S]of Yt)if(!g.find(F=>F.id===R&&F.type==="model3d")){S.renderer.dispose(),S.renderTarget.dispose();const F=S._offCanvas;F?.parentElement&&F.remove(),Yt.delete(R),console.log("[Canvas] Disposed model3d renderer for layer:",R)}}function $n(g){if(!P(he))return;const v=P(he).getRenderer(),_=a(),y=_.width||1920,x=_.height||1080,B=performance.now()/1e3,R=Math.min(B-br,.1);br=B,we(Mi)?.amplitude;const F=new Set,z=new Map;for(const Y of g){if(!Y.source||Y.source.type!=="effect"||!Y.source.effectSource)continue;const D=Y.source.effectSource,c=Y.source.id;F.add(c);const Z=z.get(c);Z?Z.layers.push(Y):z.set(c,{effectSource:D,layers:[Y]})}for(const[Y,D]of z){const{effectSource:c,layers:Z}=D;let p=ht.get(Y);if(!(c.effectType!=="fluid"&&c.effectType!=="particles"&&c.effectType!=="milkdrop"&&c.effectType!=="audiomotion"&&c.effectType!=="wavejs"&&c.effectType!=="hydra"&&c.effectType!=="ghostfx"&&c.effectType!=="analyzerlab"&&c.effectType!=="handfx")){if(!p){if(c.effectType==="fluid"&&!C){$("fluid",async()=>{C=(await at(async()=>{const{FluidSimulation:w}=await import("./fluidSimulation-CFJ7_Gzl.js");return{FluidSimulation:w}},__vite__mapDeps([12,2]),import.meta.url)).FluidSimulation});continue}if(c.effectType==="particles"&&!T){$("particles3d",async()=>{T=(await at(async()=>{const{ParticleSystem3D:w}=await import("./particleSystem3D-BLD8hzwU.js");return{ParticleSystem3D:w}},__vite__mapDeps([13,2]),import.meta.url)).ParticleSystem3D});continue}if(c.effectType==="milkdrop"&&(!I||!W)){$("milkdrop",async()=>{I=(await at(()=>import("./milkdropVisualizer-wFYLJdEg.js"),__vite__mapDeps([14,15,2]),import.meta.url)).MilkdropVisualizer;const k=await at(()=>import("./milkdropPresets-hCvSaGg0.js"),__vite__mapDeps([16,2]),import.meta.url);W=k.loadPresetPack,G=k.pickNextPreset});continue}if(c.effectType==="audiomotion"&&!O){$("audiomotion",async()=>{O=(await at(()=>import("./audiomotionVisualizer-L6vaN43T.js"),__vite__mapDeps([17,2]),import.meta.url)).AudioMotionVisualizer});continue}if(c.effectType==="wavejs"&&!ce){$("wavejs",async()=>{ce=(await at(()=>import("./wavejsVisualizer-D98ZOFr7.js"),__vite__mapDeps([18,2]),import.meta.url)).WaveJSVisualizer});continue}if(c.effectType==="hydra"&&(!ae||!se)){$("hydra",async()=>{ae=(await at(()=>import("./hydraVisualizer-CblIzNIm.js"),__vite__mapDeps([19,15,2]),import.meta.url)).HydraVisualizer,se=await at(()=>import("./hydraPresets-Bm_j6lr8.js"),[],import.meta.url)});continue}if(c.effectType==="ghostfx"&&!te){$("ghostfx",async()=>{te=(await at(()=>import("./ghostfxVisualizer-Cl_OaoHC.js"),__vite__mapDeps([20,0,1,2,3,4,5]),import.meta.url)).GhostFXVisualizer});continue}if(c.effectType==="analyzerlab"&&!L){$("analyzerlab",async()=>{L=(await at(()=>import("./analyzerLabVisualizer-CxUaVLSo.js"),__vite__mapDeps([21,3,1,2]),import.meta.url)).AnalyzerLabVisualizer});continue}if(c.effectType==="handfx"&&!N){$("handfx",async()=>{N=(await at(()=>import("./handfxVisualizer-CCgvSlnE.js"),__vite__mapDeps([22,7,2,1,0,3,4,5]),import.meta.url)).HandFXVisualizer});continue}}if(p&&p.type!==c.effectType){try{p.cameraStream?.getTracks().forEach(w=>w.stop())}catch{}try{p.cameraVideoEl?.remove()}catch{}try{p.cameraTexture?.dispose()}catch{}try{p.prevCameraTarget?.dispose()}catch{}p.fluid?.dispose(),p.particles?.dispose(),p.milkdrop?.dispose();try{p.milkdropStemRouter?.dispose()}catch{}p.audiomotion?.dispose(),p.wavejs?.dispose(),p.hydra?.dispose(),p.ghostfx?.dispose(),p.analyzerlab?.dispose(),p.handfx?.dispose(),p.renderTarget.dispose(),ht.delete(Y),p=void 0}if(!p){const w=new la(y,x,{minFilter:le,magFilter:le,format:qe});if(p={type:c.effectType,renderTarget:w,simulationWidth:y,simulationHeight:x,lastUpdateTime:B,mouseX:.5,mouseY:.5,lastMouseX:.5,lastMouseY:.5},c.effectType==="fluid"){const k=wr(y,x),A=new C(k.width,k.height);A.init(v),c.fluidMode!==void 0&&A.setMode(c.fluidMode),p.fluid=A,p.simulationWidth=k.width,p.simulationHeight=k.height}else if(c.effectType==="particles"){const k=new T(y,x);k.init(v),k.setParams({mode:c.particleMode??0,count:c.particleCount??3e3,size:c.particleSize??.8,speed:c.particleSpeed??2,gravity:c.particleGravity??-.5,turbulence:c.particleTurbulence??2,vortex:c.particleVortex??1,drag:c.particleDrag??.98,mouseForce:c.particleMouseForce??50,mouseRadius:c.particleMouseRadius??15,emission:c.particleEmission??2,bloom:c.particleBloom??.6,bloomThreshold:c.particleBloomThreshold??.35,material:c.particleMaterial??0,colorA:c.particleColorA??[.2,.5,1],colorB:c.particleColorB??[1,.3,.8],colorC:c.particleColorC??[.3,1,.5],colorMode:c.particleColorMode??0,connectors:c.particleConnectors??!1,connectorDist:c.particleConnectorDist??5,connectorOpacity:c.particleConnectorOpacity??.4,textureUrl:c.particleTextureUrl??"",lightCount:c.particleLightCount??3,lightIntensity:c.particleLightIntensity??4,lightOrbitSpeed:c.particleLightOrbitSpeed??.5,lightColorA:c.particleLightColorA??[.3,.5,1],lightColorB:c.particleLightColorB??[1,.3,.6],lightConeAngle:c.particleLightConeAngle??.6,ambient:c.particleAmbient??.35,autoRotate:c.particleAutoRotate??!0,rotationSpeed:c.particleRotationSpeed??.15}),p.particles=k}else if(c.effectType==="milkdrop"){const k=Gt.getOrCreateAudioContext(),A=c.milkdropPixelRatio??1,E=c.milkdropMeshSize??48,U=new I(k,{width:y,height:x,pixelRatio:A,meshSize:E});U.init(v),U.setSensitivity(c.milkdropSensitivity??1.5),p.milkdrop=U}else if(c.effectType==="audiomotion"){const k=Gt.getOrCreateAudioContext(),A=new O(k,y,x);A.init(v),A.setParams({mode:c.audiomotionMode??4,gradient:c.audiomotionGradient??"orangered",radial:c.audiomotionRadial??!1,barStyle:c.audiomotionBarStyle??"normal",peakLine:c.audiomotionPeakLine??!1,showPeaks:c.audiomotionShowPeaks??!0,mirror:c.audiomotionMirror??0,flipY:c.audiomotionFlipY??!1,reflexRatio:c.audiomotionReflexRatio??0,barSpace:c.audiomotionBarSpace??.1,minFreq:c.audiomotionMinFreq??30,maxFreq:c.audiomotionMaxFreq??16e3,sensitivity:c.audiomotionSensitivity??1,smoothing:c.audiomotionSmoothing??.5,bgAlpha:c.audiomotionBgAlpha??1}),p.audiomotion=A}else if(c.effectType==="wavejs"){const k=Gt.getOrCreateAudioContext(),A=new ce(k,y,x);A.init(v),A.setParams({animation:c.wavejsAnimation??"Wave",sensitivity:c.wavejsSensitivity??1.5,lineWidth:c.wavejsLineWidth??4,colorA:c.wavejsColorA??[1,.42,.42],colorB:c.wavejsColorB??[1,.55,.3],useGradient:c.wavejsUseGradient??!0,gradientRotate:c.wavejsGradientRotate??0,glowStrength:c.wavejsGlowStrength??15,glowColor:c.wavejsGlowColor??[1,.42,.42],bgAlpha:c.wavejsBgAlpha??1,flipY:c.wavejsFlipY??!1}),p.wavejs=A}else if(c.effectType==="hydra"){const k=new ae(y,x);k.init(v),k.setParams({sketchName:c.hydraSketchName??"Welcome",sketchCode:c.hydraSketchCode??"osc(20, 0.1, 1.4).rotate(0.1).out()",sensitivity:c.hydraSensitivity??1.5,bgAlpha:c.hydraBgAlpha??1}),p.hydra=k,p.hydraLoadedPresetName=c.hydraSketchName??"Welcome"}else if(c.effectType==="ghostfx"){const k=new te(y,x);k.init(v),k.setParams({scenePreset:c.ghostfxScenePreset??"drift",sensitivity:c.ghostfxSensitivity??1.4,hueDriftSpeed:c.ghostfxHueDriftSpeed??.15,bloomIntensity:c.ghostfxBloomIntensity??1.4,bloomThreshold:c.ghostfxBloomThreshold??.45,vignette:c.ghostfxVignette??.7,exposure:c.ghostfxExposure??.1,bgAlpha:c.ghostfxBgAlpha??1,vortexStrength:c.ghostfxVortexStrength??2,latticeThreshold:c.ghostfxLatticeThreshold??2.5,trailIntensity:c.ghostfxTrailIntensity??1,feedbackAmount:c.ghostfxFeedbackAmount??.35,feedbackZoom:c.ghostfxFeedbackZoom??1.003,ribbonWidth:c.ghostfxRibbonWidth??.1,ribbonSpawn:c.ghostfxRibbonSpawn??1,ribbonTranslucency:c.ghostfxRibbonTranslucency??.35,ribbonBlend:c.ghostfxRibbonBlend??"additive",lightAzimuth:c.ghostfxLightAzimuth??35,lightElevation:c.ghostfxLightElevation??55,lightStrength:c.ghostfxLightStrength??.9,ambient:c.ghostfxAmbient??.3,liquidSplatForce:c.ghostfxLiquidSplatForce??1,liquidSplatRadius:c.ghostfxLiquidSplatRadius??.08,liquidDyeDecay:c.ghostfxLiquidDyeDecay??.995,liquidVelDecay:c.ghostfxLiquidVelDecay??.992,liquidBassRate:c.ghostfxLiquidBassRate??1}),p.ghostfx=k}else if(c.effectType==="analyzerlab"){const k=new L(y,x);k.init(v),k.setParams({layout:c.analyzerLabLayout??"stack",colormap:c.analyzerLabColormap??"inferno",spectroOrientation:c.analyzerLabSpectroOrientation??"horizontal",spectroGain:c.analyzerLabSpectroGain??1,spectroMinDb:c.analyzerLabSpectroMinDb??-85,spectroMaxDb:c.analyzerLabSpectroMaxDb??-25,scrollSpeed:c.analyzerLabScrollSpeed??1,chromaStyle:c.analyzerLabChromaStyle??"bars",chromaGlow:c.analyzerLabChromaGlow??.5,waveStyle:c.analyzerLabWaveStyle??"line",waveLineWidth:c.analyzerLabWaveLineWidth??1.5,showBeats:c.analyzerLabShowBeats??!0,showLabels:c.analyzerLabShowLabels??!0,bgAlpha:c.analyzerLabBgAlpha??1}),p.analyzerlab=k}else if(c.effectType==="handfx"){const k=new N(y,x);k.init(v),k.setParams({mode:c.handfxMode??"trails",cameraOn:c.handfxCameraOn??!1,smoothing:c.handfxSmoothing??.15,predictMs:c.handfxPredictMs??18,showHelp:c.handfxShowHelp??!0,bgAlpha:c.handfxBgAlpha??0,panelColor:c.handfxPanelColor??"#FFFFFF",panelOpacity:c.handfxPanelOpacity??1,panelPadding:c.handfxPanelPadding??.04,panelCornerRadius:c.handfxPanelCornerRadius??.02,trailFade:c.handfxTrailFade??.985,trailColorMode:c.handfxTrailColorMode??"rainbow",trailThickness:c.handfxTrailThickness??3,trailVelocityScale:c.handfxTrailVelocityScale??1.5,trailSparkDensity:c.handfxTrailSparkDensity??.5,trailFlowStrength:c.handfxTrailFlowStrength??.7,inkColorMode:c.handfxInkColorMode??"coral",inkSize:c.handfxInkSize??55,inkOpacity:c.handfxInkOpacity??.28,inkDrift:c.handfxInkDrift??1,skeletonColor:c.handfxSkeletonColor??"#FF6B6B",skeletonGlow:c.handfxSkeletonGlow??1.5,sprayColorMode:c.handfxSprayColorMode??"rainbow",sprayIntensity:c.handfxSprayIntensity??1.5,sprayThreshold:c.handfxSprayThreshold??.25,showCamera:c.handfxShowCamera??!1,cameraOpacity:c.handfxCameraOpacity??.5}),p.handfx=k}ht.set(Y,p),console.log("[Canvas] Created integrated effect:",c.effectType,"for",Y)}if((p.renderTarget.width!==y||p.renderTarget.height!==x)&&p.renderTarget.setSize(y,x),p.fluid&&c.effectType==="fluid"){let w=function(q){try{q.cameraStream?.getTracks().forEach(X=>X.stop())}catch{}try{q.cameraVideoEl?.remove()}catch{}try{q.cameraTexture?.dispose()}catch{}try{q.prevCameraTarget?.dispose()}catch{}q.cameraStream=void 0,q.cameraVideoEl=void 0,q.cameraTexture=void 0,q.prevCameraTarget=void 0,q.cameraRequested=!1,q.prevCameraCopied=!1};const k=wr(y,x);(p.simulationWidth!==k.width||p.simulationHeight!==k.height)&&(p.fluid.resize(k.width,k.height),p.simulationWidth=k.width,p.simulationHeight=k.height),c.fluidMode!==void 0&&p.fluid.setMode(c.fluidMode),p._fluidRenderParams||(p._fluidRenderParams={intensity:1,contrast:1,saturation:1,hueShift:0,glow:.5,bgColor:[0,0,0]});const A=p._fluidRenderParams;A.intensity=c.fluidIntensity??1,A.contrast=c.fluidContrast??1,A.saturation=c.fluidSaturation??1,A.hueShift=c.fluidHueShift??0,A.glow=c.fluidGlow??.5,A.bgColor=c.fluidBgColor??A.bgColor,p.fluid.setRenderParams(A),p._fluidSimParams||(p._fluidSimParams={viscosity:1e-4,vorticity:30,dissipation:1,velocityDissipation:.5,pressureIterations:14});const E=p._fluidSimParams;if(E.viscosity=c.fluidViscosity??1e-4,E.vorticity=c.fluidVorticity??30,E.dissipation=c.fluidDissipation??1,E.velocityDissipation=c.fluidVelDissipation??.5,E.pressureIterations=c.fluidPressureIters??P(ga).pressureIterations,p.fluid.setParams(E),p.fluid&&c.cameraEnabled&&!p.cameraStream&&!p.cameraRequested){p.cameraRequested=!0;const q=Y;console.log("[Canvas] Requesting webcam for fluid camera feed..."),navigator.mediaDevices.getUserMedia({video:{width:640,height:480},audio:!1}).then(X=>{const ee=ht.get(q);if(!ee){X.getTracks().forEach(de=>de.stop());return}const Te=document.createElement("video");Te.srcObject=X,Te.muted=!0,Te.playsInline=!0,Te.autoplay=!0,Te.play();const oe=new Ii(Te);oe.minFilter=le,oe.magFilter=le;const me=new la(640,480,{minFilter:le,magFilter:le,format:qe});ee.cameraStream=X,ee.cameraVideoEl=Te,ee.cameraTexture=oe,ee.prevCameraTarget=me,ee.prevCameraCopied=!1,X.getVideoTracks().forEach(de=>{de.onended=()=>{console.warn("[Canvas] Webcam track ended (device unplugged?) — tearing down fluid camera feed");const ve=ht.get(q);ve&&w(ve)}}),console.log("[Canvas] Webcam started for fluid camera feed")}).catch(X=>{console.error("[Canvas] Webcam access denied or failed:",X);const ee=ht.get(q);ee&&(ee.cameraRequested=!1)})}p.fluid&&!c.cameraEnabled&&p.cameraStream&&(w(p),console.log("[Canvas] Webcam stopped (user-disabled)")),p.cameraTexture&&p.prevCameraTarget&&(p.cameraVideoEl?.readyState??0)>=2&&(p.prevCameraCopied&&p.fluid.injectCamera(v,p.cameraTexture,p.prevCameraTarget.texture,c.fluidCameraStrength??3),p._camCopyScene||(p._camCopyMat=new vl,p._camCopyMesh=new Ba(new Aa(2,2),p._camCopyMat),p._camCopyScene=new ea,p._camCopyScene.add(p._camCopyMesh),p._camCopyCam=new Ra(-1,1,1,-1,0,1)),p._camCopyMat.map=p.cameraTexture,p._camCopyMat.needsUpdate=!0,v.setRenderTarget(p.prevCameraTarget),v.render(p._camCopyScene,p._camCopyCam),v.setRenderTarget(null),p.prevCameraCopied=!0);const U=c.fluidForceScale??500,H=c.fluidColor??[.2,.5,1];if(ha){const q=ur,X=dr,ee=q-p.lastMouseX,Te=X-p.lastMouseY;if(Math.sqrt(ee*ee+Te*Te)>.001){const me=ee*U,de=-Te*U;p.fluid.addVelocity(v,q,1-X,me,de,.01),p.fluid.addDensity(v,q,1-X,H[0]*5,H[1]*5,H[2]*5,.008)}p.lastMouseX=q,p.lastMouseY=X}p.fluid.step(v,R),p.fluid.render(v,p.renderTarget)}if(p.particles&&c.effectType==="particles"){(p.particles.width!==y||p.particles.height!==x)&&p.particles.resize(y,x),p._particleParams||(p._particleParams={mode:0,count:3e3,size:.8,speed:2,gravity:-.5,turbulence:2,vortex:1,drag:.98,mouseForce:50,mouseRadius:15,emission:2,bloom:.6,bloomThreshold:.35,material:0,colorA:[.2,.5,1],colorB:[1,.3,.8],colorC:[.3,1,.5],colorMode:0,connectors:!1,connectorDist:5,connectorOpacity:.4,textureUrl:"",lightCount:3,lightIntensity:4,lightOrbitSpeed:.5,lightColorA:[.3,.5,1],lightColorB:[1,.3,.6],lightConeAngle:.6,ambient:.35,autoRotate:!0,rotationSpeed:.15});const w=p._particleParams;if(w.mode=c.particleMode??0,w.count=c.particleCount??3e3,w.size=c.particleSize??.8,w.speed=c.particleSpeed??2,w.gravity=c.particleGravity??-.5,w.turbulence=c.particleTurbulence??2,w.vortex=c.particleVortex??1,w.drag=c.particleDrag??.98,w.mouseForce=c.particleMouseForce??50,w.mouseRadius=c.particleMouseRadius??15,w.emission=c.particleEmission??2,w.bloom=c.particleBloom??.6,w.bloomThreshold=c.particleBloomThreshold??.35,w.material=c.particleMaterial??0,w.colorA=c.particleColorA??w.colorA,w.colorB=c.particleColorB??w.colorB,w.colorC=c.particleColorC??w.colorC,w.colorMode=c.particleColorMode??0,w.connectors=c.particleConnectors??!1,w.connectorDist=c.particleConnectorDist??5,w.connectorOpacity=c.particleConnectorOpacity??.4,w.textureUrl=c.particleTextureUrl??"",w.lightCount=c.particleLightCount??3,w.lightIntensity=c.particleLightIntensity??4,w.lightOrbitSpeed=c.particleLightOrbitSpeed??.5,w.lightColorA=c.particleLightColorA??w.lightColorA,w.lightColorB=c.particleLightColorB??w.lightColorB,w.lightConeAngle=c.particleLightConeAngle??.6,w.ambient=c.particleAmbient??.35,w.autoRotate=c.particleAutoRotate??!0,w.rotationSpeed=c.particleRotationSpeed??.15,p.particles.setParams(w),ha){const k=(Ji+1)*.5,A=1-(Qi+1)*.5;p.particles.setMouse(k,A,!0)}else p.particles.setMouse(.5,.5,!1);p.particles.step(v,R),p.particles.renderToTarget(v,p.renderTarget)}if(p.milkdrop&&c.effectType==="milkdrop"){const w=p.milkdrop,k=c.milkdropBlendTime??2.7,A=Z[0]?.id??"";p.milkdropLayerId=A,(p.renderTarget.width!==y||p.renderTarget.height!==x)&&w.resize(y,x,c.milkdropPixelRatio??1);const U=_s.isRunning()&&!!c.milkdropRoutingMatrix,H=U?"stems":"mono";if(H!==p.milkdropAudioSource){if(p.milkdropStemRouter){try{p.milkdropStemRouter.dispose()}catch{}p.milkdropStemRouter=void 0}if(U){const oe=Gt.getOrCreateAudioContext(),me=new Fd(oe);me.setStems(_s.getStems()),me.setMatrix(c.milkdropRoutingMatrix),w.connectAudio(me.getOutput()),p.milkdropStemRouter=me,p.milkdropAudioSource="stems",p.milkdropAudioAttached=!0,console.log("[Canvas] Milkdrop → stem router")}else{const oe=Gt.getSourceNode();oe?(w.connectAudio(oe),p.milkdropAudioSource="mono",p.milkdropAudioAttached=!0,console.log("[Canvas] Milkdrop → mono source")):p.milkdropAudioAttached=!1}}else if(U&&p.milkdropStemRouter)p.milkdropStemRouter.setMatrix(c.milkdropRoutingMatrix);else if(H==="mono"&&!p.milkdropAudioAttached){const oe=Gt.getSourceNode();oe&&(w.connectAudio(oe),p.milkdropAudioAttached=!0)}w.setSensitivity(c.milkdropSensitivity??1.5);const q=c.milkdropPresetPack??"minimal";p.milkdropPresetPack!==q&&W&&(p.milkdropPresetPack=q,W(q).then(oe=>{p.milkdropPresets=oe,p.milkdropPresetNames=Object.keys(oe).sort();const me=G(oe,null);me&&(w.loadPreset(me,oe[me],0),p.milkdropLoadedPresetName=me,p.milkdropLastEvolveAt=performance.now(),A&&sa.reportPreset(A,me))}).catch(oe=>console.warn("[Canvas] milkdrop preset pack load failed",oe)));const X=p.milkdropPresets,ee=p.milkdropPresetNames??[];if(A&&X&&ee.length>0){sa.subscribe;const me=we(sa).commands[A];if(me&&me.tag!==p.milkdropLastCommandTag){p.milkdropLastCommandTag=me.tag;const de=p.milkdropLoadedPresetName??null;let ve=null,st=k;switch(me.kind){case"next":{const bt=de?ee.indexOf(de):-1;ve=ee[(bt+1+ee.length)%ee.length];break}case"prev":{const bt=de?ee.indexOf(de):0;ve=ee[(bt-1+ee.length)%ee.length];break}case"random":{ve=G?G(X,de):null;break}case"cut":{ve=G?G(X,de):null,st=0;break}case"load":{me.presetName&&X[me.presetName]&&(ve=me.presetName);break}}ve&&X[ve]&&(w.loadPreset(ve,X[ve],st),p.milkdropLoadedPresetName=ve,p.milkdropLastEvolveAt=performance.now(),p.milkdropLastEvolveBeat=aa()?.beat?.beatCount??0,sa.reportPreset(A,ve))}}const Te=A?we(sa).locked[A]:!1;if(!Te&&X&&ee.length>0&&(c.milkdropHardCutEnabled??!1)){const oe=aa(),me=oe?.beat?.beatIntensity??0,de=c.milkdropHardCutThreshold??.8,ve=performance.now(),st=ve-(p.milkdropLastHardCutAt??0)>500;if(oe?.beat?.isBeat&&me>=de&&st&&G){const bt=G(X,p.milkdropLoadedPresetName??null);bt&&(w.loadPreset(bt,X[bt],0),p.milkdropLoadedPresetName=bt,p.milkdropLastHardCutAt=ve,p.milkdropLastEvolveAt=ve,p.milkdropLastEvolveBeat=oe.beat.beatCount,A&&sa.reportPreset(A,bt))}}if(!Te&&X&&(c.milkdropAutoEvolve??!0)&&G){const oe=c.milkdropEvolveMode??1;let me=!1;if(oe===0){const de=(c.milkdropEvolveInterval??22)*1e3,ve=p.milkdropLastEvolveAt??0;me=performance.now()-ve>=de}else{const ve=aa()?.beat?.beatCount??0,st=c.milkdropEvolveBars??8,bt=p.milkdropLastEvolveBeat??ve;p.milkdropLastEvolveBeat===void 0&&(p.milkdropLastEvolveBeat=ve),me=ve-bt>=st*4}if(me){const de=G(X,p.milkdropLoadedPresetName??null);de&&(w.loadPreset(de,X[de],k),p.milkdropLoadedPresetName=de,A&&sa.reportPreset(A,de)),p.milkdropLastEvolveAt=performance.now(),p.milkdropLastEvolveBeat=aa()?.beat?.beatCount??0}}w.render(v,p.renderTarget)}if(p.audiomotion&&c.effectType==="audiomotion"){const w=p.audiomotion;if((p.renderTarget.width!==y||p.renderTarget.height!==x)&&w.resize(y,x),!p.audiomotionAudioAttached){const k=Gt.getSourceNode();k&&(w.connectAudio(k),p.audiomotionAudioAttached=!0,console.log("[Canvas] AudioMotion audio attached"))}w.setParams({mode:c.audiomotionMode??4,gradient:c.audiomotionGradient??"orangered",radial:c.audiomotionRadial??!1,barStyle:c.audiomotionBarStyle??"normal",peakLine:c.audiomotionPeakLine??!1,showPeaks:c.audiomotionShowPeaks??!0,mirror:c.audiomotionMirror??0,flipY:c.audiomotionFlipY??!1,reflexRatio:c.audiomotionReflexRatio??0,barSpace:c.audiomotionBarSpace??.1,minFreq:c.audiomotionMinFreq??30,maxFreq:c.audiomotionMaxFreq??16e3,sensitivity:c.audiomotionSensitivity??1,smoothing:c.audiomotionSmoothing??.5,bgAlpha:c.audiomotionBgAlpha??1}),w.render(v,p.renderTarget)}if(p.analyzerlab&&c.effectType==="analyzerlab"){const w=p.analyzerlab;(p.renderTarget.width!==y||p.renderTarget.height!==x)&&w.resize(y,x),w.setParams({layout:c.analyzerLabLayout??"stack",colormap:c.analyzerLabColormap??"inferno",spectroOrientation:c.analyzerLabSpectroOrientation??"horizontal",spectroGain:c.analyzerLabSpectroGain??1,spectroMinDb:c.analyzerLabSpectroMinDb??-85,spectroMaxDb:c.analyzerLabSpectroMaxDb??-25,scrollSpeed:c.analyzerLabScrollSpeed??1,chromaStyle:c.analyzerLabChromaStyle??"bars",chromaGlow:c.analyzerLabChromaGlow??.5,waveStyle:c.analyzerLabWaveStyle??"line",waveLineWidth:c.analyzerLabWaveLineWidth??1.5,showBeats:c.analyzerLabShowBeats??!0,showLabels:c.analyzerLabShowLabels??!0,bgAlpha:c.analyzerLabBgAlpha??1}),w.render(v,p.renderTarget)}if(p.handfx&&c.effectType==="handfx"){const w=p.handfx;(p.renderTarget.width!==y||p.renderTarget.height!==x)&&w.resize(y,x),w.setParams({mode:c.handfxMode??"trails",cameraOn:c.handfxCameraOn??!1,smoothing:c.handfxSmoothing??.15,predictMs:c.handfxPredictMs??18,showHelp:c.handfxShowHelp??!0,bgAlpha:c.handfxBgAlpha??0,panelColor:c.handfxPanelColor??"#FFFFFF",panelOpacity:c.handfxPanelOpacity??1,panelPadding:c.handfxPanelPadding??.04,panelCornerRadius:c.handfxPanelCornerRadius??.02,trailFade:c.handfxTrailFade??.985,trailColorMode:c.handfxTrailColorMode??"rainbow",trailThickness:c.handfxTrailThickness??3,trailVelocityScale:c.handfxTrailVelocityScale??1.5,trailSparkDensity:c.handfxTrailSparkDensity??.5,trailFlowStrength:c.handfxTrailFlowStrength??.7,inkColorMode:c.handfxInkColorMode??"coral",inkSize:c.handfxInkSize??55,inkOpacity:c.handfxInkOpacity??.28,inkDrift:c.handfxInkDrift??1,skeletonColor:c.handfxSkeletonColor??"#FF6B6B",skeletonGlow:c.handfxSkeletonGlow??1.5,sprayColorMode:c.handfxSprayColorMode??"rainbow",sprayIntensity:c.handfxSprayIntensity??1.5,sprayThreshold:c.handfxSprayThreshold??.25,showCamera:c.handfxShowCamera??!1,cameraOpacity:c.handfxCameraOpacity??.5}),w.render(v,p.renderTarget)}if(p.wavejs&&c.effectType==="wavejs"){const w=p.wavejs;if((p.renderTarget.width!==y||p.renderTarget.height!==x)&&w.resize(y,x),!p.wavejsAudioAttached){const k=Gt.getSourceNode();k&&(w.connectAudio(k),p.wavejsAudioAttached=!0,console.log("[Canvas] Wave.js audio attached"))}w.setParams({animation:c.wavejsAnimation??"Wave",sensitivity:c.wavejsSensitivity??1.5,lineWidth:c.wavejsLineWidth??4,colorA:c.wavejsColorA??[1,.42,.42],colorB:c.wavejsColorB??[1,.55,.3],useGradient:c.wavejsUseGradient??!0,gradientRotate:c.wavejsGradientRotate??0,glowStrength:c.wavejsGlowStrength??15,glowColor:c.wavejsGlowColor??[1,.42,.42],bgAlpha:c.wavejsBgAlpha??1,flipY:c.wavejsFlipY??!1}),w.render(v,p.renderTarget)}if(p.hydra&&c.effectType==="hydra"){const w=p.hydra,k=Z[0]?.id??"";if(p.hydraLayerId=k,(p.renderTarget.width!==y||p.renderTarget.height!==x)&&w.resize(y,x),w.setParams({sketchName:c.hydraSketchName??"Welcome",sketchCode:c.hydraSketchCode??"",sensitivity:c.hydraSensitivity??1.5,bgAlpha:c.hydraBgAlpha??1}),k&&se){const A=se.HYDRA_PRESETS,E=se.pickNextHydraPreset,U=we(Ro),H=U.commands[k];if(H&&H.tag!==p.hydraLastCommandTag){p.hydraLastCommandTag=H.tag;const q=p.hydraLoadedPresetName??null;let X=null;switch(H.kind){case"next":{const ee=q?A.findIndex(Te=>Te.name===q):-1;X=A[(ee+1+A.length)%A.length];break}case"prev":{const ee=q?A.findIndex(Te=>Te.name===q):0;X=A[(ee-1+A.length)%A.length];break}case"random":X=E(q);break;case"load":{H.presetName&&(X=A.find(ee=>ee.name===H.presetName)??null);break}}if(X){for(const ee of Z)ee.source?.effectSource&&$e.setLayerSource(ee.id,{...ee.source,effectSource:{...ee.source.effectSource,hydraSketchName:X.name,hydraSketchCode:X.code}});p.hydraLoadedPresetName=X.name,Ro.reportPreset(k,X.name)}}p.hydraLoadedPresetName&&U.currentPreset[k]!==p.hydraLoadedPresetName&&Ro.reportPreset(k,p.hydraLoadedPresetName)}w.step(R,aa()),w.render(v,p.renderTarget)}if(p.ghostfx&&c.effectType==="ghostfx"){const w=p.ghostfx;(p.renderTarget.width!==y||p.renderTarget.height!==x)&&w.resize(y,x),w.setParams({scenePreset:c.ghostfxScenePreset??"drift",sensitivity:c.ghostfxSensitivity??1.4,hueDriftSpeed:c.ghostfxHueDriftSpeed??.15,exposure:c.ghostfxExposure??0,bgAlpha:c.ghostfxBgAlpha??1,bloomIntensity:c.ghostfxBloomIntensity??1.4,bloomThreshold:c.ghostfxBloomThreshold??.45,vignette:c.ghostfxVignette??.7,vortexStrength:c.ghostfxVortexStrength??2,latticeThreshold:c.ghostfxLatticeThreshold??2.5,trailIntensity:c.ghostfxTrailIntensity??1,feedbackAmount:c.ghostfxFeedbackAmount??.35,feedbackZoom:c.ghostfxFeedbackZoom??1.003,ribbonWidth:c.ghostfxRibbonWidth??.1,ribbonSpawn:c.ghostfxRibbonSpawn??1,ribbonTranslucency:c.ghostfxRibbonTranslucency??.35,ribbonBlend:c.ghostfxRibbonBlend??"additive",lightAzimuth:c.ghostfxLightAzimuth??35,lightElevation:c.ghostfxLightElevation??55,lightStrength:c.ghostfxLightStrength??.9,ambient:c.ghostfxAmbient??.3,liquidSplatForce:c.ghostfxLiquidSplatForce??1,liquidSplatRadius:c.ghostfxLiquidSplatRadius??.08,liquidDyeDecay:c.ghostfxLiquidDyeDecay??.995,liquidVelDecay:c.ghostfxLiquidVelDecay??.992,liquidBassRate:c.ghostfxLiquidBassRate??1}),w.render(v,p.renderTarget,aa(),R)}for(const w of Z)w.source.texture=p.renderTarget.texture;Me.has(Y)||(Me.set(Y,p.renderTarget.texture),hi())}}for(const[Y,D]of ht)F.has(Y)||(D.fluid?.dispose(),D.particles?.dispose(),D.milkdrop?.dispose(),D.audiomotion?.dispose(),D.wavejs?.dispose(),D.hydra?.dispose(),D.ghostfx?.dispose(),D.analyzerlab?.dispose(),D.handfx?.dispose(),D.renderTarget.dispose(),D.cameraStream&&(D.cameraStream.getTracks().forEach(c=>c.stop()),D.cameraVideoEl?.remove(),D.cameraTexture?.dispose(),D.prevCameraTarget?.dispose()),ht.delete(Y),console.log("[Canvas] Disposed integrated effect:",Y));v.setRenderTarget(null)}function Mr(){return P(he)}function Rr(){return P(_e)??null}let Si=Sl(e,"bridgeMode",8,!1);function Ar(){if(!P(vt)||!P(ft))return{x:0,y:0,width:0,height:0};const g=P(vt).offsetWidth,v=P(vt).offsetHeight,_=P(ft).offsetWidth,y=P(ft).offsetHeight;return{x:(_-g)/2,y:(y-v)/2,width:g,height:v}}ba(()=>(P(pt),t()),()=>{P(pt)&&Bn(t().output.testPattern,t().output.edgeBlendLeft,t().output.edgeBlendRight,t().output.edgeBlendTop,t().output.edgeBlendBottom,t().output.edgeBlendGamma)}),ba(()=>t(),()=>{Ze(ga,xr[t().ui.fluidQuality??"live"])}),ba(()=>(P(he),a(),P(so)),()=>{if(P(he)&&a()){const g=new Set(a().layers.map(v=>v.id));for(const v of P(so))if(!g.has(v))try{P(he).removeLayer(v)}catch(_){console.warn("[Canvas] engine.removeLayer failed for",v,_)}Ze(so,g)}}),ba(()=>(P(he),a(),P(no),P(lo),P(ft),P(yt)),()=>{if(P(he)&&a().width&&a().height){const g=a().width||1920,v=a().height||1080;if((g!==P(no)||v!==P(lo))&&P(ft)&&P(ft).offsetWidth>0&&P(ft).offsetHeight>0){Ze(no,g),Ze(lo,v),ro(P(ft).offsetWidth,P(ft).offsetHeight),P(he).resize(g,v),P(yt)&&P(yt).resize(g,v);for(const _ of qt.values())_.resize(g,v);for(const _ of va.values())_.setSize(g,v);for(const[_,y]of gt.entries()){const x=Ga.get(_)??1,B=Math.max(64,Math.round(g*x)),R=Math.max(64,Math.round(v*x));y.setSize(B,R)}}}}),ba(()=>t(),()=>{Ze(wi,Be&&!tt&&!!t()?.output?.spoutEnabled)}),ba(()=>(P(wi),P(Pe),P(Wa),t(),P(Ht),P(_e),ra),()=>{if(P(wi)&&!P(Pe)&&!P(Wa)){Ze(Wa,!0);const g=t()?.output,v=g?.spoutResolution||"match";let _=1920,y=1080;v==="4K"?(_=3840,y=2160):v==="720p"?(_=1280,y=720):v==="WXGA"?(_=1280,y=800):v==="WUXGA"?(_=1920,y=1200):v==="custom"?(_=g?.customWidth||1920,y=g?.customHeight||1080):v==="output"?P(Ht)&&(_=P(Ht).width,y=P(Ht).height):v==="match"&&P(_e)&&(_=P(_e).width,y=P(_e).height),Se("spout_start_sender",{name:g?.spoutName||"ghostArcade",width:_,height:y}).then(x=>{Ze(Pe,!0),Ze(Wa,!1),Ze(_t,0);const B=x?.mode||"unknown";console.log(`Spout output started: ${g?.spoutName} (${B})`),ra(`Spout started: ${g?.spoutName} ${_}x${y}`,"info")}).catch(x=>{console.warn("Failed to start Spout sender:",x),ra(`Spout failed: ${x?.message||x}`,"error"),Ze(Wa,!1)})}else!P(wi)&&P(Pe)&&(Se("spout_stop_sender").catch(()=>{}),Ze(Pe,!1),console.log("Spout output stopped"))}),dl();var Zn={getEngine:Mr,getCanvas:Rr,getContainerRect:Ar};yl();var _i=dp();let Br;var uo=Ir(_i);let Er;var fo=Ir(uo);let Fr;Ci(fo,g=>Ze(_e,g),()=>P(_e));var Lr=Ur(fo,2);Ci(Lr,g=>Ze(pt,g),()=>P(pt));var Kn=Ur(Lr,2);{var Jn=g=>{var v=up();Or(g,v)};wl(Kn,g=>{t(),ml(()=>t().output.blackout)&&g(Jn)})}Ci(uo,g=>Ze(vt,g),()=>P(vt)),Ci(_i,g=>Ze(ft,g),()=>P(ft)),fl(()=>{Br=go(_i,1,"canvas-wrapper svelte-o4ydsk",null,Br,{"output-mode":tt||Ge}),Er=go(uo,1,"canvas-container svelte-o4ydsk",null,Er,{"output-mode":tt||Ge}),Fr=go(fo,1,"main-canvas svelte-o4ydsk",null,Fr,{"bridge-source":Si()})}),Or(i,_i),bo(e,"getEngine",Mr),bo(e,"getCanvas",Rr),bo(e,"getContainerRect",Ar);var Qn=pl(Zn);return m(),Qn}export{Di as A,cp as B,zp as C,Sn as D,Rp as E,Lp as F,ud as G,Dp as H,Fp as S,Jc as W,Mf as a,gs as b,xf as c,pn as d,bf as e,$i as f,Af as g,bo as h,fn as i,Bf as j,Ap as k,nr as l,Bp as m,Ho as n,ra as o,_s as p,sa as q,Ef as r,kn as s,Rf as t,Ro as u,ts as v,Zl as w,Kl as x,Ep as y,jo as z};
