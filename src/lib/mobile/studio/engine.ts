import {mobileHeavyShaderPaths,mobileRemovedShaderPaths,mobileShaderBudgets} from './shaderPerformance';
import {GhostFXMotion} from './ghostFXMotion';
import {GhostFXFeedback} from './ghostFX';
import {CameraFx,cameraFxEnabled} from './cameraFx';
import {NativeLiveSource,canReplaceNativeFeed,acquireNativeFeed,hasNativeLive,depthInputs} from './nativeLive';
import {acquireCamera} from './camera';
import {defaultFlux,fluxEffect,type FluxState} from './flux';
import { StandaloneRenderer } from '../standaloneRenderer';
import { findShader } from '../standaloneShaderList';
import { StandaloneAudio, SILENT_AUDIO } from '../standaloneAudio';
import { parseISF, type ISFInput } from '../../isf/parser';
import { StudioCompositor, type TextureInput } from './compositor';
import { getAsset } from './assets';
import { type Show, type Clip, layerGain, clipUnavailable } from './model';
import { QualityGovernor, shaderRenderHeight } from './qualityGovernor';

type Prepared = { native?:NativeLiveSource; releaseCapture?:()=>void; clip: Clip; source?: string; media?: HTMLImageElement | HTMLVideoElement; url?: string };
type Slot = {
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
};
const shaderSources = new Map<string, Promise<string>>();
function shaderSource(id: string) {
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
  private compositor: StudioCompositor;
  private compositionFX: StandaloneRenderer;
  private raf = 0;
  private dead = false;
  private audio = new StandaloneAudio();
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
  constructor(
    canvas: HTMLCanvasElement,
    private getShow: () => Show,
  ) {
    this.compositor = new StudioCompositor(canvas);
    this.compositor.onPaintError=message=>this.onError(message);
    this.compositionFX=new StandaloneRenderer(canvas,this.compositor.context);
    this.compositionFX.onEffectError=message=>this.onError(message);
    for (let i = 0; i < 8; i++) {
      const c = canvas;
      const renderer = new StandaloneRenderer(c, this.compositor.context);
      renderer.onEffectError = message => this.onError(message);
      const effects = new StandaloneRenderer(c,this.compositor.context);
      effects.onEffectError=message=>this.onError(message);
      this.slots.push({ canvas: c, renderer, effects, preparation: 0, generation: 0, clipId: null, params: [] });
    }
    canvas.addEventListener('webglcontextlost', this.contextLost);
    canvas.addEventListener('webglcontextrestored', this.contextRestored);
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
  async prepare(index: number, clip: Clip): Promise<boolean> {
    const s = this.slots[index],
      generation = ++s.preparation;
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
  async launch(index: number, clip: Clip): Promise<boolean> {
    const s = this.slots[index],
      generation = ++s.generation;
    if (s.prepared?.clip.id !== clip.id && !(await this.prepare(index, clip))) return false;
    if (this.dead || s.generation !== generation) return false;
    const p = s.prepared;
    if (!p || p.clip.id !== clip.id) return false;
    s.prepared = undefined;
    try {
      if(p.native){s.params=clip.kind==='depth'?depthInputs:[];} else if (p.source) {
        const shader = findShader(clip.shaderId!)!;
        await s.renderer.loadShaderSource(p.source, shader.audioNative, shader.audioInject);
        if (this.dead || s.generation !== generation) return false;
        if (p.media instanceof HTMLVideoElement) await p.media.play();
        if (this.dead || s.generation !== generation) { this.disposePrepared(p); return false; }
        s.renderer.setShaderImage(p.media ?? null);
        s.params = parseISF(p.source).metadata.INPUTS;
        s.budget = mobileShaderBudgets[shader.path];
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
      if (!p.source) s.budget = undefined;
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
  /** Internal render height of a row's shader, for tests and diagnostics. */
  renderBudget(index:number){return this.slots[index]?.budget;}
  ghostMovement(index:number){return this.slots[index]?.ghostMotion?.currentMovement;}
  parameters(index: number) {
    return this.slots[index].params.filter(p=>!p.NAME.startsWith('_ghost'));
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
    if (enabled) {
      await this.audio.start();
      this.mic = true;
    } else {
      this.audio.stop();
      this.mic = false;
    }
  }
  start() {
    const loop = (now: number) => {
      if (this.dead || this.contextFailed) return;
      this.raf = requestAnimationFrame(loop);
      if (document.hidden) {this.frames=0;this.lastReport=now;return;}
      const show = this.getShow();
      if (this.mic) this.audio.update(now);
      const audio = this.mic ? this.audio.uniforms : SILENT_AUDIO;
      if(this.previewSuspended){for(const slot of this.slots)if(slot.video&&!slot.releaseCapture&&!slot.video.paused)slot.video.pause();this.lastLookFrame=now;this.frames=0;this.lastReport=now;return;}
      const inputs: (TextureInput | null)[] = [];
      try {
        this.compositor.beginFrame(show.quality);
        const activeShaderCount=this.slots.filter((slot,i)=>slot.clipId&&layerGain(show,i)>0&&show.clips.find(c=>c.id===slot.clipId)?.kind==='shader').length;
        const shaderHeight=shaderRenderHeight(show.quality,activeShaderCount,this.governor.detail);
        for (let i = 0; i < 8; i++) {
          const s = this.slots[i],
            l = show.layers[i];
          const active = !!s.clipId && layerGain(show, i) > 0;
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
          if (active && !this.frozen && s.native) s.native.draw(l.params);
          if (active && !this.frozen && !s.native) {
            s.renderer.setAudio(audio);
            s.renderer.setClipParams({ speed: l.speed, intensity: l.intensity });
            if(show.clips.find(c=>c.id===s.clipId)?.shaderId==='ga-ghostfx'){
              s.ghostMotion??=new GhostFXMotion();
              const dt=s.ghostTime?Math.min(.1,(now-s.ghostTime)/1000):0;s.ghostTime=now;
              const response=s.ghostMotion.update(audio,dt*Math.max(0,l.speed),Number(l.params.movement)||0,Number(l.params.drift??.6),Number(l.params.morph??2.5),Number(l.params.reactivity??1),l.params.journey===true,Number(l.params.journeySeconds??24));
              s.ghostBass=response.audio.audioBass;s.renderer.setAudio(response.audio);
              s.renderer.setShaderInputs({...this.budgetInputs(s,l.params),...response.inputs});
            }else s.renderer.setShaderInputs(this.budgetInputs(s,l.params));

            const sourceWidth = s.video?.videoWidth || s.image?.naturalWidth || 16,
              sourceHeight = s.video?.videoHeight || s.image?.naturalHeight || 9;
            const height=show.clips.find(c=>c.id===s.clipId)?.kind==='shader'?Math.max(180,shaderHeight*(s.budget?.scale??1)):show.quality;
            const scale = Math.min(height / sourceHeight, (height * 16) / 9 / sourceWidth);
            s.renderer.drawFrame(
              Math.max(1, Math.round(sourceWidth * scale)),
              Math.max(1, Math.round(sourceHeight * scale)),
            );
          }
          // Keep the held source separate from its FX result: editing or bypassing
          // clip/layer FX must update even while source playback is held.
          let source=s.native?.textureOutput??s.renderer.textureOutput;
          const clip=show.clips.find(c=>c.id===l.clipId);
          if(source&&active&&clip?.shaderId==='ga-ghostfx'){s.drift??=new GhostFXFeedback(this.compositor.context);source=s.drift.process(source,l.params,now/1000,!this.frozen,s.ghostBass??0);}
          if(source&&active&&(clip?.kind==='camera'||clip?.kind==='depth')){
            if(cameraFxEnabled(l.params)){
              if(!s.cameraFxFailed){try{
                s.cameraFx??=new CameraFx(this.compositor.context);
                source=s.cameraFx.process(source,l.params,now/1000,!this.frozen,audio.audioLevel);
              }catch(e){s.cameraFx?.destroy();s.cameraFx=undefined;s.cameraFxFailed=true;this.onError(`Camera motion FX bypassed: ${e instanceof Error?e.message:'GPU resources unavailable.'}`);}}
            }else {s.cameraFx?.destroy();s.cameraFx=undefined;s.cameraFxFailed=false;}
          }
          const chain=[...(clip?.effects || []),...l.effects];
          if(source && active && chain.some(e=>e.enabled)) {
            s.effects.setAudio(audio);
            inputs.push(s.effects.processTexture(source,chain,this.lookTime));
          } else inputs.push(source);
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
        this.compositor.render(show, inputs, this.blackout, this.testGrid, this.lookTime, audio.audioBeat, this.lookBeat, composition.some(e=>e.enabled) ? input => {this.compositionFX.setAudio(audio);return this.compositionFX.processTexture(input,composition,this.lookTime);} : undefined);
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
      s.generation++;
      s.preparation++;
      this.disposePrepared(s.prepared);
      s.canvas.removeEventListener('webglcontextlost', this.contextLost);
      this.releaseMedia(s);
      s.renderer.destroy();
      s.effects.destroy();
    }
    this.compositor.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.compositor.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    this.compositionFX.destroy();
    this.compositor.destroy(!keepContext);
  }
}
