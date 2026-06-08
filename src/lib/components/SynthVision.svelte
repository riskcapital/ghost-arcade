<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';
  import {
    synthVisionStore,
    sessionClipCache,
    isfShaderCache,
    SV_SHADERS, SV_STYLES, SV_SPACES, SV_WORLDS,
    SV_ALL_CLIPS, SV_CLIP_ROW1, SV_CLIP_ROW2, SV_CLIP_ROW3, SV_CLIP_ROW4,
    SV_PARAMS, SV_SPACE_FX, SV_CAM_MODES, SV_CAM_BLENDS,
    SV_SHADER_DEFS, SV_WORLD_DEFS,
    SV_REACTIVITY_MODES,
    type SVState, type SVLayer, type SVParams, type SVParamKey,
    type SVReactivityMode
  } from '../stores/synthVision';
  import {
    performerDeckStore,
  } from '../stores/performerDecks';
  import {
    geoDeckStore,
  } from '../stores/geoDeck';
  import { evaluateGeoDeck, type GeoEngineRuntime } from '../geo/engine';
  import { vjClipLauncher, type VJClip } from '../stores/vjClipLauncher';
  import { mediaLibrary, type MediaItem } from '../stores/media';
  import { project, svKeyboardPresets } from '../stores/layers';
  import { globalSVKeyboardPresets } from '../stores/globalPresets';
  import { parseISF, getInputDefault, type ISFInput } from '../isf/parser';
  import { createISFShader, updateISFShader, setISFInputValue, type ISFShaderInstance } from '../isf/renderer';
  import { generateCachedThumbnail, disposeThumbnailResources } from '../isf/thumbnail';
  import { generateUUID } from '../types';
  import type { Effect, EffectType, SVClipAssignment, SVKeyboardPreset } from '../types';
  import { EFFECT_PARAM_DEFS } from '../effects/effectParamDefs';
  import { getDefaultEffectParams as getRendererDefaultEffectParams } from '../renderer/effects';
  import EffectPickerModal from './EffectPickerModal.svelte';
  import SynthVisionPresets from './SynthVisionPresets.svelte';
  import { modulationStore, setParamModSource, setParamModAmount, setBaseValue, registerParamRanges, getModulatedValue, type ModSource, type ParamModulation } from '../audio/modulation';
  import { audioStore } from '../stores/audio';
  import { getVisualAudioSnapshot } from '../audio/visualAudio';
  import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
  import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
  import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
  import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
  import AudioInputPicker from './AudioInputPicker.svelte';
  import { showLoading, hideLoading } from '../stores/loading';

  export let onClose: () => void = () => {};
  export let visible: boolean = true;

  // Save clips to session cache and close — clips persist across VJ mode toggles
  function handleClose() {
    sessionClipCache.save(clipAssignments, activePresetId, clipsDirty, assignedVJLayer);
    onClose();
  }

  // ─── Clip Assignment System ─────────────────────────
  // Each keyboard slot can be assigned to a shader or a media item (video/image) via drag-drop
  type ClipAssignment = SVClipAssignment;

  let clipAssignments: Record<number, ClipAssignment> = {};
  let clipsDirty = false; // true when assignments changed since last save/load
  let performerEditMode = false;
  let shaderMixActive = true; // Start with shader mix active by default
  let dragOverClipSlot: number | null = null;
  let editMediaTab: 'fx' | 'vid' | 'img' = 'fx';

  // Keyboard presets
  type KeyboardPreset = SVKeyboardPreset;
  let savedPresets: KeyboardPreset[] = [];
  let presetSaveScope: 'project' | 'global' = 'project';

  // Combine project + global presets for display
  $: allPresets = [
    ...($svKeyboardPresets).map(p => ({ ...p, _scope: 'project' as const })),
    ...($globalSVKeyboardPresets).map(p => ({ ...p, _scope: 'global' as const })),
  ];

  let activePresetId: string | null = null;
  let presetNameInput = '';
  let showPresetNameInput = false;

  // Shader library for edit tray (loaded from ISF manifest, same as VJModePanel)
  let editShaders: Array<{ id: string; name: string; src: string; shaderCode: string; thumbnail?: string; manifestDefaults?: Record<string, any> }> = [];
  let editShadersLoading = true;
  let thumbsCancelled = false; // set true on destroy to stop background thumbnail generation + shader loading

  // Active ISF clip controls - parsed inputs from the active VJ clip's shader code
  let activeISFInputs: ISFInput[] = [];
  let activeISFName: string = '';
  let activeISFShaderCode: string = ''; // track to avoid re-parsing

  // ─── Layer Effects System ─────────────────────────
  let showEffectPicker = false;
  let expandedEffectId: string | null = null;

  // ─── 3D Worlds Toggle ─────────────────────────
  let worldsEnabled = true;

  // ─── ISF Inside SynthVision Pipeline ─────────────────────────
  // When ISF shaders are triggered from performer keys, they render INSIDE SynthVision
  // (replacing the mega-shader output) instead of replacing the SV clip on the VJ layer.
  // This keeps 3D worlds, post-FX, global dials, PUMP, audio, drift/auto all working.
  let isfActive = false;
  let isfShaderInstance: ISFShaderInstance | null = null;
  let isfRenderer: THREE.WebGLRenderer | null = null;
  let isfScene: THREE.Scene | null = null;
  let isfCamera: THREE.OrthographicCamera | null = null;
  let isfQuad: THREE.Mesh | null = null;
  let isfCanvas: HTMLCanvasElement | null = null;
  let isfShaderCode_internal: string = ''; // track to avoid re-creating ISF instance
  let isfAssignment: ClipAssignment | null = null;

  // Reactive: parse ISF inputs from active ISF shader (inside SV or VJ clip)
  $: {
    if (isfActive && isfShaderInstance) {
      // ISF is rendering inside SynthVision pipeline
      const inputs = isfShaderInstance.metadata?.INPUTS || [];
      activeISFInputs = inputs.filter(
        (i: ISFInput) => (i.TYPE === 'float' || i.TYPE === 'long' || i.TYPE === 'bool' || i.TYPE === 'color' || i.TYPE === 'point2D')
          && !i.NAME.startsWith('sv') // Hide SV bridge params from UI
      );
      activeISFName = isfAssignment?.shaderName || 'ISF Shader';
      activeISFShaderCode = isfShaderCode_internal;
    } else {
      // Fallback: check VJ clip launcher for ISF clips
      const vjState = $vjClipLauncher;
      const clip = vjState.layerStates[assignedVJLayer]?.activeClip;
      if (clip?.type === 'shader' && clip.shaderCode && clip.shaderCode !== activeISFShaderCode) {
        try {
          const parsed = parseISF(clip.shaderCode);
          activeISFInputs = parsed.metadata.INPUTS.filter(
            (i: ISFInput) => i.TYPE === 'float' || i.TYPE === 'long' || i.TYPE === 'bool' || i.TYPE === 'color' || i.TYPE === 'point2D'
          );
          activeISFName = clip.name || 'ISF Shader';
          activeISFShaderCode = clip.shaderCode;
        } catch {
          activeISFInputs = [];
          activeISFName = '';
          activeISFShaderCode = clip.shaderCode;
        }
      } else if (!clip?.shaderCode && !isfActive) {
        activeISFInputs = [];
        activeISFName = '';
        activeISFShaderCode = '';
      }
    }
  }

  // Get current value for an ISF input
  function getISFValue(input: ISFInput): number | boolean | number[] {
    if (isfActive && isfShaderInstance) {
      // Read directly from ISF shader instance uniforms
      const u = isfShaderInstance.uniforms[input.NAME];
      if (u !== undefined && u.value !== undefined) return u.value as number | boolean | number[];
    } else {
      const clip = $vjClipLauncher.layerStates[assignedVJLayer]?.activeClip;
      if (clip?.shaderValues && input.NAME in clip.shaderValues) {
        return clip.shaderValues[input.NAME];
      }
    }
    return getInputDefault(input);
  }

  // Set an ISF input value
  function setISFValue(inputName: string, value: number | boolean | number[]) {
    if (isfActive && isfShaderInstance) {
      // Set directly on the ISF shader instance
      setISFInputValue(isfShaderInstance, inputName, value);
      // Keep modulation base value in sync with slider
      if (typeof value === 'number') {
        setBaseValue(assignedVJLayer, inputName, value);
      }
    } else {
      vjClipLauncher.updateActiveClipShaderValue(assignedVJLayer, inputName, value);
    }
  }

  // ─── Layer Effects Management ─────────────────────────
  // Reactive: current layer effects on the SynthVision VJ layer
  $: svLayerEffects = $vjClipLauncher.layerStates[assignedVJLayer]?.effects ?? [];

  function handleEffectPickerAdd(types: EffectType[]) {
    for (const type of types) {
      const newEffect: Effect = {
        id: generateUUID(),
        type,
        enabled: true,
        params: getRendererDefaultEffectParams(type),
      };
      vjClipLauncher.addLayerEffect(assignedVJLayer, newEffect);
    }
    showEffectPicker = false;
  }

  function toggleSvEffect(effectId: string) {
    vjClipLauncher.toggleLayerEffect(assignedVJLayer, effectId);
  }

  function deleteSvEffect(effectId: string) {
    vjClipLauncher.removeLayerEffect(assignedVJLayer, effectId);
    expandedEffectId = null;
  }

  function updateSvEffectParam(effectId: string, paramName: string, value: number | boolean) {
    vjClipLauncher.updateLayerEffectParams(assignedVJLayer, effectId, { [paramName]: value });
  }

  // Shader param modulation — thin wrapper for getter, shared setters from modulation.ts
  function getSvShaderMod(paramName: string): ParamModulation | undefined {
    return modulationStore.getModulation(assignedVJLayer, paramName);
  }

  // Hidden canvases for rendering (output goes to VJ layer)
  let outputCanvas: HTMLCanvasElement;
  let shaderCanvas: HTMLCanvasElement;
  let threeCanvas: HTMLCanvasElement;

  // VJ Layer assignment
  let assignedVJLayer: number = 0; // 0-3 for layers 1-4
  let svClipId = `synthvision-${Date.now()}`;

  // WebGL2 context for 2D shaders
  let gl: WebGL2RenderingContext | null = null;
  let shaderProgram: WebGLProgram | null = null;
  let shaderUniforms: Record<string, WebGLUniformLocation | null> = {};
  let quadVAO: WebGLVertexArrayObject | null = null;
  // Post-FX shader for ISF mode (applies SV effects to ISF output)
  let postFxProgram: WebGLProgram | null = null;
  let postFxUniforms: Record<string, WebGLUniformLocation | null> = {};
  let isfTexture: WebGLTexture | null = null;
  let fboA: { fb: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  let fboB: { fb: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  let fboW = 0;
  let fboH = 0;
  let fboPing = true;

  // Three.js for 3D worlds
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  // Post-processing chain — RenderPass → UnrealBloomPass → OutputPass.
  // Built lazily in initThree. We render through this instead of
  // renderer.render(scene, camera) for the entire visual lift
  // (bloom on emissive surfaces + ACES tone mapping via OutputPass).
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  // Lighting rig — low ambient + key + rim. MeshBasicMaterial worlds
  // ignore lights, but Phase B rewrites move to MeshStandardMaterial
  // which picks these up.
  let keyLight: THREE.PointLight | null = null;
  let rimLight: THREE.PointLight | null = null;
  let worldObjects: THREE.Object3D[] = [];
  let currentWorldIdx = -1;
  let worldData: Record<string, any> = {};
  // Compositing canvas
  let compCtx: CanvasRenderingContext2D | null = null;

  // Animation
  let animFrame: number = 0;
  let lastTime = 0;

  // Audio — uses shared audioStore instead of independent mic
  // (mic/system audio input is managed in VJ mode settings)

  // Reactive state
  let state: SVState;
  const unsub = synthVisionStore.subscribe(s => { state = s; });

  // Camera stream for live cam layer
  let camVideo: HTMLVideoElement;
  let camStream: MediaStream | null = null;

  // Camera effects WebGL pipeline
  let camCanvas: HTMLCanvasElement;
  let camGl: WebGL2RenderingContext | null = null;
  let camShader: WebGLProgram | null = null;
  let camUniforms: Record<string, WebGLUniformLocation | null> = {};
  let camVideoTexture: WebGLTexture | null = null;
  let camPrevTexture: WebGLTexture | null = null;
  let camFboA: { fb: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  let camFboB: { fb: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  let camFboPing = true;
  let lastMotion = 0; // For camera shader uniforms

  // Camera functions
  async function startCamera() {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      if (camVideo) {
        camVideo.srcObject = camStream;
        camVideo.play();
      }
      // Init camera shaders on first camera activation (deferred to save WebGL contexts)
      if (!camGl) {
        initCamShaders();
      }
      synthVisionStore.setCamActive(true);
    } catch (err) {
      console.error('Camera error:', err);
    }
  }

  function stopCamera() {
    if (camStream) {
      camStream.getTracks().forEach(t => t.stop());
      camStream = null;
    }
    synthVisionStore.setCamActive(false);
  }

  function toggleCamera() {
    if (state.camActive) stopCamera();
    else startCamera();
  }

  // Expose output canvas for VJ layer texture
  export function getOutputCanvas(): HTMLCanvasElement | null {
    return outputCanvas || null;
  }

  // ================================================================
  //  POST-FX SHADER (for ISF mode - applies SV effects to ISF output)
  // ================================================================
  const POST_FX_VERT = `#version 300 es
in vec2 p;out vec2 vUv;void main(){vUv=p*.5+.5;gl_Position=vec4(p,0,1);}`;

  const POST_FX_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D inputTex;
uniform vec2 res;
uniform float pump;
uniform float fxShockwave,fxTwist,fxChromatic,fxPixelate,fxStrobe,fxIntensity;
uniform float inv,blackout,whiteout;
void main(){
  vec2 uv=vUv;
  vec2 center=vec2(0.5);
  // Pixelate
  if(fxPixelate>0.01){
    float px=mix(1.0,16.0,fxPixelate*fxIntensity);
    uv=floor(uv*res/px)*px/res;
  }
  // Shockwave (radial distortion)
  if(fxShockwave>0.0&&fxShockwave<2.0){
    float d=length(uv-center);
    float edge=fxShockwave*0.5;
    float wave=smoothstep(edge-0.1,edge,d)*smoothstep(edge+0.1,edge,d);
    vec2 dir=uv-center;
    if(length(dir)>0.001) dir=normalize(dir);
    uv+=dir*wave*0.08*fxIntensity;
  }
  // Twist
  if(fxTwist>0.01){
    vec2 off=uv-center;
    float angle=fxTwist*fxIntensity*3.14159*length(off);
    float s=sin(angle),c=cos(angle);
    uv=center+vec2(c*off.x-s*off.y,s*off.x+c*off.y);
  }
  // Chromatic aberration
  vec3 col;
  if(fxChromatic>0.01){
    float offset=fxChromatic*fxIntensity*0.02;
    col.r=texture(inputTex,uv+vec2(offset,0)).r;
    col.g=texture(inputTex,uv).g;
    col.b=texture(inputTex,uv-vec2(offset,0)).b;
  }else{
    col=texture(inputTex,uv).rgb;
  }
  // Pump brightness
  col*=1.0+pump*1.5;
  // Strobe
  if(fxStrobe>0.5) col=vec3(1.0);
  // Invert
  if(inv>0.5) col=1.0-col;
  // Blackout / Whiteout
  col=mix(col,vec3(0),blackout);
  col=mix(col,vec3(1),whiteout);
  fragColor=vec4(clamp(col,0.0,1.0),1.0);
}`;

  // ================================================================
  //  VERTEX SHADER
  // ================================================================
  const VERT = `#version 300 es
in vec2 p;out vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0,1);}`;

  // ================================================================
  //  FRAGMENT SHADER - 24 VJ Performance Shaders
  // ================================================================
  const FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 O;
uniform float t,bp,pump,inv;
uniform vec2 res,ms;
uniform float chaos,spd,zm,col,glow,warp,mirr,feedback,lofi,mic,bass;
uniform int mode,style;
uniform sampler2D prevFrame;
uniform float blackout,whiteout;
uniform float fxShockwave,fxTwist,fxChromatic,fxPixelate,fxStrobe,fxIntensity;
uniform float sp0,sp1,sp2;
uniform float camFlowX,camFlowY;

#define PI 3.14159265
#define TAU 6.28318530

// === UTILITY FUNCTIONS ===
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float h3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float n3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec2 p,int o){float v=0.,a=.5;mat2 r=mat2(.8,.6,-.6,.8);for(int i=0;i<6;i++){if(i>=o)break;v+=a*n(p);p=r*p*2.;a*=.5;}return v;}
float fbm3(vec3 p,int o){float v=0.,a=.5;for(int i=0;i<5;i++){if(i>=o)break;v+=a*n3(p);p=p*2.+.3;a*=.5;}return v;}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
vec3 pal(float v,float hue){return .5+.5*cos(TAU*(v+hue+vec3(0.,.33,.67)));}
vec3 hsl(float h,float s,float l){vec3 c=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.);return l+s*(c-.5)*(1.-abs(2.*l-1.));}

void main(){
  // Setup coordinates - FULL SCREEN with zoom control
  vec2 uvc=uv-.5;
  float asp=res.x/res.y;
  vec2 u=uvc*vec2(asp,1.)*(0.8+zm*1.5); // Reduced base scale for bigger visuals

  // === SPACEBAR EFFECTS: Apply BEFORE shader rendering ===
  float fxI=fxIntensity;

  // SHOCKWAVE - radial distortion ripple
  if(fxShockwave>0.01){
    float rr=length(u);
    float wave=fxShockwave*1.5; // Current wave radius
    float dist=abs(rr-wave);
    float strength=smoothstep(0.3,0.,dist)*fxI*0.3;
    u+=normalize(u+0.001)*strength*sin(dist*30.-t*20.);
  }

  // TWIST - spiral distortion from center
  if(fxTwist>0.01){
    float rr=length(u);
    float twistAmt=fxTwist*fxI*3.*(1.-smoothstep(0.,1.5,rr));
    u=rot(twistAmt/(rr+0.3))*u;
  }

  // PIXELATE - reduce resolution
  if(fxPixelate>0.05){
    float pxSize=0.02+fxPixelate*fxI*0.15;
    u=floor(u/pxSize)*pxSize+pxSize*0.5;
  }

  // Apply warp distortion
  if(warp>.01){
    float w=warp*.5;
    u+=vec2(sin(u.y*5.+t*spd),cos(u.x*5.+t*spd))*w*.3;
  }

  // Apply mirror
  if(mirr>.5){u=abs(u);}

  float r=length(u);
  float a=atan(u.y,u.x);
  vec3 c=vec3(0.);

  // ========== MODE 0: HYPERSPACE TUNNEL ==========
  if(mode==0){
    float tunnelR=.5+sp0*.8;
    float sides=3.+floor(sp1*9.);
    float colorShift=sp2;
    vec3 ro=vec3(0,0,t*spd*4.);
    vec3 rd=normalize(vec3(u*1.5,1.2-zm*.5));
    for(int i=0;i<50;i++){
      vec3 p=ro+rd*float(i)*.12;
      float pa=atan(p.y,p.x);
      float pr=length(p.xy);
      float poly=cos(PI/sides)/cos(mod(pa+p.z*.15,TAU/sides)-PI/sides);
      float d=abs(pr-poly*tunnelR)-.03;
      float g=.02/(d+.02);
      c+=pal(p.z*.04+pa/TAU+colorShift,col)*g*(1.+pump*.6+fxI*.4);
    }
    c+=pal(.5,col)*.15*exp(-r*1.5)*(1.+bass);
  }
  // ========== MODE 1: FRACTAL DIMENSION ==========
  else if(mode==1){
    float iters=3.+sp0*5.;
    float scale=2.+sp1*2.;
    float rotSpd=sp2*2.;
    vec2 z=u*2.;
    z*=rot(t*spd*rotSpd*.1);
    float v=0.;
    for(int i=0;i<8;i++){
      if(float(i)>=iters)break;
      z=abs(z)/dot(z,z)-vec2(.7+chaos*.4);
      z*=rot(t*.12+float(i)*.5);
      v+=exp(-length(z)*.8);
    }
    c=pal(v*.25+r*.08,col)*(v*.2+.1);
    c+=pal(.6,col)*exp(-r*2.)*.4*(1.+pump+fxI*.3);
  }
  // ========== MODE 2: LIQUID METAL ==========
  else if(mode==2){
    float blobSize=.6+sp0*.6;
    float turb=sp1*3.;
    float refl=sp2;
    vec2 p=u*1.2;
    float d=length(p)-blobSize;
    d-=fbm(p*2.5+t*spd,4)*turb*.2;
    d-=sin(a*5.+t*spd*2.)*.08*chaos;
    float edge=smoothstep(.03,0.,abs(d));
    float inside=smoothstep(.15,-.15,d);
    vec3 metal=mix(vec3(.7,.75,.8),pal(fbm(p*1.5+t,3)+a/TAU,col),refl);
    metal+=pow(max(0.,1.-abs(d)*8.),.5)*.6;
    c=metal*inside+pal(.5,col)*edge*2.5;
    c*=1.+pump*.4+fxI*.3;
  }
  // ========== MODE 3: ELECTRIC STORM ==========
  else if(mode==3){
    float intensity=.6+sp0;
    float branches=3.+sp1*6.;
    float lspd=.5+sp2*3.;
    for(float i=0.;i<8.;i++){
      if(i>=branches)break;
      float seed=floor(t*lspd+i*3.7);
      vec2 st=vec2(h(vec2(seed,i))-.5,1.)*.9;
      vec2 en=vec2(h(vec2(seed+1.,i))-.5,-1.)*.9;
      vec2 d=en-st;
      float l=length(d);
      d/=l;
      vec2 nn=vec2(-d.y,d.x);
      float along=dot(u-st,d)/l;
      if(along>0.&&along<1.){
        float across=dot(u-st,nn);
        float wave=sin(along*12.+t*lspd*12.)*intensity*.15;
        wave+=sin(along*20.+t*lspd*18.)*.08*chaos;
        float bolt=exp(-pow((across-wave)*12.,2.));
        c+=pal(.6+i*.1,col)*bolt*(1.+pump+fxI*.5);
        c+=vec3(.9,.95,1.)*bolt*bolt*2.5;
      }
    }
    c+=pal(.5,col)*fbm(u*2.+t,3)*.15*(1.+bass);
  }
  // ========== MODE 4: HOLOGRAPHIC GRID ==========
  else if(mode==4){
    float gridD=5.+sp0*20.;
    float glowI=.5+sp1;
    float scanSpd=1.+sp2*4.;
    float horizon=-.1-zm*.3;
    if(u.y<horizon){
      float persp=abs(horizon-u.y);
      float depth=.3/persp;
      vec2 gp=vec2(u.x*depth,depth-t*spd*2.)*gridD;
      vec2 gf=fract(gp);
      float lx=smoothstep(.03,0.,min(gf.x,1.-gf.x));
      float lz=smoothstep(.03,0.,min(gf.y,1.-gf.y));
      float grid=(lx+lz)*exp(-persp*3.)*glowI;
      c+=pal(.5+floor(gp.y)*.02,col)*grid;
      float scan=smoothstep(0.,.1,sin(floor(gp.y)*.5-t*scanSpd*5.))*.3;
      c+=pal(.4,col)*scan*exp(-persp*2.)*(1.+pump);
    }else{
      c+=pal(.5,col)*smoothstep(horizon,horizon+.5,u.y)*.1;
    }
    c+=pal(.5,col)*exp(-abs(u.y-horizon)*30.)*glowI*.5;
  }
  // ========== MODE 5: NEURAL NETWORK ==========
  else if(mode==5){
    float nodes=10.+sp0*18.;
    float conn=.4+sp1*.5;
    float pulseSpd=1.+sp2*3.;
    for(float i=0.;i<28.;i++){
      if(i>=nodes)break;
      vec2 np=vec2(h(vec2(i,0.))-.5,h(vec2(i,1.))-.5)*1.8;
      np+=vec2(sin(t*spd*.3+i),cos(t*spd*.25+i*.7))*.15*chaos;
      float nd=length(u-np);
      float pulse=.5+.5*sin(t*pulseSpd*2.+i*1.5);
      c+=pal(i/nodes,col)*.025/(nd+.015)*pulse*(1.+pump*.4+fxI*.3);
      for(float j=i+1.;j<28.;j++){
        if(j>=nodes||h(vec2(i,j))>conn)continue;
        vec2 op=vec2(h(vec2(j,0.))-.5,h(vec2(j,1.))-.5)*1.8;
        op+=vec2(sin(t*spd*.3+j),cos(t*spd*.25+j*.7))*.15*chaos;
        vec2 ld=op-np;float ll=length(ld);if(ll>1.2)continue;
        ld/=ll;
        float al=dot(u-np,ld);
        if(al>0.&&al<ll){
          float ac=abs(dot(u-np,vec2(-ld.y,ld.x)));
          float line=smoothstep(.012,0.,ac)*(1.-ll/1.2);
          float dp=fract(al/ll-t*pulseSpd);
          dp=smoothstep(.1,0.,abs(dp-.5)-.4);
          c+=pal((i+j)*.03,col)*line*.4+pal(.6,col)*line*dp*.6*(1.+bass);
        }
      }
    }
  }
  // ========== MODE 6: KALEIDOSCOPE ==========
  else if(mode==6){
    float segs=4.+sp0*12.;
    float depth=4.+sp1*5.;
    float rotSpd=.5+sp2*2.;
    for(float d=0.;d<9.;d++){
      if(d>=depth)break;
      float sc=.7+d*.35;
      vec2 p=u*sc;
      p*=rot(t*spd*rotSpd*.12*(1.+d*.2));
      float pa=atan(p.y,p.x);
      float pr=length(p);
      float seg=TAU/segs;
      pa=mod(pa+seg*.5,seg)-seg*.5;
      if(mod(floor((atan(p.y,p.x)+seg*.5)/seg),2.)==1.)pa=-pa;
      p=vec2(cos(pa),sin(pa))*pr;
      float pat=sin(p.x*6.+t*spd)*sin(p.y*6.-t*spd*.7);
      pat+=sin(pr*8.-t*spd*2.)*.5;
      pat=pat*.3+.5;
      float ring=smoothstep(.12,0.,abs(fract(pr*.4-t*spd*.2)-.5)-.3)*chaos;
      c+=pal(pat+d*.1+pr*.08,col+d*.03)*(pat*.5+ring*.5)*exp(-pr*.3)/(1.+d*.25)*(1.+pump*.4+fxI*.3);
    }
    c+=pal(.5,col)*exp(-r*2.)*.25;
  }
  // ========== MODE 7: SACRED GEOMETRY ==========
  else if(mode==7){
    float shapes=3.+sp0*5.;
    float layers=3.+sp1*4.;
    float pulseRate=1.+sp2*3.;
    u*=rot(t*spd*.1);
    for(float l=0.;l<7.;l++){
      if(l>=layers)break;
      float sc=.8+l*.25;
      vec2 p=u*sc;
      p*=rot(l*.5+t*spd*.06);
      float pa=atan(p.y,p.x);
      float pr=length(p);
      float sides=shapes+l;
      float poly=cos(PI/sides)/cos(mod(pa,TAU/sides)-PI/sides);
      float r1=smoothstep(.02,0.,abs(pr-poly*.4)-.008);
      float r2=smoothstep(.02,0.,abs(pr-poly*.6)-.008);
      float r3=smoothstep(.02,0.,abs(pr-poly*.85)-.008);
      float pulse=.5+.5*sin(t*pulseRate*3.-l*.8);
      c+=pal(l/7.,col+l*.02)*(r1+r2*.8+r3*.6)*pulse/(1.+l*.15)*(1.+pump*.5+fxI*.3);
    }
    c+=pal(.5,col)*exp(-r*2.5)*.35;
  }
  // ========== MODE 8: PULSE WAVE ==========
  else if(mode==8){
    float rings=4.+sp0*10.;
    float thick=.12+sp1*.3;
    float decay=.7+sp2*2.;
    for(float i=0.;i<14.;i++){
      if(i>=rings)break;
      float phase=t*spd*3.+i*1.0;
      float ring=sin(r*(10.+zm*15.+i*3.)-phase+chaos*sin(a*(3.+i)+t))*.5+.5;
      ring=smoothstep(thick/(1.+i*.15),0.,abs(ring-.5));
      ring*=exp(-r*decay*.6);
      c+=pal(i/rings+r*.15,col+i*.02)*ring*.7*(1.+pump*.5+fxI*.4);
    }
    float core=exp(-r*(2.-bass*1.5))*(1.+.5*sin(t*spd*TAU));
    c+=pal(.5,col)*core*.5;
    for(float b=0.;b<10.;b++){
      float ba=b/10.*TAU+t*spd*.2;
      float beam=exp(-pow(mod(a-ba+PI,TAU)-PI,2.)*40.)*exp(-r*decay*.25);
      c+=pal(b/10.,col)*beam*.2*(1.+pump);
    }
  }
  // ========== MODE 9: QUANTUM FIELD ==========
  else if(mode==9){
    float particles=20.+sp0*40.;
    float waveFreq=2.5+sp1*8.;
    float interf=.6+sp2;
    float psi=0.;
    for(float i=0.;i<4.;i++){
      vec2 k=vec2(cos(i*2.1+t*.3),sin(i*1.7+t*.25))*waveFreq;
      psi+=sin(dot(u,k)-t*spd*3.+i)/(1.+i*.4);
    }
    psi=psi*.25+.5;
    float intrf=0.;
    for(float i=0.;i<5.;i++){
      vec2 src=vec2(sin(t*.4+i*1.5),cos(t*.35+i*1.8))*.8;
      float d=length(u-src);
      intrf+=sin(d*waveFreq*1.5-t*spd*4.)*interf/(1.+d*.8);
    }
    intrf=intrf*.2+.5;
    c+=pal(psi+intrf*.3,col)*(psi*.5+intrf*.5)*(1.+pump*.4+fxI*.3);
    for(float i=0.;i<60.;i++){
      if(i>=particles)break;
      vec2 pos=vec2(h(vec2(i,0.))-.5,h(vec2(i,1.))-.5)*2.2;
      pos+=vec2(sin(t*spd*.5+i),cos(t*spd*.4+i*.8))*.2*chaos;
      float vis=step(1.-(psi+intrf*.5)*.35,h(vec2(i,floor(t*10.))));
      float pd=length(u-pos);
      c+=pal(h(vec2(i,2.)),col)*exp(-pd*pd*30.)*vis*(1.+bass);
    }
  }
  // ========== MODE 10: PLASMA REACTOR ==========
  else if(mode==10){
    float torusR=.4+sp0*.4;
    float plasmaI=.6+sp1;
    float spinSpd=.5+sp2*2.;
    vec2 p=u*1.3;
    p*=rot(t*spinSpd);
    float d=abs(length(p)-torusR)-.08;
    d-=fbm(vec2(atan(p.y,p.x)*2.5,length(p)*4.)+t*spd,3)*plasmaI*.08;
    float ring=smoothstep(.04,0.,abs(d));
    float inside=smoothstep(.08,-.03,d);
    c+=pal(fbm(p*1.5+t*.5,2)+atan(p.y,p.x)/TAU,col)*inside*.9;
    c+=pal(.6,col)*ring*2.*(1.+pump+fxI*.4);
    c+=pal(.5,col)*exp(-r*4.)*.5*plasmaI*(1.+sin(t*spd*5.)*.3)*(1.+bass);
  }
  // ========== MODE 11: GRAVITATIONAL LENS ==========
  else if(mode==11){
    float diskR=.4+sp0*.5;
    float bendStr=1.5+sp1*3.;
    float spinRate=1.+sp2*2.;
    float eventH=.1+chaos*.05;
    float lens=eventH*bendStr/(r+eventH);
    vec2 lu=u*(1.+lens);
    float lr=length(lu);
    float la=atan(lu.y,lu.x);
    if(lr>eventH*1.5&&lr<diskR+.4){
      float da=la+t*spinRate*2./lr;
      float dn=fbm(vec2(da*2.5,lr*8.+t*spd),4);
      float db=(1.-smoothstep(eventH*1.5,eventH*2.5,lr))*(1.-smoothstep(diskR,diskR+.4,lr));
      db*=.5+dn*.5;
      float doppler=.5+.5*cos(da-PI);
      c+=pal(lr*1.5+dn*.3,col)*db*(1.+doppler)*(1.+pump+fxI*.4);
      c+=vec3(1.,.8,.5)*pow(db,2.5);
    }
    c+=pal(.6,col)*exp(-pow((r-eventH*1.5)*10.,2.))*.6*(1.+bass);
    c*=1.-smoothstep(eventH,eventH*.4,r);
  }
  // ========== MODE 12: VOID TENDRILS ==========
  else if(mode==12){
    float tendrils=5.+sp0*9.;
    float tendrilL=.7+sp1*.5;
    float movement=.5+sp2*2.;
    for(float i=0.;i<14.;i++){
      if(i>=tendrils)break;
      float baseA=i/tendrils*TAU+t*movement*.1;
      vec2 pos=vec2(0.);
      for(float s=0.;s<20.;s++){
        float sT=s/20.;
        float wave=sin(sT*7.+t*movement*2.+i*1.3)*.15*tendrilL;
        wave+=sin(sT*10.+t*movement*3.+i*2.1)*.08*tendrilL*chaos;
        float ang=baseA+wave;
        pos+=vec2(cos(ang),sin(ang))*.05*tendrilL;
        float thick=(.02-.015*sT)*(1.+chaos*.3);
        float d=length(u-pos);
        float tendril=smoothstep(thick,thick*.25,d);
        c+=pal(i/tendrils+sT*.3,col)*(1.-sT*.4)*tendril*.4*(1.+pump*.3+fxI*.3);
        c+=pal(i/tendrils,col)*exp(-d*d*100.)*.25;
      }
    }
    c+=pal(.5,col)*exp(-r*3.)*.2;
  }
  // ========== MODE 13: DIMENSIONAL RIFT ==========
  else if(mode==13){
    float riftSize=.2+sp0*.4;
    float instab=.6+sp1;
    float energy=1.+sp2*2.;
    float riftY=u.y+sin(u.x*4.+t*energy)*instab*.1;
    float riftCore=smoothstep(riftSize*.4,0.,abs(riftY))*smoothstep(.9,0.,abs(u.x));
    float e1=fbm(vec2(u.x*8.,t*energy),3)*instab*.1;
    float e2=fbm(vec2(u.x*12.+5.,t*energy*1.3),3)*instab*.08;
    float top=smoothstep(.02,0.,abs(riftY-riftSize*.25-e1)-.008)*smoothstep(.8,0.,abs(u.x));
    float bot=smoothstep(.02,0.,abs(riftY+riftSize*.25+e2)-.008)*smoothstep(.8,0.,abs(u.x));
    c+=(pal(.6,col)+vec3(1.,.5,.2))*(top+bot)*(1.+pump+fxI*.5);
    if(riftCore>.1){
      vec2 vu=u*2.5;vu.y-=t*energy*2.;
      float vp=fbm(vu,4)*.5+fbm(vu*1.5-t,3)*.3;
      c+=mix(pal(vp+.3,col+.5),vec3(.05,0.,.1),1.-vp)*riftCore*(1.+bass*.5);
    }
    c+=pal(.4,col)*exp(-pow(abs(riftY)*2.5,2.))*.25*instab;
  }
  // ========== MODE 14: PARTICLE STORM ==========
  else if(mode==14){
    float count=25.+sp0*50.;
    float size=.015+sp1*.05;
    float trail=sp2;
    for(float i=0.;i<75.;i++){
      if(i>=count)break;
      float seed=h(vec2(i,0.));
      float life=fract(seed+t*spd*.3);
      vec2 vel=vec2(h(vec2(i,1.))-.5,h(vec2(i,2.))-.5)*2.5;
      vel+=vec2(sin(t+i),cos(t*.7+i))*.4*chaos;
      vec2 pos=(vec2(h(vec2(i,3.)),h(vec2(i,4.)))-.5)*2.5+vel*life;
      float d=length(u-pos);
      float p=smoothstep(size*(1.+life),0.,d)*(.5+life*.5);
      c+=pal(seed,col)*p*(1.+pump*.5+fxI*.3);
      if(trail>.1){
        for(float j=1.;j<5.;j++){
          float tl=life-j*.04;
          if(tl<0.)break;
          vec2 tp=(vec2(h(vec2(i,3.)),h(vec2(i,4.)))-.5)*2.5+vel*tl;
          float td=length(u-tp);
          c+=pal(seed,col)*smoothstep(size*.4,0.,td)*.25*trail/(1.+j*.8);
        }
      }
    }
  }
  // ========== MODE 15: COSMIC WEB ==========
  else if(mode==15){
    float density=4.+sp0*8.;
    float thickness=.015+sp1*.04;
    float glw=sp2;
    vec2 p=u*density;
    vec2 ip=floor(p);
    float minD=10.;
    vec2 minP=vec2(0.);
    for(int yi=0;yi<3;yi++)for(int xi=0;xi<3;xi++){
      int y=yi-1;int x=xi-1;
      vec2 np=ip+vec2(float(x),float(y));
      vec2 pp=np+vec2(h(np),h(np+.5))*.8;
      pp+=vec2(sin(t*spd*.5+h(np)*10.),cos(t*spd*.4+h(np+1.)*10.))*.2*chaos;
      float d=length(p-pp);
      if(d<minD){minD=d;minP=pp;}
    }
    float cell=smoothstep(thickness*density,0.,minD);
    c+=pal(h(floor(minP)),col)*cell*(1.+pump*.5+fxI*.3);
    c+=pal(.5,col)*exp(-minD*2.)*.4*glw*(1.+bass);
    float web=smoothstep(.35,.0,minD)*smoothstep(0.,.25,minD);
    c+=pal(h(floor(minP)+.3),col)*web*.3*glw;
  }
  // ========== MODE 16: DIGITAL RAIN ==========
  else if(mode==16){
    float columns=8.+sp0*25.;
    float rainSpd=1.+sp1*4.;
    float bright=.6+sp2;
    float colW=2.5/columns;
    float colI=floor((u.x+1.25)/colW);
    float colX=mod(u.x+1.25,colW)-colW*.5;
    float drop=fract(h(vec2(colI,0.))+t*rainSpd*(h(vec2(colI,1.))*.5+.5));
    float dropY=1.2-drop*2.6;
    float d=u.y-dropY;
    if(d>0.&&d<1.){
      float fade=1.-d/1.;
      float charY=floor(d*8.);
      float charFlick=step(.65,h(vec2(colI,charY+floor(t*12.))));
      float charBright=(fade+charFlick*.4)*bright;
      float inCol=smoothstep(colW*.4,colW*.15,abs(colX));
      c+=pal(.4,col)*charBright*inCol*(1.+pump*.4+fxI*.3);
      c+=vec3(.3,1.,.5)*charBright*inCol*charFlick*.6;
    }
    c+=pal(.5,col)*exp(-abs(u.y-dropY)*8.)*.25*(1.+bass);
  }
  // ========== MODE 17: SINE WAVE FIELD ==========
  else if(mode==17){
    float waves=4.+sp0*10.;
    float amp=.15+sp1*.5;
    float freq=2.+sp2*8.;
    float v=0.;
    for(float i=0.;i<12.;i++){
      if(i>=waves)break;
      float phase=i/waves*TAU+t*spd;
      float w=sin(u.x*freq+phase)*amp/(1.+i*.25);
      w+=sin(u.x*freq*1.3+phase*1.3)*amp*.35*chaos/(1.+i*.25);
      float d=abs(u.y-w);
      float line=smoothstep(.025,0.,d);
      v+=line/(1.+i*.15);
      c+=pal(i/waves+u.x*.08,col)*line*.6*(1.+pump*.4+fxI*.3);
    }
    c+=pal(.5,col)*v*.15*exp(-r*.8);
  }
  // ========== MODE 18: NEON RINGS ==========
  else if(mode==18){
    float numRings=4.+sp0*8.;
    float width=.025+sp1*.07;
    float pulse=1.+sp2*3.;
    for(float i=0.;i<12.;i++){
      if(i>=numRings)break;
      float ringR=.12+i*.12;
      float d=abs(r-ringR);
      float p=.5+.5*sin(t*pulse*2.+i*1.5+a*2.*chaos);
      float ring=smoothstep(width,0.,d)*p;
      c+=pal(i/numRings,col)*ring*(1.+pump*.5+fxI*.3);
      c+=pal(i/numRings+.1,col)*exp(-d*d*350.)*p*.6;
    }
    c+=pal(.5,col)*exp(-r*2.)*.25*(1.+bass);
  }
  // ========== MODE 19: CRYSTAL LATTICE ==========
  else if(mode==19){
    float scale=2.5+sp0*5.;
    float rotation=sp1*2.;
    float depth=sp2;
    vec2 p=u*scale;
    p*=rot(t*spd*rotation*.12);
    vec2 ip=floor(p);
    vec2 fp=fract(p)-.5;
    float d1=length(fp);
    float d2=min(min(abs(fp.x),abs(fp.y)),length(fp-sign(fp)*.5));
    float crystal=smoothstep(.12,.0,d1)+smoothstep(.025,.0,d2)*.6;
    float z=sin(ip.x*.5+ip.y*.7+t*spd)*depth;
    c+=pal(h(ip)+z*.2,col)*crystal*(1.+z*.5)*(1.+pump*.4+fxI*.3);
    c+=pal(.6,col)*exp(-d1*4.)*.4*(1.+bass);
  }
  // ========== MODE 20: ORGANIC FLOW ==========
  else if(mode==20){
    float flowScale=1.5+sp0*4.;
    float turbulence=sp1*2.5;
    float colorVar=sp2;
    vec2 p=u*flowScale;
    float n1=fbm(p+t*spd*.5,4);
    float n2=fbm(p*1.3-t*spd*.3+n1*turbulence,4);
    float n3=fbm(p*.4+t*spd*.2+n2*turbulence*.5,3);
    float flow=(n1+n2+n3)/3.;
    vec2 grad=vec2(
      fbm(p+vec2(.01,0.)+t*spd*.5,3)-fbm(p-vec2(.01,0.)+t*spd*.5,3),
      fbm(p+vec2(0.,.01)+t*spd*.5,3)-fbm(p-vec2(0.,.01)+t*spd*.5,3)
    )*40.;
    float edge=length(grad);
    c+=pal(flow+colorVar*n3,col)*(flow*.7+.35)*(1.+pump*.4+fxI*.3);
    c+=pal(.5,col)*edge*.35*(1.+bass);
  }
  // ========== MODE 21: STARFIELD ==========
  else if(mode==21){
    float density=60.+sp0*180.;
    float speed=.5+sp1*2.;
    float twinkle=sp2;
    for(float i=0.;i<240.;i++){
      if(i>=density)break;
      float z=fract(h(vec2(i,0.))+t*speed*h(vec2(i,1.)));
      vec2 pos=vec2(h(vec2(i,2.))-.5,h(vec2(i,3.))-.5)*2.5/(.08+z);
      float sz=(.012+h(vec2(i,4.))*.025)/(1.+z*4.);
      float d=length(u-pos);
      float tw=1.+sin(t*10.+i*3.)*twinkle*.6;
      float star=smoothstep(sz,0.,d)*tw*(1.-z);
      c+=pal(h(vec2(i,5.)),col)*star*(1.+pump*.3+fxI*.2);
    }
    c+=pal(.5,col)*exp(-r*1.5)*.08;
  }
  // ========== MODE 22: GEOMETRIC MORPH ==========
  else if(mode==22){
    float shapes=sp0;
    float morph=sp1;
    float spin=sp2*2.;
    vec2 p=u*1.5;
    p*=rot(t*spd*spin*.2);
    float sides=3.+shapes*5.;
    float poly1=cos(PI/sides)/cos(mod(a,TAU/sides)-PI/sides);
    float nextSides=sides+1.;
    float poly2=cos(PI/nextSides)/cos(mod(a,TAU/nextSides)-PI/nextSides);
    float poly=mix(poly1,poly2,fract(t*morph+shapes));
    for(float i=0.;i<7.;i++){
      float rr=.12+i*.12;
      float d=abs(r-poly*rr);
      float ring=smoothstep(.02,0.,d);
      float p=.5+.5*sin(t*spd*2.+i*1.2);
      c+=pal(i/7.,col)*ring*p*(1.+pump*.5+fxI*.3);
    }
    c+=pal(.5,col)*exp(-r*2.)*.25*(1.+bass);
  }
  // ========== MODE 23: BIOLUMINESCENCE ==========
  else if(mode==23){
    float creatures=6.+sp0*18.;
    float pulseSpd=1.+sp1*3.;
    float trailLen=sp2;
    for(float i=0.;i<24.;i++){
      if(i>=creatures)break;
      float seed=h(vec2(i,0.));
      vec2 center=vec2(sin(t*spd*.2+i*2.3),cos(t*spd*.17+i*1.9))*.8;
      center+=vec2(sin(t+i),cos(t*.8+i))*.25*chaos;
      float d=length(u-center);
      float pulse=.5+.5*sin(t*pulseSpd*2.+i*1.7+seed*TAU);
      float glw=.12/(d+.04)*pulse;
      c+=pal(seed,col)*glw*(1.+pump*.4+fxI*.3);
      if(trailLen>.1){
        for(float j=1.;j<7.;j++){
          float tt=t-j*.12*trailLen;
          vec2 tp=vec2(sin(tt*spd*.2+i*2.3),cos(tt*spd*.17+i*1.9))*.8;
          tp+=vec2(sin(tt+i),cos(tt*.8+i))*.25*chaos;
          float td=length(u-tp);
          c+=pal(seed,col)*.04/(td+.04)*trailLen/(1.+j*.4);
        }
      }
      for(float t_=0.;t_<3.;t_++){
        float ta=seed*TAU+t_*TAU/3.+sin(t*pulseSpd+i)*.3;
        vec2 tp=center+vec2(cos(ta),sin(ta))*.1;
        float td=length(u-tp);
        c+=pal(seed+.1,col)*.025/(td+.02)*pulse;
      }
    }
  }
  // ========== MODE 24: GLITCH ==========
  else if(mode==24){
    float amount=.3+sp0*.7;
    float glitchSpd=1.+sp1*4.;
    float colorShift=sp2;
    vec2 p=u;
    float gt=floor(t*glitchSpd*10.);
    float band=floor(p.y*10.+gt*.1);
    float shift=h(vec2(band,gt))-.5;
    if(h(vec2(band,gt+1.))>1.-amount*.3) p.x+=shift*amount*.3;
    float block=h(vec2(floor(p.x*8.),band+gt));
    if(block>.9-amount*.2){
      c=pal(block+colorShift,col)*(1.+pump*.5+fxI*.4);
    }else{
      float n1=fbm(p*3.+t,3);
      c=pal(n1+p.y*.2,col)*n1*.6;
    }
    c+=pal(.5,col)*exp(-r*2.)*.2*(1.+bass);
  }
  // ========== MODE 25: PRISM ==========
  else if(mode==25){
    float spread=.2+sp0*.6;
    float prismRot=sp1*TAU;
    float bands=3.+sp2*8.;
    vec2 p=u;
    p*=rot(prismRot+t*spd*.2);
    float angle=atan(p.y,p.x);
    float seg=floor((angle+PI)/TAU*bands);
    float segAngle=seg/bands*TAU-PI+TAU/bands*.5;
    float inSeg=abs(angle-segAngle);
    vec3 prismC=pal(seg/bands,col);
    float beam=exp(-inSeg*20./spread)*(1.-r*.3);
    c+=prismC*beam*(1.+pump*.4+fxI*.3);
    c+=pal(.5,col)*exp(-r*3.)*.2*(1.+bass);
  }
  // ========== MODE 26: NEBULA ==========
  else if(mode==26){
    float density=.4+sp0*.6;
    float swirl=sp1*3.;
    float bright=.5+sp2;
    vec2 p=u*1.5;
    p+=vec2(sin(p.y*2.+t*spd),cos(p.x*2.+t*spd*.7))*swirl*.2;
    float n1=fbm(p+t*spd*.3,5)*density;
    float n2=fbm(p*1.5-t*spd*.2,4)*density;
    float n3=fbm(p*2.+t*spd*.1,3)*density;
    float nebula=(n1+n2*.7+n3*.5)/2.2;
    vec3 col1=pal(n1+.2,col);
    vec3 col2=pal(n2+.5,col+.2);
    c=mix(col1,col2,n3)*nebula*bright*(1.+pump*.4+fxI*.3);
    c+=pal(.6,col)*exp(-r*1.5)*.15*(1.+bass);
  }
  // ========== MODE 27: CIRCUIT ==========
  else if(mode==27){
    float complexity=3.+sp0*8.;
    float glowAmt=.5+sp1;
    float pulseSpd=1.+sp2*3.;
    vec2 p=u*complexity;
    vec2 ip=floor(p);
    vec2 fp=fract(p);
    float circuit=0.;
    float hv=h(ip);
    if(hv>.5){
      circuit+=smoothstep(.06,0.,abs(fp.x-.5));
    }else{
      circuit+=smoothstep(.06,0.,abs(fp.y-.5));
    }
    if(h(ip+.1)>.7) circuit+=smoothstep(.08,0.,length(fp-.5)-.1);
    float pulse=.5+.5*sin(t*pulseSpd*3.+(ip.x+ip.y)*.5);
    c+=pal(hv,col)*circuit*glowAmt*pulse*(1.+pump*.4+fxI*.3);
    c+=pal(.5,col)*exp(-r*2.)*.15*(1.+bass);
  }
  // ========== MODE 28: AURORA ==========
  else if(mode==28){
    float waveCount=2.+sp0*5.;
    float auroraSpd=.5+sp1*2.;
    float colorVar=sp2;
    float aurora=0.;
    for(float i=0.;i<6.;i++){
      if(i>=waveCount)break;
      float phase=i*.7+t*auroraSpd;
      float wave=sin(u.x*3.+phase)*(.15+i*.05);
      wave+=sin(u.x*5.+phase*1.3)*.08;
      float y=u.y-.3+i*.1;
      float band=exp(-pow((y-wave)*8.,2.));
      aurora+=band/(1.+i*.3);
      c+=pal(i/6.+colorVar+u.x*.1,col)*band*.4/(1.+i*.2)*(1.+pump*.3+fxI*.3);
    }
    c+=pal(.5,col)*aurora*.1*exp(-abs(u.y)*.5)*(1.+bass);
  }
  // ========== MODE 29: VORTEX ==========
  else if(mode==29){
    float arms=3.+sp0*6.;
    float spinRate=1.+sp1*3.;
    float depth=.5+sp2;
    float vortexA=a+t*spinRate-r*depth*3.;
    float spiral=sin(vortexA*arms)*.5+.5;
    float core=exp(-r*2.);
    float outer=smoothstep(1.,.3,r);
    c+=pal(spiral+r*.3,col)*(spiral*.6+core*.4)*outer*(1.+pump*.5+fxI*.4);
    c+=pal(.5,col)*core*.3*(1.+bass);
    for(float i=0.;i<arms;i++){
      float armA=i/arms*TAU+t*spinRate;
      float armD=abs(mod(a-armA+PI,TAU)-PI);
      c+=pal(i/arms,col)*exp(-armD*5.)*exp(-r*1.5)*.2;
    }
  }
  // ========== MODE 30: HEX ==========
  else if(mode==30){
    float scale=4.+sp0*8.;
    float glowAmt=.5+sp1;
    float pulseSpd=1.+sp2*3.;
    vec2 p=u*scale;
    vec2 hp=vec2(p.x+p.y*.577,p.y*1.1547);
    vec2 hi=floor(hp);
    vec2 hf=fract(hp);
    float hex=min(min(abs(hf.x-.5),abs(hf.y-.5)),abs(hf.x+hf.y-1.)*.5);
    float edge=smoothstep(.08,0.,hex);
    float pulse=.5+.5*sin(t*pulseSpd*2.+(hi.x+hi.y)*.3);
    c+=pal(h(hi),col)*edge*glowAmt*pulse*(1.+pump*.4+fxI*.3);
    c+=pal(.5,col)*exp(-r*2.)*.2*(1.+bass);
  }
  // ========== MODE 31: FIRE ==========
  else if(mode==31){
    float height=.5+sp0*.5;
    float fireSpd=1.+sp1*3.;
    float colorTemp=sp2;
    vec2 p=u;
    p.y+=.5;
    float fire=0.;
    for(float i=0.;i<4.;i++){
      float freq=3.+i*2.;
      float amp=height/(1.+i*.5);
      fire+=fbm(vec2(p.x*freq,p.y*2.-t*fireSpd*(1.+i*.2)),3)*amp;
    }
    fire*=smoothstep(1.,0.,p.y)*smoothstep(-.5,0.,p.y);
    vec3 fireCol=mix(vec3(1.,.3,0.),vec3(1.,.8,.2),fire);
    fireCol=mix(fireCol,pal(.1+colorTemp,col),colorTemp);
    c+=fireCol*fire*(1.+pump*.5+fxI*.4);
    c+=vec3(1.,.5,.1)*exp(-length(p-vec2(0.,-.3))*3.)*.2*(1.+bass);
  }
  // ========== MODE 32: WAVE3D ==========
  else if(mode==32){
    float freq=3.+sp0*8.;
    float amp=.2+sp1*.4;
    float waveSpd=1.+sp2*3.;
    vec2 p=u*2.;
    float wave=sin(p.x*freq+t*waveSpd)*sin(p.y*freq*.7+t*waveSpd*.8)*amp;
    wave+=sin(p.x*freq*.5-t*waveSpd*1.2)*sin(p.y*freq*.4+t*waveSpd*.6)*amp*.5;
    float surface=smoothstep(.02,0.,abs(wave-p.y*.1+.1));
    float shade=wave*.5+.5;
    c+=pal(shade+r*.1,col)*(.3+surface*.7)*(1.+pump*.4+fxI*.3);
    c+=pal(.5,col)*surface*.3*(1.+bass);
  }
  // ========== MODE 33: SPHERE ==========
  else if(mode==33){
    float size=.4+sp0*.4;
    float glowAmt=.5+sp1;
    float pulseSpd=1.+sp2*3.;
    float sphere=smoothstep(size,size-.1,r);
    float edge=smoothstep(size+.02,size-.02,r)-smoothstep(size-.02,size-.1,r);
    float pulse=.5+.5*sin(t*pulseSpd*2.);
    vec2 norm=u/max(r,.001);
    float light=max(0.,dot(norm,normalize(vec2(1.,.5))));
    c+=pal(light+a/TAU,col)*sphere*(.4+light*.6)*(1.+pump*.3);
    c+=pal(.6,col)*edge*glowAmt*2.*(1.+fxI*.4);
    c+=pal(.5,col)*exp(-r*1.5)*.2*glowAmt*pulse*(1.+bass);
  }
  // ========== MODE 34: BURST ==========
  else if(mode==34){
    float rays=8.+sp0*16.;
    float burstSpd=1.+sp1*3.;
    float decay=.5+sp2;
    float burst=0.;
    for(float i=0.;i<24.;i++){
      if(i>=rays)break;
      float rayA=i/rays*TAU+t*burstSpd*.2;
      float rayD=abs(mod(a-rayA+PI/rays,TAU/rays*2.)-PI/rays);
      float rayL=.5+.5*sin(t*burstSpd*3.+i*1.5);
      float ray=exp(-rayD*rays*.5)*exp(-r*decay*2.)*rayL;
      burst+=ray;
      c+=pal(i/rays,col)*ray*.3*(1.+pump*.3);
    }
    c+=pal(.5,col)*exp(-r*3.)*.3*(1.+burst*.2)*(1.+bass+fxI*.4);
  }
  // ========== MODE 35: MINIMAL ==========
  else if(mode==35){
    float shape=floor(sp0*4.);
    float thick=.02+sp1*.06;
    float pulseSpd=1.+sp2*3.;
    float d=0.;
    if(shape<1.){d=abs(r-.4);}
    else if(shape<2.){float sides=4.;d=abs(r-cos(PI/sides)/cos(mod(a,TAU/sides)-PI/sides)*.4);}
    else if(shape<3.){float sides=3.;d=abs(r-cos(PI/sides)/cos(mod(a,TAU/sides)-PI/sides)*.4);}
    else{float sides=6.;d=abs(r-cos(PI/sides)/cos(mod(a,TAU/sides)-PI/sides)*.4);}
    float line=smoothstep(thick,0.,d);
    float pulse=.5+.5*sin(t*pulseSpd*2.);
    c+=pal(.5+r*.2,col)*line*pulse*(1.+pump*.5+fxI*.4);
    c+=pal(.5,col)*exp(-r*3.)*.15*(1.+bass);
  }
  // ========== DEFAULT ==========
  else{
    c=pal(r+t*spd*.2,col)*(1.-r*.3);
  }

  // === POST PROCESSING ===

  // Boost with pump (beat reactivity)
  c*=1.+pump*.5+fxI*.3;

  // Glow enhancement
  c=mix(c,c*c*2.5,glow*.6);

  // Feedback trails
  if(feedback>.01){
    vec2 fbUv=uv;
    fbUv+=(vec2(camFlowX,camFlowY))*.01*feedback;
    // Add shockwave to feedback direction
    if(fxShockwave>0.01){
      vec2 dir=normalize(uvc+0.001);
      fbUv+=dir*fxShockwave*0.02;
    }
    vec3 prev=texture(prevFrame,fbUv).rgb;
    c=mix(c,max(c,prev*(.92+feedback*.07)),feedback*.85);
  }

  // Lo-fi quantization
  if(lofi>.05){
    float lvl=max(4.,64.*(1.-lofi));
    c=floor(c*lvl+.5)/lvl;
    c+=(h(uv*res+t*100.)-.5)*.05*lofi;
  }

  // Subtle vignette
  c*=1.-length(uvc)*.3;

  // Color inversion
  c=mix(c,1.-c,inv);

  // Tone mapping
  c=c/(c+.5);
  c=pow(c,vec3(.85));

  // === SPACEBAR EFFECTS: Post-process ===

  // CHROMATIC ABERRATION - RGB split
  if(fxChromatic>0.05){
    vec2 dir=normalize(uvc+0.001)*fxChromatic*fxI*0.03;
    // We need to sample the previous frame for this to work properly
    // Since we're already past the shader, add color fringing to current
    c.r*=1.+length(uvc)*fxChromatic*fxI*0.5;
    c.b*=1.-length(uvc)*fxChromatic*fxI*0.3;
    // Shift hue based on position
    float shift=fxChromatic*fxI*0.2;
    c=mix(c,c.gbr*1.2,shift*smoothstep(0.2,0.5,length(uvc)));
  }

  // STROBE - flash white
  if(fxStrobe>.3){
    c=mix(c,vec3(1.),fxStrobe*fxI);
  }

  // Shockwave glow ring
  if(fxShockwave>0.01&&fxShockwave<1.8){
    float rr=length(uvc);
    float wave=fxShockwave*0.7;
    float ring=exp(-pow((rr-wave)*15.,2.))*fxI;
    c+=vec3(1.,.9,.7)*ring*0.5;
  }

  // Twist glow at center
  if(fxTwist>0.1){
    float rr=length(uvc);
    c+=pal(t*.5+rr,col)*exp(-rr*5.)*fxTwist*fxI*0.3;
  }

  // Blackout/Whiteout
  c*=1.-blackout;
  c=mix(c,vec3(1.),whiteout);

  O=vec4(c,1.);
}`;

  // ================================================================
  //  CAMERA EFFECTS SHADER - Reactive video processing
  // ================================================================
  const CAM_VERT = `#version 300 es
in vec2 p;out vec2 uv;void main(){uv=p*.5+.5;uv.x=1.-uv.x;uv.y=1.-uv.y;gl_Position=vec4(p,0,1);}`;

  const CAM_FRAG = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 O;

uniform sampler2D camTex;      // Live camera feed
uniform sampler2D prevFrame;   // Previous frame for trails/motion
uniform float t;               // Time
uniform float motion;          // Motion detection level 0-1
uniform float mic;             // Audio reactivity
uniform int mode;              // Effect mode (0-11)
uniform vec2 res;              // Resolution
uniform float param1;          // Extra param per effect

#define PI 3.14159265
#define TAU 6.28318530

// Hash functions
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float h1(float n){return fract(sin(n*127.1)*43758.5453);}

// Noise
float n(vec2 p){
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);
}

