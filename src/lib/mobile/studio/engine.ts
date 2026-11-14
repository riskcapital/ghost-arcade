import {mobileHeavyShaderPaths,mobileRemovedShaderPaths,mobileShaderBudgets} from './shaderPerformance';
import {GhostFXMotion} from './ghostFXMotion';
import {GhostFXFeedback} from './ghostFX';
import {CameraFx,cameraFxEnabled} from './cameraFx';
import {NativeLiveSource,canReplaceNativeFeed,acquireNativeFeed,hasNativeLive,depthInputs} from './nativeLive';
import {acquireCamera} from './camera';
import {defaultFlux,fluxEffect,type FluxState} from './flux';
import { StandaloneRenderer } from '../standaloneRenderer';
import { findShader } from '../standaloneShaderList';
import { StandaloneAudio, SILENT_AUDIO, type AudioUniforms } from '../standaloneAudio';
import type { AudioSourceKind } from '../nativeAudio';
import { parseISF, type ISFInput } from '../../isf/parser';
import { StudioCompositor, type TextureInput } from './compositor';
import { getAsset } from './assets';
import { type Show, type Clip, type Layer, layerGain, clipUnavailable } from './model';
import { QualityGovernor, shaderRenderHeight, SURFACE_CLIP_CAP } from './qualityGovernor';
import { planSurfaceClips, planKey, type SurfaceClipPlan } from './surfaceClips';
import { VoiceSignals, isVoiceDrivenInput, prepareVoiceSource } from '../studioVoices';

type Prepared = { native?:NativeLiveSource; releaseCapture?:()=>void; clip: Clip; source?: string; media?: HTMLImageElement | HTMLVideoElement; url?: string };
type Slot = {
  /** A studio voice: the sound it follows by default (its vxSource), when the clip is one. */
  voice?: number;
  /** Reduced internal scale and step count for a heavy shader kept on mobile. */
  budget?:{scale:number;detail:number};
  drift?:GhostFXFeedback;
  ghostMotion?:GhostFXMotion;
  ghostBass?:number;
  ghostTime?:number;
  cameraFx?:CameraFx;
  cameraFxFailed?:boolean;
  native?:NativeLiveSource;
  releaseCapture?:()=>void;
  prepared?: Prepared;
  preparation: number;
  canvas: HTMLCanvasElement;
  renderer: StandaloneRenderer;
  effects: StandaloneRenderer;
  generation: number;
  clipId: string | null;
  video?: HTMLVideoElement;
  url?: string;
  params: ISFInput[];
  image?: HTMLImageElement;
  /** A surface clip that could not start. Its surfaces show their deck source; no retry each frame. */
  failed?: boolean;
};
/** What a slot is drawn with: a layer row, or a surface's clip at its own look. */
type SlotLook = Pick<Layer, 'params' | 'speed' | 'intensity' | 'effects'>;
const shaderSources = new Map<string, Promise<string>>();
/** A library shader's source, fetched once. Also used by the clip picker's preview. */
export function shaderSource(id: string) {
  let p = shaderSources.get(id);
  if (!p) {
    const shader = findShader(id);
    if (!shader) throw new Error('This clip is not available on this device. Hold its pad to replace it.');
    if(mobileHeavyShaderPaths.has(shader.path)||mobileRemovedShaderPaths.has(shader.path))throw new Error(`${shader.name} is not available on this device. Hold its pad to replace it.`);
    p = fetch(encodeURI(`${import.meta.env.BASE_URL}${shader.path}`))
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load ${shader.name}.`);
        return r.text();
      })
      .then((text) => (shader.voice ? prepareVoiceSource(text) : text))
      .catch((e) => {
        shaderSources.delete(id);
        throw e;
      });
    shaderSources.set(id, p);
  }
  return p;
}
export class StudioEngine {
  flux:FluxState=defaultFlux();
  private fluxGain=0;
  private fluxFrame=0;
  private slots: Slot[] = [];
  /** Surfaces playing a clip of their own: one render per different clip, shared by its surfaces. */
  private surfaceSlots = new Map<string, Slot>();
  /** Different clips the surfaces may play at once. The owner sets it from the device tier. */
  surfaceClipCap = SURFACE_CLIP_CAP.balanced;
  private surfacePlanKey = '';
  /** The surface clip plan changed (a clip started, stopped or went over the cap). */
  onSurfacePlan: (plan: SurfaceClipPlan) => void = () => {};
  private compositor: StudioCompositor;
  private compositionFX: StandaloneRenderer;
  private raf = 0;
  private dead = false;
  private audio = new StandaloneAudio();
  /** What the studio voices on the deck hear: one set of signals for all of them. */
  private voices = new VoiceSignals();
  private voiceFrame = 0;
  private mic = false;
  private frames = 0;
  private governor=new QualityGovernor();
  /** Shader detail changed to follow the frame rate (1 = full). The owner tells the performer. */
  onDetail: (detail: number, change: 'lowered' | 'raised') => void = () => {};
  get detail() { return this.governor.detail; }
  private lookTime = 0;
  private lookBeat = 0;
  beatClock?: () => number;
  private lastLookFrame = 0;
  private lastReport = 0;
  private contextFailed = false;
  blackout = false;
  frozen = false;
  testGrid = false;
  /** Set once any layer has had a clip. Until then the output shows the
   *  alignment card; after that an empty output is black, so stopping the
   *  last clip mid-set never puts the card on the projector. */
  private hadClip = false;
  /** The interactive workspace can sleep the hidden deck renderer when it is not on air. */
  previewSuspended = false;
  onStats: (fps: number) => void = () => {};
  onError: (error: string) => void = () => {};
  /**
   * Rendering has stopped: the GPU context was lost (iOS reclaims it under memory pressure or in
   * the background) or a frame could not be drawn. This engine is finished; the owner builds a new
   * one, on the same canvas once the context is restored or on a fresh canvas if it never is.
   */
  onStopped: (reason: 'lost' | 'failed', message?: string) => void = (_reason, message) => { if (message) this.onError(message); };
  /** The browser restored the lost context. Every GPU resource is gone, so rebuild the engine. */
  onRestored: () => void = () => {};
  get stopped() { return this.contextFailed; }
  /** Get the full blend shader ready before a newer blend mode is first chosen (the blend sheet calls this as it opens). */
  prepareBlends() { if (!this.contextFailed) this.compositor.prepareBlends(); }
  constructor(
    canvas: HTMLCanvasElement,
    private getShow: () => Show,
  ) {
    this.compositor = new StudioCompositor(canvas);
    this.compositor.onPaintError=message=>this.onError(message);
    this.compositor.onBlendError=message=>this.onError(message);
    this.compositionFX=new StandaloneRenderer(canvas,this.compositor.context);
    this.compositionFX.onEffectError=message=>this.onError(message);
    for (let i = 0; i < 8; i++) this.slots.push(this.newSlot());
    canvas.addEventListener('webglcontextlost', this.contextLost);
    canvas.addEventListener('webglcontextrestored', this.contextRestored);
  }
  private newSlot(): Slot {
    const c = this.compositor.canvas;
    const renderer = new StandaloneRenderer(c, this.compositor.context);
    renderer.onEffectError = message => this.onError(message);
    const effects = new StandaloneRenderer(c,this.compositor.context);
    effects.onEffectError=message=>this.onError(message);
    return { canvas: c, renderer, effects, preparation: 0, generation: 0, clipId: null, params: [] };
  }
  private contextLost = (event: Event) => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault();
    if (this.dead) return;
    this.contextFailed = true;
    cancelAnimationFrame(this.raf);
    this.onStopped('lost');
  };
  private contextRestored = () => {
    if (!this.dead) this.onRestored();
  };
  private disposePrepared(p?: Prepared) {
    p?.native?.destroy();
    p?.releaseCapture?.();
    if (p?.media instanceof HTMLVideoElement) {
      p.media.pause();
      p.media.removeAttribute('src');
      p.media.load();
    }
    if (p?.url) URL.revokeObjectURL(p.url);
  }
  prepare(index: number, clip: Clip): Promise<boolean> {
    return this.prepareSlot(this.slots[index], clip);
  }
  private async prepareSlot(s: Slot, clip: Clip): Promise<boolean> {
    const generation = ++s.preparation;
    this.disposePrepared(s.prepared);
    s.prepared = undefined;
    const p: Prepared = { clip };
    const stale = () => this.dead || s.preparation !== generation;
    try {
      if (clip.kind === 'shader') p.source = await shaderSource(clip.shaderId!);
      if(clip.kind==='depth'||(clip.kind==='camera'&&hasNativeLive())) {
        const kind=clip.kind==='depth'?'depth':clip.facing==='user'?'front':'rear';
        if(s.native&&canReplaceNativeFeed(s.native.kind,kind)){
          s.native.destroy();s.native=undefined;s.clipId=null;
        }
        const capture=await acquireNativeFeed(kind);
        if(stale()){capture.release();return false;}
        p.native=new NativeLiveSource(this.compositor.context,kind,capture,message=>this.onError(message));
      } else if(clip.kind==='camera') {
        const camera=await acquireCamera(clip.facing==='user'?'user':'environment');p.releaseCapture=camera.release;
        if(stale()){this.disposePrepared(p);return false;}
        const video=document.createElement('video');p.media=video;video.muted=true;video.playsInline=true;video.srcObject=camera.stream;
        await video.play();
        await new Promise<void>((resolve,reject)=>{if(video.readyState>=2){resolve();return;}const timer=setTimeout(()=>reject(new Error('The camera did not deliver a frame. Try launching it again.')),10000);video.onloadeddata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(new Error('Camera preview could not start.'));};});
      }
      if ((clip.kind !== 'shader' && clip.kind !== 'camera' && clip.kind !== 'depth') || clip.assetId) {
        const blob = await getAsset(clip.assetId!);
        if (!blob) throw new Error(`${clip.name}: media is missing on this device. Import the original file again.`);
        if (stale()) return false;
        p.url = URL.createObjectURL(blob);
        if (blob.type.startsWith('video/')) {
          const video = document.createElement('video');
          p.media = video;
          video.muted = true;
          video.loop = true;
          video.playsInline = true;
          video.preload = 'auto';
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('This video took too long to load. Try an H.264 MP4.')),
              15000,
            );
            video.onloadeddata = () => {
              clearTimeout(timer);
              resolve();
            };
            video.onerror = () => {
              clearTimeout(timer);
              reject(new Error('This device cannot decode this video. Try an H.264 MP4.'));
            };
            video.src = p.url!;
            video.load();
          });
        } else {
          const image = new Image();
          p.media = image;
          image.src = p.url;
          await image.decode();
        }
      }
      if (stale()) {
        this.disposePrepared(p);
        return false;
      }
      s.prepared = p;
      return true;
    } catch (e) {
      this.disposePrepared(p);
      if (!stale()) throw e;
      return false;
    }
  }
  launch(index: number, clip: Clip): Promise<boolean> {
    return this.launchSlot(this.slots[index], clip);
  }
  private async launchSlot(s: Slot, clip: Clip): Promise<boolean> {
    const generation = ++s.generation;
    if (s.prepared?.clip.id !== clip.id && !(await this.prepareSlot(s, clip))) return false;
    if (this.dead || s.generation !== generation) return false;
    const p = s.prepared;
    if (!p || p.clip.id !== clip.id) return false;
    s.prepared = undefined;
    try {
      if(p.native){s.params=clip.kind==='depth'?depthInputs:[];} else if (p.source) {
        const shader = findShader(clip.shaderId!)!;
        await s.renderer.loadShaderSource(p.source, shader.audioNative, shader.audioInject, shader.motion);
        if (this.dead || s.generation !== generation) return false;
        if (p.media instanceof HTMLVideoElement) await p.media.play();
        if (this.dead || s.generation !== generation) { this.disposePrepared(p); return false; }
        s.renderer.setShaderImage(p.media ?? null);
        s.params = parseISF(p.source).metadata.INPUTS;
        s.budget = mobileShaderBudgets[shader.path];
        const follows = s.params.find((input) => input.NAME === 'vxSource');
        s.voice = shader.voice ? Number(shader.defaults?.vxSource ?? follows?.DEFAULT ?? 0) : undefined;
      } else if (p.media) {
        if (p.media instanceof HTMLVideoElement) await p.media.play();
        if (this.dead || s.generation !== generation) {
          this.disposePrepared(p);
          return false;
        }
        s.renderer.loadMediaSource(p.media,clip.kind==='camera'&&clip.facing==='user');
        s.params = [];
      }
      this.releaseMedia(s);
      if (!p.source) { s.budget = undefined; s.voice = undefined; }
      s.native=p.native;
      s.video = p.media instanceof HTMLVideoElement ? p.media : undefined;
      s.image = p.media instanceof HTMLImageElement ? p.media : undefined;
      s.url = p.url;
      s.releaseCapture=p.releaseCapture;
      s.clipId = clip.id;
      return true;
    } catch (e) {
      this.disposePrepared(p);
      throw e;
    }
  }
  cancelPrepared(index: number) {
    const s = this.slots[index];
    s.preparation++;
    this.disposePrepared(s.prepared);
    s.prepared = undefined;
  }
  private releaseMedia(s: Slot) {
    s.drift?.destroy();s.drift=undefined;s.ghostMotion=undefined;s.ghostBass=0;s.ghostTime=undefined;
    s.cameraFx?.destroy();s.cameraFx=undefined;s.cameraFxFailed=false;
    s.native?.destroy();s.native=undefined;
    s.releaseCapture?.();s.releaseCapture=undefined;
    if(s.video?.srcObject)s.video.srcObject=null;
    s.image = undefined;
    if (s.video) {
      s.video.pause();
      s.video.removeAttribute('src');
      s.video.load();
      s.video = undefined;
    }
    if (s.url) {
      URL.revokeObjectURL(s.url);
      s.url = undefined;
    }
  }
  clear(index: number) {
    this.cancelPrepared(index);
    const s = this.slots[index];
    s.generation++;
    s.clipId = null;
    s.params = [];
    s.budget = undefined;
    s.voice = undefined;
    this.releaseMedia(s);
    s.renderer.clearSource();
  }
  /** Heavy shaders expose a `detail` input that sets their step count; hold it inside the mobile budget. */
  private budgetInputs(s:Slot,params:Show['layers'][number]['params']){
    const budget=s.budget;if(!budget||budget.detail>=1)return params;
    const input=s.params.find(p=>p.NAME==='detail'&&p.TYPE==='float');if(!input)return params;
    const value=typeof params.detail==='number'?params.detail:Number(input.DEFAULT??1);
    return {...params,detail:value*budget.detail};
  }
  /** A slot's shader inputs this frame: its look (inside the mobile budget) and, for a studio voice, the voice signals. */
  private slotInputs(s:Slot,look:Show['layers'][number]['params'],intensity:number){
    const params=this.budgetInputs(s,look);
    if(s.voice===undefined)return params;
    return {...params,...this.voices.inputs(Number(params.vxSource??s.voice),params.vxAuto===true,intensity)};
  }
  /** Internal render height of a row's shader, for tests and diagnostics. */
  renderBudget(index:number){return this.slots[index]?.budget;}
  ghostMovement(index:number){return this.slots[index]?.ghostMotion?.currentMovement;}
  parameters(index: number) {
    const slot = this.slots[index];
    // A studio voice's signals are written every frame from what the phone hears: no control shows for them.
    return slot.params.filter(p=>!p.NAME.startsWith('_ghost')&&!(slot.voice!==undefined&&isVoiceDrivenInput(p.NAME)));
  }
  videoTime(index: number) {
    const v = this.slots[index].video;
    return v && Number.isFinite(v.duration) ? { time: v.currentTime, duration: v.duration } : null;
  }
  seek(index: number, position: number) {
    const v = this.slots[index].video;
    if (v && Number.isFinite(v.duration)) v.currentTime = Math.min(v.duration, Math.max(0, position));
  }
  async microphone(enabled: boolean) {
    await this.audioSource(enabled ? 'mic' : 'off');
  }
  /** Where Audio response listens: the microphone, the app's player or other apps' sound (iPhone and iPad app). */
  async audioSource(source: AudioSourceKind) {
    if (source === 'off') {
      this.audio.stop();
      this.mic = false;
    } else {
      await this.audio.startSource(source);
      this.mic = true;
    }
  }
  /** What the visuals hear: the source, whether sound is arriving, and its level 0..1. */
  get audioMeter() {
    return { source: this.audio.source, arriving: this.mic && this.audio.arriving, level: this.mic ? this.audio.rawLevel : 0, bpm: this.mic ? this.audio.uniforms.audioBPM ?? 0 : 0 };
  }
  start() {
    const loop = (now: number) => {
      if (this.dead || this.contextFailed) return;
      this.raf = requestAnimationFrame(loop);
      if (document.hidden) {this.frames=0;this.lastReport=now;return;}
      const show = this.getShow();
      if (this.mic) this.audio.update(now);
      const audio = this.mic ? this.audio.uniforms : SILENT_AUDIO;
      // One set of voice signals for every studio voice on the deck, from the live source or, with none, a quiet groove.
      const voiceDt = this.voiceFrame ? Math.min(.1, (now - this.voiceFrame) / 1000) : 0;
      this.voiceFrame = now;
      if (!this.frozen && [...this.slots, ...this.surfaceSlots.values()].some(slot => slot.voice !== undefined && slot.clipId)) this.voices.update(this.mic ? this.audio.voiceFrame : null, voiceDt);
      if(this.previewSuspended){for(const slot of [...this.slots,...this.surfaceSlots.values()])if(slot.video&&!slot.releaseCapture&&!slot.video.paused)slot.video.pause();this.lastLookFrame=now;this.frames=0;this.lastReport=now;return;}
      const inputs: (TextureInput | null)[] = [];
      try {
        this.compositor.beginFrame(show.quality);
        const plan=this.syncSurfaceSlots(show);
        // When every surface on the output plays its own clip, nothing shows the deck: it rests.
        const deckShown=!show.mapping||!show.surfaces.length||show.surfaces.some(sf=>sf.enabled&&!(sf.clipId&&plan.playing.includes(sf.clipId)&&!this.surfaceSlots.get(sf.clipId)?.failed));
        const shaderSlot=(slot:Slot)=>show.clips.find(c=>c.id===slot.clipId)?.kind==='shader';
        const activeShaderCount=this.slots.filter((slot,i)=>deckShown&&slot.clipId&&layerGain(show,i)>0&&shaderSlot(slot)).length
          +[...this.surfaceSlots].filter(([id,slot])=>slot.clipId===id&&shaderSlot(slot)).length;
        const shaderHeight=shaderRenderHeight(show.quality,activeShaderCount,this.governor.detail);
        for (let i = 0; i < 8; i++) {
          const s = this.slots[i],
            l = show.layers[i];
          const active = deckShown && !!s.clipId && layerGain(show, i) > 0;
          if (s.video) {
            if (active && !this.frozen && l.speed > 0) {
              s.video.playbackRate = s.releaseCapture ? 1 : Math.max(0.0625, l.speed);
              if (s.video.paused) void s.video.play().catch(() => {});
            } else if (!s.video.paused) s.video.pause();
          }
          if (!s.clipId) {
            inputs.push(null);
            continue;
          }
          this.hadClip = true;
          inputs.push(this.drawSlot(s,show.clips.find(c=>c.id===s.clipId),show.clips.find(c=>c.id===l.clipId),l,active,audio,now,shaderHeight,show.quality));
        }
        const surfaceInputs=new Map<string,TextureInput|null>();
        for(const [id,s] of this.surfaceSlots){
          if(s.failed)continue;
          this.hadClip=true;
          const clip=show.clips.find(c=>c.id===id);
          // Still loading: its surfaces stay dark rather than flash the deck first.
          if(s.clipId!==id||!clip){surfaceInputs.set(id,null);continue;}
          if(s.video&&(this.frozen?!s.video.paused:s.video.paused)){if(this.frozen)s.video.pause();else void s.video.play().catch(()=>{});}
          const defaults=clip.shaderId?findShader(clip.shaderId)?.defaults:undefined;
          surfaceInputs.set(id,this.drawSlot(s,clip,clip,{params:{...defaults,...clip.params},speed:1,intensity:1,effects:[]},true,audio,now,shaderHeight,show.quality));
        }
        if (!this.frozen && this.lastLookFrame) this.lookTime += Math.min(.1, (now-this.lastLookFrame)/1000);
        if (!this.frozen) this.lookBeat = this.beatClock?.() ?? this.lookTime * show.bpm / 60;
        this.lastLookFrame = now;
        const dt=this.fluxFrame ? Math.min(.1,(now-this.fluxFrame)/1000) : 0;
        this.fluxFrame=now;
        const target=this.flux.active&&this.flux.modules.length?this.flux.mix:0;
        this.fluxGain+=(target-this.fluxGain)*(1-Math.exp(-dt*22));
        const gesture=fluxEffect(this.flux,this.fluxGain,this.lookBeat);
        const composition=[...(show.effects||[]),...(gesture.enabled?[gesture]:[])];
        this.compositor.render(show, inputs, this.blackout, this.testGrid || !this.hadClip, this.lookTime, audio.audioBeat, this.lookBeat, composition.some(e=>e.enabled) ? input => {this.compositionFX.setAudio(audio);return this.compositionFX.processTexture(input,composition,this.lookTime);} : undefined, surfaceInputs);
      } catch (e) {
        this.contextFailed = true;
        cancelAnimationFrame(this.raf);
        this.onStopped('failed', e instanceof Error ? e.message : 'The video engine could not render this frame.');
        return;
      }
      this.frames++;
      if (now - this.lastReport > 1000) {
        const fps=Math.round((this.frames*1000)/(now-this.lastReport));this.onStats(fps);
        // Only procedural source resolution adapts, never the external output size. The governor
        // lowers it under sustained pressure and raises it again with a growing hold-off.
        const change=this.governor.sample(fps);
        if(change)this.onDetail(this.governor.detail,change);
        this.frames = 0;
        this.lastReport = now;
      }
    };
    this.lastReport = performance.now();
    this.raf = requestAnimationFrame(loop);
  }
  /**
   * Render one slot for this frame and return its picture: the source, then its GhostFX feedback
   * or camera FX, then the clip's and the layer's effects. `clip` is what the slot holds and
   * `chainClip` the clip whose look and effects apply (the same, except mid-launch on a layer).
   */
  private drawSlot(s:Slot,clip:Clip|undefined,chainClip:Clip|undefined,l:SlotLook,active:boolean,audio:AudioUniforms,now:number,shaderHeight:number,quality:number):TextureInput|null{
    if (active && !this.frozen && s.native) s.native.draw(l.params);
    if (active && !this.frozen && !s.native) {
      s.renderer.setAudio(audio);
      s.renderer.setClipParams({ speed: l.speed, intensity: l.intensity });
      if(clip?.shaderId==='ga-ghostfx'){
        s.ghostMotion??=new GhostFXMotion();
        const dt=s.ghostTime?Math.min(.1,(now-s.ghostTime)/1000):0;s.ghostTime=now;
        const response=s.ghostMotion.update(audio,dt*Math.max(0,l.speed),Number(l.params.movement)||0,Number(l.params.drift??.6),Number(l.params.morph??2.5),Number(l.params.reactivity??1),l.params.journey===true,Number(l.params.journeySeconds??24));
        s.ghostBass=response.audio.audioBass;s.renderer.setAudio(response.audio);
        s.renderer.setShaderInputs({...this.budgetInputs(s,l.params),...response.inputs});
      }else s.renderer.setShaderInputs(this.slotInputs(s,l.params,l.intensity));

      const sourceWidth = s.video?.videoWidth || s.image?.naturalWidth || 16,
        sourceHeight = s.video?.videoHeight || s.image?.naturalHeight || 9;
      const height=clip?.kind==='shader'?Math.max(180,shaderHeight*(s.budget?.scale??1)):quality;
      const scale = Math.min(height / sourceHeight, (height * 16) / 9 / sourceWidth);
      s.renderer.drawFrame(
        Math.max(1, Math.round(sourceWidth * scale)),
        Math.max(1, Math.round(sourceHeight * scale)),
      );
    }
    // Keep the held source separate from its FX result: editing or bypassing
    // clip/layer FX must update even while source playback is held.
    let source=s.native?.textureOutput??s.renderer.textureOutput;
    if(source&&active&&chainClip?.shaderId==='ga-ghostfx'){s.drift??=new GhostFXFeedback(this.compositor.context);source=s.drift.process(source,l.params,now/1000,!this.frozen,s.ghostBass??0);}
    if(source&&active&&(chainClip?.kind==='camera'||chainClip?.kind==='depth')){
      if(cameraFxEnabled(l.params)){
        if(!s.cameraFxFailed){try{
          s.cameraFx??=new CameraFx(this.compositor.context);
          source=s.cameraFx.process(source,l.params,now/1000,!this.frozen,audio.audioLevel);
        }catch(e){s.cameraFx?.destroy();s.cameraFx=undefined;s.cameraFxFailed=true;this.onError(`Camera motion FX bypassed: ${e instanceof Error?e.message:'GPU resources unavailable.'}`);}}
      }else {s.cameraFx?.destroy();s.cameraFx=undefined;s.cameraFxFailed=false;}
    }
    const chain=[...(chainClip?.effects || []),...l.effects];
    if(source && active && chain.some(e=>e.enabled)) {
      s.effects.setAudio(audio);
      return s.effects.processTexture(source,chain,this.lookTime);
    }
    return source;
  }
  /** Start renders for surface clips that joined the plan and free the ones that left it. */
  private syncSurfaceSlots(show:Show):SurfaceClipPlan{
    const plan=planSurfaceClips(show,this.surfaceClipCap);
    for(const [id,slot] of this.surfaceSlots)if(!plan.playing.includes(id)){this.disposeSlot(slot);this.surfaceSlots.delete(id);}
    for(const id of plan.playing){
      if(this.surfaceSlots.has(id))continue;
      const clip=show.clips.find(c=>c.id===id)!;
      const slot=this.newSlot();
      this.surfaceSlots.set(id,slot);
      void this.launchSlot(slot,clip).then(ok=>{if(!ok&&this.surfaceSlots.get(id)===slot&&!this.dead)slot.failed=true;},e=>{
        if(this.surfaceSlots.get(id)!==slot||this.dead)return;
        slot.failed=true;
        this.onError(e instanceof Error?e.message:`${clip.name} could not start on its surface.`);
      });
    }
    const key=planKey(plan);
    if(key!==this.surfacePlanKey){this.surfacePlanKey=key;this.onSurfacePlan(plan);}
    return plan;
  }
  /** Surface clips being rendered now, for tests and diagnostics. */
  get surfaceClips(){return [...this.surfaceSlots].filter(([id,slot])=>slot.clipId===id).map(([id])=>id);}
  private disposeSlot(s:Slot){
    s.generation++;
    s.preparation++;
    this.disposePrepared(s.prepared);
    s.prepared=undefined;
    this.releaseMedia(s);
    s.renderer.destroy();
    s.effects.destroy();
  }
  async restore(show: Show) {
    await Promise.all(
      show.layers.map(async (l, i) => {
        const clip = show.clips.find((c) => c.id === l.clipId);
        if (clip?.kind === 'camera'||clip?.kind==='depth'||clipUnavailable(clip)) {this.clear(i);l.clipId=null;return;}
        if (clip) {
          try {
            await this.launch(i, clip);
          } catch (e) {
            this.onError(e instanceof Error ? e.message : 'Clip could not be restored.');
          }
        } else this.clear(i);
      }),
    );
  }
  /** `keepContext` leaves the canvas's GPU context alive for an engine being rebuilt on it. */
  destroy(keepContext = false) {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.audio.stop();
    for (const s of this.slots) {
      s.canvas.removeEventListener('webglcontextlost', this.contextLost);
      this.disposeSlot(s);
    }
    for (const s of this.surfaceSlots.values()) this.disposeSlot(s);
    this.surfaceSlots.clear();
    this.compositor.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.compositor.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    this.compositionFX.destroy();
    this.compositor.destroy(!keepContext);
  }
}