// FBM noise
float fbm(vec2 p,int o){
  float v=0.,a=.5;
  mat2 r=mat2(.877,.479,-.479,.877);
  for(int i=0;i<6;i++){
    if(i>=o)break;
    v+=a*n(p);p=r*p*2.;a*=.5;
  }
  return v;
}

// Luminance
float luma(vec3 c){return dot(c,vec3(.299,.587,.114));}

// HSV to RGB
vec3 hsv2rgb(vec3 c){
  vec4 K=vec4(1.,2./3.,1./3.,3.);
  vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www);
  return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y);
}

// Edge detection (Sobel)
vec3 edgeDetect(vec2 uv,float str){
  vec2 px=1./res;
  float tl=luma(texture(camTex,uv+vec2(-px.x,px.y)).rgb);
  float t_=luma(texture(camTex,uv+vec2(0,px.y)).rgb);
  float tr=luma(texture(camTex,uv+vec2(px.x,px.y)).rgb);
  float l_=luma(texture(camTex,uv+vec2(-px.x,0)).rgb);
  float r_=luma(texture(camTex,uv+vec2(px.x,0)).rgb);
  float bl=luma(texture(camTex,uv+vec2(-px.x,-px.y)).rgb);
  float b_=luma(texture(camTex,uv+vec2(0,-px.y)).rgb);
  float br=luma(texture(camTex,uv+vec2(px.x,-px.y)).rgb);
  float gx=-tl-2.*l_-bl+tr+2.*r_+br;
  float gy=-tl-2.*t_-tr+bl+2.*b_+br;
  float edge=sqrt(gx*gx+gy*gy)*str;
  return vec3(edge);
}

void main(){
  vec3 cam=texture(camTex,uv).rgb;
  vec3 prev=texture(prevFrame,uv).rgb;
  float l=luma(cam);

  // Motion-based effects boost
  float react=motion+mic*.5;

  vec3 c=cam;

  // MODE 0: DIRECT - clean camera with subtle enhancements
  if(mode==0){
    c=cam;
    // Add subtle motion reactive glow
    c+=react*.15*vec3(.1,.2,.3);
  }

  // MODE 1: LO-FI - pixelated VHS glitch
  else if(mode==1){
    float px=max(4.,64.*(1.-param1));
    vec2 puv=floor(uv*px)/px;
    c=texture(camTex,puv).rgb;
    // Color depth reduction
    c=floor(c*8.+.5)/8.;
    // Scanlines
    c*=.8+.2*sin(uv.y*res.y*.5);
    // RGB offset on motion
    float off=react*.01;
    c.r=texture(camTex,puv+vec2(off,0)).r;
    c.b=texture(camTex,puv-vec2(off,0)).b;
    // Noise
    c+=(h(uv*res+t*100.)-.5)*.15;
    // Tracking glitch
    if(h(vec2(floor(uv.y*20.),t*10.))>.92){
      c=texture(camTex,puv+vec2(h(vec2(uv.y,t))*.1,0)).rgb;
    }
  }

  // MODE 2: THERMAL - heat vision colors
  else if(mode==2){
    float heat=luma(cam);
    heat=pow(heat,1.2-react*.3);
    // Thermal palette: black -> blue -> purple -> red -> yellow -> white
    vec3 thermal;
    if(heat<.2)thermal=mix(vec3(0),vec3(0,0,.5),heat/.2);
    else if(heat<.4)thermal=mix(vec3(0,0,.5),vec3(.5,0,.5),(heat-.2)/.2);
    else if(heat<.6)thermal=mix(vec3(.5,0,.5),vec3(1,0,0),(heat-.4)/.2);
    else if(heat<.8)thermal=mix(vec3(1,0,0),vec3(1,1,0),(heat-.6)/.2);
    else thermal=mix(vec3(1,1,0),vec3(1),(heat-.8)/.2);
    c=thermal;
    // Add noise for heat shimmer
    c+=vec3(fbm(uv*10.+t*2.,3)-.5)*.1*react;
  }

  // MODE 3: EDGE DETECT - neon outlines
  else if(mode==3){
    vec3 edge=edgeDetect(uv,2.+react*3.);
    float e=edge.r;
    // Colorize edges with rainbow based on angle
    vec2 px=1./res;
    float dx=luma(texture(camTex,uv+vec2(px.x,0)).rgb)-luma(texture(camTex,uv-vec2(px.x,0)).rgb);
    float dy=luma(texture(camTex,uv+vec2(0,px.y)).rgb)-luma(texture(camTex,uv-vec2(0,px.y)).rgb);
    float angle=atan(dy,dx)/TAU+.5;
    c=hsv2rgb(vec3(angle+t*.1,1.,e));
    // Add glow
    c+=hsv2rgb(vec3(angle+t*.1,.8,e*.5))*.5;
  }

  // MODE 4: MOTION PARTICLES - particles spawn and flow where motion is detected
  else if(mode==4){
    c=vec3(0);
    // Detect motion by comparing to previous frame
    vec3 diff=abs(cam-prev);
    float motionHere=length(diff);

    // Spawn particles from motion regions
    for(float i=0.;i<80.;i++){
      // Each particle has unique seed
      float seed=i*1.618;
      vec2 origin=vec2(h(vec2(seed,floor(t*2.))),h(vec2(seed+100.,floor(t*2.))));

      // Sample motion at origin to determine if particle should exist
      vec3 originDiff=abs(texture(camTex,origin).rgb-texture(prevFrame,origin).rgb);
      float originMotion=length(originDiff);

      if(originMotion>.1){
        // Particle exists - animate it flowing down/dispersing
        float age=fract(t*.3+seed*.1);
        vec2 ppos=origin;
        ppos.y+=age*.3;  // Fall down
        ppos.x+=sin(age*6.+seed)*age*.15;  // Wiggle
        ppos+=vec2(h(vec2(seed,1))-.5,h(vec2(seed,2))-.5)*age*.2;  // Disperse
        ppos=fract(ppos);

        float dist=length(uv-ppos);
        float size=.008*(1.-age*.5)+react*.005;
        float alpha=1.-age;

        if(dist<size){
          vec3 pcol=texture(camTex,origin).rgb;
          // Rainbow shift based on particle
          pcol=hsv2rgb(vec3(h(vec2(seed,3))+t*.1,.8,.9));
          c+=pcol*(1.-dist/size)*alpha*1.5;
        }
      }
    }

    // Add sparkles at high motion areas
    if(motionHere>.15){
      float spark=pow(motionHere,2.)*3.;
      c+=cam*spark;
      c+=hsv2rgb(vec3(t*.2+uv.x*.3,.7,1.))*spark*.5;
    }
  }

  // MODE 5: ASCII - text character render
  else if(mode==5){
    float charSize=8.;
    vec2 cell=floor(uv*res/charSize);
    vec2 cellUv=fract(uv*res/charSize);
    float brightness=luma(texture(camTex,cell*charSize/res+charSize*.5/res).rgb);
    // ASCII gradient: " .:-=+*#%@"
    float charIdx=floor(brightness*10.);
    // Simulate character patterns
    float pattern=0.;
    if(charIdx<1.)pattern=0.;
    else if(charIdx<2.)pattern=step(.9,cellUv.x)*step(.9,cellUv.y);
    else if(charIdx<3.)pattern=step(.8,max(abs(cellUv.x-.5),abs(cellUv.y-.5)));
    else if(charIdx<4.)pattern=step(.4,abs(cellUv.y-.5));
    else if(charIdx<5.)pattern=step(.3,max(abs(cellUv.x-.5),abs(cellUv.y-.5)));
    else if(charIdx<6.)pattern=1.-step(.3,length(cellUv-.5));
    else if(charIdx<7.)pattern=step(.5,sin(cellUv.x*PI)*sin(cellUv.y*PI));
    else if(charIdx<8.)pattern=1.-step(.4,length(cellUv-.5));
    else if(charIdx<9.)pattern=1.-step(.2,min(abs(cellUv.x-.5),abs(cellUv.y-.5)));
    else pattern=1.;
    c=vec3(pattern)*(texture(camTex,cell*charSize/res+charSize*.5/res).rgb*.5+.5);
  }

  // MODE 6: LIQUID FLOW - motion creates flowing liquid/water simulation
  else if(mode==6){
    c=vec3(0);
    // Motion detection
    vec3 diff=abs(cam-prev);
    float motionHere=length(diff);

    // Sample motion field for flow direction
    vec2 flowDir=vec2(0);
    for(int dxi=0;dxi<3;dxi++){
      for(int dyi=0;dyi<3;dyi++){
        int dx=dxi-1;int dy=dyi-1;
        vec2 off=vec2(float(dx),float(dy))/res*4.;
        vec3 d=abs(texture(camTex,uv+off).rgb-texture(prevFrame,uv+off).rgb);
        flowDir+=off*length(d);
      }
    }
    flowDir=normalize(flowDir+.001)*min(length(flowDir),.1);

    // Liquid simulation - advect color along flow
    vec2 advectUv=uv-flowDir*2.;
    vec3 advected=texture(prevFrame,advectUv).rgb;

    // Blend with camera where motion is
    float blend=smoothstep(.05,.2,motionHere);
    c=mix(advected*.95,cam,blend);  // Decay + add new

    // Add liquid surface highlights
    float surface=fbm(uv*15.+t*.5+flowDir*20.,3);
    float highlight=smoothstep(.5,.6,surface)*motionHere*2.;
    c+=vec3(.3,.5,.9)*highlight;

    // Ripple rings from high motion
    if(motionHere>.2){
      float ripple=sin(length(uv-.5)*60.-t*8.+motionHere*20.)*.5+.5;
      c+=hsv2rgb(vec3(.55+motionHere*.2,.6,.8))*ripple*motionHere*.5;
    }

    // Caustic-like patterns
    float caustic=abs(sin(uv.x*30.+t+surface*5.)*sin(uv.y*30.+t*1.2+surface*5.));
    c+=vec3(.2,.4,.6)*caustic*motionHere*.3;
  }

  // MODE 7: LAVA LAMP - motion creates rising/falling blobs like a lava lamp
  else if(mode==7){
    c=vec3(0);
    vec3 diff=abs(cam-prev);
    float motionHere=length(diff);

    // Create multiple lava blobs that react to motion
    for(float i=0.;i<12.;i++){
      float seed=i*2.718;
      // Blob center - slowly drifts and reacts to motion
      vec2 blobCenter=vec2(
        .2+.6*h(vec2(seed,0))+sin(t*.2+seed)*.15,
        mod(t*.08+seed*.3+h(vec2(seed,1))*.5,1.2)-.1  // Rise up
      );

      // Check motion near blob to affect it
      vec3 blobMotion=abs(texture(camTex,blobCenter).rgb-texture(prevFrame,blobCenter).rgb);
      float blobReact=length(blobMotion);

      // Blob size varies with motion
      float blobSize=.08+.06*sin(t*.5+seed)+blobReact*.15;

      // Metaball distance
      float d=length(uv-blobCenter);
      float blob=smoothstep(blobSize,blobSize*.3,d);

      // Organic wobble
      float wobble=fbm(uv*8.+t*.3+vec2(seed),2)*.15;
      blob*=1.+wobble;

      // Color gradient for lava
      vec3 blobCol=mix(
        vec3(1.,.2,0),   // Orange-red
        vec3(1.,.8,.2),  // Yellow
        sin(t*.3+seed+d*10.)*.5+.5
      );
      // Motion adds cyan/purple
      blobCol=mix(blobCol,hsv2rgb(vec3(.7+blobReact,.8,.9)),blobReact*2.);

      c+=blobCol*blob*.7;
    }

    // Background glow
    c+=vec3(.1,.02,.05)*(1.-length(uv-.5));

    // Motion creates new small bubbles
    if(motionHere>.15){
      float bubble=smoothstep(.02,0.,length(fract(uv*20.+t)-vec2(.5)));
      c+=hsv2rgb(vec3(t*.1+motionHere,.9,.9))*bubble*motionHere*2.;
    }

    // Heat shimmer
    float shimmer=fbm(uv*25.+t,2);
    c+=vec3(1.,.5,.2)*shimmer*.1*react;
  }

  // MODE 8: KALEID - kaleidoscope mirror
  else if(mode==8){
    vec2 p=uv-.5;
    float a=atan(p.y,p.x);
    float r=length(p);
    float segments=6.+react*6.;
    float seg=TAU/segments;
    a=mod(a,seg);
    if(mod(floor(atan(p.y,p.x)/seg),2.)==1.)a=seg-a;
    a+=t*.3;
    vec2 kuv=vec2(cos(a),sin(a))*r+.5;
    c=texture(camTex,kuv).rgb;
    // Add glow at center
    c+=vec3(.5,.3,.8)*exp(-r*5.)*.3;
  }

  // MODE 9: DNA HELIX - motion spawns double helix particle strands that wave and disperse
  else if(mode==9){
    c=vec3(0);
    vec3 diff=abs(cam-prev);
    float motionHere=length(diff);

    // Find motion center (approximate)
    vec2 motionCenter=vec2(.5);
    float totalMotion=0.;
    for(int sx=0;sx<8;sx++){
      for(int sy=0;sy<8;sy++){
        vec2 sampleUv=vec2(float(sx)+.5,float(sy)+.5)/8.;
        vec3 sd=abs(texture(camTex,sampleUv).rgb-texture(prevFrame,sampleUv).rgb);
        float sm=length(sd);
        motionCenter+=sampleUv*sm;
        totalMotion+=sm;
      }
    }
    if(totalMotion>.1)motionCenter/=totalMotion;

    // DNA double helix parameters
    float helixPhase=t*2.;
    float helixRadius=.08+totalMotion*.1;
    float helixPitch=.15;

    // Draw DNA strands
    for(float i=0.;i<60.;i++){
      float pos=i/60.;  // 0-1 along helix
      float y=motionCenter.y+(pos-.5)*.8;  // Vertical position

      // Two strands of the helix (180° apart)
      for(float strand=0.;strand<2.;strand++){
        float phase=helixPhase+pos*TAU*3.+strand*PI;
        float x=motionCenter.x+cos(phase)*helixRadius;

        // Z-depth for 3D effect
        float z=sin(phase);

        vec2 particlePos=vec2(x,y);
        float dist=length(uv-particlePos);
        float size=.006+.003*z;  // Smaller when "behind"

        if(dist<size){
          // Color based on strand and depth
          vec3 strandCol=strand<.5?
            hsv2rgb(vec3(.55+pos*.1,.8,.9)):  // Cyan strand
            hsv2rgb(vec3(.85+pos*.1,.8,.9));  // Magenta strand
          // Fade with depth
          float depthFade=.5+.5*z;
          c+=strandCol*(1.-dist/size)*depthFade;
        }
      }

      // Cross-links (base pairs)
      if(mod(i,5.)<1.){
        float phase1=helixPhase+pos*TAU*3.;
        float phase2=phase1+PI;
        vec2 p1=vec2(motionCenter.x+cos(phase1)*helixRadius,motionCenter.y+(pos-.5)*.8);
        vec2 p2=vec2(motionCenter.x+cos(phase2)*helixRadius,motionCenter.y+(pos-.5)*.8);

        // Line between p1 and p2
        vec2 lineDir=normalize(p2-p1);
        float lineDist=abs(dot(uv-p1,vec2(-lineDir.y,lineDir.x)));
        float linePos=dot(uv-p1,lineDir);
        float lineLen=length(p2-p1);

        if(lineDist<.003&&linePos>0.&&linePos<lineLen){
          c+=vec3(.3,.8,.3)*.5;  // Green base pairs
        }
      }
    }

    // Motion spawns dispersing particles from helix
    if(motionHere>.1){
      for(float p=0.;p<20.;p++){
        float seed=p+floor(t*3.);
        float age=fract(t*.5+h(vec2(seed,0))*.5);
        vec2 spawnPos=motionCenter+vec2(h(vec2(seed,1))-.5,h(vec2(seed,2))-.5)*.1;
        vec2 velocity=vec2(h(vec2(seed,3))-.5,h(vec2(seed,4))-.5);
        vec2 particlePos=spawnPos+velocity*age*.3;

        float dist=length(uv-particlePos);
        float size=.004*(1.-age);

        if(dist<size){
          c+=hsv2rgb(vec3(h(vec2(seed,5))+t*.1,.7,.9))*(1.-age)*(1.-dist/size);
        }
      }
    }
  }

  // MODE 10: DATAMOSH - glitchy compression artifacts
  else if(mode==10){
    // I-frame / P-frame simulation
    float blockSize=16.;
    vec2 block=floor(uv*res/blockSize);
    float blockHash=h(block+floor(t*2.));

    vec2 sampleUv=uv;
    if(blockHash>.7-react*.3){
      // Use previous frame for this block (P-frame)
      vec2 mv=vec2(h(block+t)-.5,h(block.yx+t)-.5)*react*.1;
      sampleUv+=mv;
      c=texture(prevFrame,sampleUv).rgb;
    }else{
      c=cam;
    }

    // Macro blocking
    if(h(block+t*5.)>.95){
      c=texture(camTex,block*blockSize/res+blockSize*.5/res).rgb;
    }

    // Color channel corruption
    if(h(vec2(block.y,t))>.9){
      c.rb=c.br;
    }
  }

  // MODE 11: SILHOUETTE - body outline only
  else if(mode==11){
    vec3 edge=edgeDetect(uv,3.+react*2.);
    float e=edge.r;
    // Threshold for silhouette
    float thresh=.3-react*.15;
    float sil=smoothstep(thresh,thresh+.1,e);
    // Gradient background
    vec3 bg=mix(vec3(.05,0,.1),vec3(0,.05,.15),uv.y+sin(t*.5)*.2);
    bg+=vec3(.1,.05,.15)*sin(uv.x*5.+t)*.3;
    // Silhouette color
    vec3 silCol=hsv2rgb(vec3(t*.05+motion*.2,.8,.9));
    c=mix(bg,silCol,sil);
    // Add glow
    c+=silCol*e*.5;
  }

  O=vec4(c,1.);
}`;

  // ================================================================
  //  WebGL Setup
  // ================================================================
  // Fallback simple shader for when main shader fails to compile
  const FRAG_SIMPLE = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 O;
uniform float t;
uniform vec2 res;
void main() {
  vec2 u = (uv - 0.5) * vec2(res.x/res.y, 1.0);
  float r = length(u);
  float a = atan(u.y, u.x);
  vec3 c = vec3(0.5 + 0.5 * sin(r * 10.0 - t * 2.0 + a * 3.0),
                0.5 + 0.5 * sin(r * 8.0 - t * 1.5 + a * 5.0),
                0.5 + 0.5 * sin(r * 12.0 - t * 3.0 + a * 2.0));
  c *= 1.0 - r * 0.5;
  O = vec4(c, 1.0);
}`;

  function initShaders() {
    if (!shaderCanvas) { console.error('SynthVision: shaderCanvas not available'); return; }
    gl = shaderCanvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) { console.error('SynthVision: WebGL2 not available'); return; }
    console.log('SynthVision: Main shader init started, canvas:', shaderCanvas.width, 'x', shaderCanvas.height);

    const vs = compileShader(gl, VERT, gl.VERTEX_SHADER);
    let fs = compileShader(gl, FRAG, gl.FRAGMENT_SHADER);

    // If main shader fails, try fallback simple shader
    if (!fs) {
      console.warn('SynthVision: Main shader failed, trying fallback simple shader...');
      fs = compileShader(gl, FRAG_SIMPLE, gl.FRAGMENT_SHADER);
    }

    if (!vs || !fs) {
      console.error('SynthVision: Both main and fallback shaders failed to compile');
      return;
    }

    shaderProgram = gl.createProgram()!;
    gl.attachShader(shaderProgram, vs);
    gl.attachShader(shaderProgram, fs);
    gl.linkProgram(shaderProgram);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
      const linkError = gl.getProgramInfoLog(shaderProgram);
      console.error('SynthVision link error:', linkError || '(empty - check shader logs above)');
      // Also check individual shader logs
      console.error('Vertex shader log:', gl.getShaderInfoLog(vs));
      console.error('Fragment shader log:', gl.getShaderInfoLog(fs));
      return;
    }
    gl.useProgram(shaderProgram);
    console.log('SynthVision: Main shader linked successfully');

    // Fullscreen quad with explicit VAO for consistent state
    quadVAO = gl.createVertexArray();
    gl.bindVertexArray(quadVAO);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(shaderProgram, 'p');
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Cache uniforms (including per-shader parameter uniforms)
    const names = ['t','bp','pump','res','ms','chaos','spd','zm','col','glow','warp','mirr','feedback','lofi','mic','bass','mode','style','inv','prevFrame','blackout','whiteout','fxShockwave','fxTwist','fxChromatic','fxPixelate','fxStrobe','fxIntensity','sp0','sp1','sp2','camFlowX','camFlowY'];
    names.forEach(n => { shaderUniforms[n] = gl!.getUniformLocation(shaderProgram!, n); });

    // Debug: log which uniforms were NOT found (null)
    const missingUniforms = names.filter(n => shaderUniforms[n] === null);
    if (missingUniforms.length > 0) {
      console.warn('SynthVision: Missing uniforms:', missingUniforms);
    } else {
      console.log('SynthVision: All', names.length, 'uniforms found successfully');
    }

    // ── Compile Post-FX shader (for ISF mode) ──
    const pfxVs = compileShader(gl, POST_FX_VERT, gl.VERTEX_SHADER);
    const pfxFs = compileShader(gl, POST_FX_FRAG, gl.FRAGMENT_SHADER);
    if (pfxVs && pfxFs) {
      postFxProgram = gl.createProgram()!;
      gl.attachShader(postFxProgram, pfxVs);
      gl.attachShader(postFxProgram, pfxFs);
      // Bind same attribute location as mega-shader so we can reuse the VBO
      gl.bindAttribLocation(postFxProgram, attr, 'p');
      gl.linkProgram(postFxProgram);
      if (gl.getProgramParameter(postFxProgram, gl.LINK_STATUS)) {
        const pfxNames = ['inputTex','res','pump','fxShockwave','fxTwist','fxChromatic','fxPixelate','fxStrobe','fxIntensity','inv','blackout','whiteout'];
        pfxNames.forEach(n => { postFxUniforms[n] = gl!.getUniformLocation(postFxProgram!, n); });
        // Create texture for ISF canvas upload
        isfTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, isfTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
        console.log('SynthVision: Post-FX shader compiled successfully');
      } else {
        console.error('SynthVision: Post-FX link error:', gl.getProgramInfoLog(postFxProgram));
        postFxProgram = null;
      }
    } else {
      console.warn('SynthVision: Post-FX shader compilation failed, ISF effects will be limited');
    }
    // Restore mega-shader as active program
    gl.useProgram(shaderProgram);
  }

  function compileShader(g: WebGL2RenderingContext, src: string, type: number): WebGLShader | null {
    const s = g.createShader(type);
    if (!s) {
      console.error('SynthVision: Failed to create shader');
      return null;
    }
    g.shaderSource(s, src);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
      const error = g.getShaderInfoLog(s);
      const shaderType = type === g.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT';
      console.error(`SynthVision ${shaderType} shader compile error:`, error);
      // Try to find the problematic line
      if (error) {
        const match = error.match(/ERROR:\s*\d+:(\d+)/);
        if (match) {
          const lineNum = parseInt(match[1]);
          const lines = src.split('\n');
          console.error('Problematic line', lineNum, ':', lines[lineNum - 1]);
          console.error('Context (lines', lineNum - 2, 'to', lineNum + 2, '):\n',
            lines.slice(Math.max(0, lineNum - 3), lineNum + 2).map((l, i) => `${lineNum - 2 + i}: ${l}`).join('\n'));
        }
      }
      g.deleteShader(s);
      return null;
    }
    // Check for warnings even if compiled
    const log = g.getShaderInfoLog(s);
    if (log && log.trim()) {
      console.warn('SynthVision shader warning:', log);
    }
    return s;
  }

  function makeFBO(g: WebGL2RenderingContext, w: number, h: number) {
    const tex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, tex);
    // Initialize texture with black pixels instead of null to avoid undefined data issues
    // (uninitialized textures can contain garbage/white data depending on GPU driver)
    const blackData = new Uint8Array(w * h * 4); // All zeros = black
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, blackData);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    const fb = g.createFramebuffer()!;
    g.bindFramebuffer(g.FRAMEBUFFER, fb);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    return { fb, tex };
  }

  function ensureFBO() {
    if (!gl || !shaderCanvas) return;
    const w = shaderCanvas.width, h = shaderCanvas.height;
    if (w === fboW && h === fboH) return;
    fboW = w; fboH = h;
    fboA = makeFBO(gl, w, h);
    fboB = makeFBO(gl, w, h);
  }

  // ================================================================
  //  Camera Effects WebGL Init
  // ================================================================
  function initCamShaders() {
    if (!camCanvas) { console.error('SynthVision: camCanvas not available'); return; }
    camGl = camCanvas.getContext('webgl2', { antialias: false, alpha: true });
    if (!camGl) { console.error('SynthVision: Camera WebGL2 not available'); return; }
    console.log('SynthVision: Camera shader init started, canvas:', camCanvas.width, 'x', camCanvas.height);

    const vs = compileShader(camGl, CAM_VERT, camGl.VERTEX_SHADER);
    const fs = compileShader(camGl, CAM_FRAG, camGl.FRAGMENT_SHADER);
    if (!vs || !fs) return;

    camShader = camGl.createProgram()!;
    camGl.attachShader(camShader, vs);
    camGl.attachShader(camShader, fs);
    camGl.linkProgram(camShader);
    if (!camGl.getProgramParameter(camShader, camGl.LINK_STATUS)) {
      console.error('SynthVision cam shader link:', camGl.getProgramInfoLog(camShader));
      return;
    }
    camGl.useProgram(camShader);
    console.log('SynthVision: Camera shader linked successfully');

    // Fullscreen quad
    const buf = camGl.createBuffer();
    camGl.bindBuffer(camGl.ARRAY_BUFFER, buf);
    camGl.bufferData(camGl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), camGl.STATIC_DRAW);
    const attr = camGl.getAttribLocation(camShader, 'p');
    camGl.enableVertexAttribArray(attr);
    camGl.vertexAttribPointer(attr, 2, camGl.FLOAT, false, 0, 0);

    // Cache uniforms
    const names = ['camTex', 'prevFrame', 't', 'motion', 'mic', 'mode', 'res', 'param1'];
    names.forEach(n => { camUniforms[n] = camGl!.getUniformLocation(camShader!, n); });

    // Create video texture
    camVideoTexture = camGl.createTexture()!;
    camGl.bindTexture(camGl.TEXTURE_2D, camVideoTexture);
    camGl.texParameteri(camGl.TEXTURE_2D, camGl.TEXTURE_MIN_FILTER, camGl.LINEAR);
    camGl.texParameteri(camGl.TEXTURE_2D, camGl.TEXTURE_MAG_FILTER, camGl.LINEAR);
    camGl.texParameteri(camGl.TEXTURE_2D, camGl.TEXTURE_WRAP_S, camGl.CLAMP_TO_EDGE);
    camGl.texParameteri(camGl.TEXTURE_2D, camGl.TEXTURE_WRAP_T, camGl.CLAMP_TO_EDGE);

    // Create previous frame texture
    camPrevTexture = camGl.createTexture()!;
    camGl.bindTexture(camGl.TEXTURE_2D, camPrevTexture);
    camGl.texParameteri(camGl.TEXTURE_2D, camGl.TEXTURE_MIN_FILTER, camGl.LINEAR);
    camGl.texParameteri(camGl.TEXTURE_2D, camGl.TEXTURE_MAG_FILTER, camGl.LINEAR);
    camGl.texParameteri(camGl.TEXTURE_2D, camGl.TEXTURE_WRAP_S, camGl.CLAMP_TO_EDGE);
    camGl.texParameteri(camGl.TEXTURE_2D, camGl.TEXTURE_WRAP_T, camGl.CLAMP_TO_EDGE);

    // Create FBOs for ping-pong (trails, feedback)
    camFboA = makeFBO(camGl, camCanvas.width, camCanvas.height);
    camFboB = makeFBO(camGl, camCanvas.width, camCanvas.height);
  }

  // Motion detection using frame differencing - FULL CAMERA DATA EXTRACTION
  let motionCanvas: HTMLCanvasElement | null = null;
  let motionCtx: CanvasRenderingContext2D | null = null;
  let prevFrameData: Uint8ClampedArray | null = null;
  const CAM_W = 64, CAM_H = 48; // Low res for performance

  function detectMotion() {
    if (!camVideo || camVideo.readyState < 2) return;

    // Create motion canvas if needed
    if (!motionCanvas) {
      motionCanvas = document.createElement('canvas');
      motionCanvas.width = CAM_W;
      motionCanvas.height = CAM_H;
      motionCtx = motionCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!motionCtx) return;

    // Draw current frame (mirrored for natural interaction)
    motionCtx.save();
    motionCtx.scale(-1, 1);
    motionCtx.drawImage(camVideo, -CAM_W, 0, CAM_W, CAM_H);
    motionCtx.restore();

    const imgData = motionCtx.getImageData(0, 0, CAM_W, CAM_H);
    const data = imgData.data;

    // ─── EXTRACT CAMERA DATA ───────────────────────────────────────────
    let totalBrightness = 0;
    let totalMotion = 0;
    let totalEdge = 0;
    let motionPixels = 0;
    let flowSumX = 0, flowSumY = 0, flowCount = 0;

    // Sobel kernels for edge detection
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    for (let y = 1; y < CAM_H - 1; y++) {
      for (let x = 1; x < CAM_W - 1; x++) {
        const i = (y * CAM_W + x) * 4;

        // Current pixel luminance
        const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
        totalBrightness += lum;

        // Motion detection (frame difference)
        if (prevFrameData) {
          const dr = Math.abs(data[i] - prevFrameData[i]);
          const dg = Math.abs(data[i + 1] - prevFrameData[i + 1]);
          const db = Math.abs(data[i + 2] - prevFrameData[i + 2]);
          const diff = (dr + dg + db) / (255 * 3);
          totalMotion += diff;

          // Threshold for "moving" pixel (presence detection)
          if (diff > 0.05) {
            motionPixels++;

            // Simple optical flow estimation (direction of motion)
            // Check neighbors to estimate flow direction
            if (x > 1 && x < CAM_W - 2 && y > 1 && y < CAM_H - 2) {
              const leftDiff = Math.abs(data[i - 4] - prevFrameData[i]);
              const rightDiff = Math.abs(data[i + 4] - prevFrameData[i]);
              const topDiff = Math.abs(data[i - CAM_W * 4] - prevFrameData[i]);
              const bottomDiff = Math.abs(data[i + CAM_W * 4] - prevFrameData[i]);

              flowSumX += (rightDiff - leftDiff) / 255;
              flowSumY += (bottomDiff - topDiff) / 255;
              flowCount++;
            }
          }
        }

        // Edge detection using Sobel filter
        let gx = 0, gy = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const ni = ((y + ky) * CAM_W + (x + kx)) * 4;
            const nlum = (data[ni] * 0.299 + data[ni + 1] * 0.587 + data[ni + 2] * 0.114) / 255;
            const ki = (ky + 1) * 3 + (kx + 1);
            gx += nlum * sobelX[ki];
            gy += nlum * sobelY[ki];
          }
        }
        const edge = Math.sqrt(gx * gx + gy * gy);
        totalEdge += edge;
      }
    }

    // Normalize all values
    const innerPixels = (CAM_W - 2) * (CAM_H - 2);
    const brightness = totalBrightness / innerPixels;
    const motion = Math.min(1, (totalMotion / innerPixels) * 8); // Scale for sensitivity
    const edge = Math.min(1, totalEdge / innerPixels / 1.414); // Max gradient ~1.414
    const presence = Math.min(1, (motionPixels / innerPixels) * 3); // Scale for sensitivity
    const flowX = flowCount > 0 ? Math.max(-1, Math.min(1, flowSumX / flowCount * 10)) : 0;
    const flowY = flowCount > 0 ? Math.max(-1, Math.min(1, flowSumY / flowCount * 10)) : 0;

    // Update store with extracted camera data
    synthVisionStore.updateCamData({
      motion,
      brightness,
      edge,
      flowX,
      flowY,
      presence
    });

    // Update local motion for camera shader uniforms
    lastMotion = motion;

    // Store current frame for next comparison
    prevFrameData = new Uint8ClampedArray(data);
  }

  // ================================================================
  //  Three.js Init
  // ================================================================
  function initThree() {
    if (!threeCanvas) return;
    renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    // ACES Filmic tone-mapping — applied by OutputPass at the very
    // end of the chain. Gives HDR-feel colour depth on what was
    // previously linear/flat MeshBasicMaterial output. Worlds that
    // push vertex colours past 1.0 in linear space now feed bloom
    // cleanly instead of clipping.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, threeCanvas.width / threeCanvas.height, 0.1, 500);
    camera.position.set(0, 0, 40);

    // ── Lighting rig ────────────────────────────────────────────
    // Soft fill + two coloured points. Most current SV worlds use
    // MeshBasicMaterial which ignores lights — these are set up so
    // Phase B's MeshStandardMaterial swaps see immediate depth.
    scene.add(new THREE.AmbientLight(0x0a0e1a, 0.4));
    keyLight = new THREE.PointLight(0xff4488, 1.2, 200, 1.5);
    keyLight.position.set(20, 25, 30);
    scene.add(keyLight);
    rimLight = new THREE.PointLight(0x44aaff, 0.9, 200, 1.5);
    rimLight.position.set(-25, -10, 20);
    scene.add(rimLight);

    // ── Post-processing chain ───────────────────────────────────
    //   RenderPass:      scene → render target
    //   UnrealBloomPass: HDR-style glow on bright pixels
    //   OutputPass:      ACES tone-map + sRGB encode + present
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(threeCanvas.width, threeCanvas.height),
      0.55,  // strength — moderate. Lifts emissive highlights without
             // washing out the whole frame. Earlier 1.4 was a "neon
             // club" overshoot that hid geometry detail.
      0.5,   // radius — soft halo extent.
      0.85,  // threshold — selective. Only HDR-pushed pixels (worlds
             // that explicitly multiplyScalar above 1.0) contribute.
             // Everything in [0..1] passes through clean so the
             // geometry detail and user param effects stay visible.
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }

  // ================================================================
  //  3D World System (10 worlds from synth-vision-v9)
  // ================================================================
  const BLEND_MAP = [THREE.AdditiveBlending, THREE.SubtractiveBlending, THREE.MultiplyBlending, THREE.NormalBlending];

  function activeLayer(): SVLayer { return state.layers[state.focus]; }
  function getBlend(): THREE.Blending { return BLEND_MAP[activeLayer().blend] || THREE.AdditiveBlending; }

  function sCol(u: number): THREE.Color {
    const c = activeLayer().p.color;
    const s = activeLayer().style;
    const col = new THREE.Color();
    switch (s) {
      case 0: col.setHSL((c + u * .1) % 1, .85, .55); break;
      case 1: { const l = .5 + c * .35 + u * .1; col.setRGB(l, l, l + .02); break; }
      case 2: col.setHSL((c + u * .03) % 1, .2, .6); break;
      case 3: col.setHSL((c + u * .06) % 1, .6, .42); break;
      case 4: { const v = .5 + .5 * Math.sin(u * 5); col.setHSL((c + v * .06) % 1, .18, .68 + v * .18); break; }
      case 5: col.setHSL((c + u * .03) % 1, .35, .12); break;
      case 6: col.setHSL((c + u * .5 + state.time * .012) % 1, .92, .58); break;
      case 7: col.setHSL(c * .07, .9, .32 + u * .18); break;
    }
    return col;
  }

  function lineMat(op: number) {
    return new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: op || .5, blending: getBlend() });
  }
  function solidMat(op: number) {
    return new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: op || .2, blending: getBlend(), side: THREE.DoubleSide });
  }
  function meshMat(op: number) {
    return new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: op || .4, blending: getBlend(), wireframe: true, side: THREE.DoubleSide });
  }
  function outlinedMeshGroup(geometry: THREE.BufferGeometry, fillOpacity = .16, outlineOpacity = .55, outlineLayers = 2) {
    const group = new THREE.Group();
    const fill = new THREE.Mesh(geometry, solidMat(fillOpacity));
    group.add(fill);
    const outlines: THREE.Mesh[] = [];
    for (let i = 0; i < outlineLayers; i++) {
      const shell = new THREE.Mesh(geometry.clone(), meshMat(outlineOpacity / (1 + i * .35)));
      shell.scale.setScalar(1.015 + i * .025);
      outlines.push(shell);
      group.add(shell);
    }
    group.userData.fill = fill;
    group.userData.outlines = outlines;
    return group;
  }

  function clearWorld() {
    worldObjects.forEach(o => {
      scene.remove(o);
      o.traverse((c: any) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach((m: any) => m.dispose());
          else c.material.dispose();
        }
      });
    });
    worldObjects.length = 0;
  }

  function addW(obj: THREE.Object3D) { scene.add(obj); worldObjects.push(obj); return obj; }

  function buildWorld(w: number) {
    if (!scene) return;
    clearWorld();
    currentWorldIdx = w;
    worldData = {};
    const T = THREE;

    switch (w) {
      case 0: { // PARTICLES
        const N = 4000;
        const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          pos[i*3] = (Math.random() - .5) * 80; pos[i*3+1] = (Math.random() - .5) * 55; pos[i*3+2] = (Math.random() - .5) * 45;
          vel[i*3] = (Math.random() - .5) * .3; vel[i*3+1] = (Math.random() - .5) * .3; vel[i*3+2] = (Math.random() - .5) * .2;
          sz[i] = .3 + Math.random();
        }
        const bg = new T.BufferGeometry();
        bg.setAttribute('position', new T.BufferAttribute(pos, 3));
        bg.setAttribute('color', new T.BufferAttribute(col, 3));
        bg.setAttribute('size', new T.BufferAttribute(sz, 1));
        const mat = new T.ShaderMaterial({
          uniforms: { uP: { value: 0 } },
          vertexShader: `attribute float size;varying vec3 vc;varying float va;uniform float uP;void main(){vc=color;vec4 mv=modelViewMatrix*vec4(position,1);float dl=length(mv.xyz);va=clamp(1.-dl/70.,.02,1.);gl_PointSize=size*(1.+uP*1.5)*(200./dl);gl_Position=projectionMatrix*mv;}`,
          fragmentShader: `varying vec3 vc;varying float va;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(vc*(1.+.2*smoothstep(.5,.0,d)),smoothstep(.5,.05,d)*va);}`,
          transparent: true, blending: getBlend(), depthWrite: false, vertexColors: true
        });
        addW(new T.Points(bg, mat));
        worldData.pos = pos; worldData.vel = vel; worldData.col = col; worldData.sz = sz; worldData.N = N;
        break;
      }
      case 1: { // CUBES — solid cores with layered wire shells
        for (let i = 0; i < 120; i++) {
          const s = 1 + Math.random() * 4;
          const g = outlinedMeshGroup(new T.BoxGeometry(s, s, s), .12, .48, 2);
          const baseX = (Math.random() - .5) * 24;
          const baseY = (Math.random() - .5) * 18;
          g.position.z = -i * 5; g.position.x = baseX; g.position.y = baseY;
          g.userData = {
            ...g.userData,
            oz: -i * 5,
            baseX,
            baseY,
            rx: (Math.random() - .5) * .5,
            ry: (Math.random() - .5) * .5,
            hu: Math.random()
          };
          addW(g);
        }
        break;
      }
      case 2: { // FRACTAL — solid bloom-friendly leaf boxes (Menger-cube variant)
        // Sierpinski tetrahedron version had a userData.depth bug
        // where all leaves shared depth=1 and got hidden by the
        // DEPTH gate — went black. Reverted to the recursive
        // box variant that ships visible.
        const fracBox = (x: number, y: number, z: number, s: number, d: number) => {
          if (d <= 0 || s < .15) {
            const g = new T.BoxGeometry(s, s, s);
            const mat = new T.MeshBasicMaterial({
              color: 0xffffff, transparent: true, opacity: .55,
              blending: getBlend(), side: T.DoubleSide,
            });
            const m = new T.Mesh(g, mat);
            m.position.set(x, y, z);
            m.userData = { hu: d * .15, rx: (Math.random() - .5) * .2, ry: (Math.random() - .5) * .2 };
            addW(m);
            return;
          }
          const ns = s / 3;
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
            const cnt = (dx === 0 ? 1 : 0) + (dy === 0 ? 1 : 0) + (dz === 0 ? 1 : 0);
            if (cnt >= 2) continue;
            fracBox(x + dx * ns, y + dy * ns, z + dz * ns, ns, d - 1);
          }
        };
        fracBox(0, 0, 0, 18, 2);
        break;
      }
      case 3: { // TERRAIN
        const gx = 80, gz = 120, sp = 1.2;
        const posArr: number[] = [];
        for (let z = 0; z < gz; z++) for (let x = 0; x < gx; x++) posArr.push((x - gx / 2) * sp, 0, (z - gz / 2) * sp);
        const bg = new T.BufferGeometry();
        const pa = new Float32Array(posArr);
        bg.setAttribute('position', new T.BufferAttribute(pa, 3));
        const idx: number[] = [];
        for (let z = 0; z < gz - 1; z++) for (let x = 0; x < gx - 1; x++) { const i = z * gx + x; idx.push(i, i + 1, i, i + gx); }
        bg.setIndex(idx);
        addW(new T.LineSegments(bg, lineMat(.25)));
        worldData.terrPos = pa; worldData.gx = gx; worldData.gz = gz; worldData.sp = sp;
        break;
      }
      case 4: { // NODES
        const N = 120;
        const nds: THREE.Mesh[] = [];
        for (let i = 0; i < N; i++) {
          const p = new T.Vector3((Math.random() - .5) * 50, (Math.random() - .5) * 35, (Math.random() - .5) * 30);
          const sg = new T.SphereGeometry(.15, 4, 3);
          const m = new T.Mesh(sg, meshMat(.5));
          m.position.copy(p);
          m.userData = { vel: new T.Vector3((Math.random() - .5) * .5, (Math.random() - .5) * .5, (Math.random() - .5) * .3), hu: Math.random() };
          addW(m);
          nds.push(m);
        }
        const eg = new T.BufferGeometry();
        const epos = new Float32Array(N * N * 6);
        eg.setAttribute('position', new T.BufferAttribute(epos, 3));
        addW(new T.LineSegments(eg, lineMat(.12)));
        worldData.nodes = nds; worldData.edgeGeo = eg; worldData.edgePos = epos; worldData.NC = N;
        break;
      }
      case 5: { // FLUID
        const N = 3000;
        const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * 20;
          pos[i*3] = Math.cos(a) * r; pos[i*3+1] = Math.sin(a) * r; pos[i*3+2] = (Math.random() - .5) * 10;
          sz[i] = .5 + Math.random() * .8;
        }
        const bg = new T.BufferGeometry();
        bg.setAttribute('position', new T.BufferAttribute(pos, 3));
        bg.setAttribute('color', new T.BufferAttribute(col, 3));
        bg.setAttribute('size', new T.BufferAttribute(sz, 1));
        const mat = new T.ShaderMaterial({
          uniforms: { uP: { value: 0 } },
          vertexShader: `attribute float size;varying vec3 vc;varying float va;uniform float uP;void main(){vc=color;vec4 mv=modelViewMatrix*vec4(position,1);float dl=length(mv.xyz);va=clamp(1.-dl/60.,.05,1.);gl_PointSize=size*(1.5+uP)*(180./dl);gl_Position=projectionMatrix*mv;}`,
          fragmentShader: `varying vec3 vc;varying float va;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;float a=smoothstep(.5,.1,d)*va;gl_FragColor=vec4(vc*(1.+.5*smoothstep(.3,.0,d)),a);}`,
          transparent: true, blending: getBlend(), depthWrite: false, vertexColors: true
        });
        addW(new T.Points(bg, mat));
        worldData.fPos = pos; worldData.fVel = vel; worldData.fCol = col; worldData.fSz = sz; worldData.fN = N;
        break;
      }
      case 6: { // CRYSTAL — faceted cores with thicker wire shells
        const s = 3, r = 4;
        for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
          if ((x + y + z) % 2 !== 0) continue;
          const m = outlinedMeshGroup(new T.IcosahedronGeometry(.38, 0), .09, .52, 2);
          m.position.set(x * s, y * s, z * s);
          m.userData = {
            ...m.userData,
            hu: ((x + r) / (r * 2) + (y + r) / (r * 2)) * .5,
            rx: .1,
            ry: .15
          };
          addW(m);
        }
        break;
      }
      case 7: { // VORTEX
        const N = 4000;
        const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          const h = i / N * 80 - 40, r = 3 + Math.random() * 15, a = Math.random() * Math.PI * 2;
          pos[i*3] = Math.cos(a) * r; pos[i*3+1] = h; pos[i*3+2] = Math.sin(a) * r;
          sz[i] = .3 + Math.random() * .6;
        }
        const bg = new T.BufferGeometry();
        bg.setAttribute('position', new T.BufferAttribute(pos, 3));
        bg.setAttribute('color', new T.BufferAttribute(col, 3));
        bg.setAttribute('size', new T.BufferAttribute(sz, 1));
        const mat = new T.ShaderMaterial({
          uniforms: { uP: { value: 0 } },
          vertexShader: `attribute float size;varying vec3 vc;varying float va;uniform float uP;void main(){vc=color;vec4 mv=modelViewMatrix*vec4(position,1);float dl=length(mv.xyz);va=clamp(1.-dl/80.,.02,1.);gl_PointSize=size*(1.+uP)*(160./dl);gl_Position=projectionMatrix*mv;}`,
          fragmentShader: `varying vec3 vc;varying float va;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(vc,smoothstep(.5,.05,d)*va);}`,
          transparent: true, blending: getBlend(), depthWrite: false, vertexColors: true
        });
        addW(new T.Points(bg, mat));
        worldData.vPos = pos; worldData.vVel = vel; worldData.vCol = col; worldData.vSz = sz; worldData.vN = N;
        break;
      }
      case 8: { // STARFIELD
        const N = 2500;
        const pos = new Float32Array(N * 6), col = new Float32Array(N * 6);
        worldData.sOrig = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
          const x = (Math.random() - .5) * 120, y = (Math.random() - .5) * 80, z = -Math.random() * 200;
          worldData.sOrig[i*3] = x; worldData.sOrig[i*3+1] = y; worldData.sOrig[i*3+2] = z;
          pos[i*6] = x; pos[i*6+1] = y; pos[i*6+2] = z;
          pos[i*6+3] = x; pos[i*6+4] = y; pos[i*6+5] = z + .5;
        }
        const bg = new T.BufferGeometry();
        bg.setAttribute('position', new T.BufferAttribute(pos, 3));
        bg.setAttribute('color', new T.BufferAttribute(col, 3));
        addW(new T.LineSegments(bg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .7, blending: getBlend() })));
        worldData.sPos = pos; worldData.sCol = col; worldData.sN = N;
        break;
      }
      case 9: { // ORGANISM
        const segs = 40, rings = 20;
        const pos = new Float32Array(segs * rings * 3);
        const bg = new T.BufferGeometry();
        bg.setAttribute('position', new T.BufferAttribute(pos, 3));
        const idx: number[] = [];
        for (let r = 0; r < rings - 1; r++) for (let s = 0; s < segs; s++) {
          const i = r * segs + s, ns = (s + 1) % segs;
          idx.push(i, r * segs + ns, i, (r + 1) * segs + s);
        }
        bg.setIndex(idx);
        addW(new T.LineSegments(bg, lineMat(.3)));
        worldData.oPos = pos; worldData.oSegs = segs; worldData.oRings = rings;
        break;
      }
      case 10: { // AURORA - northern lights ribbons
        const RIBBONS = 8, SEGS = 120;
        const pos = new Float32Array(RIBBONS * SEGS * 3);
        const col = new Float32Array(RIBBONS * SEGS * 3);
        const bg = new T.BufferGeometry();
        bg.setAttribute('position', new T.BufferAttribute(pos, 3));
        bg.setAttribute('color', new T.BufferAttribute(col, 3));
        const idx: number[] = [];
        for (let r = 0; r < RIBBONS; r++) {
          for (let s = 0; s < SEGS - 1; s++) {
            idx.push(r * SEGS + s, r * SEGS + s + 1);
          }
        }
        bg.setIndex(idx);
        addW(new T.LineSegments(bg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .6, blending: getBlend(), linewidth: 1 })));
        worldData.aPos = pos; worldData.aCol = col; worldData.aRibbons = RIBBONS; worldData.aSegs = SEGS;
        // Store random offsets per ribbon for variety
        worldData.aOffsets = Array.from({ length: RIBBONS }, () => ({
          x: (Math.random() - .5) * 60, y: Math.random() * 15 + 10, z: (Math.random() - .5) * 30,
          phase: Math.random() * Math.PI * 2, freq: .5 + Math.random() * 1.5, amp: 3 + Math.random() * 8
        }));
        break;
      }
      case 11: { // DNA - double helix
        const RUNGS = 80;
        // Two backbone strands as line strips
        const strandPos = new Float32Array(RUNGS * 2 * 3);
        const strandCol = new Float32Array(RUNGS * 2 * 3);
        const strandGeo = new T.BufferGeometry();
        strandGeo.setAttribute('position', new T.BufferAttribute(strandPos, 3));
        strandGeo.setAttribute('color', new T.BufferAttribute(strandCol, 3));
        const strandIdx: number[] = [];
        // Strand A
        for (let i = 0; i < RUNGS - 1; i++) strandIdx.push(i, i + 1);
        // Strand B
        for (let i = 0; i < RUNGS - 1; i++) strandIdx.push(RUNGS + i, RUNGS + i + 1);
        strandGeo.setIndex(strandIdx);
        addW(new T.LineSegments(strandGeo, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .6, blending: getBlend() })));
        // Rungs connecting the two strands
        const rungPos = new Float32Array(RUNGS * 6);
        const rungCol = new Float32Array(RUNGS * 6);
        const rungGeo = new T.BufferGeometry();
        rungGeo.setAttribute('position', new T.BufferAttribute(rungPos, 3));
        rungGeo.setAttribute('color', new T.BufferAttribute(rungCol, 3));
        addW(new T.LineSegments(rungGeo, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .35, blending: getBlend() })));
        worldData.dStrandPos = strandPos; worldData.dStrandCol = strandCol;
        worldData.dRungPos = rungPos; worldData.dRungCol = rungCol;
        worldData.dRungs = RUNGS;
        break;
      }
      case 12: { // SWARM - boid flocking
        const N = 2000;
        const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          pos[i*3] = (Math.random() - .5) * 60; pos[i*3+1] = (Math.random() - .5) * 40; pos[i*3+2] = (Math.random() - .5) * 30;
          const a = Math.random() * Math.PI * 2;
          vel[i*3] = Math.cos(a) * 2; vel[i*3+1] = Math.sin(a) * 2; vel[i*3+2] = (Math.random() - .5) * .5;
          sz[i] = .2 + Math.random() * .5;
        }
        const bg = new T.BufferGeometry();
        bg.setAttribute('position', new T.BufferAttribute(pos, 3));
        bg.setAttribute('color', new T.BufferAttribute(col, 3));
        bg.setAttribute('size', new T.BufferAttribute(sz, 1));
        const mat = new T.ShaderMaterial({
          uniforms: { uP: { value: 0 } },
          vertexShader: `attribute float size;varying vec3 vc;varying float va;uniform float uP;void main(){vc=color;vec4 mv=modelViewMatrix*vec4(position,1);float dl=length(mv.xyz);va=clamp(1.-dl/70.,.02,1.);gl_PointSize=size*(1.+uP)*(180./dl);gl_Position=projectionMatrix*mv;}`,
          fragmentShader: `varying vec3 vc;varying float va;void main(){float d=length(gl_PointCoord-.5);if(d>.45)discard;float tri=max(0.,1.-abs(gl_PointCoord.x-.5)*4.)*step(gl_PointCoord.y,.7);gl_FragColor=vec4(vc*(1.+tri*.3),smoothstep(.45,.05,d)*va);}`,
          transparent: true, blending: getBlend(), depthWrite: false, vertexColors: true
        });
        addW(new T.Points(bg, mat));
        worldData.swPos = pos; worldData.swVel = vel; worldData.swCol = col; worldData.swSz = sz; worldData.swN = N;
        break;
      }
      case 13: { // RINGS - nested rotating bands with wire shells
        const RING_COUNT = 12;
        for (let i = 0; i < RING_COUNT; i++) {
          const r = 4 + i * 2.5;
          const tube = .12 + i * .01;
          const tg = new T.TorusGeometry(r, tube, 10, 96);
          const m = outlinedMeshGroup(tg, .06, .42, 2);
          m.userData = {
            ...m.userData,
            ringIdx: i,
            baseR: r,
            baseTube: tube,
            hu: i / RING_COUNT,
            tiltX: (Math.random() - .5) * Math.PI * .8,
            tiltZ: (Math.random() - .5) * Math.PI * .4,
            spinDir: Math.random() > .5 ? 1 : -1
          };
          addW(m);
        }
        worldData.ringCount = RING_COUNT;
        break;
      }
    }
  }

  // Helper to get current world params with defaults
  function getWorldParams(worldIdx: number): Record<string, number> {
    const stored = state?.worldParams?.[worldIdx] ?? {};
    const def = SV_WORLD_DEFS[worldIdx];
    if (!def) return stored;
    const result: Record<string, number> = {};
    def.params.forEach(p => { result[p.k] = stored[p.k] ?? p.d; });
    return result;
  }

  function updateWorld(dt: number) {
    const t = state.time;
    const p = activeLayer().p;
    const mx = (state.mx - .5) * 50;
    const my = (.5 - state.my) * 35;
    const bpulse = Math.exp(-state.bp * 4);
    const w = activeLayer().world;
    const wp = getWorldParams(w); // World-specific params

    if (currentWorldIdx !== w) buildWorld(w);

    switch (w) {
      case 0: { // PARTICLES - wp: count, size, spread, speed, trail, gravity
        if (!worldData.pos) break;
        const N = worldData.N, pos = worldData.pos, vel = worldData.vel, col = worldData.col, sz = worldData.sz;
        const wSpeed = wp.speed * 2 + .5;  // 0.5 - 2.5
        const wSpread = wp.spread * 60 + 20;  // 20 - 80
        const wGravity = (wp.gravity - .5) * .02;  // -0.01 to 0.01
        const wTrail = 1 - wp.trail * .05;  // damping 0.95 - 1.0
        const wSize = wp.size * 1.5 + .2;  // 0.2 - 1.7
        for (let i = 0; i < N; i++) {
          const ix = i * 3;
          const dx = mx - pos[ix], dy = my - pos[ix+1], dz = -pos[ix+2];
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) + 1;
          const attr = state.mDown ? -80 : 20;
          vel[ix] += dx * attr / (dist * dist) * dt * wSpeed;
          vel[ix+1] += dy * attr / (dist * dist) * dt * wSpeed;
          vel[ix+2] += dz * attr / (dist * dist) * dt * .1;
          vel[ix] += (-pos[ix+1] * .0007 + p.warp * Math.sin(pos[ix+1] * .1 + t) * 2) * dt * 60 * wSpeed;
          vel[ix+1] += (pos[ix] * .0007 + p.warp * Math.cos(pos[ix] * .1 + t) * 2) * dt * 60 * wSpeed + wGravity;
          // Kick-triggered jitter — fires on every kick onset and
          // decays smoothly via the AR envelope. Replaces the prior
          // raw-bass amplitude trigger, which only fired on huge
          // bass spikes in smooth mode and produced jagged motion
          // in aggressive mode. kickEnv gives a clean punch + fall.
          if (state.kickEnv > .1) { vel[ix] += (Math.random() - .5) * state.kickEnv * 9 * dt; vel[ix+1] += (Math.random() - .5) * state.kickEnv * 9 * dt; }
          vel[ix] *= wTrail; vel[ix+1] *= wTrail; vel[ix+2] *= .96;
          pos[ix] += vel[ix] * dt * 60; pos[ix+1] += vel[ix+1] * dt * 60; pos[ix+2] += vel[ix+2] * dt * 60;
          if (Math.abs(pos[ix]) > wSpread) vel[ix] *= -.5;
          if (Math.abs(pos[ix+1]) > wSpread * .7) vel[ix+1] *= -.5;
          if (Math.abs(pos[ix+2]) > wSpread * .5) vel[ix+2] *= -.5;
          const c = sCol((i / N + t * .02) % 1);
          col[ix] = c.r; col[ix+1] = c.g; col[ix+2] = c.b;
          sz[i] = (.3 + Math.random() * .1) * wSize * (1 + bpulse * .15 + state.pump * .3);
        }
        const obj0 = worldObjects[0];
        if (obj0) {
          (obj0 as any).geometry.attributes.position.needsUpdate = true;
          (obj0 as any).geometry.attributes.color.needsUpdate = true;
          (obj0 as any).geometry.attributes.size.needsUpdate = true;
          if ((obj0 as any).material.uniforms) (obj0 as any).material.uniforms.uP.value = state.pump;
        }
        break;
      }
      case 1: { // CUBES - wp: count, size, spacing, rotate, explode, thick
        const wCount = wp.count;           // 0-1 visible fraction (gate)
        const wSize = wp.size * 2 + .5;    // 0.5 - 2.5 scale
        const wSpacing = wp.spacing * 1.6 + .4; // 0.4 - 2.0 z-stretch
        const wRotate = wp.rotate * 3 + .5; // 0.5 - 3.5 rotation speed
        const wExplode = wp.explode;       // 0-1 explosion scatter
        const wThick = wp.thick * 1.8 + .2;
        const spd = 8 + p.speed * 30;
        worldObjects.forEach(m => {
          if (m.userData.oz === undefined) return;
          m.position.z += spd * dt;
          // wSpacing stretches the z wrap window so the cubes spread
          // farther apart in depth (or pack tighter). Cycle length
          // scales 1.0 → 5.0 of the base 300-unit loop.
          const wrap = 300 * (0.5 + wSpacing * 0.6);
          if (m.position.z > 30) { m.position.z -= wrap; m.position.x = (Math.random() - .5) * 24; m.position.y = (Math.random() - .5) * 18; }
          // wCount filters per-cube visibility — smoothstep edge
          // so cubes fade in/out across a small band rather than
          // snapping (the prior binary gate produced the flicker
          // the user flagged). userData.hu is a stable 0-1 ID.
          const gateEdge = wCount * 1.1;
          const visible = Math.max(0, Math.min(1, (gateEdge - m.userData.hu) / 0.12 + 0.5));
          const explodeDrift = wExplode * (5 + state.kickEnv * 8);
          m.position.x = m.userData.baseX + Math.sin(t * (.6 + wRotate * .3) + m.userData.hu * 10) * explodeDrift;
          m.position.y = m.userData.baseY + Math.cos(t * (.5 + wRotate * .25) + m.userData.hu * 8) * explodeDrift * (.55 + state.midPulse * .35);
          m.rotation.x += m.userData.rx * dt * wRotate * (1 + p.chaos * 3);
          m.rotation.y += m.userData.ry * dt * wRotate * (1 + p.chaos * 3);
          const fade = Math.max(0, 1 - Math.abs(m.position.z) / 150);
          // Scale = baseline × user size × subtle audio breath ×
          // visibility gate. bpulse + state.pump give continuous
          // smooth bounce; kickEnv gives a smooth punch via the AR
          // envelope.
          const sc = wSize * (1 + state.pump * .4 + bpulse * .15 + state.kickEnv * 0.35 + wExplode * Math.sin(t * 2 + m.userData.hu * 10) * .5) * visible;
          m.scale.setScalar(sc);
          const cubeCol = sCol((m.userData.hu + state.centroidHue * .18 + t * .01) % 1);
          const fill = m.userData.fill as THREE.Mesh | undefined;
          const outlines = (m.userData.outlines as THREE.Mesh[] | undefined) ?? [];
          if (fill?.material instanceof THREE.MeshBasicMaterial) {
            fill.material.color.copy(cubeCol);
            fill.material.opacity = fade * (0.06 + visible * 0.16 + state.bass * 0.05);
          }
          outlines.forEach((shell, idx) => {
            shell.scale.setScalar(1.018 + wThick * 0.085 + idx * 0.026 + state.kickEnv * 0.02);
            if (shell.material instanceof THREE.MeshBasicMaterial) {
              shell.material.color.copy(cubeCol);
              shell.material.opacity = fade * visible * (0.16 + wThick * 0.22 + state.midPulse * 0.08) / (1 + idx * 0.35);
            }
          });
        });
        break;
      }
      case 2: { // FRACTAL - wp: depth, scale, twist, branch, glow, animate
        const wDepth = wp.depth;          // 0-1 deep-leaf reveal
        const wScale = wp.scale * 1.5 + .5;  // 0.5 - 2.0
        const wTwist = wp.twist * 2;     // 0 - 2 twist intensity
        const wBranch = wp.branch * 2.5 + .25; // 0.25 - 2.75 chaos
        const wGlow = wp.glow * .4 + .15; // 0.15 - 0.55 baseline
        const wAnimate = wp.animate * 2;  // 0 - 2 animation speed
        // Treble drives the per-leaf twist amount so the fractal's
        // small-scale flutter tracks the bright transients of the
        // music; bass drives the overall scale via wpump + bpulse.
        const trebTwist = 1 + state.trebShimmer * 1.5;
        worldObjects.forEach(m => {
          if (m.userData.hu === undefined) return;
          // wBranch chaos-multiplies per-leaf rotation rates — at
          // low values the fractal counter-rotates slowly, at high
          // values each leaf spins at its own erratic rate.
          m.rotation.x += (m.userData.rx || 0) * dt * (1 + p.chaos) * (1 + wAnimate) * trebTwist * wBranch;
          m.rotation.y += (m.userData.ry || 0) * dt * (1 + p.chaos) * (1 + wAnimate) * trebTwist * wBranch;
          m.rotation.z += wTwist * Math.sin(t * .5 + m.userData.hu * 5) * dt;
          // Smooth bass-driven breath + kick punch on the whole tree.
          const sc = wScale * (1 + state.pump * .3 + bpulse * .12 + state.bass * 0.2 + state.kickEnv * 0.3);
          m.scale.setScalar(sc);
          // Solid colour at unit intensity — bloom catches overlap
          // when colours stack. No HDR multiplier so we don't blow
          // the whole frame out into white.
          (m as any).material.color.copy(sCol(m.userData.hu + t * .01 * (1 + wAnimate)));
          // wDepth uses userData.hu (which Menger stores as
          // d * 0.15, so deeper leaves have higher hu). Drag DEPTH
          // low → only outer leaves visible; high → full density.
          // wGlow controls baseline opacity headroom.
          const depthGate = Math.max(0, 1 - (m.userData.hu - wDepth * .9));
          (m as any).material.opacity = (0.35 + wGlow * 0.7) * depthGate;
        });
        break;
      }
      case 3: { // TERRAIN - wp: height, detail, water, erosion, fog, sun
        if (!worldData.terrPos) break;
        const pos = worldData.terrPos, gx = worldData.gx, gz = worldData.gz, sp = worldData.sp;
        const wHeight = wp.height * 8 + 2;  // 2 - 10 height multiplier
        const wDetail = wp.detail * .15 + .05;  // 0.05 - 0.2 wave frequency
        const wErosion = wp.erosion;  // smoothing factor
        const wSun = wp.sun;  // color warmth
        const scroll = t * p.speed * 8;
        for (let z = 0; z < gz; z++) for (let x = 0; x < gx; x++) {
          const wx = (x - gx / 2) * sp, wz = (z - gz / 2) * sp + scroll;
          let h = 0; const ch = p.chaos * 3 + 1;
          h += Math.sin(wx * wDetail + t * .3) * 2 * ch;
          h += Math.sin(wz * wDetail * .8 + t * .2) * 3 * ch;
          h += Math.sin((wx + wz) * wDetail * 1.5 + t * .5) * 1.5;
          h *= wHeight / 5;
          // Apply erosion smoothing
          h = h * (1 - wErosion * .5) + Math.sign(h) * Math.sqrt(Math.abs(h)) * wErosion * 2;
          pos[(z * gx + x) * 3 + 1] = h;
        }
        (worldObjects[0] as any).geometry.attributes.position.needsUpdate = true;
        (worldObjects[0] as any).material.color.copy(sCol(.3 + wSun * .4));
        (worldObjects[0] as any).material.opacity = .25 + (1 - wp.fog) * .15;
        break;
      }
      case 4: { // NODES - wp: count, connect, pulse, attract, thick, glow
        if (!worldData.nodes) break;
        const nds = worldData.nodes, ep = worldData.edgePos;
        const wCount = wp.count;
        const wConnect = wp.connect * 20 + 5;  // 5 - 25 connection threshold
        const wPulse = wp.pulse;  // pulsing intensity
        const wAttract = wp.attract * .001;  // mouse attraction strength
        const wThick = wp.thick * 1.8 + .35;
        const wGlow = wp.glow * .6 + .3;  // 0.3 - 0.9 brightness
        let ec = 0; const thresh = wConnect + p.chaos * 15;
        nds.forEach((n: any) => {
          const v = n.userData.vel;
          v.x += (mx - n.position.x) * wAttract; v.y += (my - n.position.y) * wAttract;
          v.multiplyScalar(.995);
          n.position.add(v.clone().multiplyScalar(dt * 60));
          if (Math.abs(n.position.x) > 30) v.x *= -.8;
          if (Math.abs(n.position.y) > 22) v.y *= -.8;
          const visible = Math.max(0, Math.min(1, (wCount * 1.15 - n.userData.hu) / 0.12 + 0.5));
          const pulseSc = 1 + wPulse * Math.sin(t * 3 + n.userData.hu * 10) * .5;
          n.scale.setScalar((0.35 + wThick * 0.75) * pulseSc * (0.35 + visible * 0.65 + state.kickEnv * 0.15));
          n.material.color.copy(sCol(n.userData.hu));
          n.material.opacity = visible * (0.12 + wGlow * 0.55);
        });
        for (let i = 0; i < nds.length; i++) for (let j = i + 1; j < nds.length; j++) {
          if (ec >= worldData.NC * worldData.NC) break;
          if (nds[i].scale.x < 0.1 || nds[j].scale.x < 0.1) continue;
          const d = nds[i].position.distanceTo(nds[j].position);
          if (d < thresh) {
            const k = ec * 6;
            ep[k] = nds[i].position.x; ep[k+1] = nds[i].position.y; ep[k+2] = nds[i].position.z;
            ep[k+3] = nds[j].position.x; ep[k+4] = nds[j].position.y; ep[k+5] = nds[j].position.z;
            ec++;
          }
        }
        for (let i = ec * 6; i < Math.min(ec * 6 + 600, ep.length); i++) ep[i] = 0;
        worldData.edgeGeo.attributes.position.needsUpdate = true;
        worldData.edgeGeo.setDrawRange(0, ec * 2);
        if (worldObjects[1]) (worldObjects[1] as any).material.opacity = (0.08 + wThick * 0.22 + state.midPulse * 0.12) * wGlow;
        break;
      }
      case 5: { // FLUID - wp: viscosity, turbulence, density, color, flow, splash
        if (!worldData.fPos) break;
        const N = worldData.fN, pos = worldData.fPos, vel = worldData.fVel, col = worldData.fCol, sz = worldData.fSz;
        const wViscosity = 1 - wp.viscosity * .04;  // damping 0.96 - 1.0
        const wTurbulence = wp.turbulence * 6 + 2;  // 2 - 8 noise strength
        const wFlow = wp.flow * 2 + .5;  // 0.5 - 2.5 flow speed
        const wSplash = wp.splash * 15;  // splash intensity
        const wColor = wp.color;  // color shift
        const wDensity = wp.density * 1.2 + .4;  // 0.4 - 1.6 size
        const cx = mx, cy = my, vsc = p.chaos * 2 + .5;
        for (let i = 0; i < N; i++) {
          const ix = i * 3;
          const px = pos[ix], py = pos[ix+1], pz = pos[ix+2];
          const nx = Math.sin(py * .08 + t * .3 * wFlow) * wTurbulence + Math.cos(pz * .1 + t * .2 * wFlow) * (wTurbulence * .75);
          const ny = Math.sin(pz * .09 - t * .25 * wFlow) * wTurbulence + Math.cos(px * .07 + t * .35 * wFlow) * (wTurbulence * .75);
          const nz = Math.sin(px * .06 + t * .2 * wFlow) * (wTurbulence * .5);
          vel[ix] += (nx * vsc - vel[ix]) * .02; vel[ix+1] += (ny * vsc - vel[ix+1]) * .02; vel[ix+2] += (nz * vsc - vel[ix+2]) * .015;
          const dx = cx - px, dy = cy - py;
          const d = Math.sqrt(dx*dx + dy*dy) + 1;
          const f = state.mDown ? -40 : 15;
          vel[ix] += dx * f / (d * d) * dt; vel[ix+1] += dy * f / (d * d) * dt;
          vel[ix] += state.pump * (Math.random() - .5) * wSplash; vel[ix+1] += state.pump * (Math.random() - .5) * wSplash;
          vel[ix] *= wViscosity; vel[ix+1] *= wViscosity;
          pos[ix] += vel[ix] * dt * 60; pos[ix+1] += vel[ix+1] * dt * 60; pos[ix+2] += vel[ix+2] * dt * 60;
          if (pos[ix] > 40) pos[ix] -= 80; if (pos[ix] < -40) pos[ix] += 80;
          if (pos[ix+1] > 30) pos[ix+1] -= 60; if (pos[ix+1] < -30) pos[ix+1] += 60;
          const spd2 = Math.sqrt(vel[ix]*vel[ix] + vel[ix+1]*vel[ix+1]);
          const c = sCol((spd2 * .1 + i / N * .3 + wColor) % 1);
          col[ix] = c.r; col[ix+1] = c.g; col[ix+2] = c.b;
          sz[i] = (.5 + spd2 * .15) * wDensity * (1 + state.pump * .5);
        }
        const obj5 = worldObjects[0];
        if (obj5) {
          (obj5 as any).geometry.attributes.position.needsUpdate = true;
          (obj5 as any).geometry.attributes.color.needsUpdate = true;
          (obj5 as any).geometry.attributes.size.needsUpdate = true;
          if ((obj5 as any).material.uniforms) (obj5 as any).material.uniforms.uP.value = state.pump;
        }
        break;
      }
      case 6: { // CRYSTAL - wp: facets, size, thick, cluster, glow, rotate
        const wFacets = wp.facets * 8 + .5;  // 0.5 - 8.5 wobble freq
        const wSize = wp.size * 1.5 + .5;    // 0.5 - 2.0 scale
        const wThick = wp.thick * 1.8 + .25;
        // Stash original lattice positions on first use so wCluster
        // can lerp them toward/away from origin each frame without
        // them being lost across param changes.
        const wCluster = wp.cluster;         // 0-1 pull-tight factor
        const wGlow = wp.glow * .5 + .3;     // 0.3 - 0.8 brightness
        const wRotate = wp.rotate * 2;       // rotation speed
        worldObjects.forEach(m => {
          if (m.userData.hu === undefined) return;
          if (!m.userData.origPos) m.userData.origPos = m.position.clone();
          // wCluster lerps each crystal toward origin (1 = pulled in,
          // 0 = at original lattice slot). Combined with wSize this
          // gives "dispersed lattice" → "tight cluster" looks.
          m.position.copy(m.userData.origPos).multiplyScalar(1 - wCluster * 0.72 + state.bass * 0.05);
          // wFacets drives a high-frequency wobble baked onto the
          // base rotation — reads as "facet shimmer" when high,
          // smooth slow rotation when low.
          const facWobble = Math.sin(t * wFacets + m.userData.hu * 8) * 0.15;
          m.rotation.x = Math.sin(t * (.3 + wRotate) + m.position.x * .2) * p.chaos * .5 + facWobble;
          m.rotation.y = Math.sin(t * (.25 + wRotate) + m.position.y * .2) * p.chaos * .5 + facWobble;
          m.rotation.z += wRotate * dt * (.4 + state.lfoBeat * 0.25);
          // Smooth audio breath via bass_att + kick punch.
          m.scale.setScalar(wSize * (1 + state.pump * .22 + state.bass * 0.24 + state.kickEnv * 0.32 + state.trebShimmer * 0.16));
          const crystalCol = sCol((m.userData.hu + t * .005 + state.centroidHue * .18) % 1);
          const fill = m.userData.fill as THREE.Mesh | undefined;
          const outlines = (m.userData.outlines as THREE.Mesh[] | undefined) ?? [];
          if (fill?.material instanceof THREE.MeshBasicMaterial) {
            fill.material.color.copy(crystalCol);
            fill.material.opacity = 0.05 + wGlow * 0.14;
          }
          outlines.forEach((shell, idx) => {
            shell.scale.setScalar(1.018 + wThick * 0.08 + idx * 0.03 + state.trebShimmer * 0.02);
            if (shell.material instanceof THREE.MeshBasicMaterial) {
              shell.material.color.copy(crystalCol);
              shell.material.opacity = 0.14 + wThick * 0.2 + wGlow * 0.16 + state.trebShimmer * 0.08 - idx * 0.04;
            }
          });
        });
        break;
      }
      case 7: { // VORTEX - wp: arms, spin, pull, depth, particles, color
        if (!worldData.vPos) break;
        const N = worldData.vN, pos = worldData.vPos, col = worldData.vCol;
        const wSpin = wp.spin * 4 + .5;  // 0.5 - 4.5 spin speed
        const wPull = wp.pull * .5;  // 0 - 0.5 inward pull
        const wDepth = wp.depth * 20 + 5;  // 5 - 25 vertical movement
        const wColor = wp.color;  // color shift
        const rotSpd = (p.speed * 3 + .5) * wSpin;
        for (let i = 0; i < N; i++) {
          const ix = i * 3;
          const x = pos[ix], z = pos[ix+2];
          let r = Math.sqrt(x*x + z*z);
          const a = Math.atan2(z, x);
          const na = a + rotSpd * dt * (1 + (30 - r) * .01);  // faster spin near center
          r -= wPull * dt * 10;  // pull toward center
          if (r < 1) r = 25 + Math.random() * 10;  // respawn at edge
          pos[ix] = Math.cos(na) * r; pos[ix+2] = Math.sin(na) * r;
          pos[ix+1] += dt * wDepth * p.speed; if (pos[ix+1] > 40) pos[ix+1] -= 80;
          const c = sCol((r * .03 + pos[ix+1] * .01 + t * .05 + wColor) % 1);
          col[ix] = c.r; col[ix+1] = c.g; col[ix+2] = c.b;
        }
        const obj7 = worldObjects[0];
        if (obj7) {
          (obj7 as any).geometry.attributes.position.needsUpdate = true;
          (obj7 as any).geometry.attributes.color.needsUpdate = true;
          if ((obj7 as any).material.uniforms) (obj7 as any).material.uniforms.uP.value = state.pump;
        }
        break;
      }
      case 8: { // STARFIELD - wp: density, speed, size, depth, nebula, twinkle
        if (!worldData.sPos) break;
        const N = worldData.sN, pos = worldData.sPos, col = worldData.sCol, orig = worldData.sOrig;
        const wDensity = wp.density;        // 0-1 visible fraction
        const wSpeed = wp.speed * 50 + 5;   // 5 - 55 warp speed
        const wSize = wp.size * 1.8 + .4;   // 0.4 - 2.2 brightness × stretch
        const wDepth = wp.depth * 1.5 + .5; // 0.5 - 2.0 depth range
        const wNebula = wp.nebula;          // nebula coloring
        const wTwinkle = wp.twinkle;        // brightness variation
        // Subtle audio-reactive warp — bass_att gives a smooth ~15%
        // speed nudge; kickEnv adds a brief streak elongation on
        // every kick. Original prefactor (1 + 0.8*bass + 1.4*kick)
        // was over 3× — stars sped past faster than they could
        // register. Now max ~1.3× which reads as "the music is
        // pulling me forward" without losing visibility.
        const audioWarp = 1 + state.bass * 0.15 + state.kickEnv * 0.18;
        const audioStretch = 1 + state.kickEnv * 0.6;
        const warpSpd = (wSpeed + p.speed * 40) * audioWarp;
        const stretch = (p.chaos * 8 + .5) * audioStretch;
        const audioBright = 1 + state.bass * 0.15 + state.kickEnv * 0.25;
        for (let i = 0; i < N; i++) {
          const ix = i * 6;
          let z = orig[i*3+2] * wDepth; z += t * warpSpd; z = ((z % 200) + 200) % 200 - 200;
          const x = orig[i*3], y = orig[i*3+1];
          pos[ix] = x; pos[ix+1] = y; pos[ix+2] = z;
          // wSize stretches the streak length — small stars = short
          // points, large stars = long warp streaks. Multiplies the
          // base stretch + kickEnv accent.
          pos[ix+3] = x; pos[ix+4] = y; pos[ix+5] = z + (stretch + state.pump * 5) * wSize;
          // wDensity gates per-star visibility. Stable per-star hash
          // (i / N) means the same stars dim out at low density
          // rather than the field flickering.
          const visible = (i / N) < wDensity ? 1 : 0;
          // Brightness scales with wSize so larger stars also burn
          // brighter (matches the "closer / bigger = visibly more
          // luminous" intuition).
          const bright = Math.max(0, 1 + z / 200) * (1 - wTwinkle * .5 + wTwinkle * Math.sin(t * 5 + i) * .5) * audioBright * wSize * visible;
          const c = sCol((bright * .5 + i / N * .3 + wNebula * .3) % 1);
          col[ix] = c.r * bright; col[ix+1] = c.g * bright; col[ix+2] = c.b * bright;
          col[ix+3] = c.r * bright * .3; col[ix+4] = c.g * bright * .3; col[ix+5] = c.b * bright * .3;
        }
        (worldObjects[0] as any).geometry.attributes.position.needsUpdate = true;
        (worldObjects[0] as any).geometry.attributes.color.needsUpdate = true;
        break;
      }
      case 9: { // ORGANISM - wp: cells, pulse, branch, color, flow, mutate
        if (!worldData.oPos) break;
        const pos = worldData.oPos, segs = worldData.oSegs, rings = worldData.oRings;
        const wPulse = wp.pulse * 4 + 1;  // 1 - 5 pulse intensity
        const wBranch = wp.branch * 4 + 2;  // 2 - 6 wave complexity
        const wColor = wp.color;  // color shift
        const wFlow = wp.flow * 2 + .5;  // 0.5 - 2.5 flow speed
        const wMutate = wp.mutate * 5;  // mutation intensity
        for (let r = 0; r < rings; r++) {
          const rv = r / rings;
          const baseR = 5 + Math.sin(rv * Math.PI) * 12;
          const y2 = (rv - .5) * 40;
          for (let s = 0; s < segs; s++) {
            const sv = s / segs;
            const a = sv * Math.PI * 2;
            const wave = Math.sin(a * wBranch + t * p.speed * 2 * wFlow + rv * 6) * p.chaos * 3;
            const breath = Math.sin(t * p.speed * wFlow + rv * 4) * wPulse;
            const mutation = Math.sin(t * .5 + a * 2 + rv * 3) * wMutate;
            const rad = baseR + wave + breath + mutation + state.pump * 4 * Math.exp(-((rv - .5) * (rv - .5)) * 10);
            const ix = (r * segs + s) * 3;
            pos[ix] = Math.cos(a) * rad; pos[ix+1] = y2 + Math.sin(a * 2 + t * wFlow) * p.warp * 2; pos[ix+2] = Math.sin(a) * rad;
          }
        }
        (worldObjects[0] as any).geometry.attributes.position.needsUpdate = true;
        (worldObjects[0] as any).material.color.copy(sCol((.5 + wColor) % 1));
        break;
      }
      case 10: { // AURORA - wp: ribbons, height, wave, shimmer, color, spread
        if (!worldData.aPos) break;
        const pos = worldData.aPos, col = worldData.aCol;
        const RIBBONS = worldData.aRibbons, SEGS = worldData.aSegs;
        const offsets = worldData.aOffsets;
        const wRibbonCount = Math.max(1, Math.round(1 + wp.ribbons * (RIBBONS - 1)));
        const wHeight = wp.height * 20 + 5;    // 5 - 25 ribbon height
        const wWave = wp.wave * 6 + 1;         // 1 - 7 wave complexity
        const wShimmer = wp.shimmer * 3 + .5;  // 0.5 - 3.5 shimmer speed
        const wColor = wp.color;               // color shift
        const wSpread = wp.spread * 40 + 20;   // 20 - 60 horizontal spread
        for (let r = 0; r < RIBBONS; r++) {
          const off = offsets[r];
          const ribbonVisible = r < wRibbonCount ? 1 : 0;
          for (let s = 0; s < SEGS; s++) {
            const sv = s / SEGS;
            const ix = (r * SEGS + s) * 3;
            const xBase = (sv - .5) * wSpread * 2 + off.x * (wSpread / 30);
            const phase = sv * wWave * Math.PI + off.phase + t * p.speed * wShimmer;
            const y = off.y + Math.sin(phase) * off.amp * (wHeight / 10) + Math.sin(sv * 3 + t * .5) * 2;
            const z = off.z + Math.cos(phase * .7 + t * .3) * 4 + Math.sin(sv * 5 + t * wShimmer * .4) * 2;
            pos[ix] = xBase; pos[ix+1] = y + state.pump * 3 * Math.sin(sv * Math.PI); pos[ix+2] = z;
            // Aurora colors: greens, teals, purples with shimmer
            const hue = (.3 + wColor * .5 + sv * .15 + Math.sin(t * wShimmer + sv * 4) * .1 + state.centroidHue * .12) % 1;
            const bright = (.4 + Math.sin(sv * Math.PI) * .4 + Math.sin(t * wShimmer * 2 + sv * 8 + r) * .15 + state.trebShimmer * .2) * ribbonVisible;
            const c = new THREE.Color().setHSL(hue, .8, bright * (.3 + p.chaos * .2));
            col[ix] = c.r; col[ix+1] = c.g; col[ix+2] = c.b;
          }
        }
        const obj10 = worldObjects[0];
        if (obj10) {
          (obj10 as any).geometry.attributes.position.needsUpdate = true;
          (obj10 as any).geometry.attributes.color.needsUpdate = true;
          (obj10 as any).material.opacity = 0.25 + wp.ribbons * 0.35 + state.trebShimmer * 0.12;
        }
        break;
      }
      case 11: { // DNA - wp: twist, rungs, radius, speed, glow, pairs
        if (!worldData.dStrandPos) break;
        const spos = worldData.dStrandPos, scol = worldData.dStrandCol;
        const rpos = worldData.dRungPos, rcol = worldData.dRungCol;
        const RUNGS = worldData.dRungs;
        const wTwist = wp.twist * 4 + 1;       // 1 - 5 helix twist rate
        const wRungs = Math.max(2, Math.round(4 + wp.rungs * (RUNGS - 4)));
        const wRadius = wp.radius * 8 + 3;     // 3 - 11 helix radius
        const wSpeed = wp.speed * 3 + .5;      // 0.5 - 3.5 rotation speed
        const wGlow = wp.glow * .5 + .3;       // 0.3 - 0.8 brightness
        const wPairs = wp.pairs;               // base pair visibility
        const scroll = t * p.speed * wSpeed;
        for (let i = 0; i < RUNGS; i++) {
          const frac = i / RUNGS;
          const y = (frac - .5) * 60;
          const angle = frac * Math.PI * 2 * wTwist + scroll;
          const pulse = 1 + state.pump * .3 * Math.sin(frac * Math.PI * 4);
          const r = wRadius * pulse;
          // Strand A
          const ax = Math.cos(angle) * r, az = Math.sin(angle) * r;
          spos[i*3] = ax; spos[i*3+1] = y; spos[i*3+2] = az;
          // Strand B (opposite side)
          const bx = Math.cos(angle + Math.PI) * r, bz = Math.sin(angle + Math.PI) * r;
          spos[(RUNGS + i)*3] = bx; spos[(RUNGS + i)*3+1] = y; spos[(RUNGS + i)*3+2] = bz;
          // Colors
          const hue = (.5 + frac * .3 + t * .02) % 1;
          const c1 = new THREE.Color().setHSL(hue, .85, wGlow);
          const c2 = new THREE.Color().setHSL((hue + .15) % 1, .85, wGlow);
          scol[i*3] = c1.r; scol[i*3+1] = c1.g; scol[i*3+2] = c1.b;
          scol[(RUNGS + i)*3] = c2.r; scol[(RUNGS + i)*3+1] = c2.g; scol[(RUNGS + i)*3+2] = c2.b;
          // Rungs (base pairs) connecting strands
          const rungVisible = i < wRungs && (i % 3 === 0) && wPairs > .1;
          rpos[i*6] = rungVisible ? ax : 0; rpos[i*6+1] = rungVisible ? y : 0; rpos[i*6+2] = rungVisible ? az : 0;
          rpos[i*6+3] = rungVisible ? bx : 0; rpos[i*6+4] = rungVisible ? y : 0; rpos[i*6+5] = rungVisible ? bz : 0;
          const rc = new THREE.Color().setHSL((hue + .3) % 1, .6, wGlow * .7);
          rcol[i*6] = rc.r; rcol[i*6+1] = rc.g; rcol[i*6+2] = rc.b;
          rcol[i*6+3] = rc.r; rcol[i*6+4] = rc.g; rcol[i*6+5] = rc.b;
        }
        if (worldObjects[0]) {
          (worldObjects[0] as any).geometry.attributes.position.needsUpdate = true;
          (worldObjects[0] as any).geometry.attributes.color.needsUpdate = true;
        }
        if (worldObjects[1]) {
          (worldObjects[1] as any).geometry.attributes.position.needsUpdate = true;
          (worldObjects[1] as any).geometry.attributes.color.needsUpdate = true;
          (worldObjects[1] as any).material.opacity = 0.12 + wPairs * 0.4 + state.kickEnv * 0.1;
        }
        break;
      }
      case 12: { // SWARM - wp: count, cohesion, speed, scatter, trail, color
        if (!worldData.swPos) break;
        const N = worldData.swN, pos = worldData.swPos, vel = worldData.swVel, col = worldData.swCol, sz = worldData.swSz;
        const wCohesion = wp.cohesion * .003 + .001;  // 0.001 - 0.004
        const wSpeed = wp.speed * 3 + 1;              // 1 - 4 max speed
        const wScatter = wp.scatter * 15;              // scatter force
        const wTrail = 1 - wp.trail * .03;             // damping 0.97 - 1.0
        const wColor = wp.color;
        // Compute flock center
        let cx2 = 0, cy2 = 0, cz2 = 0;
        for (let i = 0; i < Math.min(N, 200); i++) { cx2 += pos[i*3]; cy2 += pos[i*3+1]; cz2 += pos[i*3+2]; }
        const sampleN = Math.min(N, 200);
        cx2 /= sampleN; cy2 /= sampleN; cz2 /= sampleN;
        // Attractor point that moves
        const atX = Math.sin(t * .3) * 20 + mx * .5;
        const atY = Math.cos(t * .25) * 15 + my * .5;
        const atZ = Math.sin(t * .2) * 10;
        for (let i = 0; i < N; i++) {
          const ix = i * 3;
          // Cohesion: steer toward flock center
          vel[ix] += (cx2 - pos[ix]) * wCohesion; vel[ix+1] += (cy2 - pos[ix+1]) * wCohesion; vel[ix+2] += (cz2 - pos[ix+2]) * wCohesion;
          // Attractor
          vel[ix] += (atX - pos[ix]) * .0005; vel[ix+1] += (atY - pos[ix+1]) * .0005; vel[ix+2] += (atZ - pos[ix+2]) * .0003;
          // Scatter on beat
          // Snare-triggered scatter — pairs better with swarm feel
          // (snares are the "step" in flock dynamics) than the prior
          // raw-bass amplitude trigger.
          if (state.snareEnv > .1) { vel[ix] += (Math.random() - .5) * wScatter * state.snareEnv * 1.2 * dt; vel[ix+1] += (Math.random() - .5) * wScatter * state.snareEnv * 1.2 * dt; }
          // Pump burst
          if (state.pump > .1) { const dx = pos[ix] - cx2, dy = pos[ix+1] - cy2; const d = Math.sqrt(dx*dx+dy*dy) + 1; vel[ix] += dx / d * state.pump * 8 * dt; vel[ix+1] += dy / d * state.pump * 8 * dt; }
          // Speed limit
          const spd2 = Math.sqrt(vel[ix]*vel[ix] + vel[ix+1]*vel[ix+1] + vel[ix+2]*vel[ix+2]);
          if (spd2 > wSpeed) { const sc = wSpeed / spd2; vel[ix] *= sc; vel[ix+1] *= sc; vel[ix+2] *= sc; }
          // Damping
          vel[ix] *= wTrail; vel[ix+1] *= wTrail; vel[ix+2] *= wTrail;
          // Move
          pos[ix] += vel[ix] * dt * 60; pos[ix+1] += vel[ix+1] * dt * 60; pos[ix+2] += vel[ix+2] * dt * 60;
          // Wrap
          if (pos[ix] > 40) pos[ix] -= 80; if (pos[ix] < -40) pos[ix] += 80;
          if (pos[ix+1] > 30) pos[ix+1] -= 60; if (pos[ix+1] < -30) pos[ix+1] += 60;
          if (pos[ix+2] > 20) pos[ix+2] -= 40; if (pos[ix+2] < -20) pos[ix+2] += 40;
          // Color based on velocity direction
          const heading = Math.atan2(vel[ix+1], vel[ix]) / (Math.PI * 2) + .5;
          const c = sCol((heading + wColor + i / N * .1) % 1);
          col[ix] = c.r; col[ix+1] = c.g; col[ix+2] = c.b;
          sz[i] = (.2 + spd2 * .1) * (1 + state.pump * .4);
        }
        const obj12 = worldObjects[0];
        if (obj12) {
          (obj12 as any).geometry.attributes.position.needsUpdate = true;
          (obj12 as any).geometry.attributes.color.needsUpdate = true;
          (obj12 as any).geometry.attributes.size.needsUpdate = true;
          if ((obj12 as any).material.uniforms) (obj12 as any).material.uniforms.uP.value = state.pump;
        }
        break;
      }
      case 13: { // RINGS - wp: count, radius, spin, tilt, gap, thick
        const wCount = wp.count;
        const wRadius = wp.radius * 1.5 + .5;   // 0.5 - 2.0 scale
        const wSpin = wp.spin * 3 + .5;          // 0.5 - 3.5 spin speed
        const wTilt = wp.tilt * 2;               // 0 - 2 tilt variation
        const wGap = wp.gap * 1.5 + .5;          // 0.5 - 2.0 gap between rings
        const wThick = wp.thick * 1.7 + .25;
        worldObjects.forEach(m => {
          if (m.userData.ringIdx === undefined) return;
          const ri = m.userData.ringIdx;
          const visible = Math.max(0, Math.min(1, (wCount * 1.15 - ri / Math.max(1, worldData.ringCount - 1)) / 0.14 + 0.5));
          const baseTiltX = m.userData.tiltX * wTilt;
          const baseTiltZ = m.userData.tiltZ * wTilt;
          m.rotation.x = baseTiltX + Math.sin(t * (.2 + ri * .05) * wSpin) * p.chaos * .3;
          m.rotation.y += m.userData.spinDir * dt * wSpin * (.5 + ri * .1) * (1 + p.speed);
          m.rotation.z = baseTiltZ + Math.cos(t * (.15 + ri * .04) * wSpin) * p.chaos * .2;
          const sc = wRadius * (wGap * (.35 + ri * .045) + .35) * (1 + state.pump * .2 * Math.sin(ri + t * 3)) * visible;
          m.scale.setScalar(sc);
          const ringCol = sCol((m.userData.hu + t * .01 + state.centroidHue * .16) % 1);
          const fill = m.userData.fill as THREE.Mesh | undefined;
          const outlines = (m.userData.outlines as THREE.Mesh[] | undefined) ?? [];
          if (fill?.material instanceof THREE.MeshBasicMaterial) {
            fill.material.color.copy(ringCol);
            fill.material.opacity = visible * (0.04 + state.bass * 0.08);
          }
          outlines.forEach((shell, idx) => {
            shell.scale.setScalar(1.015 + wThick * 0.08 + idx * 0.025 + state.kickEnv * 0.018);
            if (shell.material instanceof THREE.MeshBasicMaterial) {
              shell.material.color.copy(ringCol);
              shell.material.opacity = visible * (0.15 + wThick * 0.24 + state.pump * 0.12 + Math.sin(t * 2 + ri * .8) * .04) / (1 + idx * 0.35);
            }
          });
        });
        break;
      }
    }
  }

  // ================================================================
  //  Camera System (6 spaces)
  // ================================================================
  function updateCamera(dt: number) {
    if (!camera) return;
    const mx = (state.mx - .5) * 2, my = (state.my - .5) * 2, t = state.time;
    switch (activeLayer().space) {
      case 0: { // ORBIT
        const r = 32 + my * 10;
        camera.position.lerp(new THREE.Vector3(Math.cos(t * .15 + mx * 2) * r, my * 14 + Math.sin(t * .1) * 4, Math.sin(t * .15 + mx * 2) * r), .03);
        camera.lookAt(0, 0, 0);
        break;
      }
      case 1: { // FLY
        camera.position.z -= dt * 22 * (.5 + activeLayer().p.speed);
        camera.position.x += (mx * 28 - camera.position.x) * .02;
        camera.position.y += (-my * 18 - camera.position.y) * .02;
        if (camera.position.z < -75) camera.position.z = 75;
        camera.lookAt(camera.position.x * .5, camera.position.y * .5, camera.position.z - 45);
        break;
      }
      case 2: { // LANDSCAPE
        camera.position.set(mx * 38, 11 + my * 7, 28 + Math.sin(t * .08) * 13);
        camera.lookAt(mx * 18, -4, camera.position.z - 38);
        break;
      }
      case 3: { // TUNNEL
        const tz = t * 14 * activeLayer().p.speed;
        camera.position.set(Math.sin(tz * .03) * 7 + mx * 4, Math.cos(tz * .04) * 5 - my * 4, 38 - ((tz) % 75));
        camera.lookAt(camera.position.x * .3, camera.position.y * .3, camera.position.z - 28);
        break;
      }
      case 4: { // ZERO-G
        camera.position.x += (mx * 45 - camera.position.x) * .01;
        camera.position.y += (-my * 35 - camera.position.y) * .01;
        camera.position.z = 33 + Math.sin(t * .05) * 9;
        camera.lookAt(mx * 9, -my * 9, 0);
        break;
      }
      case 5: { // FALL
        camera.position.set(mx * 13, 46 - ((t * 18 * activeLayer().p.speed) % 95), 13 + my * 9);
        camera.lookAt(camera.position.x * .5, camera.position.y - 28, 0);
        break;
      }
    }

    // ── Audio-reactive FOV breath ────────────────────────────────
    // Cinematic "lens breath" — a 0-4° FOV expansion driven by the
    // smoothed bass follower. Reads as a perspective punch on hits
    // without touching any camera POSITION math (so all 6 space
    // trajectories above stay clean). state.bass is bass_att-derived
    // in smooth mode, so this rises fast on a kick and decays slowly.
    // Lerp toward target at ~8/s so even sharp peaks don't snap.
    const fovTarget = 55 + state.bass * 4 + state.kickEnv * 1.5;
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 8);
    camera.updateProjectionMatrix();
  }

  // ================================================================
  //  Audio — reads from the shared visual-audio bus so SynthVision's
  //  worlds move with the same Milkdrop-style smoothing as the rest of
  //  the renderer. The reactivity modes simply decide how much of that
  //  shared musical motion to expose.
  // ================================================================
  function updateAudio() {
    const audio = getVisualAudioSnapshot();

    // ── Silent / inactive — decay every audio-derived value ─────
    // Even with reactivityMode='off' we keep this branch so a paused
    // song doesn't leave the visuals frozen on a hit.
    if (!audio.isActive || state.reactivityMode === 'off') {
      synthVisionStore.update(s => ({
        ...s,
        micLevel: s.micLevel * .92,
        bass: s.bass * .92,
        kickEnv: s.kickEnv * .85,
        snareEnv: s.snareEnv * .85,
        midPulse: s.midPulse * .92,
        trebShimmer: s.trebShimmer * .92,
        // centroidHue + lfoBeat we let live so the visuals don't
        // freeze mid-cycle — they're cosmetic continuous oscillators
        // not energy levels.
      }));
      return;
    }

    // ── Map shared visual audio → local world-facing controls ─────
    let bassOut: number;
    switch (state.reactivityMode) {
      case 'smooth':     bassOut = audio.bass; break;
      case 'default':    bassOut = audio.bass; break;
      case 'aggressive': bassOut = Math.max(audio.bass, audio.bassFast * 0.9, audio.beat * 0.6); break;
      default:           bassOut = 0; break;
    }

    // Envelopes only fire in 'default' / 'aggressive'. In 'smooth'
    // mode we pin them to 0 so worlds that opted into envelope-based
    // bursts don't add accent flashes when the user wants pure
    // continuous reactivity.
    const envScale = (state.reactivityMode === 'default' || state.reactivityMode === 'aggressive') ? 1 : 0;
    const kickOut  = audio.kick * envScale;
    const snareOut = audio.snare * envScale;

    // BPM-locked LFO only in 'aggressive'. 0-1 sine at one cycle
    // per beat — drives orbital motion / breathing in worlds that
    // wire it up.
    const lfoOut = state.reactivityMode === 'aggressive'
      ? audio.lfoBeat
      : 0.5; // neutral midpoint when off — worlds can ignore the
              // signal by computing relative to 0.5.

    // Centroid hue is always on (when audio is on) — it's a slow
    // smoothed timbre signal, hard to make ugly.
    const centroidOut = audio.centroid;

    synthVisionStore.update(s => ({
      ...s,
      mic: true,
      micLevel: audio.level,
      bass: bassOut,
      kickEnv: kickOut,
      snareEnv: snareOut,
      midPulse: audio.mid,
      trebShimmer: audio.high,
      centroidHue: centroidOut,
      lfoBeat: lfoOut,
    }));
  }

  function renderGeoFrame(dt: number) {
    if (!compCtx || !outputCanvas) return;
    const ctx = compCtx;
    const w = outputCanvas.width;
    const h = outputCanvas.height;
    const t = state.time;
    const evalGeo = evaluateGeoDeck($geoDeckStore, geoRuntime, dt, t, state.mx, state.my);
    const geo = evalGeo.params;
    const mouseX = state.mx;
    const mouseY = state.my;

    // FX envelope decay
    geoFx.pulse *= Math.pow(0.06, dt);
    geoFx.slice *= Math.pow(0.045, dt);
    geoFx.phase *= Math.pow(0.08, dt);
    geoFx.shatter *= Math.pow(0.05, dt);
    geoFx.tunnel *= Math.pow(0.07, dt);
    if (geoFx.hold < 0.5) geoFx.hold *= Math.pow(0.25, dt);

    const flow = 0.25 + geo.flow * 2.2 + evalGeo.lfo1 * 0.15;
    const depth = 8 + Math.floor(geo.depth * 28);
    const scale = 0.4 + geo.scale * 1.8;
    const symmetry = 2 + Math.floor(geo.symmetry * 10);
    const contrast = 0.55 + geo.contrast * 1.25;
    const trailFade = clamp01(0.08 + (1 - geo.echo) * 0.3);
    const tunnelPush = geoFx.tunnel * 0.75 + evalGeo.lfo2 * 0.2;

    // Trail/afterimage background
    ctx.fillStyle = `rgba(5, 8, 11, ${trailFade})`;
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const baseRadius = Math.min(w, h) * (0.12 + geo.scale * 0.22);
    const phaseShift = t * flow * 0.7 + geoFx.phase * 3.4;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';

    // Primary geometry layers
    for (let i = 0; i < depth; i++) {
      const d = i / Math.max(1, depth - 1);
      const z = Math.pow(d, 1.35);
      const pulse = 1 + geoFx.pulse * 0.34 + evalGeo.lfo1 * 0.22 * (1 - d);
      const radius = baseRadius * pulse * (0.7 + z * scale * 2.4 + tunnelPush * (1 - z) * 0.7);
      const ang = phaseShift + z * 6.2 + (geoFx.slice * 0.8 + evalGeo.lfo2 * 0.2) * (i % 2 === 0 ? 1 : -1);
      const alpha = clamp01((0.07 + (1 - z) * 0.32) * contrast);
      const hueA = 178 + z * 72 + evalGeo.lfo1 * 50 + geoFx.phase * 40;
      const hueB = 25 + z * 30 + geoFx.shatter * 90;
      const lw = 0.8 + (1 - z) * 2.4 + geoFx.slice * 2.2;

      ctx.lineWidth = lw;
      ctx.strokeStyle = `hsla(${hueA}, 88%, ${48 + (1 - z) * 18}%, ${alpha})`;
      ctx.beginPath();

      if (evalGeo.form === 'minimal') {
        const sides = Math.max(3, symmetry);
        for (let s = 0; s <= sides; s++) {
          const a = (s / sides) * Math.PI * 2 + ang;
          const rx = Math.cos(a) * radius;
          const ry = Math.sin(a) * radius * (0.9 + mouseY * 0.5);
          if (s === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
        }
      } else if (evalGeo.form === 'hex') {
        const sides = 6;
        for (let s = 0; s <= sides; s++) {
          const a = (s / sides) * Math.PI * 2 + ang;
          const rx = Math.cos(a) * radius;
          const ry = Math.sin(a) * radius;
          if (s === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
        }
      } else if (evalGeo.form === 'grid') {
        const span = radius * 1.6;
        const lines = 6 + Math.floor(geo.symmetry * 10);
        for (let n = -lines; n <= lines; n++) {
          const p = (n / lines) * span;
          const bend = Math.sin(p * 0.015 + ang) * radius * 0.12;
          ctx.moveTo(-span, p + bend);
          ctx.lineTo(span, p - bend);
          ctx.moveTo(p + bend, -span);
          ctx.lineTo(p - bend, span);
        }
      } else if (evalGeo.form === 'sacred') {
        const petals = Math.max(4, symmetry + 2);
        for (let p = 0; p < petals; p++) {
          const a = (p / petals) * Math.PI * 2 + ang;
          const ox = Math.cos(a) * radius * 0.55;
          const oy = Math.sin(a) * radius * 0.55;
          ctx.moveTo(ox + radius * 0.45, oy);
          ctx.arc(ox, oy, radius * 0.45, 0, Math.PI * 2);
        }
      } else if (evalGeo.form === 'tunnel') {
        const sides = 4 + Math.floor(geo.symmetry * 6);
        for (let s = 0; s <= sides; s++) {
          const a = (s / sides) * Math.PI * 2 + ang;
          const rx = Math.cos(a) * radius * (1 + z * 0.25);
          const ry = Math.sin(a) * radius * (1 - z * 0.18);
          if (s === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
        }
      } else {
        const segs = 56;
        for (let s = 0; s <= segs; s++) {
          const a = (s / segs) * Math.PI * 2;
          const wave = Math.sin(a * (symmetry + 1) + ang * 1.2) * (radius * 0.22 + geoFx.shatter * 24);
          const rr = radius + wave;
          const rx = Math.cos(a) * rr;
          const ry = Math.sin(a) * rr * (0.55 + mouseY * 0.65);
          if (s === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
        }
      }

      ctx.stroke();

      // Secondary accents / slicing rays
      if (geoFx.slice > 0.02 || i % 4 === 0) {
        ctx.strokeStyle = `hsla(${hueB}, 90%, 65%, ${alpha * (0.35 + geoFx.slice * 0.6)})`;
        ctx.lineWidth = lw * 0.55;
        const spokes = 3 + Math.floor(symmetry * 0.8);
        for (let s = 0; s < spokes; s++) {
          const a = (s / spokes) * Math.PI * 2 + ang * 0.55;
          const r0 = radius * 0.18;
          const r1 = radius * (1.15 + geoFx.tunnel * 0.8);
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
          ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
          ctx.stroke();
        }
      }
    }

    // Cursor anchor for performance targeting
    const mx = (mouseX - 0.5) * w * 0.35;
    const my = (mouseY - 0.5) * h * 0.35;
    ctx.strokeStyle = `hsla(${180 + geoFx.phase * 50}, 95%, 72%, ${0.35 + geoFx.hold * 0.5})`;
    ctx.lineWidth = 1.4 + geoFx.hold * 1.8;
    ctx.beginPath();
    ctx.arc(mx, my, 8 + geoFx.pulse * 16 + evalGeo.lfo1 * 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx - 12, my);
    ctx.lineTo(mx + 12, my);
    ctx.moveTo(mx, my - 12);
    ctx.lineTo(mx, my + 12);
    ctx.stroke();

    // Frame-space strobe flash
    if (geoFx.shatter > 0.35) {
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgba(255,255,255,${(geoFx.shatter - 0.35) * 0.25})`;
      ctx.fillRect(-cx, -cy, w, h);
    }

    ctx.restore();
  }

  // ================================================================
  //  Splash Screen
  // ================================================================
  function renderSplash() {
    if (!compCtx || !outputCanvas) return;
    const w = outputCanvas.width, h = outputCanvas.height;
    compCtx.fillStyle = '#000';
    compCtx.fillRect(0, 0, w, h);

    // Title text
    const fontSize = Math.round(h * 0.055);
    compCtx.font = `bold ${fontSize}px monospace`;
    compCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    compCtx.textAlign = 'center';
    compCtx.textBaseline = 'middle';
    compCtx.fillText('P  E  R  F  O  R  M  E  R', w / 2, h / 2);

    // Subtle underline accent
    const textW = compCtx.measureText('P  E  R  F  O  R  M  E  R').width;
    compCtx.strokeStyle = 'rgba(187, 134, 252, 0.4)';
    compCtx.lineWidth = 1;
    compCtx.beginPath();
    compCtx.moveTo(w / 2 - textW / 2, h / 2 + fontSize * 0.7);
    compCtx.lineTo(w / 2 + textW / 2, h / 2 + fontSize * 0.7);
    compCtx.stroke();
  }

  function dismissSplash() {
    synthVisionStore.update(s => ({ ...s, showSplash: false }));
  }

  // ================================================================
  //  Main Render Loop
  // ================================================================
  let _renderLogCount = 0;
  function renderFrame(now: number) {
    animFrame = requestAnimationFrame(renderFrame);
    if (!state.active) { if (_renderLogCount++ < 3) console.log('[SV render] skipped: not active'); return; }
    // Keep rendering even when Performer UI is hidden — the VJ layer needs live canvas output.
    // Only skip rendering if VJ mode itself is closed (performerStarted will be false → component unmounts).

    // Show splash screen until first interaction (only when UI is visible)
    if (visible && state.showSplash) {
      renderSplash();
      return;
    }

    const dt = Math.min((now - lastTime) / 1000, .05);
    lastTime = now;

    // Update time
    synthVisionStore.update(s => {
      const newTime = s.time + dt;
      // BPM
      const bI = 60000 / s.bpm;
      let newBp = ((now - s.lastBeat) % bI) / bI;
      let newLastBeat = s.lastBeat;
      let newPump = s.pump * .93;
      if (now - s.lastBeat > bI) {
        newLastBeat = now;
        if (s.bpmSync) newPump = Math.max(newPump, .4);
      }
      // Drift
      let newDriftTarget = s.driftTarget;
      let newDriftTimer = s.driftTimer;
      if (s.drift && s.driftTarget) {
        newDriftTimer += dt;
        const newLayers = { ...s.layers };
        const l = { ...newLayers[s.focus], p: { ...newLayers[s.focus].p } };
        for (const param of SV_PARAMS) {
          const tgt = (s.driftTarget as any)[param.k];
          if (tgt !== undefined) l.p[param.k] += (tgt - l.p[param.k]) * dt * s.driftSpeed;
        }
        newLayers[s.focus] = l;
        if (newDriftTimer >= s.driftInterval) {
          newDriftTimer = 0;
          newDriftTarget = {} as SVParams;
          for (const param of SV_PARAMS) (newDriftTarget as any)[param.k] = Math.random();
          if (Math.random() > .6) l.sh = Math.floor(Math.random() * 36);
          if (Math.random() > .75) l.style = Math.floor(Math.random() * 8);
        }
        return { ...s, time: newTime, bp: newBp, lastBeat: newLastBeat, pump: newPump, driftTimer: newDriftTimer, driftTarget: newDriftTarget, layers: newLayers };
      }
      // Auto mode
      let newAutoTimer = s.autoTimer;
      if (s.autoMode) {
        newAutoTimer += dt;
        // Auto random will be done separately to avoid recursive store updates
      }
      return { ...s, time: newTime, bp: newBp, lastBeat: newLastBeat, pump: newPump, autoTimer: newAutoTimer };
    });

    // Auto mode random trigger (shader deck only)
    if ($performerDeckStore.activeDeck === 'shader' && state.autoMode && state.autoTimer >= state.autoInterval) {
      if (isfActive && isfShaderInstance) {
        // ISF mode: randomize ISF effectStyle (if it exists) + world cycling
        if (isfShaderInstance.uniforms.effectStyle) {
          const newStyle = Math.floor(Math.random() * 12);
          setISFInputValue(isfShaderInstance, 'effectStyle', newStyle);
        }
        // Still cycle world for 3D variety
        synthVisionStore.cycleWorld(1);
      } else {
        synthVisionStore.doRandom();
      }
      synthVisionStore.update(s => ({ ...s, autoTimer: 0 }));
    }

    // Decay spacebar effects over time
    synthVisionStore.decayEffects(dt);

    if ($performerDeckStore.activeDeck === 'shader') {
      updateAudio();
    }

    // Extract camera data BEFORE rendering shaders (so it drives the visuals)
    if ($performerDeckStore.activeDeck === 'shader' && state.camActive && camVideo && camVideo.readyState >= 2) {
      detectMotion();
    }

    // Resolve crossfade mix params
    const xf = state.xfade;
    const aL = state.layers.a, bL = state.layers.b;
    const activeL = xf < .5 ? aL : bL;
    const mixP: Record<string, number> = {};
    for (const param of SV_PARAMS) {
      mixP[param.k] = aL.p[param.k] * (1 - xf) + bL.p[param.k] * xf;
    }

    if (($performerDeckStore.activeDeck as string) === 'geo') {
      renderGeoFrame(dt);
      return;
    }

    // Update 3D world (skip if worlds disabled)
    if (worldsEnabled) {
      updateWorld(dt);
      updateCamera(dt);
    }

    // Render 2D shader (or ISF shader with post-FX)
    if (gl && shaderProgram) {
      ensureFBO();
      if (fboA && fboB) {
        const frameNum = Math.floor(state.time * 60);

        if (isfActive && isfShaderInstance && isfRenderer && isfScene && isfCamera && isfQuad && postFxProgram && isfTexture && isfCanvas) {
          // ── ISF MODE: Render ISF shader → post-FX → shaderCanvas ──
          // 1. Bridge SV params to ISF uniforms
          bridgeSVParamsToISF(mixP);

          // 1b. Apply audio modulation — read modulated values from modulation engine
          // and apply them directly to ISF shader uniforms (the engine writes to vjClipLauncher
          // but Performer renders via its own ISF instance, so we bridge the gap here)
          const inputs = isfShaderInstance.metadata?.INPUTS;
          if (inputs) {
            for (const input of inputs) {
              if (input.TYPE !== 'float' && !(input.TYPE === 'long' && !input.VALUES)) continue;
              const modVal = getModulatedValue(assignedVJLayer, input.NAME);
              if (modVal !== null) {
                setISFInputValue(isfShaderInstance, input.NAME, modVal);
              }
            }
          }

          // 2. Render ISF to isfCanvas (Three.js)
          const w = shaderCanvas.width || 960;
          const h = shaderCanvas.height || 540;
          if (isfCanvas.width !== w || isfCanvas.height !== h) {
            isfRenderer.setSize(w, h, false);
          }
          isfQuad.material = isfShaderInstance.material;
          updateISFShader(isfShaderInstance, w, h, dt, audioStateForISF());
          isfRenderer.render(isfScene, isfCamera);

          // 3. Upload ISF canvas to WebGL2 texture and apply post-FX
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, w, h);
          gl.useProgram(postFxProgram);

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, isfTexture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, isfCanvas);
          gl.uniform1i(postFxUniforms.inputTex, 0);
          gl.uniform2f(postFxUniforms.res, w, h);
          gl.uniform1f(postFxUniforms.pump, state.pump);
          gl.uniform1f(postFxUniforms.fxShockwave, state.fxShockwave);
          gl.uniform1f(postFxUniforms.fxTwist, state.fxTwist);
          gl.uniform1f(postFxUniforms.fxChromatic, state.fxChromatic);
          gl.uniform1f(postFxUniforms.fxPixelate, state.fxPixelate);
          gl.uniform1f(postFxUniforms.fxStrobe, state.fxStrobe);
          gl.uniform1f(postFxUniforms.fxIntensity, state.fxIntensity);
          gl.uniform1f(postFxUniforms.inv, state.invert ? 1 : 0);
          gl.uniform1f(postFxUniforms.blackout, Math.max(0, Math.min(1, state.blackout)));
          gl.uniform1f(postFxUniforms.whiteout, Math.max(0, Math.min(1, state.whiteout)));

          gl.bindVertexArray(quadVAO);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          if (frameNum < 3) {
            console.log('SynthVision ISF render: frame=', frameNum, 'shader=', isfShaderInstance.name, 'size=', w, 'x', h);
          }
        } else {
          // ── NO CLIP ACTIVE: clear to black so stale framebuffers and
          //     the legacy mega-shader can never leak through.
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, shaderCanvas.width, shaderCanvas.height);
          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        // Legacy mega-shader path removed — built-in shaders were leaking through
        // when no ISF clip was active. ISF clips are now the only render path.
        // (Restore from git history if post-FX wiring needs re-introduction.)
      } else {
        const frameNum = Math.floor(state.time * 60);
        if (frameNum < 5) console.warn('SynthVision: FBOs not ready', { fboA: !!fboA, fboB: !!fboB });
      }
    } else {
      const frameNum = Math.floor(state.time * 60);
      if (frameNum < 5) console.warn('SynthVision: Shader rendering skipped', { gl: !!gl, shaderProgram: !!shaderProgram });
    }

    // Render Three.js (skip if worlds disabled). Goes through the
    // post chain (bloom + ACES tone map) when composer is up;
    // falls back to direct render if anything in initThree failed.
    if (worldsEnabled && renderer && scene && camera) {
      if (composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    }

    // Render camera effects layer (separate visual layer, not data input)
    if (state.camActive && camGl && camShader && camVideo && camVideo.readyState >= 2 && camFboA && camFboB) {
      const camW = camCanvas.width, camH = camCanvas.height;
      const src = camFboPing ? camFboA : camFboB;
      const dst = camFboPing ? camFboB : camFboA;

      camGl.bindFramebuffer(camGl.FRAMEBUFFER, dst.fb);
      camGl.viewport(0, 0, camW, camH);
      camGl.useProgram(camShader);

      // Upload camera video texture
      camGl.activeTexture(camGl.TEXTURE0);
      camGl.bindTexture(camGl.TEXTURE_2D, camVideoTexture);
      camGl.texImage2D(camGl.TEXTURE_2D, 0, camGl.RGBA, camGl.RGBA, camGl.UNSIGNED_BYTE, camVideo);
      camGl.uniform1i(camUniforms.camTex, 0);

      // Previous frame for motion detection/feedback
      camGl.activeTexture(camGl.TEXTURE1);
      camGl.bindTexture(camGl.TEXTURE_2D, src.tex);
      camGl.uniform1i(camUniforms.prevFrame, 1);

      // Set uniforms
      camGl.uniform1f(camUniforms.t, state.time);
      camGl.uniform2f(camUniforms.res, camW, camH);
      // Convert camMode string to index
      const camModeIdx = SV_CAM_MODES.findIndex(m => m.id === state.camMode);
      camGl.uniform1i(camUniforms.mode, camModeIdx >= 0 ? camModeIdx : 0);
      camGl.uniform1f(camUniforms.motion, lastMotion);
      camGl.uniform1f(camUniforms.mic, state.micLevel);
      camGl.uniform1f(camUniforms.param1, 0.5);

      camGl.drawArrays(camGl.TRIANGLE_STRIP, 0, 4);

      // Blit to screen
      camGl.bindFramebuffer(camGl.READ_FRAMEBUFFER, dst.fb);
      camGl.bindFramebuffer(camGl.DRAW_FRAMEBUFFER, null);
      camGl.viewport(0, 0, camW, camH);
      camGl.blitFramebuffer(0, 0, camW, camH, 0, 0, camW, camH, camGl.COLOR_BUFFER_BIT, camGl.LINEAR);
      camGl.bindFramebuffer(camGl.FRAMEBUFFER, null);
      camFboPing = !camFboPing;
    }

    // Composite to output canvas
    if (compCtx && outputCanvas && shaderCanvas && threeCanvas) {
      compCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      compCtx.globalCompositeOperation = 'source-over';
      compCtx.drawImage(shaderCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
      // Use additive blending for 3D layer (skip if worlds disabled)
      if (worldsEnabled) {
        compCtx.globalCompositeOperation = 'lighter';
        compCtx.drawImage(threeCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
        compCtx.globalCompositeOperation = 'source-over';
      }

      // Render camera effects layer with selected blend mode
      if (state.camActive && camCanvas) {
        const blendMode = SV_CAM_BLENDS[state.camBlend]?.op || 'lighter';
        compCtx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
        compCtx.globalAlpha = state.camOpacity;
        compCtx.drawImage(camCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
        compCtx.globalAlpha = 1;
        compCtx.globalCompositeOperation = 'source-over';
      }
    } else {
      // Debug: Log why compositing isn't happening
      const frameNum = Math.floor(state.time * 60);
      if (frameNum < 10) {
        console.warn('SynthVision: Compositing skipped - missing:',
          { compCtx: !!compCtx, outputCanvas: !!outputCanvas, shaderCanvas: !!shaderCanvas, threeCanvas: !!threeCanvas });
      }
      // Fallback: draw a debug pattern to the output canvas to verify it's being displayed
      if (compCtx && outputCanvas) {
        compCtx.fillStyle = `hsl(${(state.time * 50) % 360}, 80%, 40%)`;
        compCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
        compCtx.fillStyle = '#fff';
        compCtx.font = '24px monospace';
        compCtx.fillText('SynthVision: Waiting for render...', 20, 50);
      }
    }
  }

  // ================================================================
  //  Keyboard Handler
  // ================================================================
  // ─── ISF Inside SynthVision Pipeline Functions ─────────────────────────
  function initISF() {
    if (isfRenderer) return;
    const pW = $project.width || 1920;
    const pH = $project.height || 1080;
    const maxPx = 1920 * 1080;
    const sc = (pW * pH) > maxPx ? Math.sqrt(maxPx / (pW * pH)) : 1;
    const isfW = Math.round(pW * sc);
    const isfH = Math.round(pH * sc);
    isfCanvas = document.createElement('canvas');
    isfCanvas.width = isfW;
    isfCanvas.height = isfH;
    isfRenderer = new THREE.WebGLRenderer({ canvas: isfCanvas, alpha: false, antialias: false, powerPreference: 'high-performance' });
    isfRenderer.setSize(isfW, isfH, false);
    isfScene = new THREE.Scene();
    isfCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new THREE.PlaneGeometry(2, 2);
    isfQuad = new THREE.Mesh(geo);
    isfScene.add(isfQuad);
    console.log('SynthVision: ISF renderer initialized');
  }

  function activateISFShader(assignment: ClipAssignment) {
    if (!assignment.shaderCode) return;
    initISF();

    // Create/update ISF shader instance only if shader changed
    if (isfShaderCode_internal !== assignment.shaderCode) {
      try {
        isfShaderInstance = createISFShader(
          `sv-isf-${Date.now()}`,
          assignment.shaderName || 'ISF',
          assignment.shaderCode
        );
        isfShaderCode_internal = assignment.shaderCode;
        // Apply manifest default overrides if present
        if (assignment.manifestDefaults && isfShaderInstance) {
          for (const [name, value] of Object.entries(assignment.manifestDefaults)) {
            setISFInputValue(isfShaderInstance, name, value as number | boolean | number[]);
          }
        }
        console.log('SynthVision: ISF shader created:', assignment.shaderName);
      } catch (e) {
        console.error('SynthVision: Failed to create ISF shader:', e);
        return;
      }
    }

    isfAssignment = assignment;
    isfActive = true;
    // Do NOT touch VJ layer — SynthVision 'synthvision' clip stays

    // Register param ranges for modulation clamping
    if (isfShaderInstance?.metadata?.INPUTS) {
      registerParamRanges(assignedVJLayer, isfShaderInstance.metadata.INPUTS);
    }
  }

  function deactivateISF() {
    isfActive = false;
    isfShaderInstance = null;
    isfShaderCode_internal = '';
    isfAssignment = null;
    // Update ISF controls
    activeISFInputs = [];
    activeISFName = '';
    activeISFShaderCode = '';
  }

  function bridgeSVParamsToISF(mixP: Record<string, number>) {
    if (!isfShaderInstance) return;
    // Map SV globals to ISF uniform names (silently skip if uniform doesn't exist)
    const bridge: Record<string, number> = {
      svPump: state.pump,
      svChaos: mixP.chaos ?? 0,
      svGlow: mixP.glow ?? 0,
      svWarp: mixP.warp ?? 0,
      svMirror: mixP.mirror ?? 0,
      svFeedback: mixP.feedback ?? 0,
      svLofi: mixP.lofi ?? 0,
      svInvert: state.invert ? 1.0 : 0.0,
      svColor: mixP.color ?? 0,
      svSpeed: mixP.speed ?? 1,
      svZoom: mixP.zoom ?? 1,
    };
    for (const [name, value] of Object.entries(bridge)) {
      if (isfShaderInstance.uniforms[name]) {
        isfShaderInstance.uniforms[name].value = value;
      }
    }
  }

  function audioStateForISF(): any | null {
    const audio = $audioStore;
    if (!audio.isActive) return null;
    return {
      isActive: true,
      amplitude: audio.amplitude,
      bands: { bass: audio.bands.bass, mid: audio.bands.mid, high: audio.bands.high },
      beat: { beatIntensity: state.pump || 0 },
      beatPhase: audio.beatPhase,
      bpm: audio.bpm || 120,
      spectralCentroid: 0,
    };
  }

  // ─── Shader Clip Trigger ─────────────────────────
  function applyShaderClip(assignment: ClipAssignment) {
    if (!assignment.shaderCode) return;
    // Resolve live shader code from the current editShaders library by id, so
    // any edits made after the clip was assigned are always picked up. Falls
    // back to the snapshot captured at drop time if the id is no longer in
    // the library.
    let liveAssignment = assignment;
    if (assignment.shaderId) {
      const live = editShaders.find(s => s.id === assignment.shaderId);
      if (live && live.shaderCode) {
        liveAssignment = {
          ...assignment,
          shaderName: live.name,
          shaderSrc: live.src,
          shaderCode: live.shaderCode,
          shaderThumbnail: live.thumbnail,
          manifestDefaults: live.manifestDefaults,
        };
      }
    }
    // Force re-creation of ISF instance so any edits to the library's shader
    // code are always picked up (both for click and keyboard launches).
    isfShaderCode_internal = '';
    // Render ISF inside SynthVision pipeline instead of replacing SV on VJ layer
    activateISFShader(liveAssignment);
  }

  // ─── Random All: ISF Params + Layer Effects ─────────────────────────
  function randomizeAll() {
    // 1. Randomize ISF shader params (if ISF active)
    if (isfActive && isfShaderInstance) {
      const inputs = isfShaderInstance.metadata?.INPUTS || [];
      for (const input of inputs) {
        if (input.NAME.startsWith('sv')) continue; // skip bridge params
        if (input.TYPE === 'float') {
          const min = (input.MIN as number) ?? 0;
          const max = (input.MAX as number) ?? 1;
          setISFInputValue(isfShaderInstance, input.NAME, min + Math.random() * (max - min));
        } else if (input.TYPE === 'long' && input.VALUES) {
          const idx = Math.floor(Math.random() * input.VALUES.length);
          setISFInputValue(isfShaderInstance, input.NAME, input.VALUES[idx]);
        }
      }
    }

    // 2. Randomize layer effects params
    const effects = $vjClipLauncher.layerStates[assignedVJLayer]?.effects ?? [];
    for (const effect of effects) {
      const defs = EFFECT_PARAM_DEFS[effect.type] || [];
      const patch: Record<string, number> = {};
      for (const pd of defs) {
        if (pd.type === 'color' && pd.colorParams) {
          // Randomize RGB color components
          patch[pd.colorParams.r] = Math.random();
          patch[pd.colorParams.g] = Math.random();
          patch[pd.colorParams.b] = Math.random();
        } else if (pd.type === 'select' && pd.options) {
          // Pick a random option value
          const opt = pd.options[Math.floor(Math.random() * pd.options.length)];
          patch[pd.param] = opt.value;
        } else {
          patch[pd.param] = pd.min + Math.random() * (pd.max - pd.min);
        }
      }
      if (Object.keys(patch).length > 0) {
        vjClipLauncher.updateLayerEffectParams(assignedVJLayer, effect.id, patch);
      }
    }

    // 3. Still do world/shader cycling via the store
    synthVisionStore.doFullRandom();
  }

  // ================================================================
  //  Performer Deck Modes
  // ================================================================
  const geoFx = {
    pulse: 0,
    slice: 0,
    phase: 0,
    shatter: 0,
    tunnel: 0,
    hold: 0,
    seed: Math.random() * 1000,
  };
  const geoRuntime: GeoEngineRuntime = {
    lfo1Phase: Math.random(),
    lfo2Phase: Math.random(),
  };

  function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
  }

  function toggleShaderAuto() {
    synthVisionStore.toggleAuto();
  }

  // ─── Clip Assignment Functions ─────────────────────
  function triggerClip(clipPos: number) {
    console.log('[SV triggerClip]', clipPos, 'editMode:', performerEditMode, 'active:', state.active, 'visible:', visible);
    // Dismiss splash on any clip trigger (allows click-to-launch without needing keyboard first)
    if (state.showSplash) dismissSplash();
    const assignment = clipAssignments[clipPos];
    if (!assignment) { console.log('[SV triggerClip] no assignment at', clipPos); return; }

    // Re-activate SynthVision clip on VJ layer if STOP ALL cleared it
    ensureSVClipActive();

    if (assignment.type === 'media' && assignment.mediaSrc) {
      applyMediaClip(assignment);
    } else if (assignment.type === 'shader' && assignment.shaderCode) {
      console.log('[SV triggerClip] applying shader:', assignment.shaderName);
      applyShaderClip(assignment);
    }
  }

  /** Ensure the synthvision clip is active on the VJ layer (re-triggers after STOP ALL) */
  function ensureSVClipActive() {
    const layerState = $vjClipLauncher.layerStates[assignedVJLayer];
    if (!layerState?.activeClip || layerState.activeClip.id !== svClipId) {
      // SynthVision clip was cleared (e.g. by STOP ALL) — re-set and re-trigger it
      const svClip: VJClip = {
        id: svClipId,
        type: 'synthvision',
        name: 'PERFORMER',
        src: '',
        synthVisionCanvas: outputCanvas
      };
      vjClipLauncher.setClip(assignedVJLayer, 0, svClip);
      vjClipLauncher.triggerClip(assignedVJLayer, 0);
    }
  }

  function applyMediaClip(assignment: ClipAssignment) {
    if (!assignment.mediaSrc) return;
    const layerIdx = assignedVJLayer;
    const clipId = `perf-media-${assignment.mediaId || Date.now()}`;

    if (assignment.mediaType === 'video') {
      // Reuse library item's <video> element if available so rapid
      // Performer keyboard switching doesn't churn fresh elements.
      const libraryItem = assignment.mediaId
        ? $mediaLibrary.find(m => m.id === assignment.mediaId)
        : null;
      let video = libraryItem?.videoElement as HTMLVideoElement | undefined;
      if (!video) {
        video = document.createElement('video');
        video.src = assignment.mediaSrc;
      }
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      // Restart from frame 0 on every Performer keypress — clicking a key
      // means "play this clip from the top", not "resume mid-stream".
      try { video.currentTime = 0; } catch { /* ignore */ }
      if (video.paused) video.play().catch(() => {});
      const clip: VJClip = {
        id: clipId,
        type: 'video',
        name: assignment.mediaName || 'Media Clip',
        src: assignment.mediaSrc,
        thumbnail: assignment.mediaThumbnail || libraryItem?.thumbnail,
        videoElement: video,
      };
      vjClipLauncher.setClip(layerIdx, 0, clip);
      vjClipLauncher.triggerClip(layerIdx, 0);
    } else if (assignment.mediaType === 'image') {
      const clip: VJClip = {
        id: clipId,
        type: 'image',
        name: assignment.mediaName || 'Image Clip',
        src: assignment.mediaSrc,
        thumbnail: assignment.mediaThumbnail || assignment.mediaSrc,
      };
      vjClipLauncher.setClip(layerIdx, 0, clip);
      vjClipLauncher.triggerClip(layerIdx, 0);
    }
  }

  // ─── Drag-Drop Assignment Handlers ─────────────────────
  function handleEditDragStart(e: DragEvent, type: 'shader' | 'media', shader?: typeof editShaders[0], item?: MediaItem) {
    if (!e.dataTransfer) return;
    if (type === 'shader' && shader) {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'shader',
        id: shader.id,
        name: shader.name,
        src: shader.src,
        thumbnail: shader.thumbnail,
        shaderCode: shader.shaderCode,
        manifestDefaults: shader.manifestDefaults,
      }));
    } else if (item) {
      const mediaThumbnail = item.type === 'image' ? item.src : (item.thumbnail || '');
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'media',
        mediaId: item.id,
        mediaName: item.name,
        mediaSrc: item.src,
        mediaType: item.type,
        mediaThumbnail,
      }));
    }
    e.dataTransfer.effectAllowed = 'copy';
  }

  function handleClipDragOver(e: DragEvent, clipPos: number) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dragOverClipSlot = clipPos;
  }

  function handleClipDragLeave(clipPos: number) {
    if (dragOverClipSlot === clipPos) dragOverClipSlot = null;
  }

  function handleClipDrop(e: DragEvent, clipPos: number) {
    e.preventDefault();
    dragOverClipSlot = null;
    if (!e.dataTransfer) return;
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.type === 'shader') {
        clipAssignments[clipPos] = {
          type: 'shader',
          shaderId: data.id,
          shaderName: data.name,
          shaderSrc: data.src,
          shaderThumbnail: data.thumbnail,
          shaderCode: data.shaderCode,
          manifestDefaults: data.manifestDefaults,
        };
        clipAssignments = { ...clipAssignments };
        clipsDirty = true;
      } else if (data.type === 'media') {
        clipAssignments[clipPos] = {
          type: 'media',
          mediaId: data.mediaId,
          mediaName: data.mediaName,
          mediaSrc: data.mediaSrc,
          mediaType: data.mediaType,
          mediaThumbnail: data.mediaThumbnail || (data.mediaType === 'image' ? data.mediaSrc : undefined),
        };
        clipAssignments = { ...clipAssignments };
        clipsDirty = true;

        if (data.mediaType === 'video' && data.mediaSrc) {
          captureVideoKeyThumbnail(data.mediaSrc).then(thumb => {
            if (!thumb) return;
            const cur = clipAssignments[clipPos];
            // Slot may have been reassigned or cleared while we waited
            // for the frame — bail silently in that case.
            if (!cur || cur.type !== 'media' || cur.mediaSrc !== data.mediaSrc) return;
            clipAssignments[clipPos] = { ...cur, mediaThumbnail: thumb };
            clipAssignments = { ...clipAssignments };
            clipsDirty = true;
          }).catch(() => { /* */ });
        }
      }
    } catch (err) {
      // Ignore invalid drag data
    }
  }

  /**
   * Capture the first decoded frame of a video URL as a 160×90 JPEG data
   * URL. Used for performer-mode key thumbnails on video drops. Failures
   * (cors, slow first frame, blob URL revoked) resolve to undefined and
   * the caller leaves the key without a preview.
   */
  async function captureVideoKeyThumbnail(url: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      // ghost-asset:// is cross-origin from the renderer; without anonymous
      // CORS the canvas drawImage below taints and toDataURL throws.
      if (/^(https?:|ghost-asset:)/i.test(url)) v.crossOrigin = 'anonymous';
      v.src = url;

      let done = false;
      const finish = (out: string | undefined) => {
        if (done) return;
        done = true;
        try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* */ }
        resolve(out);
      };

      const grab = () => {
        try {
          const w = 160, h = 90;
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          if (!ctx) return finish(undefined);
          ctx.drawImage(v, 0, 0, w, h);
          finish(c.toDataURL('image/jpeg', 0.7));
        } catch {
          finish(undefined);
        }
      };

      v.addEventListener('loadeddata', () => {
        // Seek slightly past 0 so demuxers that produce a black initial
        // frame land on actual content.
        try { v.currentTime = 0.1; } catch { grab(); return; }
      }, { once: true });
      v.addEventListener('seeked', grab, { once: true });
      v.addEventListener('error', () => finish(undefined), { once: true });
      // Hard timeout — never let a hung video stall the slot forever.
      setTimeout(() => finish(undefined), 3000);
    });
  }

  // Preset management
  function loadPresetsFromStorage() {
    // Legacy: now handled by stores. Sync savedPresets from stores for backwards compat.
    savedPresets = allPresets;
  }
  function savePresetsToStorage() {
    // No-op: presets are now saved via project store or global store
  }
  function savePreset(name: string) {
    if (!name.trim()) return;
    const preset: SVKeyboardPreset = {
      id: Date.now().toString(36),
      name: name.trim(),
      assignments: JSON.parse(JSON.stringify(clipAssignments)),
      createdAt: Date.now(),
      scope: presetSaveScope,
    };
    if (presetSaveScope === 'global') {
      globalSVKeyboardPresets.add(preset);
    } else {
      project.saveSVKeyboardPreset(preset);
    }
    activePresetId = preset.id;
    clipsDirty = false;
    showPresetNameInput = false;
    presetNameInput = '';
  }
  function loadPreset(preset: KeyboardPreset) {
    showLoading('Loading Preset...');
    // Dismiss splash if still showing
    if (state.showSplash) dismissSplash();
    clipAssignments = JSON.parse(JSON.stringify(preset.assignments));
    activePresetId = preset.id;
    clipsDirty = false;
    // Hide loading after next frame renders
    requestAnimationFrame(() => hideLoading());
  }
  function deletePreset(id: string) {
    // Find which store it belongs to
    const isGlobal = $globalSVKeyboardPresets.some(p => p.id === id);
    if (isGlobal) {
      globalSVKeyboardPresets.remove(id);
    } else {
      project.deleteSVKeyboardPreset(id);
    }
    if (activePresetId === id) activePresetId = null;
  }

  /** Right-click "Update Preset" — overwrite an existing preset with the
   * CURRENT keyboard state (clipAssignments). Lets users iterate on a
   * preset without delete + re-save under the same name. */
  function updatePresetInPlace(preset: { id: string; _scope?: string }) {
    const fields = {
      assignments: JSON.parse(JSON.stringify(clipAssignments)),
      updatedAt: Date.now(),
    };
    if (preset._scope === 'global') {
      globalSVKeyboardPresets.updateContents(preset.id, fields);
    } else {
      project.updateSVKeyboardPreset(preset.id, fields);
    }
    activePresetId = preset.id;
    clipsDirty = false;
  }

  /** Right-click "Rename Preset" handler. */
  function renamePresetInPlace(preset: { id: string; _scope?: string }, newName: string) {
    if (preset._scope === 'global') {
      globalSVKeyboardPresets.rename(preset.id, newName);
    } else {
      project.renameSVKeyboardPreset(preset.id, newName);
    }
  }

  function getClipLabel(clipPos: number, assignments: Record<number, ClipAssignment>): { name: string; desc: string; isMedia: boolean; isAssigned: boolean; thumbnail?: string } {
    const assignment = assignments[clipPos];
    if (!assignment) return { name: '', desc: 'EMPTY', isMedia: false, isAssigned: false };
    if (assignment.type === 'media') {
      let thumb = assignment.mediaThumbnail;
      if (!thumb && assignment.mediaId) {
        const libItem = $mediaLibrary.find(m => m.id === assignment.mediaId);
        thumb = libItem?.thumbnail
          || (libItem?.type === 'image' ? libItem.src : undefined);
      }
      if (!thumb && assignment.mediaType === 'image') thumb = assignment.mediaSrc;
      return {
        name: assignment.mediaName || 'Media',
        desc: assignment.mediaType === 'video' ? 'VIDEO' : 'IMAGE',
        isMedia: true,
        isAssigned: true,
        thumbnail: thumb,
      };
    }
    return {
      name: assignment.shaderName || 'Shader',
      desc: 'SHADER',
      isMedia: false,
      isAssigned: true,
      thumbnail: assignment.shaderThumbnail,
    };
  }

  const CODE_TO_CLIP: Record<string, number> = {};
  SV_ALL_CLIPS.forEach((c, i) => { CODE_TO_CLIP[c.code] = i; });
  function handleKeydown(e: KeyboardEvent) {
    if (!state.active) return;
    // Don't capture if typing in an input
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

    // Dismiss splash on first interaction
    if (state.showSplash) dismissSplash();

    const code = e.code;
    const kl = e.key.toLowerCase();
    const sh = e.shiftKey;

    // Clip trigger (all 36 keys)
    if (CODE_TO_CLIP[code] !== undefined && !sh) {
      e.preventDefault();
      const clipPos = CODE_TO_CLIP[code];
      if (clipPos !== undefined) triggerClip(clipPos);
      return;
    }

    if (e.repeat) return;

    // Tab = full random (shader, world, style, space, params, effects)
    if (code === 'Tab') { e.preventDefault(); randomizeAll(); return; }

    // Arrow left/right = crossfade nudge
    if (code === 'ArrowLeft') { e.preventDefault(); synthVisionStore.nudgeXfade(-.05); return; }
    if (code === 'ArrowRight') { e.preventDefault(); synthVisionStore.nudgeXfade(.05); return; }

    // ; ' = space
    if (code === 'Semicolon') { synthVisionStore.cycleSpace(-1); return; }
    if (code === 'Quote') { synthVisionStore.cycleSpace(1); return; }

    // , . = world (comma/period)
    if (code === 'Comma') { synthVisionStore.cycleWorld(-1); return; }
    if (code === 'Period') { synthVisionStore.cycleWorld(1); return; }

    // Space = trigger selected spacebar effect + tap tempo
    if (code === 'Space') { e.preventDefault(); synthVisionStore.triggerSpaceFx(); tapBPM(); return; }

    // Backtick = toggle focus
    if (code === 'Backquote') { synthVisionStore.toggleFocus(); return; }

    // Actions
    if (kl === 'n') { synthVisionStore.toggleInvert(); return; }
    if (kl === 'b') { synthVisionStore.doBlackout(); return; }
    if (kl === 'm') { synthVisionStore.doGlitch(); return; }
    if (kl === 'x') { synthVisionStore.toggleDrift(); return; }
    if (kl === 'c') { randomizeAll(); return; }
    if (code === 'Escape') {
      synthVisionStore.update(s => ({ ...s, blackout: 0, whiteout: 0, invert: false }));
      return;
    }
  }

  // Tap tempo
  let taps: number[] = [];
  function tapBPM() {
    const now = performance.now();
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) {
      let total = 0;
      for (let i = 1; i < taps.length; i++) total += taps[i] - taps[i-1];
      const bpm = Math.round(60000 / (total / (taps.length - 1)));
      if (bpm >= 40 && bpm <= 300) synthVisionStore.setBpm(bpm);
    }
    synthVisionStore.update(s => ({ ...s, lastBeat: now, bp: 0 }));
  }

  // ================================================================
  //  Crossfader drag
  // ================================================================
  let xfDragging = false;
  function xfMouseDown(e: MouseEvent) {
    xfDragging = true;
    updateXfFromEvent(e);
  }
  function xfMouseMove(e: MouseEvent) {
    if (xfDragging) updateXfFromEvent(e);
  }
  function xfMouseUp() { xfDragging = false; }
  function updateXfFromEvent(e: MouseEvent) {
    const track = document.querySelector('.sv-xf-track') as HTMLElement;
    if (!track) return;
    const r = track.getBoundingClientRect();
    // Vertical slider: top = 0 (A), bottom = 1 (B)
    synthVisionStore.setXfade((e.clientY - r.top) / r.height);
  }

  // ================================================================
  //  Resize
  // ================================================================
  function handleResize() {
    if (!outputCanvas || !shaderCanvas || !threeCanvas) {
      console.warn('SynthVision handleResize: canvases not ready', { outputCanvas: !!outputCanvas, shaderCanvas: !!shaderCanvas, threeCanvas: !!threeCanvas });
      return;
    }
    // Use project dimensions but cap total pixels at ~2MP (1920×1080) for performer performance
    // Preserves aspect ratio for portrait (9:16), square, and landscape modes
    const projW = $project.width || 1920;
    const projH = $project.height || 1080;
    const maxPixels = 1920 * 1080; // ~2MP cap
    const pixels = projW * projH;
    const scale = pixels > maxPixels ? Math.sqrt(maxPixels / pixels) : 1;
    const w = Math.round(projW * scale);
    const h = Math.round(projH * scale);
    outputCanvas.width = w; outputCanvas.height = h;
    shaderCanvas.width = w; shaderCanvas.height = h;
    threeCanvas.width = w; threeCanvas.height = h;
    if (camCanvas) { camCanvas.width = w; camCanvas.height = h; }
    if (gl) gl.viewport(0, 0, w, h);
    if (camGl) camGl.viewport(0, 0, w, h);
    if (renderer) { renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    // Keep the post-processing chain's internal render targets in sync
    // with the canvas size, otherwise the composer renders to a stale
    // resolution and the output gets stretched / blurred.
    if (composer) composer.setSize(w, h);
    if (bloomPass) bloomPass.setSize(w, h);
    fboW = 0; // force FBO rebuild
    // Reinit camera FBOs on resize
    if (camGl && camCanvas) {
      camFboA = makeFBO(camGl, w, h);
      camFboB = makeFBO(camGl, w, h);
    }
    console.log('SynthVision handleResize: canvases sized to', w, 'x', h);
  }

  // Re-resize performer canvases when project dimensions change
  $: if (outputCanvas && ($project.width || $project.height)) {
    handleResize();
  }

  // ================================================================
  //  VJ Layer Assignment
  // ================================================================
  function assignToVJLayer(layerIdx: number) {
    if (!outputCanvas) { console.error('[SV] assignToVJLayer: outputCanvas is null!'); return; }
    console.log('[SV] assignToVJLayer:', layerIdx, 'canvas:', outputCanvas.width, 'x', outputCanvas.height, 'clipId:', svClipId);
    assignedVJLayer = layerIdx;

    // Create Performer clip for VJ layer
    const svClip: VJClip = {
      id: svClipId,
      type: 'synthvision',
      name: 'PERFORMER',
      src: '',
      synthVisionCanvas: outputCanvas
    };

    // Set clip in first column of the target layer and trigger it
    vjClipLauncher.setClip(layerIdx, 0, svClip);
    vjClipLauncher.triggerClip(layerIdx, 0);

    // Update store
    synthVisionStore.setAssignedLayer(layerIdx);
    console.log('[SV] assignToVJLayer complete, activeClip:', $vjClipLauncher.layerStates[layerIdx]?.activeClip?.id);
  }

  function unassignFromVJLayer() {
    if (assignedVJLayer !== null) {
      vjClipLauncher.clearClip(assignedVJLayer, 0);
      synthVisionStore.setAssignedLayer(null);
    }
  }

  // ================================================================
  //  Lifecycle
  // ================================================================
  onMount(() => {
    console.log('SynthVision: Starting initialization...');
    _attachDialListeners(); // see comment above the $:-removed attach block
    showLoading('Initializing Performer...');
    loadPresetsFromStorage();

    // Restore clip assignments and VJ layer from session cache (persists across VJ mode toggles)
    const cached = sessionClipCache.restore();
    let restoredVJLayer = 0;
    if (cached && Object.keys(cached.assignments).length > 0) {
      clipAssignments = cached.assignments;
      activePresetId = cached.activePresetId;
      clipsDirty = cached.dirty;
      restoredVJLayer = cached.assignedVJLayer ?? 0;
      console.log('SynthVision: Restored', Object.keys(cached.assignments).length, 'clip assignments, VJ layer:', restoredVJLayer);
    } else if (savedPresets.length > 0) {
      // No cached state and at least one saved preset exists — auto-load
      // the first one so the performer screen has working clips ready
      // instead of an empty grid the user has to manually click into.
      // Fires only when there's nothing to restore, so we never clobber
      // mid-session work.
      console.log('SynthVision: No cached clips, auto-loading first preset:', savedPresets[0].name);
      try {
        loadPreset(savedPresets[0] as KeyboardPreset);
      } catch (e) {
        console.warn('SynthVision: auto-load first preset failed:', e);
      }
    }

    // Reset effects state to ensure clean start (blackout/whiteout should be 0)
    // Skip splash if clips are already assigned (returning user is ready to perform)
    const skipSplash = Object.keys(clipAssignments).length > 0;
    synthVisionStore.update(s => ({ ...s, blackout: 0, whiteout: 0, pump: 0, fxIntensity: 0, fxShockwave: 0, fxTwist: 0, fxChromatic: 0, fxPixelate: 0, fxStrobe: 0, autoMode: false, drift: false, ...(skipSplash ? { showSplash: false } : {}) }));

    // Check WebGL availability first
    showLoading('Checking WebGL...');
    const testCanvas = document.createElement('canvas');
    const testGl = testCanvas.getContext('webgl2');
    if (!testGl) {
      console.error('SynthVision: WebGL2 is NOT available on this system! Try closing other browser tabs/apps.');
      const gl1 = testCanvas.getContext('webgl');
      console.log('SynthVision: WebGL1 available:', !!gl1);
      const expGl = testCanvas.getContext('experimental-webgl');
      console.log('SynthVision: Experimental WebGL available:', !!expGl);
    } else {
      console.log('SynthVision: WebGL2 test passed, proceeding with init');
      const ext = testGl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }

    // Safety timeout: always dismiss loading overlay after 8 seconds max
    // (prevents permanent freeze if WebGL init or shader loading hangs on re-mount)
    const safetyTimeout = setTimeout(() => {
      console.warn('SynthVision: Safety timeout — forcing loading overlay dismiss');
      hideLoading();
    }, 8000);

    // Wrap sync initialization in try-catch to ensure hideLoading is always called
    // (prevents frozen full-screen loading overlay if WebGL init fails on re-mount)
    try {
      showLoading('Compiling shaders...');
      handleResize();
      initShaders();
      // Defer camera shader init until camera is actually used to save WebGL contexts
      // initCamShaders(); -- will be called on first camera activation

      showLoading('Building 3D scene...');
      initThree();
      buildWorld(0);
    } catch (initErr) {
      console.error('SynthVision: Init failed, clearing loading overlay:', initErr);
      hideLoading();
      clearTimeout(safetyTimeout);
    }

    // Start render loop and event listeners immediately
    synthVisionStore.activate();
    lastTime = performance.now();
    animFrame = requestAnimationFrame(renderFrame);

    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('mousemove', xfMouseMove);
    document.addEventListener('mouseup', xfMouseUp);

    compCtx = outputCanvas.getContext('2d', { alpha: false });

    // Assign to restored VJ layer (or default layer 0) — defer to ensure canvas is bound
    const targetVJLayer = restoredVJLayer;
    setTimeout(() => assignToVJLayer(targetVJLayer), 100);

    // Load ISF shader library — use module-level cache if available
    // Keep loading indicator visible until shader library is ready
    (async () => {
      try {
        const cachedShaders = isfShaderCache.get();
        if (cachedShaders) {
          // Instant restore from module-level cache (no network fetches needed)
          editShaders = cachedShaders.map(s => ({ ...s }));
          editShadersLoading = false;
          console.log(`SynthVision: ${editShaders.length} shaders restored from cache (instant)`);
          showLoading('Ready');
          hideLoading();
          clearTimeout(safetyTimeout);
          return;
        }

        // First-time load: fetch from network
        if (thumbsCancelled) return; // component was destroyed
        showLoading('Loading shader library...');
        console.log('SynthVision: Loading shader library from network...');
        const response = await fetch('./ISF/manifest.json');
        if (thumbsCancelled) return;
        const manifest = await response.json();
        // Support both v1 (flat array) and v2 (objects with metadata) manifest formats
        const entries: Array<{ file: string; defaults?: Record<string, any> }> =
          manifest.version === 2
            ? manifest.shaders.filter((s: any) => s.enabled !== false)
            : manifest.shaders.map((f: string) => ({ file: f }));

        const totalShaders = entries.length;

        // Parallel fetch in batches of 30
        const BATCH_SIZE = 30;
        const loaded: typeof editShaders = [];
        for (let i = 0; i < totalShaders; i += BATCH_SIZE) {
          if (thumbsCancelled) break; // component was destroyed during loading
          const batch = entries.slice(i, i + BATCH_SIZE);
          if (!thumbsCancelled) showLoading(`Loading shader library... (${Math.min(i + BATCH_SIZE, totalShaders)}/${totalShaders})`);
          const results = await Promise.allSettled(
            batch.map(async (entry) => {
              const filename = entry.file;
              const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
              const shaderResponse = await fetch(`./ISF/${encodedPath}`);
              const shaderCode = await shaderResponse.text();
              return {
                id: generateUUID(),
                name: filename.replace('.fs', '').replace('DM-', ''),
                src: `./ISF/${encodedPath}`,
                shaderCode,
                manifestDefaults: entry.defaults,
              };
            })
          );
          if (thumbsCancelled) break; // component destroyed while awaiting batch
          for (const r of results) {
            if (r.status === 'fulfilled') loaded.push(r.value);
          }
        }
        if (thumbsCancelled) return; // component was destroyed
        editShaders = loaded;
        editShadersLoading = false;
        showLoading('Ready');
        hideLoading();
        clearTimeout(safetyTimeout);
        console.log(`SynthVision: ${loaded.length} shaders loaded, generating thumbnails in background...`);

        // Generate thumbnails in background — yield between EVERY thumbnail
        // so click events, renders, and clip triggers stay fully responsive
        const UI_UPDATE_BATCH = 10;
        for (let i = 0; i < editShaders.length; i++) {
          if (thumbsCancelled) break; // Stop if component was destroyed
          try {
            editShaders[i].thumbnail = await generateCachedThumbnail(editShaders[i].shaderCode, 0.5);
          } catch {}
          // Yield to main thread after EVERY thumbnail (setTimeout gives macrotask queue a chance)
          await new Promise<void>(r => setTimeout(r, 0));
          // Trigger Svelte reactivity periodically (not every single one — avoids GC churn)
          if ((i + 1) % UI_UPDATE_BATCH === 0 || i === editShaders.length - 1) {
            editShaders = [...editShaders];
          }
        }
        if (!thumbsCancelled) {
          console.log('SynthVision: All thumbnails generated, caching for future mounts.');
          // Cache to module-level so next mount is instant
          isfShaderCache.set(editShaders.map(s => ({ ...s })));
        }
      } catch (err) {
        console.error('Failed to load shaders for edit tray:', err);
        editShadersLoading = false;
        hideLoading();
        clearTimeout(safetyTimeout);
      }
    })();

    console.log('SynthVision: Initialization complete. gl:', !!gl, 'renderer:', !!renderer, 'camGl:', !!camGl);
  });

  onDestroy(() => {
    // Always dismiss loading overlay — prevents frozen UI if destroyed during init
    hideLoading();

    // Cancel any ongoing thumbnail generation
    thumbsCancelled = true;

    // Save clip assignments + VJ layer to session cache so they persist across VJ mode toggles
    sessionClipCache.save(clipAssignments, activePresetId, clipsDirty, assignedVJLayer);

    // Unassign from VJ layer
    unassignFromVJLayer();

    synthVisionStore.deactivate();
    if (animFrame) cancelAnimationFrame(animFrame);
    document.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('mousemove', xfMouseMove);
    document.removeEventListener('mouseup', xfMouseUp);
    _detachDialListeners();

    // Cleanup WebGL — release contexts to avoid exhausting browser limits
    if (gl) {
      if (fboA) { gl.deleteFramebuffer(fboA.fb); gl.deleteTexture(fboA.tex); }
      if (fboB) { gl.deleteFramebuffer(fboB.fb); gl.deleteTexture(fboB.tex); }
      if (isfTexture) gl.deleteTexture(isfTexture);
      if (postFxProgram) gl.deleteProgram(postFxProgram);
      // Explicitly lose WebGL context to free GPU resources for re-mount
      const loseExt = gl.getExtension('WEBGL_lose_context');
      if (loseExt) loseExt.loseContext();
      gl = null as any;
    }

    // Cleanup ISF renderer
    if (isfRenderer) { isfRenderer.dispose(); isfRenderer = null; }
    isfShaderInstance = null;
    isfActive = false;

    // Cleanup Camera WebGL
    if (camGl) {
      if (camFboA) { camGl.deleteFramebuffer(camFboA.fb); camGl.deleteTexture(camFboA.tex); }
      if (camFboB) { camGl.deleteFramebuffer(camFboB.fb); camGl.deleteTexture(camFboB.tex); }
      if (camVideoTexture) camGl.deleteTexture(camVideoTexture);
      if (camPrevTexture) camGl.deleteTexture(camPrevTexture);
      // Explicitly lose camera WebGL context
      const camLoseExt = camGl.getExtension('WEBGL_lose_context');
      if (camLoseExt) camLoseExt.loseContext();
      camGl = null as any;
    }

    // Stop camera if running
    stopCamera();

    // Cleanup Three.js
    clearWorld();
    if (renderer) { renderer.dispose(); renderer = null; }

    // Release shared thumbnail WebGL context
    disposeThumbnailResources();

    // Audio cleanup — shared audioStore handles its own lifecycle
    performerDeckStore.reset();
    geoDeckStore.reset();
    unsub();
  });

  // Reactive helpers for display
  $: aLayer = state?.layers?.a;
  $: bLayer = state?.layers?.b;
  $: focusedLayer = state ? state.layers[state.focus] : null;

  // XY Pad handling
  let xyPadEl: HTMLElement;
  let xyDragging = false;

  function handleXYPadMouseDown(e: MouseEvent) {
    xyDragging = true;
    updateXYFromEvent(e);
  }

  function handleXYPadMouseMove(e: MouseEvent) {
    if (xyDragging) updateXYFromEvent(e);
  }

  function handleXYPadMouseUp() {
    xyDragging = false;
  }

  function updateXYFromEvent(e: MouseEvent) {
    if (!xyPadEl) return;
    const r = xyPadEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    synthVisionStore.setMouse(x, y);
  }

  // Dial/param drag handling
  let dialDragging: SVParamKey | null = null;
  let dialStartY = 0;
  let dialStartVal = 0;

  function handleDialMouseDown(e: MouseEvent, key: SVParamKey) {
    dialDragging = key;
    dialStartY = e.clientY;
    dialStartVal = focusedLayer?.p?.[key] ?? 0.5;
    e.preventDefault();
  }

  function handleDialMouseMove(e: MouseEvent) {
    if (!dialDragging) return;
    const delta = (dialStartY - e.clientY) / 150; // Drag up = increase
    const newVal = Math.max(0, Math.min(1, dialStartVal + delta));
    synthVisionStore.setParam(dialDragging, newVal);
  }

  function handleDialMouseUp() {
    dialDragging = null;
    shaderDialDragging = null;
  }

  // Shader-specific dial handling (per-shader params)
  let shaderDialDragging: { shaderIdx: number; paramKey: string } | null = null;
  let shaderDialStartY = 0;
  let shaderDialStartVal = 0;

  function handleShaderDialMouseDown(e: MouseEvent, shaderIdx: number, paramKey: string) {
    shaderDialDragging = { shaderIdx, paramKey };
    shaderDialStartY = e.clientY;
    const currentParams = state?.shaderParams?.[shaderIdx] ?? {};
    const paramDef = SV_SHADER_DEFS[shaderIdx]?.params?.find(p => p.k === paramKey);
    shaderDialStartVal = currentParams[paramKey] ?? paramDef?.d ?? 0.5;
    e.preventDefault();
  }

  function handleShaderDialMouseMove(e: MouseEvent) {
    if (!shaderDialDragging) return;
    const delta = (shaderDialStartY - e.clientY) / 150; // Drag up = increase
    const newVal = Math.max(0, Math.min(1, shaderDialStartVal + delta));
    synthVisionStore.setShaderParam(shaderDialDragging.shaderIdx, shaderDialDragging.paramKey, newVal);
  }

  // World-specific dial handling (per-world params)
  let worldDialDragging: { worldIdx: number; paramKey: string } | null = null;
  let worldDialStartY = 0;
  let worldDialStartVal = 0;

  function handleWorldDialMouseDown(e: MouseEvent, worldIdx: number, paramKey: string) {
    worldDialDragging = { worldIdx, paramKey };
    worldDialStartY = e.clientY;
    const currentParams = state?.worldParams?.[worldIdx] ?? {};
    const paramDef = SV_WORLD_DEFS[worldIdx]?.params?.find(p => p.k === paramKey);
    worldDialStartVal = currentParams[paramKey] ?? paramDef?.d ?? 0.5;
    e.preventDefault();
  }

  function handleWorldDialMouseMove(e: MouseEvent) {
    if (!worldDialDragging) return;
    const delta = (worldDialStartY - e.clientY) / 150; // Drag up = increase
    const newVal = Math.max(0, Math.min(1, worldDialStartVal + delta));
    synthVisionStore.setWorldParam(worldDialDragging.worldIdx, worldDialDragging.paramKey, newVal);
  }

  function handleWorldDialMouseUp() {
    worldDialDragging = null;
  }

  // Global mouse move/up for dials.
  //
  // IMPORTANT: these listeners are attached once in onMount() and removed in
  // onDestroy() — previously they were inside a `$: if (typeof document !==
  // 'undefined')` reactive block, which re-attached on every Svelte reactive
  // tick and never removed. With high-frequency store churn (audio, modulation,
  // VJ clip state), that leaked 7 listeners per tick, stalling the renderer
  // after 30-90 minutes. See stability audit T1.2 for details.
  function _attachDialListeners() {
    document.addEventListener('mousemove', handleDialMouseMove);
    document.addEventListener('mousemove', handleShaderDialMouseMove);
    document.addEventListener('mousemove', handleWorldDialMouseMove);
    document.addEventListener('mouseup', handleDialMouseUp);
    document.addEventListener('mouseup', handleWorldDialMouseUp);
    document.addEventListener('mousemove', handleXYPadMouseMove);
    document.addEventListener('mouseup', handleXYPadMouseUp);
  }
  function _detachDialListeners() {
    document.removeEventListener('mousemove', handleDialMouseMove);
    document.removeEventListener('mousemove', handleShaderDialMouseMove);
    document.removeEventListener('mousemove', handleWorldDialMouseMove);
    document.removeEventListener('mouseup', handleDialMouseUp);
    document.removeEventListener('mouseup', handleWorldDialMouseUp);
    document.removeEventListener('mousemove', handleXYPadMouseMove);
    document.removeEventListener('mouseup', handleXYPadMouseUp);
  }
</script>

<!-- Hidden canvases for rendering (output goes to VJ layer) -->
<div class="sv-hidden-canvases">
  <canvas bind:this={shaderCanvas}></canvas>
  <canvas bind:this={threeCanvas}></canvas>
  <canvas bind:this={outputCanvas}></canvas>
  <canvas bind:this={camCanvas}></canvas>
</div>

<div class="sv-root" on:click={() => { if (state.showSplash) dismissSplash(); }}>
  <!-- HEADER -->
  <div class="sv-header">
    <div class="sv-logo">PERFORMER</div>
    <div class="sv-deck-tabs">
      <button class="sv-deck-tab active" title="Shader clip instrument">SHADER MODE</button>
    </div>

    <!-- VJ Layer Assignment -->
    <div class="sv-vj-assign">
      <span class="sv-vj-lbl">VJ LAYER</span>
      {#each Array($vjClipLauncher.numLayers) as _, i}
        <button class="sv-vj-btn" class:on={assignedVJLayer === i} on:click={() => assignToVJLayer(i)}>{i + 1}</button>
      {/each}
    </div>

    <!-- BPM Section -->
    <div class="sv-bpm-section"
      data-midi-path="sv:bpm"
      data-midi-label="BPM"
      data-midi-min="40"
      data-midi-max="300"
      data-midi-step="1">
      <button class="sv-bpm-btn" on:click={() => synthVisionStore.nudgeBpm(-5)}>-5</button>
      <div class="sv-bpm-display">
        <span class="sv-bpm-val">{state?.bpm || 120}</span>
        <span class="sv-bpm-lbl">BPM</span>
      </div>
      <button class="sv-bpm-btn" on:click={() => synthVisionStore.nudgeBpm(5)}>+5</button>
      <button class="sv-tap-btn" on:click={tapBPM}>TAP</button>
      <div class="sv-beat-indicator" class:flash={state && state.bp < .15}></div>
      <button class="sv-sync-btn" class:on={state?.bpmSync} on:click={() => synthVisionStore.toggleSync()}>SYNC</button>
    </div>

    <!-- Reactivity Mode picker. Controls how the Milkdrop-style smooth
         audio follower's outputs flow into world params:
           OFF        — silent
           SMOOTH     — bass_att only, no envelopes (elegant breathing)
           DEFAULT    — smooth + kick/snare onset envelopes
           AGGRESSIVE — smooth + envelopes + BPM LFO + raw bass blend
         See `milkdropFollower.ts` for the underlying math. -->
    <div class="sv-react-section" title={SV_REACTIVITY_MODES.find(m => m.id === state?.reactivityMode)?.description ?? ''}>
      <span class="sv-react-lbl">REACT</span>
      <select
        class="sv-react-select"
        value={state?.reactivityMode ?? 'smooth'}
        on:change={(e) => synthVisionStore.setReactivityMode((e.currentTarget as HTMLSelectElement).value as SVReactivityMode)}
      >
        {#each SV_REACTIVITY_MODES as m}
          <option value={m.id}>{m.label}</option>
        {/each}
      </select>
    </div>

    <!-- Quick Actions
         Audio source picker lives in the VJ top bar (single source of truth
         across modes) — Performer just reads $audioStore.isActive.
         DRIFT  → slowly randomizes performer params over time for a
                  self-evolving look (toggle on, walk away).
         AUTO   → auto-cycles to a new random shader/world every few seconds
                  (interval is set in the performer's auto-mode config). -->
    <div class="sv-quick-actions">
      <button class="sv-action-btn" class:on={state?.drift}
        on:click={() => synthVisionStore.toggleDrift()}
        title="DRIFT: slowly randomize all performer params over time. Hands-free evolution.">DRIFT</button>
      <button class="sv-action-btn" class:on={state?.autoMode}
        on:click={toggleShaderAuto}
        title="SHADER AUTO: auto-cycle to a new random shader / world at the configured interval.">SHADER AUTO</button>
    </div>

    <button class="sv-edit-btn" class:active={performerEditMode} on:click={() => performerEditMode = !performerEditMode}>
      {performerEditMode ? '✓ EDIT' : 'EDIT'}
    </button>
    {#if performerEditMode}
      <button class="sv-reset-btn" on:click={() => { clipAssignments = {}; activePresetId = null; clipsDirty = false; }}>RESET</button>
    {/if}
    <button class="sv-close-btn" on:click={handleClose}>X</button>
  </div>

  <!-- MAIN CONTROLS -->
  <div class="sv-main">
    <!-- LEFT: XY Pad + Layer Mixer -->
    <div class="sv-left-col">
      <!-- XY Pad -->
      <div class="sv-xy-section">
        <div class="sv-section-title">XY PAD</div>
        <div class="sv-xy-pad" bind:this={xyPadEl}
          on:mousedown={handleXYPadMouseDown}>
          <div class="sv-xy-crosshair-h" style="top:{(state?.my ?? 0.5) * 100}%"></div>
          <div class="sv-xy-crosshair-v" style="left:{(state?.mx ?? 0.5) * 100}%"></div>
          <div class="sv-xy-dot" style="left:{(state?.mx ?? 0.5) * 100}%;top:{(state?.my ?? 0.5) * 100}%"></div>
        </div>
      </div>

      <!-- A/B mixer removed — X/Y pad takes full space -->
    </div>

    <!-- CENTER: Clip Grid - Keyboard Layout with Side Panels -->
    <div class="sv-center-col">
      <div class="sv-keyboard-area">
        <!-- LEFT SIDE: Camera Controls -->
        <div class="sv-kb-side sv-kb-left">
          <div class="sv-section-title">LIVE CAMERA</div>
          <button class="sv-cam-toggle" class:active={state?.camActive} on:click={toggleCamera}>
            <span class="sv-cam-icon">{state?.camActive ? '[ ON ]' : '[ OFF ]'}</span>
            <span class="sv-cam-label">{state?.camActive ? 'STREAMING' : 'CLICK TO START'}</span>
          </button>
          {#if state?.camActive}
            <div class="sv-cam-blend-row">
              <span class="sv-cam-blend-lbl">BLEND</span>
              <div class="sv-cam-blend-controls">
                <button class="sv-cam-blend-btn" on:click={() => synthVisionStore.cycleCamBlend(-1)}>&lt;</button>
                <span class="sv-cam-blend-val">{SV_CAM_BLENDS[state?.camBlend ?? 0]?.name || 'ADD'}</span>
                <button class="sv-cam-blend-btn" on:click={() => synthVisionStore.cycleCamBlend(1)}>&gt;</button>
              </div>
            </div>
            <div class="sv-cam-opacity-vert">
              <span class="sv-cam-opacity-lbl">OPACITY</span>
              <input type="range" min="0" max="1" step="0.05"
                data-midi-path="sv:camOpacity"
                data-midi-label="Camera Opacity"
                data-midi-min="0"
                data-midi-max="1"
                value={state?.camOpacity ?? 0.8}
                on:input={(e) => synthVisionStore.setCamOpacity(parseFloat((e.target as HTMLInputElement).value))} />
              <span class="sv-cam-opacity-val">{Math.round((state?.camOpacity ?? 0.8) * 100)}%</span>
            </div>
            <div class="sv-cam-mode-row">
              <span class="sv-cam-mode-lbl">MODE</span>
              <button class="sv-cam-nav" on:click={() => synthVisionStore.cycleCamMode(-1)}>&lt;</button>
              <span class="sv-cam-mode-name">{SV_CAM_MODES.find(m => m.id === state?.camMode)?.name || 'DIRECT'}</span>
              <button class="sv-cam-nav" on:click={() => synthVisionStore.cycleCamMode(1)}>&gt;</button>
            </div>
          {/if}

          <!-- Shader Mix -->
          <div class="sv-section-title sv-shader-mix-title">SHADER MIX</div>
          <button class="sv-shader-mix-btn" class:active={shaderMixActive}
            on:click={() => { shaderMixActive = !shaderMixActive; if (shaderMixActive) randomizeAll(); }}>
            <span class="sv-shader-mix-icon">&#9876;</span>
            <span class="sv-shader-mix-label">{shaderMixActive ? 'MIXING' : 'START MIX'}</span>
          </button>
          {#if shaderMixActive}
            <div class="sv-shader-mix-hint">Press <kbd>TAB</kbd> to randomize</div>
          {/if}
        </div>

        <!-- CENTER: Keyboard -->
        <div class="sv-kb-center">
          <div class="sv-section-title">CLIPS {#if performerEditMode}<span class="sv-assign-hint">(drag items onto keys to assign)</span>{/if}</div>
          <div class="sv-keyboard" class:edit-mode={performerEditMode}>
            <!-- Row 1: 1-0 (10 keys) -->
            <div class="sv-kb-row sv-kb-row1">
              {#each SV_CLIP_ROW1 as clip, i}
                {@const label = getClipLabel(i, clipAssignments)}
                <button class="sv-clip-btn"
                  data-midi-path="sv:clip:{i}"
                  data-midi-label="Clip {clip.key}"
                  data-midi-mode="toggle"
                  class:assigned={label.isAssigned && !label.isMedia}
                  class:media-assigned={label.isMedia}
                  class:has-thumb={!!label.thumbnail}
                  class:drag-over={performerEditMode && dragOverClipSlot === i}
                  style={label.thumbnail ? `background-image:url('${label.thumbnail}')` : ''}
                  on:click={() => { if (!performerEditMode) triggerClip(i); }}
                  on:contextmenu={(e) => { if (performerEditMode && clipAssignments[i]) { e.preventDefault(); delete clipAssignments[i]; clipAssignments = clipAssignments; clipsDirty = true; } }}
                  on:dragover={(e) => { if (performerEditMode) handleClipDragOver(e, i); }}
                  on:dragleave={() => { if (performerEditMode) handleClipDragLeave(i); }}
                  on:drop={(e) => { if (performerEditMode) handleClipDrop(e, i); }}>
                  <span class="sv-clip-key">{clip.key}</span>
                  <span class="sv-clip-name">{label.name}</span>
                  <span class="sv-clip-desc">{label.desc}</span>
                </button>
              {/each}
            </div>
            <!-- Row 2: Q-P (10 keys) -->
            <div class="sv-kb-row sv-kb-row2">
              {#each SV_CLIP_ROW2 as clip, i}
                {@const clipPos = 10 + i}
                {@const label = getClipLabel(clipPos, clipAssignments)}
                <button class="sv-clip-btn"
                  data-midi-path="sv:clip:{clipPos}"
                  data-midi-label="Clip {clip.key}"
                  data-midi-mode="toggle"
                  class:assigned={label.isAssigned && !label.isMedia}
                  class:media-assigned={label.isMedia}
                  class:has-thumb={!!label.thumbnail}
                  class:drag-over={performerEditMode && dragOverClipSlot === clipPos}
                  style={label.thumbnail ? `background-image:url('${label.thumbnail}')` : ''}
                  on:click={() => { if (!performerEditMode) triggerClip(clipPos); }}
                  on:contextmenu={(e) => { if (performerEditMode && clipAssignments[clipPos]) { e.preventDefault(); delete clipAssignments[clipPos]; clipAssignments = clipAssignments; clipsDirty = true; } }}
                  on:dragover={(e) => { if (performerEditMode) handleClipDragOver(e, clipPos); }}
                  on:dragleave={() => { if (performerEditMode) handleClipDragLeave(clipPos); }}
                  on:drop={(e) => { if (performerEditMode) handleClipDrop(e, clipPos); }}>
                  <span class="sv-clip-key">{clip.key}</span>
                  <span class="sv-clip-name">{label.name}</span>
                  <span class="sv-clip-desc">{label.desc}</span>
                </button>
              {/each}
            </div>
            <!-- Row 3: A-L (9 keys) -->
            <div class="sv-kb-row sv-kb-row3">
              {#each SV_CLIP_ROW3 as clip, i}
                {@const clipPos = 20 + i}
                {@const label = getClipLabel(clipPos, clipAssignments)}
                <button class="sv-clip-btn"
                  data-midi-path="sv:clip:{clipPos}"
                  data-midi-label="Clip {clip.key}"
                  data-midi-mode="toggle"
                  class:assigned={label.isAssigned && !label.isMedia}
                  class:media-assigned={label.isMedia}
                  class:has-thumb={!!label.thumbnail}
                  class:drag-over={performerEditMode && dragOverClipSlot === clipPos}
                  style={label.thumbnail ? `background-image:url('${label.thumbnail}')` : ''}
                  on:click={() => { if (!performerEditMode) triggerClip(clipPos); }}
                  on:contextmenu={(e) => { if (performerEditMode && clipAssignments[clipPos]) { e.preventDefault(); delete clipAssignments[clipPos]; clipAssignments = clipAssignments; clipsDirty = true; } }}
                  on:dragover={(e) => { if (performerEditMode) handleClipDragOver(e, clipPos); }}
                  on:dragleave={() => { if (performerEditMode) handleClipDragLeave(clipPos); }}
                  on:drop={(e) => { if (performerEditMode) handleClipDrop(e, clipPos); }}>
                  <span class="sv-clip-key">{clip.key}</span>
                  <span class="sv-clip-name">{label.name}</span>
                  <span class="sv-clip-desc">{label.desc}</span>
                </button>
              {/each}
            </div>
            <!-- Row 4: Z-M (7 keys) -->
            <div class="sv-kb-row sv-kb-row4">
              {#each SV_CLIP_ROW4 as clip, i}
                {@const clipPos = 29 + i}
                {@const label = getClipLabel(clipPos, clipAssignments)}
                <button class="sv-clip-btn"
                  data-midi-path="sv:clip:{clipPos}"
                  data-midi-label="Clip {clip.key}"
                  data-midi-mode="toggle"
                  class:assigned={label.isAssigned && !label.isMedia}
                  class:media-assigned={label.isMedia}
                  class:has-thumb={!!label.thumbnail}
                  class:drag-over={performerEditMode && dragOverClipSlot === clipPos}
                  style={label.thumbnail ? `background-image:url('${label.thumbnail}')` : ''}
                  on:click={() => { if (!performerEditMode) triggerClip(clipPos); }}
                  on:contextmenu={(e) => { if (performerEditMode && clipAssignments[clipPos]) { e.preventDefault(); delete clipAssignments[clipPos]; clipAssignments = clipAssignments; clipsDirty = true; } }}
                  on:dragover={(e) => { if (performerEditMode) handleClipDragOver(e, clipPos); }}
                  on:dragleave={() => { if (performerEditMode) handleClipDragLeave(clipPos); }}
                  on:drop={(e) => { if (performerEditMode) handleClipDrop(e, clipPos); }}>
                  <span class="sv-clip-key">{clip.key}</span>
                  <span class="sv-clip-name">{label.name}</span>
                  <span class="sv-clip-desc">{label.desc}</span>
                </button>
              {/each}
            </div>
          </div>
          <!-- SPACE selector - inline under keyboard keys -->
          <div class="sv-selectors-row">
            <div class="sv-selector-horiz">
              <span class="sv-sel-lbl">SPACE</span>
              <button class="sv-sel-btn" on:click={() => synthVisionStore.cycleSpace(-1)}>&lt;</button>
              <span class="sv-sel-val">{SV_SPACES[focusedLayer?.space ?? 0]}</span>
              <button class="sv-sel-btn" on:click={() => synthVisionStore.cycleSpace(1)}>&gt;</button>
            </div>
          </div>
        </div>

        <!-- RIGHT SIDE: 3D Worlds -->
        <div class="sv-kb-side sv-kb-right">
          <div class="sv-section-title">3D WORLDS</div>
          <div class="sv-world-grid-vert">
            {#each SV_WORLDS as world, i}
              <button class="sv-world-btn" class:on={worldsEnabled && focusedLayer && focusedLayer.world === i}
                class:worlds-off={!worldsEnabled}
                on:click={() => { if (worldsEnabled) synthVisionStore.setWorld(i); }}>
                {world}
              </button>
            {/each}
          </div>
          <button class="sv-worlds-toggle" class:on={worldsEnabled}
            on:click={() => worldsEnabled = !worldsEnabled}>
            {worldsEnabled ? '3D ON' : '3D OFF'}
          </button>
        </div>
      </div>
    </div>

    <!-- RIGHT: Param Dials + Actions -->
    <div class="sv-right-col">
      <!-- Tab selector for Effects vs Shader vs World params -->
      <div class="sv-param-tabs">
        <button class="sv-param-tab" class:active={state?.paramTab === 'effects'} on:click={() => synthVisionStore.setParamTab('effects')}>EFFECTS</button>
        <button class="sv-param-tab" class:active={state?.paramTab === 'shader'} on:click={() => synthVisionStore.setParamTab('shader')}>SHADER</button>
        <button class="sv-param-tab world" class:active={state?.paramTab === 'world'} on:click={() => synthVisionStore.setParamTab('world')}>WORLD</button>
      </div>

      {#if state?.paramTab === 'effects'}
        <!-- Layer Effects (applied to SynthVision's VJ layer) -->
        <div class="sv-effects-panel">
          <div class="sv-effects-header">
            <span>Layer Effects</span>
            <button class="sv-add-fx-btn" on:click={() => showEffectPicker = true}>+ Add</button>
          </div>
          <div class="sv-effects-list">
            {#each svLayerEffects as effect (effect.id)}
              <div class="sv-effect-item" class:disabled={!effect.enabled}>
                <div class="sv-effect-header"
                  on:click={() => expandedEffectId = expandedEffectId === effect.id ? null : effect.id}>
                  <button class="sv-fx-toggle" class:active={effect.enabled}
                    on:click|stopPropagation={() => toggleSvEffect(effect.id)}>
                    {effect.enabled ? '●' : '○'}
                  </button>
                  <span class="sv-fx-name">{effect.type}</span>
                  <span class="sv-fx-expand">{expandedEffectId === effect.id ? '▼' : '▶'}</span>
                  <button class="sv-fx-delete"
                    on:click|stopPropagation={() => deleteSvEffect(effect.id)}>×</button>
                </div>
                {#if expandedEffectId === effect.id}
                  <div class="sv-effect-params">
                    {#each (EFFECT_PARAM_DEFS[effect.type] || []) as pd}
                      {@const val = (effect.params as Record<string, number>)[pd.param] ?? pd.default}
                      <div class="sv-fx-param-row"
                        data-midi-path="sv:fx:{effect.type}:{pd.param}"
                        data-midi-label="{pd.name}"
                        data-midi-min="{pd.min}"
                        data-midi-max="{pd.max}"
                        data-midi-step="{pd.step}">
                        <span class="sv-fx-param-name">{pd.name}</span>
                        {#if pd.type === 'select' && pd.options}
                          <select value={val}
                            on:change={(e) => updateSvEffectParam(effect.id, pd.param, parseFloat(e.currentTarget.value))}
                            style="flex:1; background:#222; color:#fff; border:1px solid #444; border-radius:3px; padding:2px 4px; font-size:11px;">
                            {#each pd.options as opt}
                              <option value={opt.value} selected={val === opt.value}>{opt.label}</option>
                            {/each}
                          </select>
                        {:else if pd.type === 'color' && pd.colorParams}
                          {@const cr = (effect.params as Record<string, number>)[pd.colorParams.r] ?? 0}
                          {@const cg = (effect.params as Record<string, number>)[pd.colorParams.g] ?? 1}
                          {@const cb = (effect.params as Record<string, number>)[pd.colorParams.b] ?? 0.4}
                          {@const hexVal = '#' + [cr,cg,cb].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}
                          <input type="color" value={hexVal}
                            on:input={(e) => {
                              const hex = e.currentTarget.value;
                              const r = parseInt(hex.slice(1,3), 16) / 255;
                              const g = parseInt(hex.slice(3,5), 16) / 255;
                              const b = parseInt(hex.slice(5,7), 16) / 255;
                              if (pd.colorParams) {
                                updateSvEffectParam(effect.id, pd.colorParams.r, r);
                                updateSvEffectParam(effect.id, pd.colorParams.g, g);
                                updateSvEffectParam(effect.id, pd.colorParams.b, b);
                              }
                            }}
                            style="flex:0 0 40px; height:22px; padding:0; border:1px solid #444; border-radius:3px; cursor:pointer;" />
                        {:else}
                          <input type="range" min={pd.min} max={pd.max} step={pd.step}
                            value={val}
                            on:input={(e) => updateSvEffectParam(effect.id, pd.param,
                              parseFloat(e.currentTarget.value))} />
                          <span class="sv-fx-param-val">{val.toFixed(pd.step < 0.1 ? 2 : 1)}</span>
                        {/if}
                      </div>
                    {/each}
                    {#if (EFFECT_PARAM_DEFS[effect.type] || []).length === 0}
                      <div class="sv-fx-no-params">No adjustable parameters</div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
            {#if svLayerEffects.length === 0}
              <div class="sv-fx-empty">No effects — tap + Add</div>
            {/if}
          </div>
        </div>
      {:else if state?.paramTab === 'shader'}
        {#if activeISFInputs.length > 0}
          <!-- ISF Shader controls from active VJ clip -->
          <div class="sv-shader-info">
            <span class="sv-shader-name isf">{activeISFName}</span>
          </div>
          <div class="sv-isf-controls">
            {#each activeISFInputs as input}
              {@const val = getISFValue(input)}
              {@const canModulate = input.TYPE === 'float' || (input.TYPE === 'long' && !input.VALUES)}
              {@const mod = canModulate ? getSvShaderMod(input.NAME) : undefined}
              {@const isModulated = mod && mod.source !== 'manual'}
              <div class="sv-isf-control" class:sv-modulated={isModulated}
                data-midi-path="sv:isf:{input.NAME}"
                data-midi-label="{input.LABEL || input.NAME}"
                data-midi-min="{input.MIN ?? 0}"
                data-midi-max="{input.MAX ?? 1}">
                <div class="sv-isf-header">
                  <label class="sv-isf-label">{input.LABEL || input.NAME}</label>
                  {#if input.TYPE === 'float' || (input.TYPE === 'long' && !input.VALUES)}
                    <select class="sv-mod-select" class:active={isModulated} value={mod?.source || 'manual'}
                      on:change={(e) => setParamModSource(assignedVJLayer, input.NAME, e.currentTarget.value as ModSource)}>
                      <optgroup label="Control"><option value="manual">Manual</option></optgroup>
                      <optgroup label="Audio">
                        <option value="sub">Sub</option><option value="bass">Bass</option><option value="lowMid">Low Mid</option>
                        <option value="mid">Mid</option><option value="highMid">Hi Mid</option><option value="high">High</option>
                        <option value="amplitude">Volume</option>
                      </optgroup>
                      <optgroup label="Sync"><option value="beatPhase">Beat</option></optgroup>
                      <optgroup label="LFO">
                        <option value="lfo-sine">Sine</option><option value="lfo-saw">Saw</option>
                        <option value="lfo-square">Square</option><option value="lfo-tri">Triangle</option>
                      </optgroup>
                    </select>
                  {/if}
                </div>
                {#if input.TYPE === 'float'}
                  <div class="sv-isf-slider-row">
                    <input type="range"
                      class="sv-isf-range"
                      min={input.MIN ?? 0}
                      max={input.MAX ?? 1}
                      step={((input.MAX ?? 1) - (input.MIN ?? 0)) / 200}
                      value={typeof val === 'number' ? val : 0}
                      on:input={(e) => setISFValue(input.NAME, parseFloat(e.currentTarget.value))} />
                    <span class="sv-isf-val">{typeof val === 'number' ? val.toFixed(2) : '0'}</span>
                  </div>
                {:else if input.TYPE === 'long'}
                  {#if input.VALUES && input.LABELS}
                    <select class="sv-isf-select"
                      value={typeof val === 'number' ? val : 0}
                      on:change={(e) => setISFValue(input.NAME, parseInt(e.currentTarget.value))}>
                      {#each input.VALUES as v, vi}
                        <option value={v}>{input.LABELS[vi] || v}</option>
                      {/each}
                    </select>
                  {:else if input.VALUES}
                    <select class="sv-isf-select"
                      value={typeof val === 'number' ? val : 0}
                      on:change={(e) => setISFValue(input.NAME, parseInt(e.currentTarget.value))}>
                      {#each input.VALUES as v}
                        <option value={v}>{v}</option>
                      {/each}
                    </select>
                  {:else}
                    <div class="sv-isf-slider-row">
                      <input type="range"
                        class="sv-isf-range"
                        min={input.MIN ?? 0}
                        max={input.MAX ?? 10}
                        step="1"
                        value={typeof val === 'number' ? val : 0}
                        on:input={(e) => setISFValue(input.NAME, parseInt(e.currentTarget.value))} />
                      <span class="sv-isf-val">{typeof val === 'number' ? val : '0'}</span>
                    </div>
                  {/if}
                {:else if input.TYPE === 'bool'}
                  <button class="sv-isf-toggle" class:on={!!val}
                    on:click={() => setISFValue(input.NAME, !val)}>
                    {val ? 'ON' : 'OFF'}
                  </button>
                {:else if input.TYPE === 'color'}
                  <input type="color" class="sv-isf-color"
                    value={Array.isArray(val) ? `#${Math.round((val[0]??1)*255).toString(16).padStart(2,'0')}${Math.round((val[1]??1)*255).toString(16).padStart(2,'0')}${Math.round((val[2]??1)*255).toString(16).padStart(2,'0')}` : '#ffffff'}
                    on:input={(e) => {
                      const hex = e.currentTarget.value;
                      const r = parseInt(hex.slice(1,3),16)/255;
                      const g = parseInt(hex.slice(3,5),16)/255;
                      const b = parseInt(hex.slice(5,7),16)/255;
                      setISFValue(input.NAME, [r, g, b, 1]);
                    }} />
                {/if}
                {#if isModulated}
                  <div class="sv-mod-depth-row">
                    <span class="sv-mod-depth-label">Depth</span>
                    <input type="range" min="0" max="1" step="0.01" value={mod?.amount ?? 0.5}
                      on:input={(e) => setParamModAmount(assignedVJLayer, input.NAME, parseFloat(e.currentTarget.value))} class="sv-mod-depth-slider" />
                    <span class="sv-mod-depth-val">{((mod?.amount ?? 0.5) * 100).toFixed(0)}%</span>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <!-- Fallback: SynthVision built-in shader params -->
          {@const currentShaderIdx = focusedLayer?.sh ?? 0}
          {@const shaderDef = SV_SHADER_DEFS[currentShaderIdx]}
          {@const shaderParams = state?.shaderParams?.[currentShaderIdx] ?? {}}
          <div class="sv-shader-info">
            <span class="sv-shader-name">{shaderDef?.name ?? 'SHADER'}</span>
          </div>
          <div class="sv-dial-grid sv-shader-params">
            {#if shaderDef?.params}
              {#each shaderDef.params as param}
                <div class="sv-dial-wrap"
                  data-midi-path="sv:param:shader:{param.k}"
                  data-midi-label="{param.l}"
                  data-midi-min="0"
                  data-midi-max="1"
                  on:mousedown={(e) => handleShaderDialMouseDown(e, currentShaderIdx, param.k)}>
                  <div class="sv-dial shader">
                    <svg viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" class="sv-dial-bg shader"/>
                      <circle cx="50" cy="50" r="40" class="sv-dial-arc shader"
                        stroke-dasharray="{(shaderParams[param.k] ?? param.d) * 251.2} 251.2"
                        transform="rotate(-90 50 50)"/>
                    </svg>
                    <span class="sv-dial-val">{Math.round((shaderParams[param.k] ?? param.d) * 100)}</span>
                  </div>
                  <span class="sv-dial-lbl shader">{param.l}</span>
                </div>
              {/each}
            {/if}
          </div>
        {/if}
      {:else}
        <!-- Per-world parameters (unique to current 3D world) -->
        {@const currentWorldIdx = focusedLayer?.world ?? 0}
        {@const worldDef = SV_WORLD_DEFS[currentWorldIdx]}
        {@const worldParams = state?.worldParams?.[currentWorldIdx] ?? {}}
        <div class="sv-shader-info world">
          <span class="sv-shader-name world">{worldDef?.name ?? 'WORLD'}</span>
        </div>
        <div class="sv-dial-grid sv-world-params">
          {#if worldDef?.params}
            {#each worldDef.params as param}
              <div class="sv-dial-wrap"
                data-midi-path="sv:param:world:{param.k}"
                data-midi-label="{param.l}"
                data-midi-min="0"
                data-midi-max="1"
                on:mousedown={(e) => handleWorldDialMouseDown(e, currentWorldIdx, param.k)}>
                <div class="sv-dial world">
                  <svg viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" class="sv-dial-bg world"/>
                    <circle cx="50" cy="50" r="40" class="sv-dial-arc world"
                      stroke-dasharray="{(worldParams[param.k] ?? param.d) * 251.2} 251.2"
                      transform="rotate(-90 50 50)"/>
                  </svg>
                  <span class="sv-dial-val">{Math.round((worldParams[param.k] ?? param.d) * 100)}</span>
                </div>
                <span class="sv-dial-lbl world">{param.l}</span>
              </div>
            {/each}
          {/if}
        </div>
      {/if}

      <!-- Spacebar Effect Selector -->
      <div class="sv-section-title" style="margin-top:8px">SPACEBAR FX</div>
      <div class="sv-spacefx-selector">
        <button class="sv-spacefx-btn trigger" on:click={() => synthVisionStore.triggerSpaceFx()}>
          <span class="sv-spacefx-key">SPACE</span>
        </button>
        <div class="sv-spacefx-dropdown">
          <button class="sv-spacefx-nav" on:click={() => synthVisionStore.cycleSpaceFx(-1)}>&lt;</button>
          <div class="sv-spacefx-current">
            <span class="sv-spacefx-name">{SV_SPACE_FX.find(f => f.id === state?.spaceFx)?.name || 'PUMP'}</span>
            <span class="sv-spacefx-desc">{SV_SPACE_FX.find(f => f.id === state?.spaceFx)?.desc || ''}</span>
          </div>
          <button class="sv-spacefx-nav" on:click={() => synthVisionStore.cycleSpaceFx(1)}>&gt;</button>
        </div>
      </div>

      <div class="sv-section-title" style="margin-top:8px">ACTIONS</div>
      <div class="sv-action-grid">
        <button class="sv-big-btn pump" on:click={() => synthVisionStore.doPump()}>PUMP</button>
        <button class="sv-big-btn glitch" on:click={() => synthVisionStore.doGlitch()}>GLITCH</button>
        <button class="sv-big-btn" on:click={() => randomizeAll()}>RANDOM</button>
        <button class="sv-big-btn invert" class:on={state?.invert} on:click={() => synthVisionStore.toggleInvert()}>INVERT</button>
        <button class="sv-big-btn black" class:on={state?.blackout > 0.5} on:click={() => synthVisionStore.doBlackout()}>BLACK</button>
        <button class="sv-big-btn white" class:on={state?.whiteout > 0.5} on:click={() => synthVisionStore.doWhiteout()}>WHITE</button>
      </div>
    </div>

    <!-- EDIT MODE: Inline Media Tray -->
    {#if performerEditMode}
      <div class="sv-edit-tray">
        <div class="sv-edit-tray-tabs">
          <button class="sv-edit-tab" class:active={editMediaTab === 'fx'} on:click={() => editMediaTab = 'fx'}>FX</button>
          <button class="sv-edit-tab" class:active={editMediaTab === 'vid'} on:click={() => editMediaTab = 'vid'}>VID</button>
          <button class="sv-edit-tab" class:active={editMediaTab === 'img'} on:click={() => editMediaTab = 'img'}>IMG</button>
        </div>
        <div class="sv-edit-tray-list">
          {#if editMediaTab === 'fx'}
            {#if editShadersLoading}
              <div class="sv-edit-empty">Loading shaders...</div>
            {:else if editShaders.length === 0}
              <div class="sv-edit-empty">No shaders found</div>
            {:else}
              {#each editShaders as shader, i}
                <div class="sv-edit-item"
                  draggable="true"
                  on:dragstart={(e) => handleEditDragStart(e, 'shader', shader)}>
                  <div class="sv-edit-item-thumb shader">
                    {#if shader.thumbnail}
                      <img src={shader.thumbnail} alt="" />
                    {:else}
                      <span>S</span>
                    {/if}
                  </div>
                  <span class="sv-edit-item-name">{shader.name}</span>
                </div>
              {/each}
            {/if}
          {:else if editMediaTab === 'vid'}
            {#each $mediaLibrary.filter(m => m.type === 'video') as item}
              <div class="sv-edit-item"
                draggable="true"
                on:dragstart={(e) => handleEditDragStart(e, 'media', undefined, item)}>
                <div class="sv-edit-item-thumb video">
                  {#if item.thumbnail}
                    <img src={item.thumbnail} alt="" />
                  {:else}
                    <span>V</span>
                  {/if}
                </div>
                <span class="sv-edit-item-name">{item.name}</span>
              </div>
            {:else}
              <div class="sv-edit-empty">No videos in media library</div>
            {/each}
          {:else}
            {#each $mediaLibrary.filter(m => m.type === 'image') as item}
              <div class="sv-edit-item"
                draggable="true"
                on:dragstart={(e) => handleEditDragStart(e, 'media', undefined, item)}>
                <div class="sv-edit-item-thumb image">
                  {#if item.thumbnail}
                    <img src={item.thumbnail} alt="" />
                  {:else}
                    <span>I</span>
                  {/if}
                </div>
                <span class="sv-edit-item-name">{item.name}</span>
              </div>
            {:else}
              <div class="sv-edit-empty">No images in media library</div>
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Preset Bar -->
  <SynthVisionPresets
    {allPresets}
    {activePresetId}
    onSave={(name, scope) => { presetSaveScope = scope; savePreset(name); }}
    onLoad={(preset) => loadPreset(preset as KeyboardPreset)}
    onDelete={(id) => deletePreset(id)}
    onUpdate={(preset) => updatePresetInPlace(preset)}
    onRename={(preset, newName) => renamePresetInPlace(preset, newName)}
  />
</div>

<!-- Hidden video element for camera -->
<video bind:this={camVideo} class="sv-cam-video" playsinline muted></video>

<!-- Effect Picker Modal (full catalog, multi-select, 3-col grid) -->
<EffectPickerModal
  bind:open={showEffectPicker}
  onAdd={handleEffectPickerAdd}
  onClose={() => showEffectPicker = false}
/>

<style>
  :root {
    /* Use global theme variables for consistent styling */
    --sv-c: var(--accent-primary, #FF6B6B);
    --sv-m: var(--accent-secondary, #FF8585);
    --sv-g: var(--success, #2ED573);
    --sv-y: var(--warning, #FFA502);
    --sv-bg: var(--bg-primary, #0a0a0c);
    --sv-bg2: var(--bg-tertiary, #141418);
    --sv-brd: var(--border-secondary, rgba(255,255,255,.06));
  }

  /* Hidden canvases for offscreen rendering */
  .sv-hidden-canvases {
    position: absolute;
    left: -9999px;
    top: -9999px;
    width: 960px;
    height: 540px;
    pointer-events: none;
    visibility: hidden;
  }
  .sv-hidden-canvases canvas {
    width: 960px;
    height: 540px;
  }

  .sv-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--sv-bg);
    color: #fff;
    font-family: 'IBM Plex Mono', 'Consolas', monospace;
    user-select: none;
    overflow: hidden;
  }

  /* HEADER */
  .sv-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 16px;
    background: var(--sv-bg2);
    border-bottom: 1px solid var(--sv-brd);
    height: 44px;
    flex-shrink: 0;
  }

  .sv-logo {
    font-family: 'Orbitron', sans-serif;
    font-weight: 900;
    font-size: 14px;
    letter-spacing: 3px;
    color: var(--sv-c);
    text-shadow: 0 0 10px rgba(187,134,252,.3);
  }
  .sv-logo em { color: var(--sv-m); font-style: normal; }

  .sv-deck-tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
  }
  .sv-deck-tab {
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--sv-brd);
    background: rgba(255,255,255,.04);
    color: rgba(255,255,255,.55);
    font-size: 10px;
    letter-spacing: .08em;
    font-weight: 700;
    cursor: pointer;
    transition: all .12s ease;
  }
  .sv-deck-tab:hover {
    border-color: rgba(255,255,255,.2);
    color: #fff;
  }
  .sv-deck-tab.active {
    border-color: var(--sv-c);
    color: var(--sv-c);
    background: rgba(255,255,255,.08);
    box-shadow: 0 0 10px rgba(255,255,255,.08);
  }
  .sv-deck-tab.geo.active {
    border-color: var(--sv-g);
    color: var(--sv-g);
  }

  /* VJ Layer Assignment */
  .sv-vj-assign {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
  }
  .sv-vj-lbl {
    font-size: 9px;
    opacity: .4;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .sv-vj-btn {
    width: 28px;
    height: 24px;
    background: rgba(255,255,255,.04);
    border: 1px solid var(--sv-brd);
    color: rgba(255,255,255,.4);
    font-family: 'Orbitron', sans-serif;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all .1s;
  }
  .sv-vj-btn:hover { border-color: rgba(255,255,255,.2); color: #fff; }
  .sv-vj-btn.on {
    background: rgba(187,134,252,.15);
    border-color: var(--sv-c);
    color: var(--sv-c);
    box-shadow: 0 0 8px rgba(187,134,252,.2);
  }

  /* BPM Section */
  .sv-bpm-section {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  .sv-bpm-btn {
    padding: 4px 8px;
    background: rgba(255,255,255,.04);
    border: 1px solid var(--sv-brd);
    color: rgba(255,255,255,.5);
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    cursor: pointer;
    transition: all .1s;
  }
  .sv-bpm-btn:hover { background: rgba(255,255,255,.08); color: #fff; }
  .sv-bpm-display {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 50px;
  }
  .sv-bpm-val {
    font-family: 'Orbitron', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: var(--sv-c);
    line-height: 1;
  }
  .sv-bpm-lbl {
    font-size: 7px;
    opacity: .3;
    letter-spacing: 1px;
  }
  .sv-tap-btn {
    padding: 6px 14px;
    background: linear-gradient(135deg, rgba(187,134,252,.15), rgba(187,134,252,.05));
    border: 1px solid rgba(187,134,252,.3);
    color: var(--sv-c);
    font-family: 'Orbitron', sans-serif;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    transition: all .1s;
  }
  .sv-tap-btn:hover { background: linear-gradient(135deg, rgba(187,134,252,.25), rgba(187,134,252,.1)); }
  .sv-tap-btn:active { transform: scale(.95); }
  .sv-beat-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255,255,255,.1);
    transition: all .05s;
  }
  .sv-beat-indicator.flash {
    background: var(--sv-c);
    box-shadow: 0 0 12px var(--sv-c);
  }
  .sv-sync-btn {
    padding: 4px 10px;
    background: rgba(255,255,255,.04);
    border: 1px solid var(--sv-brd);
    color: rgba(255,255,255,.4);
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    cursor: pointer;
    transition: all .1s;
  }
  .sv-sync-btn.on {
    background: rgba(105,240,174,.1);
    border-color: var(--sv-g);
    color: var(--sv-g);
  }
  .sv-react-section {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
  }
  .sv-react-lbl {
    font-family: 'Orbitron', sans-serif;
    font-size: 8px;
    letter-spacing: 1.5px;
    opacity: .45;
    color: #fff;
  }
  .sv-react-select {
    padding: 4px 8px;
    background: rgba(255,255,255,.04);
    border: 1px solid var(--sv-brd);
    color: rgba(255,255,255,.7);
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    letter-spacing: 1px;
    cursor: pointer;
    outline: none;
    border-radius: 2px;
  }
  .sv-react-select:hover { background: rgba(255,255,255,.08); color: #fff; }
  .sv-react-select:focus { border-color: var(--sv-c); }

  /* Quick Actions */
  .sv-quick-actions {
    display: flex;
    gap: 4px;
  }
  .sv-action-btn {
    padding: 6px 12px;
    background: rgba(255,255,255,.04);
    border: 1px solid var(--sv-brd);
    color: rgba(255,255,255,.5);
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    cursor: pointer;
    transition: all .1s;
  }
  .sv-action-btn:hover { background: rgba(255,255,255,.08); color: #fff; }
  .sv-action-btn.on {
    background: rgba(105,240,174,.1);
    border-color: var(--sv-g);
    color: var(--sv-g);
  }

  .sv-close-btn {
    width: 32px;
    height: 32px;
    background: rgba(255,0,170,.1);
    border: 1px solid rgba(255,0,170,.3);
    color: var(--sv-m);
    font-family: 'Orbitron', sans-serif;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: all .1s;
    margin-left: 8px;
  }
  .sv-close-btn:hover { background: rgba(255,0,170,.2); }

  /* MAIN LAYOUT */
  .sv-main {
    flex: 1;
    display: flex;
    overflow: hidden;
    gap: 1px;
    background: var(--sv-brd);
  }

  /* GEO MODE LAYOUT */
  .sv-geo-main {
    flex: 1;
    display: grid;
    grid-template-columns: 300px 1fr 320px;
    gap: 1px;
    width: 100%;
    min-width: 0;
    background: var(--sv-brd);
  }
  .sv-geo-col {
    background: var(--sv-bg);
    padding: 12px;
    min-height: 0;
  }
  .sv-geo-form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 6px;
  }
  .sv-geo-tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .sv-geo-tab-btn {
    height: 28px;
    border: 1px solid var(--sv-brd);
    background: rgba(255,255,255,.04);
    color: rgba(255,255,255,.6);
    font-size: 10px;
    letter-spacing: .06em;
    font-weight: 700;
    cursor: pointer;
  }
  .sv-geo-tab-btn.on {
    border-color: var(--sv-g);
    color: var(--sv-g);
    background: rgba(46, 213, 115, .12);
  }
  .sv-geo-scenes {
    display: grid;
    gap: 6px;
  }
  .sv-geo-scene-item {
    display: grid;
    grid-template-columns: 1fr 52px;
    gap: 6px;
  }
  .sv-geo-scene-btn {
    border: 1px solid var(--sv-brd);
    background: rgba(255,255,255,.03);
    color: var(--text-primary, #ddd);
    font-size: 10px;
    padding: 5px 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
  }
  .sv-geo-scene-btn small {
    font-size: 9px;
    color: rgba(255,255,255,.55);
  }
  .sv-geo-scene-btn.on {
    border-color: var(--sv-c);
    color: var(--sv-c);
    background: rgba(255,255,255,.08);
  }
  .sv-geo-scene-store {
    border: 1px solid var(--sv-brd);
    background: rgba(255,255,255,.03);
    color: rgba(255,255,255,.65);
    font-size: 9px;
    letter-spacing: .06em;
    cursor: pointer;
  }
  .sv-geo-morph-controls {
    display: grid;
    grid-template-columns: 62px 1fr 44px;
    gap: 8px;
    align-items: center;
  }
  .sv-geo-morph-controls select {
    height: 24px;
    background: rgba(255,255,255,.05);
    color: var(--text-primary, #ddd);
    border: 1px solid var(--sv-brd);
    font-size: 10px;
  }
  .sv-geo-form-btn {
    border: 1px solid var(--sv-brd);
    background: rgba(255,255,255,.03);
    color: var(--text-primary, #ddd);
    text-align: left;
    padding: 8px;
    cursor: pointer;
    transition: all .12s ease;
    min-height: 58px;
  }
  .sv-geo-form-btn:hover {
    border-color: rgba(255,255,255,.2);
    background: rgba(255,255,255,.06);
  }
  .sv-geo-form-btn.on {
    border-color: var(--sv-g);
    background: rgba(46, 213, 115, .12);
    box-shadow: inset 0 0 12px rgba(46, 213, 115, .08);
  }
  .sv-geo-form-name {
    display: block;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .08em;
    margin-bottom: 4px;
  }
  .sv-geo-form-hint {
    display: block;
    font-size: 10px;
    color: rgba(255,255,255,.55);
  }
  .sv-geo-shortcuts {
    margin-top: 10px;
    border-top: 1px solid var(--sv-brd);
    padding-top: 8px;
    display: grid;
    gap: 4px;
  }
  .sv-geo-shortcut {
    font-size: 10px;
    color: rgba(255,255,255,.6);
    letter-spacing: .05em;
  }
  .sv-xy-pad-geo {
    min-height: 300px;
    margin-top: 8px;
    background:
      radial-gradient(circle at 50% 50%, rgba(255,255,255,.06), transparent 55%),
      linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.01));
  }
  .sv-geo-status-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 10px;
  }
  .sv-geo-stat {
    border: 1px solid var(--sv-brd);
    background: rgba(255,255,255,.03);
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sv-geo-stat-label {
    font-size: 9px;
    letter-spacing: .1em;
    color: rgba(255,255,255,.5);
  }
  .sv-geo-stat-value {
    font-size: 12px;
    font-weight: 800;
    color: #fff;
    letter-spacing: .06em;
  }
  .sv-geo-slider-wrap {
    display: grid;
    grid-template-columns: 62px 1fr 34px;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
  }
  .sv-geo-slider-label {
    font-size: 10px;
    letter-spacing: .08em;
    color: rgba(255,255,255,.7);
  }
  .sv-geo-slider-wrap input[type="range"] {
    width: 100%;
  }
  .sv-geo-slider-val {
    font-size: 11px;
    text-align: right;
    color: var(--text-primary, #ddd);
  }
  .sv-geo-action-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
    margin-top: 8px;
  }
  .sv-geo-action-btn {
    border: 1px solid var(--sv-brd);
    background: rgba(255,255,255,.03);
    color: #dcdcdc;
    font-size: 10px;
    letter-spacing: .08em;
    font-weight: 700;
    padding: 8px 6px;
    cursor: pointer;
    transition: all .12s ease;
  }
  .sv-geo-action-btn:hover {
    border-color: rgba(255,255,255,.2);
    background: rgba(255,255,255,.08);
  }
  .sv-geo-action-btn.on {
    border-color: var(--sv-c);
    color: var(--sv-c);
    background: rgba(255,255,255,.08);
  }
  .sv-geo-footer-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 10px;
  }
  .sv-geo-matrix {
    display: grid;
    gap: 8px;
  }
  .sv-geo-route {
    border: 1px solid var(--sv-brd);
    background: rgba(255,255,255,.03);
    padding: 6px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .sv-geo-route label {
    font-size: 10px;
    color: rgba(255,255,255,.72);
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .sv-geo-route span {
    font-size: 10px;
    color: rgba(255,255,255,.6);
    text-align: right;
  }

  .sv-section-title {
    font-size: 9px;
    opacity: .35;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--sv-brd);
  }

  /* LEFT COLUMN: XY Pad + Mixer */
  .sv-left-col {
    width: 180px;
    background: var(--sv-bg);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* XY Pad */
  .sv-xy-section { flex: 1; display: flex; flex-direction: column; }
  .sv-xy-pad {
    flex: 1;
    background: linear-gradient(135deg, rgba(187,134,252,.02), rgba(255,0,170,.02));
    border: 1px solid var(--sv-brd);
    border-radius: 4px;
    position: relative;
    cursor: crosshair;
    min-height: 180px;
  }
  .sv-xy-crosshair-h {
    position: absolute;
    left: 0; right: 0;
    height: 1px;
    background: rgba(187,134,252,.2);
    pointer-events: none;
  }
  .sv-xy-crosshair-v {
    position: absolute;
    top: 0; bottom: 0;
    width: 1px;
    background: rgba(187,134,252,.2);
    pointer-events: none;
  }
  .sv-xy-dot {
    position: absolute;
    width: 16px;
    height: 16px;
    background: radial-gradient(circle, var(--sv-c) 0%, transparent 70%);
    border: 2px solid var(--sv-c);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    box-shadow: 0 0 12px var(--sv-c);
  }

  /* Layer A/B Mixer */
  .sv-mixer-section {
    display: flex;
    align-items: stretch;
    gap: 8px;
    height: 80px;
  }
  .sv-layer-box {
    flex: 1;
    background: rgba(255,255,255,.02);
    border: 1px solid var(--sv-brd);
    border-radius: 4px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all .1s;
  }
  .sv-layer-box:hover { border-color: rgba(255,255,255,.15); }
  .sv-layer-box.active {
    border-color: var(--sv-c);
    background: rgba(187,134,252,.05);
  }
  .sv-layer-letter {
    font-family: 'Orbitron', sans-serif;
    font-size: 18px;
    font-weight: 900;
    color: var(--sv-c);
  }
  .sv-layer-box:last-child .sv-layer-letter { color: var(--sv-m); }
  .sv-layer-box:last-child.active { border-color: var(--sv-m); background: rgba(255,0,170,.05); }
  .sv-layer-shader {
    font-size: 8px;
    opacity: .5;
    margin-top: 2px;
    text-align: center;
  }

  .sv-xfade-vertical {
    width: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sv-xf-range {
    writing-mode: vertical-lr;
    direction: rtl;
    -webkit-appearance: slider-vertical;
    appearance: slider-vertical;
    width: 28px;
    height: 100%;
    background: transparent;
    cursor: pointer;
    margin: 0;
    padding: 0;
  }
  .sv-xf-range::-webkit-slider-runnable-track {
    width: 6px;
    background: linear-gradient(to bottom, var(--sv-c), var(--sv-m));
    border-radius: 3px;
  }
  .sv-xf-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 8px;
    background: #fff;
    border-radius: 3px;
    border: none;
    box-shadow: 0 0 6px rgba(255,255,255,.3);
    margin-left: -5px; /* center thumb on 6px track */
  }

  /* CENTER COLUMN: Clip Grid */
  .sv-center-col {
    flex: 1;
    background: var(--sv-bg);
    padding: 12px;
    overflow-y: auto;
  }

  /* Keyboard Area with Side Panels - EXPANDED */
  .sv-keyboard-area {
    display: flex;
    gap: 20px;
    align-items: stretch;
    justify-content: center;
    min-height: 240px;
  }
  .sv-kb-side {
    width: 160px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px;
    background: rgba(0,0,0,.15);
    border-radius: 6px;
    border: 1px solid var(--sv-brd);
  }
  .sv-kb-left {
    align-items: center;
  }
  .sv-kb-right {
    align-items: center;
  }
  .sv-kb-center {
    flex-shrink: 0;
  }

  /* Keyboard Layout - LARGER KEYS */
  .sv-keyboard {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sv-kb-row {
    display: flex;
    gap: 4px;
    justify-content: center;
  }
  /* Keyboard stagger offsets */
  .sv-kb-row1 { margin-left: 0; }
  .sv-kb-row2 { margin-left: 16px; }
  .sv-kb-row3 { margin-left: 24px; }
  .sv-kb-row4 { margin-left: 40px; }

  .sv-clip-btn {
    position: relative;
    width: 54px;
    height: 56px;
    background-color: rgba(255,255,255,.02);
    background-image: none;
    background-size: cover;
    background-position: center;
    border: 1px solid var(--sv-brd);
    border-radius: 5px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    cursor: pointer;
    transition: border-color .08s, background-color .08s, box-shadow .08s;
    padding: 5px 3px 3px;
    overflow: hidden;
  }
  .sv-clip-btn:hover { border-color: rgba(255,255,255,.25); background-color: rgba(255,255,255,.05); }
  .sv-clip-btn.on {
    border-color: var(--sv-c);
    background-color: rgba(187,134,252,.12);
    box-shadow: 0 0 12px rgba(187,134,252,.2);
  }
  .sv-clip-key {
    font-family: 'Orbitron', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: rgba(255,255,255,.45);
    line-height: 1;
  }
  .sv-clip-btn.on .sv-clip-key { color: var(--sv-c); }
  .sv-clip-btn.media-assigned {
    border-color: var(--sv-g);
    background-color: rgba(46,213,115,.08);
  }
  .sv-clip-btn.media-assigned .sv-clip-key { color: var(--sv-g); }
  .sv-clip-btn.media-assigned .sv-clip-name { opacity: .85; color: var(--sv-g); }
  .sv-clip-btn.media-assigned .sv-clip-desc { color: var(--sv-g); }
  .sv-clip-btn.assigned {
    border-color: var(--sv-y);
    background-color: rgba(255,165,2,.10);
  }
  .sv-clip-btn.assigned .sv-clip-key { color: var(--sv-y); }
  .sv-clip-btn.assigned .sv-clip-name { opacity: .85; color: var(--sv-y); }
  .sv-clip-btn.assigned .sv-clip-desc { color: var(--sv-y); }
  .sv-clip-name {
    font-size: 7px;
    opacity: .55;
    text-align: center;
    overflow: hidden;
    white-space: nowrap;
    max-width: 100%;
    line-height: 1.15;
    margin-top: 3px;
  }
  .sv-clip-btn.on .sv-clip-name { opacity: .85; }
  .sv-clip-desc {
    font-size: 6px;
    opacity: .4;
    text-align: center;
    overflow: hidden;
    white-space: nowrap;
    max-width: 100%;
    line-height: 1;
    margin-top: 2px;
    color: var(--sv-c);
  }
  .sv-clip-btn.on .sv-clip-desc { opacity: .65; }

  /* World Grid - LARGER for Side Panel */
  .sv-world-grid-vert {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 5px;
    width: 100%;
  }
  .sv-world-btn {
    height: 32px;
    background: rgba(255,0,170,.03);
    border: 1px solid rgba(255,0,170,.2);
    border-radius: 4px;
    color: rgba(255,255,255,.55);
    font-size: 9px;
    font-weight: 500;
    cursor: pointer;
    transition: all .08s;
    padding: 0 4px;
  }
  .sv-world-btn:hover { border-color: rgba(255,0,170,.4); background: rgba(255,0,170,.08); }
  .sv-world-btn.on {
    border-color: var(--sv-m);
    background: rgba(255,0,170,.18);
    color: var(--sv-m);
    box-shadow: 0 0 10px rgba(255,0,170,.2);
  }
  .sv-world-btn.worlds-off {
    opacity: 0.3;
    cursor: default;
  }
  .sv-worlds-toggle {
    width: 100%;
    margin-top: 4px;
    height: 24px;
    background: rgba(255,0,170,.05);
    border: 1px solid rgba(255,0,170,.2);
    border-radius: 4px;
    color: rgba(255,255,255,.4);
    font-size: 9px;
    font-weight: 600;
    cursor: pointer;
    transition: all .12s;
    letter-spacing: 1px;
  }
  .sv-worlds-toggle:hover { border-color: rgba(255,0,170,.4); }
  .sv-worlds-toggle.on {
    background: rgba(255,0,170,.15);
    border-color: var(--sv-m);
    color: var(--sv-m);
  }

  /* Selectors - Inline under keyboard keys */
  .sv-selectors-row {
    display: flex;
    justify-content: center;
    gap: 30px;
    margin-top: 6px;
  }
  .sv-selector-horiz {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sv-sel-lbl {
    font-size: 10px;
    opacity: .5;
    font-weight: 500;
    min-width: 45px;
  }
  .sv-sel-btn {
    width: 32px;
    height: 32px;
    background: rgba(255,255,255,.05);
    border: 1px solid var(--sv-brd);
    color: rgba(255,255,255,.6);
    font-size: 16px;
    cursor: pointer;
    transition: all .1s;
    border-radius: 4px;
  }
  .sv-sel-btn:hover { background: rgba(255,255,255,.1); color: #fff; }
  .sv-sel-val {
    min-width: 80px;
    text-align: center;
    font-family: 'Orbitron', sans-serif;
    font-size: 12px;
    color: var(--sv-c);
  }

  /* Shader Mix Button */
  .sv-shader-mix-title {
    margin-top: 14px;
  }
  .sv-shader-mix-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 10px 8px;
    background: rgba(187,134,252,.04);
    border: 1px solid rgba(187,134,252,.25);
    border-radius: 6px;
    cursor: pointer;
    transition: all .15s;
    width: 100%;
  }
  .sv-shader-mix-btn:hover {
    background: rgba(187,134,252,.12);
    border-color: rgba(187,134,252,.5);
  }
  .sv-shader-mix-btn.active {
    background: rgba(187,134,252,.18);
    border-color: #BB86FC;
    box-shadow: 0 0 18px rgba(187,134,252,.25);
    animation: sv-mix-pulse 2s ease-in-out infinite;
  }
  @keyframes sv-mix-pulse {
    0%, 100% { box-shadow: 0 0 10px rgba(187,134,252,.2); }
    50% { box-shadow: 0 0 24px rgba(187,134,252,.4); }
  }
  .sv-shader-mix-icon {
    font-size: 18px;
    color: #BB86FC;
  }
  .sv-shader-mix-label {
    font-family: 'Orbitron', sans-serif;
    font-size: 10px;
    font-weight: 700;
    color: #BB86FC;
    letter-spacing: .08em;
    margin-top: 2px;
  }
  .sv-shader-mix-hint {
    font-size: 9px;
    color: var(--text-muted, #888);
    text-align: center;
    margin-top: 4px;
  }
  .sv-shader-mix-hint kbd {
    background: rgba(187,134,252,.15);
    border: 1px solid rgba(187,134,252,.3);
    border-radius: 3px;
    padding: 1px 4px;
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    color: #BB86FC;
  }

  /* LIVE CAMERA - LARGER Vertical Layout */
  .sv-cam-toggle {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 14px 10px;
    background: rgba(105,240,174,.04);
    border: 1px solid rgba(105,240,174,.25);
    border-radius: 6px;
    cursor: pointer;
    transition: all .15s;
    width: 100%;
  }
  .sv-cam-toggle:hover {
    background: rgba(105,240,174,.1);
    border-color: rgba(105,240,174,.5);
  }
  .sv-cam-toggle.active {
    background: rgba(105,240,174,.18);
    border-color: var(--sv-g);
    box-shadow: 0 0 18px rgba(105,240,174,.25);
  }
  .sv-cam-icon {
    font-family: 'Orbitron', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--sv-g);
  }
  .sv-cam-label {
    font-size: 9px;
    opacity: .55;
    margin-top: 4px;
  }
  .sv-cam-toggle.active .sv-cam-label {
    opacity: .85;
    color: var(--sv-g);
  }
  .sv-cam-blend-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    background: rgba(0,0,0,.25);
    padding: 6px 8px;
    border-radius: 5px;
  }
  .sv-cam-blend-lbl {
    font-size: 8px;
    opacity: .5;
    text-align: center;
  }
  .sv-cam-blend-controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sv-cam-blend-btn {
    width: 22px;
    height: 22px;
    background: rgba(255,255,255,.05);
    border: 1px solid var(--sv-brd);
    color: rgba(255,255,255,.6);
    font-size: 12px;
    cursor: pointer;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .sv-cam-blend-btn:hover { background: rgba(255,255,255,.1); }
  .sv-cam-blend-val {
    flex: 1;
    text-align: center;
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    color: var(--sv-g);
  }
  .sv-cam-opacity-vert {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px;
    background: rgba(0,0,0,.15);
    border-radius: 4px;
  }
  .sv-cam-opacity-lbl {
    font-size: 8px;
    opacity: .5;
  }
  .sv-cam-opacity-vert input[type="range"] {
    width: 120px;
    height: 6px;
    -webkit-appearance: none;
    background: rgba(105,240,174,.25);
    border-radius: 3px;
  }
  .sv-cam-opacity-vert input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    background: var(--sv-g);
    border-radius: 50%;
    cursor: pointer;
  }
  .sv-cam-opacity-val {
    font-family: 'Orbitron', sans-serif;
    font-size: 12px;
    color: var(--sv-g);
  }
  .sv-cam-mode-row {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    background: rgba(0,0,0,.25);
    padding: 6px 8px;
    border-radius: 5px;
  }
  .sv-cam-mode-lbl {
    font-size: 8px;
    opacity: .5;
    min-width: 36px;
  }
  .sv-cam-mode-name {
    flex: 1;
    text-align: center;
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    color: var(--sv-g);
  }
  .sv-cam-nav {
    width: 22px;
    height: 22px;
    background: rgba(255,255,255,.05);
    border: 1px solid var(--sv-brd);
    color: rgba(255,255,255,.5);
    font-size: 12px;
    cursor: pointer;
    transition: all .1s;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .sv-cam-nav:hover {
    background: rgba(255,255,255,.08);
    color: #fff;
  }
  /* Duplicate sv-cam-mode-name removed - defined above */
  .sv-cam-mode-name-old {
    font-family: 'Orbitron', sans-serif;
    font-size: 11px;
    font-weight: 700;
    color: var(--sv-g);
    display: block;
  }
  .sv-cam-mode-desc {
    font-size: 8px;
    opacity: .4;
  }
  .sv-cam-mode-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    margin-top: 4px;
  }
  .sv-cam-mode-btn {
    height: 28px;
    background: rgba(105,240,174,.02);
    border: 1px solid rgba(105,240,174,.15);
    border-radius: 3px;
    color: rgba(255,255,255,.5);
    font-size: 7px;
    cursor: pointer;
    transition: all .08s;
  }
  .sv-cam-mode-btn:hover {
    border-color: rgba(105,240,174,.3);
    background: rgba(105,240,174,.05);
  }
  .sv-cam-mode-btn.active {
    border-color: var(--sv-g);
    background: rgba(105,240,174,.15);
    color: var(--sv-g);
    box-shadow: 0 0 8px rgba(105,240,174,.15);
  }

  /* Camera Blend & Opacity Controls */
  .sv-cam-blend-row {
    display: flex;
    gap: 12px;
    margin-bottom: 8px;
  }
  .sv-cam-blend {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sv-cam-blend-lbl, .sv-cam-opacity-lbl {
    font-size: 8px;
    opacity: .4;
    width: 40px;
  }
  .sv-cam-blend-btn {
    width: 20px;
    height: 20px;
    background: rgba(255,255,255,.04);
    border: 1px solid var(--sv-brd);
    color: rgba(255,255,255,.5);
    font-size: 10px;
    cursor: pointer;
    transition: all .1s;
  }
  .sv-cam-blend-btn:hover {
    background: rgba(255,255,255,.08);
    color: #fff;
  }
  .sv-cam-blend-val {
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    color: var(--sv-g);
    min-width: 55px;
    text-align: center;
  }
  .sv-cam-opacity {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
  }
  .sv-cam-opacity input[type="range"] {
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(255,255,255,.1);
    border-radius: 2px;
    cursor: pointer;
  }
  .sv-cam-opacity input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    background: var(--sv-g);
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 0 6px rgba(105,240,174,.4);
  }
  .sv-cam-opacity-val {
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    color: var(--sv-g);
    min-width: 30px;
    text-align: right;
  }

  /* RIGHT COLUMN: Dials + Actions */
  .sv-right-col {
    width: 240px;
    background: var(--sv-bg);
    padding: 12px;
    overflow-y: auto;
  }

  /* ── Effects Panel ── */
  .sv-effects-panel { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; flex: 1; min-height: 0; }
  .sv-effects-header { display: flex; justify-content: space-between; align-items: center; padding: 2px 4px; }
  .sv-effects-header span { font-size: 10px; color: var(--text-muted, #888); text-transform: uppercase; }
  .sv-add-fx-btn { background: #BB86FC22; border: 1px solid #BB86FC44; border-radius: 4px; color: #BB86FC; font-size: 10px; padding: 2px 8px; cursor: pointer; transition: all 0.15s; }
  .sv-add-fx-btn:hover { background: #BB86FC33; border-color: #BB86FC88; }
  .sv-effects-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
  .sv-effect-item { background: var(--bg-tertiary, #1a1a1e); border: 1px solid #333; border-radius: 4px; overflow: hidden; }
  .sv-effect-item.disabled { opacity: 0.5; }
  .sv-effect-header { display: flex; align-items: center; gap: 6px; padding: 4px 6px; cursor: pointer; }
  .sv-fx-toggle { background: none; border: none; color: #BB86FC; font-size: 10px; cursor: pointer; padding: 0; }
  .sv-fx-toggle.active { color: #BB86FC; }
  .sv-fx-name { font-size: 10px; color: var(--text-primary, #ccc); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sv-fx-expand { font-size: 8px; color: #666; }
  .sv-fx-delete { background: none; border: none; color: #666; font-size: 12px; cursor: pointer; padding: 0 2px; }
  .sv-fx-delete:hover { color: #f44; }
  .sv-effect-params { padding: 4px 8px 6px; border-top: 1px solid #2a2a2a; }
  .sv-fx-param-row { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
  .sv-fx-param-name { font-size: 9px; color: var(--text-muted, #888); min-width: 50px; }
  .sv-fx-param-row input[type=range] { flex: 1; height: 3px; accent-color: #BB86FC; }
  .sv-fx-param-val { font-size: 9px; color: #666; min-width: 28px; text-align: right; }
  .sv-fx-no-params, .sv-fx-empty { font-size: 10px; color: #555; text-align: center; padding: 8px; }

  .sv-dial-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .sv-dial-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: ns-resize;
  }
  .sv-dial {
    width: 52px;
    height: 52px;
    position: relative;
  }
  .sv-dial svg {
    width: 100%;
    height: 100%;
  }
  .sv-dial-bg {
    fill: none;
    stroke: rgba(255,255,255,.06);
    stroke-width: 8;
  }
  .sv-dial-arc {
    fill: none;
    stroke: var(--sv-c);
    stroke-width: 8;
    stroke-linecap: round;
    filter: drop-shadow(0 0 4px rgba(187,134,252,.3));
  }
  .sv-dial-val {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: 'Orbitron', sans-serif;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
  }
  .sv-dial-lbl {
    font-size: 8px;
    opacity: .55;
    margin-top: 2px;
    text-transform: uppercase;
    letter-spacing: .5px;
  }
  .sv-dial-lbl.shader { color: var(--sv-m); opacity: .7; }

  /* Param tab selector */
  .sv-param-tabs {
    display: flex;
    gap: 2px;
    margin-bottom: 8px;
  }
  .sv-param-tab {
    flex: 1;
    height: 26px;
    background: rgba(255,255,255,.04);
    border: 1px solid var(--sv-brd);
    border-radius: 4px;
    color: rgba(255,255,255,.5);
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    font-weight: 600;
    cursor: pointer;
    transition: all .15s;
  }
  .sv-param-tab:hover { background: rgba(255,255,255,.08); color: #fff; }
  .sv-param-tab.active {
    background: rgba(187,134,252,.1);
    border-color: rgba(187,134,252,.4);
    color: var(--sv-c);
  }

  /* Shader-specific param styling */
  .sv-shader-info {
    text-align: center;
    margin-bottom: 8px;
    padding: 4px 8px;
    background: rgba(255,0,170,.08);
    border: 1px solid rgba(255,0,170,.3);
    border-radius: 4px;
  }
  .sv-shader-name {
    font-family: 'Orbitron', sans-serif;
    font-size: 11px;
    font-weight: 700;
    color: var(--sv-m);
    letter-spacing: 1px;
  }
  .sv-shader-params .sv-dial-arc.shader {
    stroke: var(--sv-m);
    filter: drop-shadow(0 0 4px rgba(255,0,170,.3));
  }
  .sv-shader-params .sv-dial-bg.shader {
    stroke: rgba(255,0,170,.15);
  }

  /* ISF Shader controls */
  .sv-shader-name.isf {
    color: var(--sv-y);
    font-size: 10px;
  }
  .sv-isf-controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 320px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .sv-isf-controls::-webkit-scrollbar { width: 3px; }
  .sv-isf-controls::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 2px; }
  .sv-isf-control {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 0;
    border-left: 2px solid transparent;
    padding-left: 4px;
  }
  .sv-isf-control.sv-modulated {
    border-left-color: #a855f7;
    background: rgba(168, 85, 247, 0.06);
    border-radius: 0 4px 4px 0;
  }
  .sv-isf-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
  }
  .sv-mod-select {
    font-size: 8px;
    padding: 1px 2px;
    background: #000;
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 3px;
    color: rgba(255,255,255,.5);
    cursor: pointer;
    max-width: 65px;
    font-family: 'Orbitron', sans-serif;
  }
  .sv-mod-select option {
    background: #000;
    color: var(--text-primary, #ccc);
  }
  .sv-mod-select optgroup {
    background: #000;
    color: var(--text-muted, #888);
  }
  .sv-mod-select.active {
    border-color: #a855f7;
    color: #a855f7;
    background: rgba(168, 85, 247, 0.15);
  }
  .sv-mod-select.active option {
    background: #111;
    color: var(--text-primary, #ccc);
  }
  .sv-mod-depth-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 1px;
    padding-left: 2px;
  }
  .sv-mod-depth-label {
    font-family: 'Orbitron', sans-serif;
    font-size: 7px;
    color: #a855f7;
    min-width: 24px;
    letter-spacing: .5px;
    text-transform: uppercase;
  }
  .sv-mod-depth-slider {
    flex: 1;
    height: 2px;
    accent-color: #a855f7;
  }
  .sv-mod-depth-val {
    font-family: 'Orbitron', sans-serif;
    font-size: 7px;
    color: #a855f7;
    min-width: 24px;
    text-align: right;
  }
  .sv-isf-label {
    font-family: 'Orbitron', sans-serif;
    font-size: 8px;
    font-weight: 600;
    letter-spacing: .8px;
    color: var(--sv-y);
    text-transform: uppercase;
    opacity: .85;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sv-isf-slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sv-isf-range {
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: rgba(255,165,2,.15);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }
  .sv-isf-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--sv-y);
    cursor: pointer;
    box-shadow: 0 0 6px rgba(255,165,2,.4);
  }
  .sv-isf-val {
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    color: rgba(255,255,255,.6);
    min-width: 32px;
    text-align: right;
  }
  .sv-isf-select {
    width: 100%;
    height: 24px;
    background: rgba(255,165,2,.08);
    border: 1px solid rgba(255,165,2,.3);
    border-radius: 3px;
    color: #fff;
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    padding: 0 6px;
    cursor: pointer;
    outline: none;
  }
  .sv-isf-select:hover { border-color: var(--sv-y); }
  .sv-isf-select option { background: var(--bg-secondary, #1a1a2e); }
  .sv-isf-toggle {
    width: 48px;
    height: 22px;
    border: 1px solid rgba(255,165,2,.3);
    border-radius: 3px;
    background: rgba(255,255,255,.03);
    color: rgba(255,255,255,.5);
    font-family: 'Orbitron', sans-serif;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    transition: all .1s;
  }
  .sv-isf-toggle.on {
    border-color: var(--sv-y);
    background: rgba(255,165,2,.15);
    color: var(--sv-y);
    box-shadow: 0 0 8px rgba(255,165,2,.2);
  }
  .sv-isf-color {
    width: 44px;
    height: 24px;
    border: 1px solid rgba(255,165,2,.3);
    border-radius: 3px;
    background: transparent;
    cursor: pointer;
    padding: 1px;
    flex-shrink: 0;
  }

  /* World tab button styling */
  .sv-param-tab.world.active {
    background: rgba(105,240,174,.1);
    border-color: rgba(105,240,174,.4);
    color: var(--sv-g);
  }

  /* World-specific param styling */
  .sv-shader-info.world {
    background: rgba(105,240,174,.08);
    border: 1px solid rgba(105,240,174,.3);
  }
  .sv-shader-name.world {
    color: var(--sv-g);
  }
  .sv-world-params .sv-dial-arc.world {
    stroke: var(--sv-g);
    filter: drop-shadow(0 0 4px rgba(105,240,174,.3));
  }
  .sv-world-params .sv-dial-bg.world {
    stroke: rgba(105,240,174,.15);
  }
  .sv-dial-lbl.world {
    color: var(--sv-g);
  }

  .sv-action-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }
  .sv-big-btn {
    height: 36px;
    background: rgba(255,255,255,.04);
    border: 1px solid var(--sv-brd);
    border-radius: 4px;
    color: rgba(255,255,255,.6);
    font-family: 'Orbitron', sans-serif;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    transition: all .1s;
  }
  .sv-big-btn:hover { background: rgba(255,255,255,.08); color: #fff; }
  .sv-big-btn:active { transform: scale(.97); }
  .sv-big-btn.pump { border-color: rgba(187,134,252,.3); color: var(--sv-c); }
  .sv-big-btn.pump:hover { background: rgba(187,134,252,.1); }
  .sv-big-btn.glitch { border-color: rgba(255,0,170,.3); color: var(--sv-m); }
  .sv-big-btn.glitch:hover { background: rgba(255,0,170,.1); }
  .sv-big-btn.invert.on { background: rgba(255,213,79,.15); border-color: var(--sv-y); color: var(--sv-y); }
  .sv-big-btn.black.on { background: #111; border-color: #333; color: #666; }
  .sv-big-btn.white.on { background: rgba(255,255,255,.2); border-color: #fff; color: #fff; }

  /* Spacebar Effect Selector */
  .sv-spacefx-selector {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sv-spacefx-btn {
    width: 100%;
    height: 40px;
    background: linear-gradient(135deg, rgba(255,0,170,.15), rgba(187,134,252,.1));
    border: 2px solid rgba(255,0,170,.4);
    border-radius: 6px;
    font-family: 'Orbitron', sans-serif;
    font-size: 12px;
    font-weight: 800;
    color: var(--sv-m);
    cursor: pointer;
    transition: all .15s;
    text-shadow: 0 0 8px rgba(255,0,170,.4);
  }
  .sv-spacefx-btn:hover {
    background: linear-gradient(135deg, rgba(255,0,170,.25), rgba(187,134,252,.15));
    border-color: var(--sv-m);
    transform: scale(1.02);
    box-shadow: 0 0 15px rgba(255,0,170,.3);
  }
  .sv-spacefx-btn:active {
    transform: scale(.98);
    background: linear-gradient(135deg, rgba(255,0,170,.4), rgba(187,134,252,.2));
  }
  .sv-spacefx-key {
    letter-spacing: 3px;
  }
  .sv-spacefx-dropdown {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sv-spacefx-nav {
    width: 28px;
    height: 32px;
    background: rgba(255,255,255,.04);
    border: 1px solid var(--sv-brd);
    border-radius: 4px;
    color: rgba(255,255,255,.5);
    font-family: 'Orbitron', sans-serif;
    font-size: 12px;
    cursor: pointer;
    transition: all .1s;
  }
  .sv-spacefx-nav:hover {
    background: rgba(255,255,255,.08);
    border-color: rgba(255,255,255,.2);
    color: #fff;
  }
  .sv-spacefx-current {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 8px;
    background: rgba(187,134,252,.06);
    border: 1px solid rgba(187,134,252,.2);
    border-radius: 4px;
  }
  .sv-spacefx-name {
    font-family: 'Orbitron', sans-serif;
    font-size: 11px;
    font-weight: 700;
    color: var(--sv-c);
    letter-spacing: 1px;
  }
  .sv-spacefx-desc {
    font-size: 7px;
    opacity: .4;
    text-transform: uppercase;
    letter-spacing: .5px;
    margin-top: 1px;
  }

  /* Clip button variations */
  .sv-clip-btn.video {
    border-color: rgba(105, 240, 174, .3);
    background: rgba(105, 240, 174, .05);
  }
  .sv-clip-btn.video .sv-clip-key { color: var(--sv-g); }
  .sv-clip-btn.camera {
    border-color: rgba(255, 0, 170, .3);
    background: rgba(255, 0, 170, .05);
  }
  .sv-clip-btn.camera .sv-clip-key { color: var(--sv-m); }
  .sv-clip-type {
    position: absolute;
    bottom: 2px;
    right: 3px;
    font-size: 6px;
    opacity: .5;
    letter-spacing: .5px;
  }

  @media (max-width: 1400px) {
    .sv-deck-tabs {
      display: none;
    }
    .sv-geo-main {
      grid-template-columns: 260px 1fr 280px;
    }
  }

  @media (max-width: 1100px) {
    .sv-geo-main {
      grid-template-columns: 1fr;
      overflow-y: auto;
    }
    .sv-xy-pad-geo {
      min-height: 220px;
    }
  }

  /* Hidden camera elements */
  .sv-cam-video {
    position: absolute;
    left: -9999px;
    width: 640px;
    height: 480px;
    pointer-events: none;
  }

  /* ═══ Assign Hint ═══ */
  .sv-assign-hint {
    font-size: 9px;
    font-weight: 400;
    color: rgba(255,255,255,.3);
    font-family: inherit;
    letter-spacing: 0;
  }

  /* ═══ EDIT Button ═══ */
  .sv-edit-btn {
    padding: 4px 12px;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 4px;
    color: var(--text-secondary, #aaa);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    transition: all .15s;
    font-family: inherit;
    margin-left: auto;
  }
  .sv-edit-btn:hover {
    background: rgba(255,255,255,.1);
    color: var(--text-primary, #ddd);
    border-color: rgba(255,255,255,.2);
  }
  .sv-edit-btn.active {
    background: rgba(46,213,115,.15);
    border-color: rgba(46,213,115,.4);
    color: var(--sv-g);
    box-shadow: 0 0 8px rgba(46,213,115,.15);
  }

  /* ═══ Drag-over state on clip buttons ═══ */
  .sv-clip-btn.drag-over {
    border: 2px dashed var(--sv-g) !important;
    background: rgba(46,213,115,.1) !important;
    box-shadow: inset 0 0 12px rgba(46,213,115,.15);
  }

  .sv-keyboard.edit-mode .sv-clip-btn {
    border: 1px dashed rgba(255,255,255,.15);
    cursor: default;
  }

  /* ═══ Inline Edit Media Tray ═══ */
  .sv-edit-tray {
    width: 200px;
    min-width: 200px;
    background: var(--sv-bg2);
    border-left: 1px solid var(--sv-brd);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sv-edit-tray-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--sv-brd);
    flex-shrink: 0;
  }
  .sv-edit-tab {
    flex: 1;
    padding: 6px 0;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: #666;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    transition: all .12s;
    font-family: inherit;
  }
  .sv-edit-tab:hover { color: var(--text-secondary, #aaa); }
  .sv-edit-tab.active {
    color: var(--sv-c);
    border-bottom-color: var(--sv-c);
  }
  .sv-edit-tray-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-auto-rows: 80px;
    gap: 3px;
    align-content: start;
  }
  .sv-edit-tray-list::-webkit-scrollbar { width: 3px; }
  .sv-edit-tray-list::-webkit-scrollbar-track { background: transparent; }
  .sv-edit-tray-list::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
  .sv-edit-item {
    position: relative;
    background: #333;
    border-radius: 4px;
    overflow: hidden;
    cursor: grab;
    transition: all .12s;
  }
  .sv-edit-item:hover {
    transform: scale(1.02);
    box-shadow: 0 2px 8px rgba(0,0,0,.3);
  }
  .sv-edit-item:active { cursor: grabbing; }
  .sv-edit-item-thumb {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
  }
  .sv-edit-item-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .sv-edit-item-thumb.shader {
    background: linear-gradient(135deg, #3a2a4a, #2a2a3a);
    color: #a080c0;
  }
  .sv-edit-item-thumb.video {
    background: linear-gradient(135deg, #2a3a4a, #2a2a3a);
    color: #80a0c0;
  }
  .sv-edit-item-thumb.image {
    background: linear-gradient(135deg, #3a4a2a, #2a3a2a);
    color: #a0c080;
  }
  .sv-edit-item-name {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2px 4px;
    background: rgba(0,0,0,.8);
    font-size: 9px;
    color: var(--text-primary, #eee);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sv-edit-empty {
    grid-column: 1 / -1;
    padding: 16px 8px;
    font-size: 10px;
    color: #555;
    text-align: center;
  }

  /* Thumbnail backgrounds on clip buttons */
  .sv-clip-btn.has-thumb {
    background-size: cover;
    background-position: center;
  }
  .sv-clip-btn.has-thumb::before {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,.55);
    border-radius: 4px;
    pointer-events: none;
  }
  .sv-clip-btn.has-thumb .sv-clip-key,
  .sv-clip-btn.has-thumb .sv-clip-name,
  .sv-clip-btn.has-thumb .sv-clip-desc {
    position: relative;
    z-index: 1;
    text-shadow: 0 1px 3px rgba(0,0,0,.8);
  }

  /* Reset button */
  .sv-reset-btn {
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    font-weight: 700;
    padding: 4px 8px;
    border: 1px solid rgba(255,80,80,.4);
    border-radius: 4px;
    background: rgba(255,80,80,.1);
    color: #ff5050;
    cursor: pointer;
  }
  .sv-reset-btn:hover { background: rgba(255,80,80,.25); }

  /* Preset bar */
  .sv-preset-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(0,0,0,.3);
    border-top: 1px solid var(--sv-brd);
    min-height: 34px;
  }
  .sv-preset-left {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .sv-preset-save-btn {
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    font-weight: 700;
    padding: 4px 10px;
    border: 1px solid rgba(187,134,252,.4);
    border-radius: 4px;
    background: rgba(187,134,252,.1);
    color: var(--sv-c);
    cursor: pointer;
  }
  .sv-preset-save-btn:hover { background: rgba(187,134,252,.25); }
  .sv-preset-input {
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    width: 100px;
    padding: 3px 6px;
    border: 1px solid rgba(187,134,252,.4);
    border-radius: 3px;
    background: rgba(0,0,0,.4);
    color: #fff;
    outline: none;
  }
  .sv-preset-input:focus { border-color: var(--sv-c); }
  .sv-preset-save-confirm, .sv-preset-save-cancel {
    font-family: 'Orbitron', sans-serif;
    font-size: 8px;
    font-weight: 700;
    padding: 3px 6px;
    border: 1px solid var(--sv-brd);
    border-radius: 3px;
    background: rgba(255,255,255,.05);
    color: var(--text-secondary, #aaa);
    cursor: pointer;
  }
  .sv-preset-save-confirm:hover { color: var(--sv-g); border-color: var(--sv-g); }
  .sv-preset-save-cancel:hover { color: #ff5050; border-color: #ff5050; }
  .sv-preset-list {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    flex: 1;
    scrollbar-width: none;
  }
  .sv-preset-list::-webkit-scrollbar { display: none; }
  .sv-preset-btn {
    font-family: 'Orbitron', sans-serif;
    font-size: 9px;
    font-weight: 600;
    padding: 4px 10px;
    border: 1px solid var(--sv-brd);
    border-radius: 4px;
    background: rgba(255,255,255,.03);
    color: rgba(255,255,255,.6);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .sv-preset-btn:hover { border-color: rgba(255,255,255,.25); background: rgba(255,255,255,.08); color: #fff; }
  .sv-preset-btn.active {
    border-color: var(--sv-c);
    background: rgba(187,134,252,.12);
    color: var(--sv-c);
  }
  .sv-preset-hint {
    font-size: 9px;
    color: rgba(255,255,255,.2);
    font-style: italic;
  }
  .sv-scope-toggle {
    padding: 2px 6px;
    font-size: 11px;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 3px;
    background: rgba(255,255,255,0.05);
    cursor: pointer;
    line-height: 1;
  }
  .sv-scope-toggle.global {
    border-color: rgba(100,200,255,0.4);
    background: rgba(100,200,255,0.1);
  }
  .sv-preset-scope {
    font-size: 9px;
    font-weight: bold;
    color: rgba(100,200,255,0.8);
    margin-right: 3px;
  }
  .global-preset {
    border-color: rgba(100,200,255,0.3) !important;
  }
</style>
