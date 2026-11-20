<script lang="ts">
  import {ghostMovements} from '../../mobile/studio/ghostFXMotion';
  export let oncompanion:()=>void=()=>{};
  import PaintPad from './PaintPad.svelte';
  import PaintPanel from './PaintPanel.svelte';
  import {defaultPaint,type PaintConfig,type PaintStroke} from '../../mobile/studio/paint';
  import {groupParams,paramLabel} from '../../mobile/studio/paramGroups';
  import {currentLayout, watchLayout} from '../../mobile/studio/layout';
  import './mobileStudioLayout.css';
  import BlockTabs from './BlockTabs.svelte';
  import CoachStrip from './CoachStrip.svelte';
  import ClipPicker from './ClipPicker.svelte';
  import EffectBrowser from './EffectBrowser.svelte';
  import {effectLabel,moveEffect} from '../../mobile/studio/effectBrowser';
  import {dragReorder} from '../../mobile/studio/reorder';
  import {secondFingerTaps} from '../../mobile/studio/secondFingerTaps';
  import {loadPreferences,savePreferences,isFirstRun,feel,type StudioPreferences} from '../../mobile/studio/preferences';
  import {startCoach,coachAfter,coachLaunch,coachSkip,coachSteps,coachStep,type CoachState} from '../../mobile/studio/coach';
  // Choices of this device (haptics, launch on touch-down, hints already seen). Written at once,
  // so "first run" is decided on the first launch only. A first run opens the mapping demo.
  const firstRun=isFirstRun();
  let prefs=loadPreferences();
  if(firstRun)prefs={...prefs,coachTrack:'mapping'};
  savePreferences(prefs);
  function setPrefs(patch:Partial<StudioPreferences>){prefs={...prefs,...patch};savePreferences(prefs);}
  let coach:CoachState=prefs.coachTrack==='mapping'?{...startCoach('mapping'),step:prefs.coachAt??0}:startCoach();
  function coachMove(next:CoachState){
    if(prefs.coachDone||next===coach)return;
    coach=next;
    if(next.track==='mapping'&&!next.done)setPrefs({coachAt:next.step});
    if(next.done){setPrefs({coachDone:true});flash('That is the basics. Have a good set.');}
  }
  /** A clip launched by a finger (not Autopilot): the haptic tap and the coach's launch steps. */
  function handLaunch(row:number){
    feel(prefs,'launch');
    noteDeckHidden();
    // Rows of a deck that is switched off still hold a clip id; they are not playing.
    coachMove(coachLaunch(coach,show.layers.slice(0,show.dualDeck?8:4).flatMap((l,i)=>l.clipId?[i]:[]),row));
  }
  import {MAX_BLOCKS,addBlock,blockTabs,deleteBlock,duplicateBlock,ensureOpenBlock,moveBlock,switchBlock,type BlockState} from '../../mobile/studio/blocks';
  let layoutInfo=currentLayout();
  $: tablet=layoutInfo.mixer==='docked';
  let compactPreview=layoutInfo.short;
  $: dockedInspector=layoutInfo.inspector==='side' && tab==='perform';
  let mappingTool:'edit'|'paint'='edit';
  $: paint=show.paint??defaultPaint();
  function patchPaint(patch:Partial<PaintConfig>){show.paint={...paint,...patch};persist();}
  function startStroke(stroke:PaintStroke){
    checkpoint();
    show.paint={...paint,strokes:[...paint.strokes,stroke].slice(-64)};
    show={...show};
  }
  function finishStroke(){if(show.paint)show.paint={...show.paint,strokes:show.paint.strokes.filter(s=>s.samples.length)};persist();}
  function paintMode(){
    if(!show.surfaces.length)addSurface();
    show.mapping=true;mappingTool='paint';persist();
  }

  import {touchSliders} from '../../mobile/studio/touchSliders';
  import '../../mobile/studio/touchSliders.css';
  import {nextAutoClip,varyAutoParams,autopilotResponse,type AutoEvent} from '../../mobile/studio/autopilot';
  let autoOn=false,autoSettings=false,autoClips=true,autoParams=true,autoRandom=false;
  let autoInterval=16,autoVariation=.12,autoRows=Array(8).fill(true);
  let autoNext=0,autoParamNext=0,autoLast=-1,autoEpoch=0;
  let autoJobs=new Map<number,{clip:Clip;ready:boolean}>();
  /** Paused by the performer taking a row over by hand. The Auto button and a notice offer Resume. */
  let autoPaused=false;
  function stopAuto(){
    autoOn=false;autoPaused=false;autoEpoch++;
    for(const row of autoJobs.keys())engine?.cancelPrepared(row);
    autoJobs.clear();
  }
  /** Drop anything Autopilot has prepared and time its next change from now. It stays on. */
  function rearmAuto(){
    for(const row of autoJobs.keys())engine?.cancelPrepared(row);
    autoJobs.clear();autoEpoch++;
    const b=(performance.now()-clockOrigin)*show.bpm/60000;
    autoNext=Math.floor(b)+autoInterval;autoParamNext=Math.floor(b)+4;autoLast=b;
  }
  function startAuto(){
    stopAuto();checkpoint();autoOn=true;
    rearmAuto();
    if(noticeAction)clearNotice();
  }
  /** Route every performer action through one policy so nothing switches Autopilot off silently. */
  function autoEvent(event:AutoEvent){
    if(!autoOn)return;
    const response=autopilotResponse(event);
    if(response==='rearm')rearmAuto();
    else if(response==='pause'){
      stopAuto();autoPaused=true;
      flash('Autopilot paused.',{label:'Resume',run:startAuto},8000);
    }
  }
  function autoTick(now:number){
    if(!autoOn||!engine)return;
    const autoEngine=engine;
    const b=(now-clockOrigin)*show.bpm/60000;
    if(document.hidden||frozen||b<autoLast||b-autoLast>2){
      for(const row of autoJobs.keys())engine.cancelPrepared(row);
      autoJobs.clear();autoEpoch++;autoNext=Math.floor(b)+autoInterval;autoParamNext=Math.floor(b)+4;autoLast=b;return;
    }
    autoLast=b;
    if(autoClips&&b>=autoNext-1&&b<autoNext&&autoJobs.size===0){
      const epoch=autoEpoch;
      show.layers.forEach((l,row)=>{
        if((!show.dualDeck&&row>=4)||!autoRows[row]||!l.enabled||loading[row]||pending[row])return;
        // The row open in Controls keeps its clip while the performer shapes it.
        if(clipControlsOpen&&row===selectedLayer)return;
        // Leave live camera sources under manual control.
        if(['camera','depth'].includes(show.clips.find(c=>c.id===l.clipId)?.kind??''))return;
        const clip=nextAutoClip(show,row,autoRandom);if(!clip)return;
        const job={clip,ready:false};autoJobs.set(row,job);
        void autoEngine.prepare(row,clip).then(ok=>{if(epoch===autoEpoch&&autoJobs.get(row)===job)job.ready=ok;}).catch(e=>{if(epoch===autoEpoch)error=e instanceof Error?e.message:'Autopilot could not prepare a clip.';});
      });
    }
    if(b>=autoNext){
      for(const [row,job] of autoJobs){if(job.ready&&!loading[row]&&!pending[row])void launch(job.clip,row,true);else engine.cancelPrepared(row);}
      autoJobs.clear();autoNext=Math.floor(b)+autoInterval;
    }
    if(b>=autoParamNext){
      if(autoParams){
        show.layers=show.layers.map((l,row)=>autoRows[row]&&l.enabled&&!(clipControlsOpen&&row===selectedLayer)&&show.clips.find(c=>c.id===l.clipId)?.kind==='shader'
          ?{...l,params:varyAutoParams(autoEngine.parameters(row),l.params,autoVariation)}:l);
        persist();
      }
      autoParamNext=Math.floor(b)+4;
    }
  }

  import {stopNativeFeeds,hasNativeLive} from '../../mobile/studio/nativeLive';
  import {releaseCamerasForToolkit} from '../../mobile/studio/camera';
  import CameraFxPanel from './CameraFxPanel.svelte';
  import CaptureToolkit from './CaptureToolkit.svelte';
  import MobileInteractiveWorkspace from './MobileInteractiveWorkspace.svelte';
  let interactiveOpen=false,interactiveMounted=false,interactiveLive=false;
  let interactiveWorkspace:MobileInteractiveWorkspace;
  function openInteractive(){interactiveMounted=true;interactiveOpen=true;mixerOpen=false;}
  /** The bottom bar. It stays on screen in Studio too, so every workspace is one tap away. */
  const NAV=[{id:'perform',label:'Perform',icon:'grid'},{id:'flux',label:'Flux',icon:'flux'},{id:'map',label:'Map',icon:'map'},{id:'interactive',label:'Studio',icon:'depth'},{id:'tools',label:'Tools',icon:'scan'},{id:'ctrls',label:'Ctrls',icon:'controls'}] as const;
  const navActive=(id:string,current:string,mixing:boolean,studio:boolean,controls:boolean)=>id==='mix'?mixing:id==='interactive'?studio:id==='ctrls'?controls&&!studio:id==='tools'?false:!studio&&!mixing&&!controls&&current===id;
  /** While performing, the first place in the bar opens the mixer; anywhere else it leads back to Perform. */
  $: navItems=NAV.map(item=>item.id==='perform'&&tab==='perform'&&!interactiveOpen?{id:'mix' as const,label:'Mix',icon:'mixer'}:item);
  function navTo(id:typeof NAV[number]['id']|'mix'){
    feel(prefs,'switch');
    if(id==='mix'){closeControls();mixerOpen=!mixerOpen;return;}
    if(id==='tools'){toolkitOpen=true;return;}
    if(id==='interactive'){openInteractive();return;}
    interactiveOpen=false;
    if(id==='ctrls'){if(clipControlsOpen)closeControls();else{if(tab!=='perform')selectTab('perform');openControls(selectedLayer);}return;}
    closeControls();selectTab(id);
  }
  function interactiveOutput(target:HTMLCanvasElement|null){if(!interactiveOutputAllowed)return;interactiveLive=!!target;externalOutput?.destroy();externalOutput=new ExternalOutput(target??output,status=>outputStatus=status);externalOutput.configure(outputPreferences);}
  $: if(engine)engine.previewSuspended=interactiveOpen&&(interactiveLive||outputStatus.state!=='live');

  import {captureFileURL,captureCapabilities,type CameraShot} from '../../mobile/studio/captureToolkit';
  /** "+ Add": the full-height clip picker, and the source tab it opens on. */
  let pickerOpen=false;
  let pickerSource:'visuals'|'media'|'camera'='visuals';
  function openPicker(slot:{row:number;column:number}|null=null){
    mixerOpen=false;clipControlsOpen=false;tempoOpen=false;
    editSlot=slot;if(slot)changeLayer(slot.row);
    tab='perform';pickerOpen=true;
  }
  function closePicker(){pickerOpen=false;editSlot=null;}
  function setDual(enabled:boolean){checkpoint();autoEvent('settings');show.dualDeck=enabled;if(!enabled&&selectedLayer>=4)changeLayer(0);persist();}
  const rowName=(row:number)=>show.dualDeck?`${row<4?'A':'B'}${row%4+1}`:`L${row+1}`;
  /** null until the device has answered. Only then is the depth camera offered. */
  let lidar:boolean|null=null;
  let toolkitOpen=false;
  let videoInput:HTMLInputElement,photoInput:HTMLInputElement;
  async function prepareCaptureTool(){
    mixerOpen=false;
    for(let i=0;i<show.layers.length;i++){
      const ids=[show.layers[i].clipId,pending[i]?.clip.id,launchingClips[i]?.clipId];
      if(ids.some(id=>['camera','depth'].includes(show.clips.find(c=>c.id===id)?.kind??'')))stopRow(i);
    }
    await releaseCamerasForToolkit();
    await stopNativeFeeds();
  }
  async function importCameraShots(shots:CameraShot[]){
    if(!shots.length)return;checkpoint();
    for(const shot of shots){
      const response=await fetch(captureFileURL(shot.url));if(!response.ok)throw new Error('Could not read the captured camera image.');
      const blob=await response.blob(), id=uid();await putAsset(id,blob);
      show.clips=[...show.clips,{id,assetId:id,name:shot.name,kind:'image'}];persist();
    }
  }
  import OutputPanel from './OutputPanel.svelte';
  import {ExternalOutput,loadOutputPreferences,type OutputStatus} from '../../mobile/studio/externalOutput';
  let externalOutput:ExternalOutput|undefined;
  let interactiveOutputAllowed=true;
  let outputSettings=false;
  let outputPreferences=loadOutputPreferences();
  let outputStatus:OutputStatus={native:false,connected:false,state:'disconnected'};
  // ── Projector setup, present mode, recording and the review prompt ─────────
  import PresentMode from './PresentMode.svelte';
  import RecordControl from './RecordControl.svelte';
  import {noDisplayConnected} from '../../mobile/studio/outputSetup';
  import {appVersion,requestReview} from '../../mobile/studio/nativeOutput';
  import {MapSaveWatch,loadReviewState,noteLaunch,reviewAfterSuccess,saveReviewState,type SuccessMoment} from '../../mobile/studio/reviewPrompt';
  let outputSetup=false, presenting=false;
  function openOutput(setup:boolean){outputSetup=setup;outputSettings=true;}
  /** The setup's test pattern borrows the Test grid and gives back whatever it was. */
  let setupPattern=false, patternBefore=false;
  function setupTestPattern(on:boolean){
    if(on===setupPattern)return;
    setupPattern=on;
    if(on)patternBefore=testGrid;
    testGrid=on?true:patternBefore;
    if(engine)engine.testGrid=testGrid;
  }
  /** What goes to the projector (the interactive scene when it is live), for the recorder. */
  const programCanvas=()=>externalOutput?.source??output??null;
  saveReviewState(noteLaunch(loadReviewState()));
  const reviewWhen=(moment:SuccessMoment)=>void reviewAfterSuccess(moment,{version:()=>appVersion(''),request:requestReview});
  const mapSaves=new MapSaveWatch();
  $: if(mapSaves.update(tab,show.mapping,show.surfaces))reviewWhen('map-saved');
  import {hitMappingScreens} from '../../mobile/studio/mappingInteraction';
  import MappingCanvas from './mapping/MappingCanvas.svelte';
  import NudgePad from './mapping/NudgePad.svelte';
  import SurfaceShapePanel from './mapping/SurfaceShapePanel.svelte';
  import AddSurfaceSheet from './mapping/AddSurfaceSheet.svelte';
  import MapIcon from './mapping/MapIcon.svelte';
  import MaskPanel from './mapping/MaskPanel.svelte';
  import SurfaceActions from './mapping/SurfaceActions.svelte';
  import type {SurfacePattern} from '../../mobile/studio/compositor';
  import {nudgeBasis} from '../../mobile/studio/mapping/viewport';
  import {nudge as nudgeSurfaces,pointAt,selectablePoints,pruneWelds} from '../../mobile/studio/mapping/edit';
  import {createDrawnSurface,createSurface,cornerView,kindLabel,resetGeometry,type NewSurfaceKind} from '../../mobile/studio/mapping/surfaceKinds';
  let mappingGrid=false, mappingSnap=false;
  // Pro mapping tools: extra selected surfaces, outline drawing, the add sheet and the canvas (for its loupe).
  let mapSelection:number[]=[], mapDraw=false, addSheet=false, mappingCanvas:MappingCanvas|undefined;
  // The mask being edited on the selected surface, its selected point, and whether one is being made.
  let mapMask=-1, mapMaskPoint=0, mapMaskTool:'edit'|'polygon'|'freehand'='edit', mapTapped=0;
  $: { selectedSurface; mapMask=-1; mapMaskPoint=0; mapMaskTool='edit'; }
  function mapMaskSet(mask:number,point:number,tool:'edit'|'polygon'|'freehand'){mapMask=mask;mapMaskPoint=point;mapMaskTool=tool;mapTapped=0;}
  // Editor-only views of the output (never saved, off outside Map): several selected, solo, test patterns.
  let mapMulti=false, mapSolo=false, mapIdentify=false, mapPatterns:Record<string,SurfacePattern>={};
  $: if(engine) engine.mappingView = tab==='map' ? {solo:mapSolo?(mapSelection.length>1?mapSelection:[selectedSurface]).map(i=>show.surfaces[i]?.id).filter(Boolean):undefined,identify:mapIdentify,patterns:mapPatterns} : null;
  $: mapBasis=nudgeBasis(outputStatus.connected?outputStatus.display:null);
  $: mapPoints=selectablePoints(show.surfaces[selectedSurface]);
  function mapChange(next:Surface[]){show.surfaces=next;show={...show};}
  function mapBegin(){checkpoint();show.mapping=true;}
  /**
   * A drag on the canvas starts. Moving geometry lets the demo stage go (Undo brings it back), and
   * dragging a point is the coach's "Drag a corner" step.
   */
  function mapCanvasBegin(what?:'point'|'move'){mapBegin();if(what)leaveStage();if(what==='point')coachMove(coachAfter(coach,'corner'));}
  /** After a checkpoint: the surfaces no longer sit on the template's objects. */
  function leaveStage(){if(show.stage)show.stage=undefined;}
  /** The demo stage behind the picture, zoomed with it by the mapping canvas. */
  let stageLayer:HTMLDivElement|null=null;
  /** One finished mapping edit: a single undo step. */
  function mapApply(next:Surface[],point?:number){mapBegin();mapChange(next);if(point!==undefined)selectedPoint=point;persist();}
  function addMappedSurface(kind:NewSurfaceKind){
    if(show.surfaces.length>=16){flash('A set supports up to 16 surfaces.');return;}
    addSheet=false;mapApply([...show.surfaces,createSurface(kind,show.surfaces.length)],0);selectedSurface=show.surfaces.length-1;mapSelection=[];
  }
  function drawnSurface(path:import('../../mobile/studio/mapping/pathGeometry').PathPoint[]){
    mapDraw=false;
    if(show.surfaces.length>=16){flash('A set supports up to 16 surfaces.');return;}
    mapApply([...show.surfaces,createDrawnSurface(path,show.surfaces.length)],0);selectedSurface=show.surfaces.length-1;mapSelection=[];
  }
  let lastScreenTap={x:-100,y:-100,time:0};
  function selectPreviewScreen(e:MouseEvent){
    if(mappingTool==='paint'||tab!=='map'||(e.target as HTMLElement).closest('.warp-handle,.mapping-canvas'))return;
    const r=preview.getBoundingClientRect(),p={x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};
    const hits=hitMappingScreens(p,show.surfaces);if(!hits.length)return;
    const repeated=performance.now()-lastScreenTap.time<700&&Math.hypot(e.clientX-lastScreenTap.x,e.clientY-lastScreenTap.y)<12;
    selectedSurface=repeated?hits[(hits.indexOf(selectedSurface)+1)%hits.length]:hits[0];
    lastScreenTap={x:e.clientX,y:e.clientY,time:performance.now()};
  }
  import FluxPanel from './FluxPanel.svelte';
  import FluxPad from './FluxPad.svelte';
  import {defaultFlux} from '../../mobile/studio/flux';
  let flux=defaultFlux();
  /**
   * Scramble: every playing shader and every effect that is switched on gets new settings at once,
   * like Tab in the desktop's Performer mode. One undo brings the old look back.
   */
  function scramble(){
    if(!engine)return;
    const shuffle=<T extends EffectChain|undefined>(chain:T):T=>(chain?chain.map(effect=>{
      if(!effect.enabled)return effect;
      const controls=MOBILE_EFFECTS.find(def=>def.type===effect.type)?.controls||[];
      const params={...effect.params};
      for(const control of controls){
        if(control.type==='color'||!(control.max>control.min))continue;
        if(control.type==='select'&&control.options?.length){params[control.param]=control.options[Math.floor(Math.random()*control.options.length)].value;continue;}
        const value=control.min+Math.random()*(control.max-control.min);
        params[control.param]=control.step>=1?Math.round(value):value;
      }
      return {...effect,params};
    }) as T:chain);
    checkpoint();
    const playing=new Set(show.layers.map(l=>l.clipId).filter(Boolean));
    show.layers=show.layers.map((l,row)=>{
      const clip=show.clips.find(c=>c.id===l.clipId);
      const params=clip?.kind==='shader'&&l.enabled?varyAutoParams(engine!.parameters(row),l.params,1):l.params;
      return {...l,params,effects:shuffle(l.effects)};
    });
    show.clips=show.clips.map(clip=>playing.has(clip.id)&&clip.effects?.length?{...clip,effects:shuffle(clip.effects)}:clip);
    show.effects=shuffle(show.effects);
    persist();feel(prefs,'switch');
  }
  /** Flux stays playable on the preview while performing, with whatever was set up in the Flux tab. */
  let fluxPerform=false;
  import PerformanceMixer from "./PerformanceMixer.svelte";
  import LookControls from "./LookControls.svelte";
  import { onDestroy, onMount, tick } from 'svelte';
  import { takeLaunchPath } from '../../mobile/studio/launchIntent';

  function sliderFill(value: number, min: number, max: number): number {
    return max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  }
  import Icon from './StudioIcon.svelte';
  import { audioPlayer, hasNativeAudio, importAudioTracks, nativeAudioStatus, removeAudioTrack, startPhoneAudio, type AudioSourceKind, type NativeAudioStatus, type PlayerAction } from '../../mobile/nativeAudio';
  import StudioDecks from './StudioDecks.svelte';
  import Section from './ui/Section.svelte';
  import InfoTip from './ui/InfoTip.svelte';
  import Divider from './ui/Divider.svelte';
  import './mobileStudioClarity.css';
  import { StudioEngine } from '../../mobile/studio/engine';
  import { keepAwake } from '../../mobile/studio/wakeLock';
  import { shareFile, isNativePlatform, canOpenAppSettings, mentionsSettings, openAppSettings } from '../../mobile/studio/nativeShare';
  import { standaloneShaderPaths } from '../../mobile/studio/shaderAvailability';
  const libraryShaders=MOBILE_SHADERS.filter(s=>!s.requiresImage&&standaloneShaderPaths.has(s.path)).sort((a,b)=>Number(b.id.startsWith('featured-'))-Number(a.id.startsWith('featured-')));
  import { MOBILE_SHADERS, findShader } from '../../mobile/standaloneShaderList';
  import { MOBILE_EFFECTS } from '../../mobile/standaloneEffects';
  import { EFFECT_PARAM_DEFS } from '../../effects/effectParamDefs';
  import { putAsset, getAsset, listAssets, deleteAssets, unusedAssets, totalBytes, formatBytes, type AssetInfo } from '../../mobile/studio/assets';
  import { setProblems, needsRepair, repairSet, repairSummary, type SetProblems } from '../../mobile/studio/setRepair';
  import { packSet, unpackSet, setMediaSize, BundleTooLarge, BUNDLE_MAX_BYTES } from '../../mobile/studio/setBundle';
  import {
    loadShow,
    saveCurrentShow,
    savedSets,
    upsertSet,
    removeSet,
    renameSet,
    duplicateSet,
    writeSetBank,
    MAX_SAVED_SETS,
    referencedAssetIds,
    renameBlock,
    defaultShow,
    normalizeShow,
    clipUnavailable,
    clipLaunchParams,
    rememberClipLook,
    resetClipLook,
    newSurface,
    gridPoints,
    fullFramePoints,
    movePoint,
    copy,
    uid,
    clamp,
    shaderThumbnail,
    nextBeat,
    History,
    type EffectChain,
    type Clip,
    type Show,
    type Surface,
  } from '../../mobile/studio/model';
  import type { ISFInput } from '../../isf/parser';
  // ── Mapping 1.2: first-run demo, templates, a clip per surface, landscape mapping ──────────
  import TemplateGallery from './TemplateGallery.svelte';
  import StageBackdrop from './StageBackdrop.svelte';
  import SurfaceContentStrip from './SurfaceContentStrip.svelte';
  import SurfacePlacement from './SurfacePlacement.svelte';
  import BlendPicker from './BlendPicker.svelte';
  import { withControl, sameSourceSurfaces, spanPlacements, sameOnSurfaces } from '../../mobile/studio/placement';
  import { forgetSurfaceClip } from '../../mobile/studio/model';
  import { mappingDemoShow, applyTemplate, stageMatches } from '../../mobile/studio/templates';
  import { findTemplate } from '../../mobile/studio/stageScenes';
  import { putOnSurface, surfaceCapMessage, type SurfaceChoice, type SurfaceClipPlan } from '../../mobile/studio/surfaceClips';
  import { surfaceClipCap, type DeviceHints } from '../../mobile/studio/qualityGovernor';
  import { allowMappingRotation } from '../../mobile/studio/captureToolkit';
  let templatesOpen = false;
  /** Surface lit up while a visual is dragged over it. */
  let dropSurface: number | null = null;
  let surfaceCap = surfaceClipCap();
  let surfacePlan: SurfaceClipPlan = { playing: [], capped: [], wanted: 0, cap: surfaceCap };
  function setSurfaceCap(hints: DeviceHints) {
    surfaceCap = surfaceClipCap(hints);
    if (engine) engine.surfaceClipCap = surfaceCap;
  }
  $: deviceName = layoutInfo.mixer === 'docked' ? 'This iPad' : 'This iPhone';
  $: capNotice = surfaceCapMessage(surfacePlan, deviceName);
  /** The template's rendered stage shows behind the picture while the surfaces still sit on it. */
  $: stageShown = !clean && stageMatches(show) ? show.stage! : '';
  /**
   * Integration hook for the output wizard (MB-1): "Connect a projector" lands here. Until the
   * wizard is wired in, it opens Output settings.
   */
  function connectProjector() { openOutput(true); }
  $: if (outputStatus.state === 'live') coachMove(coachAfter(coach, 'connect'));
  $: coachCurrent = prefs.coachDone ? undefined : coachStep(coach);
  // iPhone turns sideways for mapping only; leaving Map brings it back upright.
  let rotationAllowed = false;
  $: { const allow = tab === 'map' && !interactiveOpen && !pickerOpen; if (allow !== rotationAllowed) { rotationAllowed = allow; void allowMappingRotation(allow); } }
  function applyTemplateById(id: string) {
    const template = findTemplate(id);
    if (!template) return;
    checkpoint();
    show = applyTemplate(show, template);
    selectedSurface = 0; selectedPoint = 0; mappingTool = 'edit'; templatesOpen = false;
    persist();
    // Templates arrive moving to the music.
    if (audioSource === 'off') void chooseAudio(preferredAudio());
    flash(`${template.name} placed. Drag the corners onto your object.`, { label: 'Undo', run: () => void undo() }, 6000);
  }
  function chooseLayout(preset: 'split' | 'triptych' | 'paint-box') { templatesOpen = false; addSurface(preset); }
  function assignSurface(index: number, choice: SurfaceChoice) {
    const next = putOnSurface(show, index, choice);
    if (next === show) { if (!('deck' in choice)) flash('That clip cannot play on a surface. Live cameras stay on the deck.'); return; }
    checkpoint();
    show = { ...show, ...next, mapping: true };
    selectedSurface = index;
    persist();
    feel(prefs, 'switch');
  }
  function hideStage() { checkpoint(); show.stage = undefined; persist(); }
  /** Said once a session: launching a pad while every surface plays its own clip shows nowhere. */
  let deckHiddenNoted = false;
  function noteDeckHidden() {
    if (deckHiddenNoted || !show.mapping || !show.surfaces.some(s => s.enabled)) return;
    if (!show.surfaces.every(s => !s.enabled || (s.clipId && surfacePlan.playing.includes(s.clipId)))) return;
    deckHiddenNoted = true;
    flash('Every surface plays its own visual, so the deck is not on the output. In Map, drag Deck mix onto a surface.', null, 7000);
  }
  $: surfaceMedia = show.clips.filter(c => c.kind === 'image' || c.kind === 'video');
  $: currentChoice = surface?.clipId ? (() => { const c = show.clips.find(c => c.id === surface.clipId); return c?.kind === 'shader' && !c.assetId ? { shader: c.shaderId } : { clip: c?.id }; })() : null;
  const surfaceContentName = (s: Surface, index: number) => {
    const clip = s.clipId ? show.clips.find(c => c.id === s.clipId) : undefined;
    if (clip && !surfacePlan.capped.includes(index)) return clip.name;
    const deck = s.source === 'mix' ? 'Full composition' : `Layer ${(show.dualDeck ? s.source % 4 : s.source) + 1}${show.dualDeck ? ' · A/B' : ''}`;
    return clip ? `${clip.name} · over limit, ${deck}` : deck;
  };

  let show = firstRun ? mappingDemoShow() : loadShow();
  // Kept at once, so closing the app before touching anything still reopens on the demo.
  if (firstRun) try { saveCurrentShow(show); } catch { /* storage full: the demo is rebuilt next time */ }
  let setBank = savedSets();
  // The mapping coach's first steps happen in Map, so the app opens there until they are done.
  // A path picked on the welcome screen decides where the studio opens; without one it opens as before.
  const launchPath = takeLaunchPath();
  let tab: 'perform' | 'map' | 'fx' | 'flux' = launchPath === 'mapping' ? 'map' : launchPath ? 'perform' : firstRun || coachStep(coach)?.tab === 'map' && !prefs.coachDone ? 'map' : 'perform';
  // Mobile Control opens the existing desktop pairing over the VJ screen.
  onMount(() => { if (launchPath === 'control') oncompanion(); });
  let mixerOpen=false;
  let clipControlsOpen=false;
  let controlsReturnFocus:HTMLElement|null=null;
  let controlView: 'source'|'effects'='source';
  let fxScope: 'comp'|'layer'|'clip'='layer';
  let selectedLayer = 0,
    selectedSurface = 0,
    selectedPoint = 0,
    bank = 0;
  let shaderInputId: string | null = null;
  let shaderMediaInput: HTMLInputElement;
  let editSlot: { row: number; column: number } | null = null;
  let settings = false,
    clean = false,
    blackout = false,
    frozen = false,
    mic = false,
    micBusy = false,
    audioSource: AudioSourceKind = 'off',
    testGrid = false;
  let output: HTMLCanvasElement, preview: HTMLDivElement, mediaInput: HTMLInputElement, setInput: HTMLInputElement;
  let engine: StudioEngine | undefined,
    fps = 0,
    error = '',
    notice = '',
    loading = Array(8).fill(false),
    params: ISFInput[] = [];
  let pending: Record<number, { clip: Clip; at: number }> = {},
    clockOrigin = performance.now(),
    beat = 0;
  let videoPosition = 0,
    videoDuration = 0;
  let saveTimer: ReturnType<typeof setTimeout>, noticeTimer: ReturnType<typeof setTimeout>;
  let history = new History(),
    canUndo = false,
    canRedo = false;
  let taps: number[] = [];
  $: layer = show.layers[selectedLayer];
  // The set being played is always listed, even before its first save reaches the list.
  $: setList = setBank.some((s) => s.id === show.id) ? setBank : [show, ...setBank];
  $: surface = show.surfaces[selectedSurface];
  $: visibleClips = show.clips.slice(bank * 12, bank * 12 + 12);
  $: groupedParams=groupParams(params.filter(p=>['float','long','bool','color','point2D','event'].includes(p.TYPE)));
  $: activeClip = show.clips.find((c) => c.id === layer.clipId);
  // Source metadata must follow the actual playing layer, including library selection.
  $: controlSourceKey = `${selectedLayer}:${layer.clipId ?? ''}`;
  $: if (engine && controlSourceKey) refreshParams();
  $: activeEffects = fxScope==='comp' ? (show.effects||[]) : fxScope==='clip' ? (activeClip?.effects||[]) : layer.effects;
  $: pageCount = Math.max(1, Math.ceil(show.clips.length / 12));
  type NoticeAction = { label: string; run: () => void };
  let noticeAction: NoticeAction | null = null;
  function clearNotice() { clearTimeout(noticeTimer); notice = ''; noticeAction = null; }
  function flash(message: string, action: NoticeAction | null = null, ms = 3500) {
    notice = message;
    noticeAction = action;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(clearNotice, ms);
  }
  function checkpoint() {
    history.push(show);
    canUndo = history.canUndo;
    canRedo = history.canRedo;
  }
  function persist() {
    if(show.activeBlockId)show.scenes=show.scenes.map(b=>b.id===show.activeBlockId?{...b,launchGrid:copy(show.launchGrid)}:b);
    show = { ...show };
    clearTimeout(saveTimer);
    // Autosave writes only the set being played. The list of saved sets is written far less
    // often, so dragging a control never re-reads and rewrites every set on the render thread.
    saveTimer = setTimeout(saveNow, 400);
  }
  const SAVE_FAILED = 'Your device could not save this set. Export a set file before closing.';
  let bankTimer: ReturnType<typeof setTimeout> | undefined, bankDirty = false, bankFullWarned = false;
  function saveNow() {
    clearTimeout(saveTimer);
    try { saveCurrentShow(show); } catch { error = SAVE_FAILED; }
    bankDirty = true;
    bankTimer ??= setTimeout(flushBank, 5000);
  }
  function writeBank() {
    try { writeSetBank(setBank); } catch { error = SAVE_FAILED; }
  }
  function flushBank() {
    clearTimeout(bankTimer); bankTimer = undefined;
    if (!bankDirty) return;
    bankDirty = false;
    const result = upsertSet(setBank, show);
    if (result.full) {
      // Never push an older set out to make room. Say so once instead.
      if (!bankFullWarned) { bankFullWarned = true; error = `This device already holds ${MAX_SAVED_SETS} sets, so this one is not in your saved list. Delete a set you no longer need in Set settings.`; }
      return;
    }
    setBank = result.bank;
    writeBank();
  }
  /** Write everything now: before switching sets, when the app is hidden, and on close. */
  function flushSaves() { saveNow(); flushBank(); }
  // ── Saved sets ────────────────────────────────────────────────────────────
  let setEdit: { id: string; mode: 'rename' | 'delete'; name: string } | null = null;
  let freshConfirm = false;
  function renameSavedSet(id: string, name: string) {
    if (!name.trim()) { setEdit = null; return; }
    if (id === show.id) { show.name = name.trim().slice(0, 100); persist(); }
    setBank = renameSet(setBank, id, name);
    writeBank();
    setEdit = null;
  }
  function deleteSavedSet(id: string) {
    if (id === show.id) return;
    const name = setBank.find((s) => s.id === id)?.name ?? 'Set';
    setBank = removeSet(setBank, id);
    writeBank();
    setEdit = null;
    flash(`${name} deleted.`);
    void refreshStorage();
  }
  /** A copy of a saved set (or the open one) beside it in the list. The open set stays open. */
  function duplicateSavedSet(id: string) {
    flushSaves();
    const source = id === show.id ? show : setBank.find((s) => s.id === id);
    if (!source) return;
    const result = duplicateSet(setBank, source);
    if (result.full || !result.copy) { error = `This device holds ${MAX_SAVED_SETS} sets. Delete one you no longer need, then try again.`; return; }
    setBank = result.bank;
    writeBank();
    flash(`${result.copy.name} saved on this device.`);
  }
  /** A new set needs a free place: nothing already saved is dropped to make one. */
  function roomForNewSet(replacingId?: string) {
    flushSaves();
    if (setBank.length < MAX_SAVED_SETS || (replacingId && setBank.some((s) => s.id === replacingId))) return true;
    error = `This device holds ${MAX_SAVED_SETS} sets. Delete one you no longer need, then try again.`;
    return false;
  }
  async function startFreshSet() {
    freshConfirm = false;
    if (!roomForNewSet()) return;
    checkpoint();
    cancelQueued();
    autoEvent('set');
    show = defaultShow(true);
    selectedSurface = 0;
    bank = 0;
    await engine?.restore(show);
    refreshParams();
    persist();
    settings = false;
    flash('New set started. Your last set is saved on this device.');
  }
  // ── Imported media ────────────────────────────────────────────────────────
  let storage: { files: number; bytes: number; unused: AssetInfo[]; unusedBytes: number } | null = null;
  let storageBusy = false, mediaConfirm = false;
  /** Photos and videos this set uses: what "Export with media" would carry. */
  let setMedia = { files: 0, bytes: 0 };
  async function refreshStorage() {
    try {
      const all = await listAssets();
      const unused = unusedAssets(all, referencedAssetIds([show, ...setBank, ...history.states]));
      storage = { files: all.length, bytes: totalBytes(all), unused, unusedBytes: totalBytes(unused) };
      setMedia = setMediaSize(show, all);
    } catch { storage = null; setMedia = { files: 0, bytes: 0 }; }
  }
  async function deleteUnusedMedia() {
    mediaConfirm = false;
    if (storageBusy) return;
    storageBusy = true;
    try {
      flushSaves();
      await refreshStorage();
      const unused = storage?.unused ?? [];
      if (!unused.length) return;
      await deleteAssets(unused.map((asset) => asset.id));
      flash(`${unused.length} file${unused.length === 1 ? '' : 's'} deleted. ${formatBytes(totalBytes(unused))} freed.`);
      await refreshStorage();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not delete the media.';
    } finally { storageBusy = false; }
  }
  $: if (settings) void refreshStorage(); else { setEdit = null; freshConfirm = false; mediaConfirm = false; }
  // ── Blocks ────────────────────────────────────────────────────────────────
  $: blockTabList = blockTabs(show);
  function applyBlocks(next: BlockState) {
    show.scenes = next.scenes; show.activeBlockId = next.activeBlockId; show.launchGrid = next.launchGrid;
  }
  /** Opens another block. Playing clips keep playing; only the deck's pads change. */
  function selectBlock(id: string) {
    const next = switchBlock(show, id, uid);
    if (!next) return;
    feel(prefs,'switch');
    autoEvent('block');
    checkpoint();
    applyBlocks(next);
    persist();
  }
  /** Drag or the menu arrows: the tab moves, the open block and what plays stay as they are. */
  function moveBlockTab(from: number, to: number) {
    const next = moveBlock(show, from, to, uid);
    if (!next) return;
    checkpoint();
    applyBlocks(next);
    persist();
    feel(prefs,'switch');
  }
  function newBlock() {
    const next = addBlock(show, uid);
    if (!next) { flash(`A set supports up to ${MAX_BLOCKS} blocks.`); return; }
    checkpoint();
    applyBlocks(next);
    persist();
    flash(`${next.added.name} added.`);
  }
  function renameBlockTab(id: string, name: string) {
    const clean = name.trim();
    if (!clean) return;
    checkpoint();
    // The deck of an older set becomes a real block the moment it is given a name.
    if (!id) { applyBlocks(ensureOpenBlock(show, uid)); id = show.activeBlockId ?? ''; }
    show.scenes = renameBlock(show, id, clean);
    persist();
  }
  function copyBlock(id: string) {
    const next = duplicateBlock(show, id, uid);
    if (!next) { flash(`A set supports up to ${MAX_BLOCKS} blocks.`); return; }
    checkpoint();
    applyBlocks(next);
    persist();
    flash(`${next.added.name} added.`);
  }
  function deleteBlockTab(id: string) {
    const next = deleteBlock(show, id, uid);
    if (!next) { flash('A set keeps at least one block.'); return; }
    if (next.activeBlockId !== show.activeBlockId) autoEvent('block');
    checkpoint();
    applyBlocks(next);
    persist();
    flash(`${next.removed.name} deleted.`, { label: 'Undo', run: () => void undo() }, 6000);
  }
  async function undo(redo = false) {
    const next = redo ? history.redo(show) : history.undo(show);
    if (!next) return;
    show = next;
    cancelQueued();
    autoEvent('undo');
    await engine?.restore(show);
    refreshParams();
    canUndo = history.canUndo;
    canRedo = history.canRedo;
    persist();
  }
  function changeLayer(index: number) {
    selectedLayer = index;
    refreshParams();
  }
  // Shared with the renderer so all movement controls stay in sync.
  let liveGhostMovement:number|undefined;
  function ghostMove(direction:number){checkpoint();const current=engine?.ghostMovement(selectedLayer)??(Number(layer.params.movement)||0);setParam('journey',false);setParam('movement',direction===0?(current+1+Math.floor(Math.random()*(ghostMovements.length-1)))%ghostMovements.length:(current+direction+ghostMovements.length)%ghostMovements.length);}
  function refreshParams() {
    params = (engine?.parameters(selectedLayer) || []).filter(p=>!p.NAME.startsWith('_ghost'));
    const t = engine?.videoTime(selectedLayer);
    videoPosition = t?.time || 0;
    videoDuration = t?.duration || 0;
  }
  function cancelQueued() {
    pending = {};
    for (let i = 0; i < 8; i++) engine?.cancelPrepared(i);
  }
  const launchingClips: Record<number, {clipId:string}> = {};
  let lastPlayingTap:{row:number;clipId:string;at:number}|null=null;
  const unavailableMessage=(clip:Clip)=>`${clip.name} is not available on this device. Hold its pad to replace it.`;
  /** Sets from other devices can hold clips this build cannot run. Say so once; their pads stay. */
  function noteUnavailable(){
    const count=new Set(show.launchGrid.flat().filter(id=>clipUnavailable(show.clips.find(c=>c.id===id)))).size;
    if(count)flash(`${count} clip${count===1?' is':'s are'} not available on this device. Hold a pad to replace it.`);
  }
  function toggleClip(clip:Clip,index:number) {
    if(clipUnavailable(clip)){flash(unavailableMessage(clip));return;}
    changeLayer(index);
    controlView='source';
    const running=show.layers[index].clipId===clip.id || pending[index]?.clip.id===clip.id || launchingClips[index]?.clipId===clip.id;
    const now=performance.now();
    if(running){
      const doubleTap=lastPlayingTap?.row===index && lastPlayingTap.clipId===clip.id && now-lastPlayingTap.at<=350;
      lastPlayingTap=doubleTap?null:{row:index,clipId:clip.id,at:now};
      if(doubleTap)stopRow(index);
    }else{
      lastPlayingTap=null;
      autoEvent('launch');
      handLaunch(index);
      void launch(clip,index);
    }
  }
  async function launch(clip: Clip, index = selectedLayer, queued = false) {
    if (clipUnavailable(clip)) { flash(unavailableMessage(clip)); return; }
    if (show.quantize && !queued) {
      const request = { clip, at: Infinity };
      pending = { ...pending, [index]: request };
      try {
        const ready = await engine?.prepare(index, clip);
        if (ready && pending[index] === request)
          pending = { ...pending, [index]: { clip, at: nextBeat(performance.now(), clockOrigin, show.bpm) } };
      } catch (e) {
        if (pending[index] === request) {
          const next = { ...pending };
          delete next[index];
          pending = next;
          error = e instanceof Error ? e.message : 'Could not prepare this clip.';
        }
      }
      return;
    }
    const rest = { ...pending };
    delete rest[index];
    pending = rest;
    const launchRequest={clipId:clip.id};
    launchingClips[index]=launchRequest;
    loading[index] = true;
    loading = [...loading];
    error = '';
    try {
      const accepted = await engine?.launch(index, clip);
      if (!accepted) return;
      // A clip comes back with the look it was last given, not the shader's factory settings.
      show.layers[index] = { ...show.layers[index], clipId: clip.id, enabled: true, ...(clip.kind==='camera'?{fit:'fill' as const}:{}), params: clipLaunchParams(show, clip.id) };
      persist();
      if (index === selectedLayer) refreshParams();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not launch this clip.';
    } finally {
      if(launchingClips[index]===launchRequest){delete launchingClips[index];loading[index] = false;loading = [...loading];}
    }
  }
  function patchLayer(patch: Partial<typeof layer>) {
    show.layers[selectedLayer] = { ...show.layers[selectedLayer], ...patch };
    // Edits to a playing clip's parameters are that clip's look: keep them with the clip.
    if (patch.params) show.clips = rememberClipLook(show, selectedLayer);
    persist();
  }
  function resetLook() {
    if (!activeClip) return;
    checkpoint();
    const reset = resetClipLook(show, activeClip.id);
    show.clips = reset.clips;
    show.layers[selectedLayer] = { ...show.layers[selectedLayer], params: reset.params };
    persist();
    flash('Look reset to the clip defaults.');
  }
  function patchSurface(patch: Partial<Surface>) {
    if (!surface) return;
    show.surfaces[selectedSurface] = { ...surface, ...patch };
    persist();
  }
  function assignClip(clip: Clip) {
    let row = editSlot?.row ?? selectedLayer;
    let column = editSlot?.column ?? show.launchGrid[row].findIndex(id => !id);
    if (column < 0) column = show.launchGrid[row].length;
    if (column >= 48) { error = 'This row is full. Choose a slot to replace.'; return; }
    show.launchGrid[row][column] = clip.id;
    changeLayer(row);
    editSlot = null;
    pickerOpen = false;
    tab = 'perform';
    // The deck opens at column 1; bring the new pad into view and pulse it so "tap its pad" is possible.
    freshPad = { row, column };
    clearTimeout(freshTimer);
    freshTimer = setTimeout(() => (freshPad = null), 3400);
    flash('Clip loaded. Tap its pad to launch.');
    persist();
  }
  /** The effect browser sheet is open. */
  let effectBrowser = false;
  function chooseEffect(type: string) { effectBrowser = false; addEffect(type); }
  /** Drag handle or arrow keys: one effect moves, one undo step. */
  function moveEffectTo(from: number, to: number, announce = false) {
    if (to < 0 || to >= activeEffects.length || from === to) return;
    checkpoint();
    patchEffects(moveEffect(activeEffects, from, to));
    feel(prefs, 'switch');
    if (announce) void tick().then(() => document.querySelectorAll<HTMLElement>('[data-effect-handle]')[to]?.focus());
  }
  $: effectScopeName = fxScope==='comp' ? 'the whole output' : fxScope==='clip' ? (activeClip?.name ?? 'this clip') : `Layer ${show.dualDeck ? selectedLayer % 4 + 1 : selectedLayer + 1}`;
  let freshPad: { row: number; column: number } | null = null;
  let freshTimer: ReturnType<typeof setTimeout>;
  function stopRow(index: number) {
    autoEvent('stop');
    feel(prefs,'stop');
    delete launchingClips[index];loading[index]=false;loading=[...loading];
    checkpoint(); const next = { ...pending }; delete next[index]; pending = next; engine?.cancelPrepared(index); engine?.clear(index);
    show.layers[index] = { ...show.layers[index], clipId: null };
    persist(); refreshParams();
  }
  function addDepth(){
    checkpoint();let clip=show.clips.find(c=>c.kind==='depth');
    if(!clip){clip={id:uid(),name:'LiDAR Depth',kind:'depth'};show.clips=[...show.clips,clip];}
    assignClip(clip);flash('Depth camera loaded. Tap to launch; Controls opens depth FX.');
  }
  function addCamera(facing:'user'|'environment') {
    checkpoint();const id=`camera-${facing}`;
    let clip=show.clips.find(c=>c.id===id);
    if(!clip){clip={id,name:facing==='user'?'Front camera':'Rear camera',kind:'camera',facing};show.clips=[...show.clips,clip];}
    assignClip(clip);flash('Camera loaded. Tap its pad to start capture.');
  }
  function addShader(id: string) {
    const shader = findShader(id)!;
    if (shader.requiresImage) { shaderInputId = id; shaderMediaInput.click(); return; }
    let clip = show.clips.find((c) => c.shaderId === id);
    checkpoint();
    if (!clip) {
      clip = { id: uid(), shaderId: id, name: shader.name, kind: 'shader' };
      show.clips = [...show.clips, clip];
    }
    bank = Math.floor(show.clips.indexOf(clip) / 12);
    assignClip(clip);
    tab = 'perform';
    persist();
  }
  async function importShaderSource(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    const shader = shaderInputId ? findShader(shaderInputId) : undefined;
    shaderInputId = null;
    if (!file || !shader) return;
    try {
      const assetId = uid(); await putAsset(assetId, file); checkpoint();
      const clip: Clip = { id: uid(), kind: 'shader', shaderId: shader.id, assetId, name: `${shader.name} · ${file.name}` };
      show.clips = [...show.clips, clip]; assignClip(clip);
    } catch (e) { error = e instanceof Error ? e.message : 'Could not load shader input.'; }
  }
  async function importMedia(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    checkpoint();
    let first: Clip | undefined;
    for (const file of files) {
      if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) {
        error = `${file.name} is not a supported image or video.`;
        continue;
      }
      const id = uid();
      try {
        await putAsset(id, file);
        const clip: Clip = {
          id,
          assetId: id,
          name: file.name,
          kind: file.type.startsWith('video/') ? 'video' : 'image',
        };
        show.clips = [...show.clips, clip];
        first ??= clip;
      } catch (e) {
        error = e instanceof Error ? e.message : 'Media import failed.';
      }
    }
    if (first) {
      tab = 'perform';
      bank = Math.floor(show.clips.findIndex((c) => c.id === first!.id) / 12);
      assignClip(first);
      flash(`${files.length} file${files.length === 1 ? '' : 's'} added to this device`);
    }
    persist();
  }
  function removeClip(clip: Clip) {
    checkpoint();
    show.clips = show.clips.filter((c) => c.id !== clip.id);
    show.surfaces = forgetSurfaceClip(show.surfaces, clip.id);
    show.launchGrid = show.launchGrid.map(row => row.map(id => id === clip.id ? null : id));
    show.layers = show.layers.map((l, i) => {
      if (l.clipId !== clip.id) return l;
      engine?.clear(i);
      return { ...l, clipId: null };
    });
    bank = Math.min(bank, Math.max(0, Math.ceil(show.clips.length / 12) - 1));
    persist();
  }
  function selectTab(next: typeof tab) {
    if(next==='fx'){openControls(selectedLayer);return;}
    clipControlsOpen=false;
    mixerOpen=false;
    // Looking at Map never changes the output. Mapping starts from the toggle, a new surface,
    // Paint, or the first corner the performer moves.
    tab = next;
  }
  function addSurface(preset = 'single') {
    checkpoint();
    show.mapping = true;
    if (preset !== 'single') show.stage = undefined;
    if (preset === 'single') {
      if (show.surfaces.length >= 16) {
        flash('A set supports up to 16 surfaces.');
        return;
      }
      show.surfaces = [...show.surfaces, newSurface(show.surfaces.length, !show.surfaces.length)];
      selectedSurface = show.surfaces.length - 1;
    } else if(preset==='paint-box'){
      const corners=[
        [[.5,.1],[.82,.28],[.5,.46],[.18,.28]],
        [[.18,.28],[.5,.46],[.5,.88],[.18,.68]],
        [[.5,.46],[.82,.28],[.82,.68],[.5,.88]],
      ];
      show.surfaces=corners.map((c,i)=>({...newSurface(i),name:['Box · top','Box · left','Box · right'][i],points:Array.from({length:9},(_,n)=>{
        const u=(n%3)/2,v=Math.floor(n/3)/2;
        return{x:c[0][0]*(1-u)*(1-v)+c[1][0]*u*(1-v)+c[2][0]*u*v+c[3][0]*(1-u)*v,y:c[0][1]*(1-u)*(1-v)+c[1][1]*u*(1-v)+c[2][1]*u*v+c[3][1]*(1-u)*v};
      })}));
      const [top,left,right]=show.surfaces;
      show.paint={...paint,enabled:true,isolate:true,brush:'slime',color:'#beff63',strokes:[],loop:false,links:[
        {from:top.id,edge:'bottom',to:left.id,entry:'top',flip:false},
        {from:top.id,edge:'right',to:right.id,entry:'top',flip:true},
        {from:left.id,edge:'right',to:right.id,entry:'left',flip:false},
      ]};
      selectedSurface=0;mappingTool='paint';
    } else {
      const count = preset === 'triptych' ? 3 : 2;
      show.surfaces = Array.from({ length: count }, (_, i) => ({
        ...newSurface(i),
        name: `Panel ${i + 1}`,
        points: gridPoints(0.04 + (i * 0.94) / count, 0.12, 0.88 / count, 0.76),
      }));
      selectedSurface = 0;
    }
    persist();
  }
  function setBpm(value: number) {
    show.bpm = clamp(value, 30, 240);
    clockOrigin = performance.now();
    // A new tempo re-times what is queued. It never cancels a launch or switches Autopilot off.
    const now = clockOrigin;
    pending = Object.fromEntries(Object.entries(pending).map(([row, request]) => [row, Number.isFinite(request.at) ? { ...request, at: nextBeat(now, clockOrigin, show.bpm) } : request]));
    autoEvent('tempo');
    persist();
  }
  /** Tap tempo and the microphone live in a small sheet opened from the BPM label in the footer. */
  let tempoOpen = false;
  let footerEl: HTMLElement;
  let tempoAnchor = { left: 10, bottom: 60 };
  function toggleTempo() {
    if (!tempoOpen && footerEl) {
      // The footer scrolls its own overflow, so the sheet is placed from the footer's box instead of inside it.
      // On a phone the footer is usually hidden: sit just above the workspace bar instead.
      let box = footerEl.getBoundingClientRect();
      if (!box.height) box = (document.querySelector('.studio > .tabs') ?? footerEl).getBoundingClientRect();
      tempoAnchor = box.height ? { left: Math.round(box.left) + 10, bottom: Math.round(window.innerHeight - box.top) + 8 } : { left: 10, bottom: 70 };
    }
    tempoOpen = !tempoOpen;
  }
  /** The tempo chip is a tap pad: tap it in time to set the tempo, hold it for the tempo and audio sheet. */
  let tempoPress = 0, tempoHold: ReturnType<typeof setTimeout> | undefined;
  function tempoDown() {
    tempoPress = performance.now();
    const before = taps;
    tap();
    clearTimeout(tempoHold);
    tempoHold = setTimeout(() => { taps = before; if (!tempoOpen) toggleTempo(); }, 500);
  }
  function tempoUp() { clearTimeout(tempoHold); }
  // A rotation or Split View resize moves the footer: close rather than float in the wrong place.
  $: if (layoutInfo) tempoOpen = false;
  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps = [...taps.slice(-5), now];
    if (taps.length > 1) setBpm(Math.round(60000 / ((now - taps[0]) / (taps.length - 1))));
  }
  // Audio response listens to one source. The iPhone and iPad app also offer its own
  // player and other apps' sound (through a screen broadcast); elsewhere only the microphone.
  const nativeAudio = hasNativeAudio();
  const audioSources: { id: AudioSourceKind; label: string }[] = nativeAudio
    ? [{ id: 'off', label: 'Off' }, { id: 'mic', label: 'Mic' }, { id: 'player', label: 'Player' }, { id: 'phone', label: 'Phone' }]
    : [{ id: 'off', label: 'Off' }, { id: 'mic', label: 'Mic' }];
  const audioNames: Record<AudioSourceKind, string> = { off: 'Audio off', mic: 'Microphone', player: 'Player', phone: 'Phone audio' };
  const AUDIO_PREFERENCE = 'ghost-arcade.studio.audio-source';
  function preferredAudio(): Exclude<AudioSourceKind, 'off'> {
    try { const value = localStorage.getItem(AUDIO_PREFERENCE); if (value === 'player' || value === 'phone') return nativeAudio ? value : 'mic'; } catch { /* storage unavailable */ }
    return 'mic';
  }
  let audioState: NativeAudioStatus | null = null;
  let audioMeter = { source: 'off' as AudioSourceKind, arriving: false, level: 0, bpm: 0 };
  $: mic = audioSource !== 'off';
  async function chooseAudio(next: AudioSourceKind) {
    if (micBusy || next === audioSource) return;
    micBusy = true;
    try {
      await engine?.audioSource(next);
      audioSource = next;
      if (next !== 'off') try { localStorage.setItem(AUDIO_PREFERENCE, next); } catch { /* storage unavailable */ }
      if (nativeAudio) audioState = await nativeAudioStatus().catch(() => audioState);
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      error = next === 'mic' ? message || 'Microphone access was not available. Check microphone permission in Settings.' : message || 'That audio source could not start.';
    } finally {
      micBusy = false;
    }
  }
  /** The quick switch in Controls: off, or back to the source last used. */
  function toggleMic() {
    void chooseAudio(audioSource === 'off' ? preferredAudio() : 'off');
  }
  async function audioCommand(task: () => Promise<NativeAudioStatus | void>, failure: string) {
    try {
      const status = await task();
      if (status) audioState = status;
    } catch (e) {
      error = (e instanceof Error && e.message) || failure;
    }
  }
  const playerCommand = (action: PlayerAction, options: { id?: string; position?: number; loop?: boolean } = {}) =>
    audioCommand(() => audioPlayer(action, options), 'The player could not do that.');
  async function addAudioTracks() {
    await audioCommand(async () => {
      const status = await importAudioTracks();
      if (status.skipped?.length) flash(`Could not add ${status.skipped.join(', ')}. Pick audio files or videos with sound.`, null, 6000);
      else if (status.added) flash(status.added === 1 ? 'Added 1 track.' : `Added ${status.added} tracks.`);
      return status;
    }, 'Could not add those files.');
  }
  const formatTrackTime = (seconds = 0) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  $: phoneHint = audioSource !== 'phone'
    ? ''
    : audioMeter.arriving
      ? 'Hearing other apps. Play anything and the visuals follow it.'
      : audioState?.phoneSilentFor == null
        ? 'Not started yet. Tap Start phone audio, choose Ghost Arcade Audio and tap Start Broadcast.'
        : 'No sound right now. Play music in another app, or start phone audio again if the broadcast stopped.';
  // While the sheet is open, keep the meter, player position and broadcast status fresh.
  let audioWatch: ReturnType<typeof setInterval> | undefined;
  function watchAudio(open: boolean) {
    clearInterval(audioWatch);
    audioWatch = undefined;
    if (!open) return;
    const refresh = () => {
      if (engine) audioMeter = engine.audioMeter;
      if (nativeAudio && (audioSource === 'player' || audioSource === 'phone')) void nativeAudioStatus().then(status => { audioState = status; }, () => {});
    };
    refresh();
    audioWatch = setInterval(refresh, 250);
  }
  $: watchAudio(tempoOpen);
  onDestroy(() => clearInterval(audioWatch));
  /** The audio input button beside Hold: its icon says which source listens, its bars that sound arrives. */
  const audioIcons: Record<AudioSourceKind, string> = { off: 'mic-off', mic: 'mic', player: 'note', phone: 'phone' };
  let audioLevel = 0;
  let levelWatch: ReturnType<typeof setInterval> | undefined;
  function watchLevel(on: boolean) {
    clearInterval(levelWatch);
    levelWatch = undefined;
    if (!on) { audioLevel = 0; return; }
    levelWatch = setInterval(() => { audioLevel = engine ? Math.min(1, engine.audioMeter.level / 0.6) : 0; }, 100);
  }
  $: watchLevel(mic && tab === 'perform' && !clean);
  onDestroy(() => clearInterval(levelWatch));
  function setFrozen() {
    frozen = !frozen;
    if (engine) engine.frozen = frozen;
  }
  function setBlackout() {
    blackout = !blackout;
    feel(prefs,'blackout');
    if (engine) engine.blackout = blackout;
  }
  function toggleGrid() {
    testGrid = !testGrid;
    if (engine) engine.testGrid = testGrid;
  }
  function patchEffects(effects:EffectChain) {
    if(fxScope==='comp') show.effects=effects;
    else if(fxScope==='clip') {if(!activeClip)return;show.clips=show.clips.map(c=>c.id===activeClip.id?{...c,effects}:c);}
    else show.layers[selectedLayer]={...show.layers[selectedLayer],effects};
    persist();
  }
  function openControls(row:number){
    if(!clipControlsOpen)controlsReturnFocus=document.activeElement as HTMLElement|null;
    lastPlayingTap=null;
    changeLayer(row);
    controlView='source';
    mixerOpen=false;
    tab='perform';
    clipControlsOpen=true;
    coachMove(coachAfter(coach,'controls'));
  }
  /** A small sheet: focus goes in when it opens, Escape closes it, focus returns to the opener. */
  function focusSheet(node:HTMLElement,close:()=>void){
    const opener=document.activeElement as HTMLElement|null;
    node.querySelector<HTMLElement>('button:not([disabled])')?.focus({preventScroll:true});
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}};
    node.addEventListener('keydown',key);
    return {destroy(){node.removeEventListener('keydown',key);if(opener?.isConnected)opener.focus({preventScroll:true});}};
  }
  function closeControls(){clipControlsOpen=false;effectBrowser=false;}
  /** A press anywhere off the controls sheet closes it (not when it is docked beside the deck). */
  function pressOffControls(e:PointerEvent){
    if(!clipControlsOpen||dockedInspector||effectBrowser)return;
    const target=e.target as HTMLElement|null;
    if(!target||target.closest('.clip-controls-tray, dialog, [role="dialog"], .bottom-nav, nav'))return;
    closeControls();
  }
  function focusControlsTray(node:HTMLElement){
    node.querySelector<HTMLElement>('[data-close-controls]')?.focus({preventScroll:true});
    return {destroy(){const opener=controlsReturnFocus;controlsReturnFocus=null;void tick().then(()=>{if(!clipControlsOpen&&opener?.isConnected)opener.focus({preventScroll:true});});}};
  }
  function openMixer(row=selectedLayer){clipControlsOpen=false;changeLayer(row);if(!tablet)mixerOpen=true;else selectTab("perform");}
  function addEffect(type: string) {
    if (activeEffects.length >= 8) { flash("Each FX scope supports up to eight effects."); return; }
    const def = MOBILE_EFFECTS.find((e) => e.type === type)!;
    checkpoint();
    patchEffects([...activeEffects, { id: uid(), type, enabled: true, params: { ...def.defaults } }]);
  }
  function setEffect(index: number, key: string, value: number) {
    const effects = copy(activeEffects);
    effects[index].params[key] = value;
    patchEffects(effects);
  }
  function colorHex(value: unknown) {
    const v = Array.isArray(value) ? value : [1, 1, 1];
    return (
      '#' +
      v
        .slice(0, 3)
        .map((n) =>
          Math.round(clamp(Number(n)) * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  }
  function colorValue(value: string) {
    return [
      parseInt(value.slice(1, 3), 16) / 255,
      parseInt(value.slice(3, 5), 16) / 255,
      parseInt(value.slice(5, 7), 16) / 255,
      1,
    ];
  }
  function variation() {
    checkpoint();
    const values = { ...layer.params };
    for (const p of params) {
      if (p.TYPE === 'float')
        values[p.NAME] = (p.MIN ?? 0) + ((p.MAX ?? 1) - (p.MIN ?? 0)) * (0.15 + Math.random() * 0.7);
      else if (p.TYPE === 'long' && p.VALUES?.length)
        values[p.NAME] = p.VALUES[Math.floor(Math.random() * p.VALUES.length)];
    }
    patchLayer({ params: values });
  }
  function focusDialog(node: HTMLElement) {
    const previous = document.activeElement as HTMLElement | null;
    node.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const elements = Array.from(
        node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]'),
      ).filter((el) => el.offsetParent !== null);
      const first = elements[0],
        last = elements.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    node.addEventListener('keydown', trap);
    return {
      destroy() {
        node.removeEventListener('keydown', trap);
        previous?.focus();
      },
    };
  }
  function setParam(name: string, value: number | boolean | number[]) {
    patchLayer({ params: { ...show.layers[selectedLayer].params, [name]: value } });
  }
  async function openSavedSet(id: string) {
    const next = setBank.find((s) => s.id === id);
    if (!next || next.id === show.id) return;
    flushSaves();
    checkpoint();
    cancelQueued();
    autoEvent('set');
    show = copy(next);
    selectedSurface = 0;
    bank = 0;
    await engine?.restore(show);
    refreshParams();
    persist();
    settings = false;
    noteUnavailable();
    offerRepair();
  }
  // ── One-time repair for sets saved by app 1.0 ─────────────────────────────
  // Offered once per set, never applied silently. Declining changes nothing; the fix stays in
  // Set settings while the set still has the problem.
  let repairOffer: SetProblems | null = null;
  $: setFix = setProblems(show);
  function offerRepair() {
    const problems = setProblems(show);
    repairOffer = needsRepair(problems) && !prefs.repairOffered.includes(show.id) ? problems : null;
    if (repairOffer) setPrefs({ repairOffered: [...prefs.repairOffered, show.id] });
  }
  function fixSet() {
    const problems = setProblems(show);
    repairOffer = null;
    if (!needsRepair(problems)) return;
    checkpoint();
    show = repairSet(show, problems);
    persist();
    settings = false;
    const done = [problems.hiddenDecks.length ? 'lower rows now show through' : '', problems.inset ? 'the picture fills the frame' : ''].filter(Boolean).join(' and ');
    flash(`Set fixed: ${done}.`, { label: 'Undo', run: () => void undo() }, 9000);
  }
  let exporting = false;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  /**
   * Shares the set as one .ghostset file. With `withMedia` the file also carries the photos and
   * videos the set uses, so it opens complete on another device.
   */
  async function exportSet(event?: Event, withMedia = false) {
    if (exporting) return;
    exporting = true;
    // The iPad share popover points at the button that was tapped.
    const anchor = event?.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
    try {
      let blob: Blob, files = 0, missing = 0;
      if (withMedia) {
        const packed = await packSet(show, getAsset);
        blob = packed.blob; files = packed.files; missing = packed.missing.length;
      } else blob = new Blob([JSON.stringify(show, null, 2)], { type: 'application/json' });
      // Only claim success when the file really left: a finished share sheet, or a started download.
      const done = await shareFile(`${show.name}.ghostset`, blob, withMedia ? 'application/octet-stream' : 'application/json', anchor);
      const how = isNativePlatform() ? 'Set shared' : 'Set file downloaded';
      if (!done) flash('Export cancelled. Nothing was shared.');
      else if (withMedia) flash(`${how} with ${plural(files, 'media file')}.${missing ? ` ${plural(missing, 'file')} could not be found on this device.` : ''}`, null, 5000);
      else flash(`${how}. Imported media stays on this device.`);
    } catch (e) {
      if (e instanceof BundleTooLarge) error = `This set uses more than ${formatBytes(BUNDLE_MAX_BYTES)} of media, which is too much for one file. Export the set only, or remove clips you do not need.`;
      else error = e instanceof Error && /latest version/.test(e.message) ? e.message : 'This set could not be exported. Try again.';
    } finally {
      exporting = false;
    }
  }
  async function importSet(event: Event) {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      // Either kind of .ghostset: the set alone, or the set with its media in the same file.
      const opened = await unpackSet(file);
      const next = normalizeShow(opened.show);
      if (!roomForNewSet(next.id)) return;
      // Media first: the set is only opened once its files are safely on this device.
      try { for (const item of opened.media) await putAsset(item.id, item.blob); }
      catch { throw new Error('There is not enough space on this device for the media in this set. Free some space and try again.'); }
      flushSaves();
      checkpoint();
      cancelQueued();
      autoEvent('set');
      show = next;
      selectedSurface = 0;
      bank = 0;
      await engine?.restore(show);
      refreshParams();
      persist();
      settings = false;
      if (opened.bundled) flash(`“${next.name}” opened with ${plural(opened.media.length, 'media file')}.${opened.missing.length ? ` ${plural(opened.missing.length, 'file')} were not in the set file.` : ''}`, null, 5000);
      noteUnavailable();
      offerRepair();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not open this set.';
    }
  }
  function onKey(e: KeyboardEvent) {
    if(clipControlsOpen){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeControls();}return;}
    if(e.defaultPrevented||interactiveOpen||(e.target as HTMLElement)?.closest('button,[role=dialog],dialog'))return;
    if ((e.target as HTMLElement)?.matches('input,select,textarea')) return;
    if (e.key === 'Escape') {
      clean = false;
      settings = false;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      setFrozen();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      void undo(e.shiftKey);
    }
  }
  // ── Visuals engine lifecycle ──────────────────────────────────────────────
  // iOS can take the GPU context away (memory pressure, a long spell in the background). The engine
  // then stops and is rebuilt here: on the same canvas when the browser restores the context, or
  // on a fresh canvas from the Restart visuals button when it does not.
  let visualsDown = false, visualsRestarting = false, canvasGeneration = 0;
  /** Shader detail the engine is rendering at (1 = full). Below 1 the monitor says so. */
  let detail = 1, detailNoticed = false;
  let restoreTimer: ReturnType<typeof setTimeout>;
  function startEngine() {
    const next = new StudioEngine(output, () => show);
    next.beatClock = () => (performance.now() - clockOrigin) * show.bpm / 60000;
    next.onStats = (value) => (fps = value);
    next.afterFrame = (canvas) => mappingCanvas?.loupeFrame(canvas);
    next.onError = (message) => (error = message);
    next.onStopped = (reason, message) => {
      if (engine !== next) return;
      visualsDown = true; fps = 0;
      clearTimeout(restoreTimer);
      // A lost context normally comes back by itself within a moment; a failed frame never does.
      if (reason === 'failed') error = message || 'The visuals stopped.';
      else restoreTimer = setTimeout(() => { if (visualsDown && engine === next) error = 'The visuals were interrupted and did not come back by themselves.'; }, 4000);
    };
    next.onRestored = () => { if (engine === next) void restartVisuals(false); };
    detail = 1;
    next.onDetail = (value, change) => {
      if (engine !== next) return;
      detail = value;
      // Say it when it first drops and when full detail is back, not on every step.
      if (change === 'lowered' && !detailNoticed) { detailNoticed = true; flash('Detail lowered to hold the frame rate. It comes back when there is room.', null, 5000); }
      else if (change === 'raised' && value >= 1) { detailNoticed = false; flash('Full detail is back.'); }
    };
    next.frozen = frozen; next.blackout = blackout; next.testGrid = testGrid; next.flux = flux;
    next.surfaceClipCap = surfaceCap; next.onSurfacePlan = plan => { if (engine === next) surfacePlan = plan; };
    engine = next;
    next.start();
    if (audioSource !== 'off') void next.audioSource(audioSource).catch(() => { audioSource = 'off'; });
  }
  async function restartVisuals(freshCanvas: boolean) {
    if (visualsRestarting) return;
    visualsRestarting = true;
    clearTimeout(restoreTimer);
    try {
      cancelQueued();
      autoJobs.clear();
      // Reusing the canvas: its (restored) context must survive the old engine's teardown.
      engine?.destroy(!freshCanvas);
      engine = undefined;
      if (freshCanvas) {
        // A new canvas gets a new GPU context when the old one cannot be revived.
        canvasGeneration++;
        await tick();
        if (!interactiveLive) { externalOutput?.destroy(); externalOutput = new ExternalOutput(output, status => outputStatus = status); externalOutput.configure(outputPreferences); }
      }
      startEngine();
      await engine!.restore(show);
      visualsDown = false; error = '';
      refreshParams();
      if (autoOn) rearmAuto();
      flash('Visuals restarted.');
    } catch (e) {
      visualsDown = true;
      error = e instanceof Error ? e.message : 'The visuals could not restart.';
    } finally {
      visualsRestarting = false;
    }
  }
  onMount(() => {
    if(hasNativeLive())void captureCapabilities().then(c=>{lidar=!!c.lidar;setSurfaceCap({memoryGB:c.memoryGB,cores:c.cores});}).catch(()=>lidar=false);
    else setSurfaceCap({cores:navigator.hardwareConcurrency});
    const stopLayout=watchLayout(info=>{layoutInfo=info;if(info.mixer==='docked')mixerOpen=false;});
    let disposed = false;
    try {
      startEngine();
      externalOutput=new ExternalOutput(output,status=>outputStatus=status);
      void engine!.restore(show).then(() => {
        if (!disposed) { refreshParams(); noteUnavailable(); offerRepair(); }
      });
    } catch (e) {
      visualsDown = true;
      error = e instanceof Error ? e.message : 'Video engine unavailable.';
    }
    let autoFrame=0;
    const frame=(now:number)=>{autoTick(now);autoFrame=requestAnimationFrame(frame);};
    autoFrame=requestAnimationFrame(frame);
    const timer = setInterval(() => {
      const now = performance.now();
      beat = Math.floor((now - clockOrigin) / (60000 / show.bpm)) % 4;
      for (const [key, value] of Object.entries(pending))
        if (now >= value.at) void launch(value.clip, Number(key), true);
      const t = engine?.videoTime(selectedLayer);
      liveGhostMovement=engine?.ghostMovement(selectedLayer);
      videoPosition = t?.time || 0;
      videoDuration = t?.duration || 0;
    }, 50);
    // iOS can end the app while it is in the background, so nothing may wait in a timer there.
    const saveWhenHidden = () => { if (document.visibilityState === 'hidden') flushSaves(); };
    document.addEventListener('visibilitychange', saveWhenHidden);
    window.addEventListener('pagehide', flushSaves);
    // Held for as long as the studio is open, and asked for again after every trip to the background.
    const awake = keepAwake();
    return () => {
      stopAuto();
      stopLayout();
      disposed = true;interactiveOutputAllowed=false;
      cancelAnimationFrame(autoFrame);
      clearInterval(timer);
      clearTimeout(noticeTimer);
      clearTimeout(freshTimer);
      document.removeEventListener('visibilitychange', saveWhenHidden);
      window.removeEventListener('pagehide', flushSaves);
      flushSaves();
      clearTimeout(restoreTimer);
      externalOutput?.destroy();
      engine?.destroy();
      awake.stop();
    };
  });
</script>
{#snippet shaderParam(p:ISFInput)}
{#if p.TYPE === 'color'}<label
                  class="toggle-row"
                  ><span>{paramLabel(p)}</span><input
                    type="color"
                    value={colorHex(layer.params[p.NAME] ?? p.DEFAULT)}
                    onchange={(e) => {
                      checkpoint();
                      setParam(p.NAME, colorValue(e.currentTarget.value));
                    }}
                  /></label
                >{:else if p.TYPE === 'event'}<button class="secondary" onclick={() => setParam(p.NAME, Number(layer.params[p.NAME] ?? 0) + 1)}>{paramLabel(p)}</button>
                {:else if p.TYPE === 'point2D'}
                  {#each [0, 1] as axis}
                    {@const point = (layer.params[p.NAME] ?? p.DEFAULT ?? [0, 0]) as number[]}
                    {@const lower = Array.isArray(p.MIN) ? p.MIN[axis] : 0}
                    {@const upper = Array.isArray(p.MAX) ? p.MAX[axis] : 1}
                    <label class="range-row"><span>{paramLabel(p)} {axis ? 'Y' : 'X'}</span><input type="range" min={lower} max={upper} step={(upper-lower)/200} data-default={Array.isArray(p.DEFAULT) ? p.DEFAULT[axis] : undefined} value={point[axis]} class="blue-fill" style:--range-fill={sliderFill(point[axis], lower, upper)} oninput={e => { const next = [...point]; next[axis] = Number(e.currentTarget.value); setParam(p.NAME, next); }} /><output>{point[axis].toFixed(1)}</output></label>
                  {/each}
                {:else if p.TYPE === 'bool'}<label class="toggle-row"
                  ><span>{paramLabel(p)}</span><input
                    type="checkbox"
                    checked={Boolean(layer.params[p.NAME] ?? p.DEFAULT)}
                    onchange={(e) => setParam(p.NAME, e.currentTarget.checked)}
                  /></label
                >{:else if p.TYPE === 'long' && p.VALUES}<label class="field"
                  >{paramLabel(p)}<select
                    value={Number(layer.params[p.NAME] ?? p.DEFAULT ?? 0)}
                    onchange={(e) => setParam(p.NAME, Number(e.currentTarget.value))}
                    >{#each p.VALUES as v, i}<option value={v}>{p.LABELS?.[i] || v}</option>{/each}</select
                  ></label
                >{:else}<label class="range-row"
                  ><span>{paramLabel(p)}</span><input
                    type="range"
                    min={p.MIN ?? 0}
                    max={p.MAX ?? 1}
                    step={p.TYPE === 'long' ? 1 : ((p.MAX ?? 1) - (p.MIN ?? 0)) / 200}
                    data-default={typeof p.DEFAULT === 'number' ? p.DEFAULT : undefined}
                    value={Number(layer.params[p.NAME] ?? p.DEFAULT ?? 0)}
                    class="blue-fill"
                    style:--range-fill={sliderFill(Number(layer.params[p.NAME] ?? p.DEFAULT ?? 0), p.MIN ?? 0, p.MAX ?? 1)}
                    onpointerdown={checkpoint}
                    oninput={(e) => setParam(p.NAME, Number(e.currentTarget.value))}
                  /><output>{Number(layer.params[p.NAME] ?? p.DEFAULT ?? 0).toFixed(2)}</output></label
                >{/if}
{/snippet}
{#snippet sourceControls(inTray=false)}
          {#if !inTray}
          <div class="panel-heading">
            <div>
              <span class="eyebrow">{show.dualDeck ? `DECK ${selectedLayer < 4 ? "A" : "B"} · LAYER ${selectedLayer % 4 + 1}` : `LAYER ${selectedLayer + 1}`} · {activeClip?.kind || 'EMPTY'}</span>
              <h1>{activeClip?.name || 'Source & effects'}</h1>
            </div>
            <select
              aria-label="Effect layer"
              value={selectedLayer}
              onchange={(e) => changeLayer(Number(e.currentTarget.value))}
              >{#each show.layers.slice(0,show.dualDeck?8:4) as _, i}<option value={i}>{show.dualDeck ? `Deck ${i < 4 ? "A" : "B"} · Layer ${i % 4 + 1}` : `Layer ${i + 1}`}</option>{/each}</select
            >
          </div>
          {/if}
          <div class="segmented wide" aria-label="Control view"><button class:active={controlView==='source'} aria-pressed={controlView==='source'} onclick={()=>controlView='source'}>Source</button><button class:active={controlView==='effects'} aria-pressed={controlView==='effects'} onclick={()=>controlView='effects'}>FX</button></div>
          {#if controlView==='source'}
          {#if !activeClip}<div class="empty-state"><Icon name="grid" size={28}/><h2>No clip playing</h2><p>Launch a clip, then tap the layer gear to edit its look.</p><button onclick={closeControls}>Back to clips</button></div>{:else}
          {#if activeClip?.kind==='camera'||activeClip?.kind==='depth'}<CameraFxPanel params={layer.params} onchange={setParam} onstart={checkpoint}/>{/if}
          {#if activeClip?.shaderId==='ga-ghostfx'}<div class="ghost-movements"><strong>GhostFX · {ghostMovements[liveGhostMovement??(Number(layer.params.movement)||0)]}</strong><div><button aria-label="Previous GhostFX movement" onclick={()=>ghostMove(-1)}>← Prev</button><button aria-label="Random GhostFX movement" onclick={()=>ghostMove(0)}>↝ Random</button><button aria-label="Next GhostFX movement" onclick={()=>ghostMove(1)}>Next →</button></div></div>{/if}
          <div class="inspector-card">
            {#if !inTray}<div class="section-heading">
              <span>SOURCE CONTROLS</span><div class="inline"><button disabled={!activeClip?.params} onclick={resetLook}>Reset look</button><button disabled={!params.length} onclick={variation}>New variation</button></div>
            </div>{/if}
            <label class="range-row"
              ><span>Audio response</span><input
                type="range"
                min="0"
                max="2"
                step=".01"
                data-default="1"
                value={layer.intensity}
                class="blue-fill"
                style:--range-fill={sliderFill(layer.intensity, 0, 2)}
                oninput={(e) => patchLayer({ intensity: Number(e.currentTarget.value) })}
              /><output>{layer.intensity.toFixed(2)}</output></label
            >
            <div class="audio-quick"><button class="mic-toggle inline" class:active={mic} aria-pressed={mic} disabled={micBusy} onclick={toggleMic}><Icon name="mic" size={18} /><span>{mic ? `Listening: ${audioNames[audioSource]}` : 'Audio off'}</span></button>{#if nativeAudio}<button class="audio-change" onclick={toggleTempo}>Source</button>{/if}</div>
            {#each groupedParams.pinned as p}{@render shaderParam(p)}{/each}
            {#key controlSourceKey}
              {#each groupedParams.groups as group}<details class="param-group" open={params.length<=10 || (!groupedParams.pinned.length && group.id==='look')}><summary>{group.label}<span>{group.params.length}</span></summary>{#each group.params as p}{@render shaderParam(p)}{/each}</details>{/each}
            {/key}
            {#if inTray && (params.length || activeClip?.params)}<div class="look-actions"><button data-reset-look disabled={!activeClip?.params} onclick={resetLook}>Reset look</button>{#if params.length}<button class="new-variation" onclick={variation}>New variation</button>{/if}</div>{/if}
          </div>
          <details class="param-group transport-card"><summary>Playback &amp; layer</summary>
            <div class="section-heading">
              <span>{activeClip?.name || 'NO CLIP LOADED'}</span><button
                onclick={() => {
                  checkpoint();
                  cancelQueued();
                  autoEvent('stop');
                  engine?.clear(selectedLayer);
                  patchLayer({ clipId: null });
                  refreshParams();
                }}>Clear layer</button
              >
            </div>
            {#if videoDuration > 0}<label class="range-row"
                ><span>Position</span><input
                  aria-label="Video position"
                  type="range"
                  min="0"
                  max={videoDuration}
                  step=".01"
                  value={videoPosition}
                  oninput={(e) => engine?.seek(selectedLayer, Number(e.currentTarget.value))}
                /><output>{videoPosition.toFixed(1)}s</output></label
              >{/if}
            <label class="range-row"
              ><span>Speed</span><input
                type="range"
                min="0"
                max="3"
                step=".01"
                data-default="1"
                value={layer.speed}
                onpointerdown={checkpoint}
                oninput={(e) => patchLayer({ speed: Number(e.currentTarget.value) })}
              /><output>{layer.speed.toFixed(2)}×</output></label
            >
            <label class="range-row"
              ><span>Source fit</span><select
                value={layer.fit}
                onchange={(e) => {
                  checkpoint();
                  patchLayer({ fit: e.currentTarget.value as typeof layer.fit });
                }}
                >{#each ['contain', 'fill', 'stretch'] as fit}<option value={fit}
                    >{fit[0].toUpperCase() + fit.slice(1)}</option
                  >{/each}</select
              ></label
            >
            <div class="range-row"
              ><span>Blend</span><BlendPicker
                value={layer.blend}
                scope={show.dualDeck ? `Layer ${rowName(selectedLayer)}` : `Layer ${selectedLayer + 1}`}
                onstart={checkpoint}
                onopen={() => engine?.prepareBlends()}
                onchange={(blend) => patchLayer({ blend })}
              /></div
            >
          </details>
          {/if}
          {:else}
          <div class="segmented wide" aria-label="Effect scope">{#each [{id:'comp',name:'Comp'},{id:'layer',name:'Layer'},{id:'clip',name:'Clip'}] as scope}<button class:active={fxScope===scope.id} aria-pressed={fxScope===scope.id} disabled={scope.id==='clip'&&!activeClip} onclick={()=>fxScope=scope.id as typeof fxScope}>{scope.name}</button>{/each}</div>
          <p class="scope-context">{fxScope==='comp'?'Composition · final output':fxScope==='clip'?`Clip · ${activeClip?.name || 'Launch a clip first'}`:`Layer ${show.dualDeck ? selectedLayer % 4 + 1 : selectedLayer+1} · stays when clips change`}</p>
          <div class="section-heading">
            <span>EFFECT CHAIN · {activeEffects.length} OF 8</span><button class="add-effect" data-add-effect aria-haspopup="dialog"
              disabled={activeEffects.length >= 8 || (fxScope==='clip'&&!activeClip)}
              onclick={() => (effectBrowser = true)}><Icon name="plus" size={18} />Add effect</button>
          </div>
          {#if activeEffects.length >= 8}<p class="scope-context" role="status">This chain is full. Remove an effect to add another.</p>{/if}
          <div class="effect-chain" role="list" aria-label="Effect chain, first to last">
          {#each activeEffects as effect, i (effect.id)}{@const label = effectLabel(MOBILE_EFFECTS.find((e) => e.type === effect.type)?.label ?? effect.type)}<div class="inspector-card effect-card" role="listitem" data-reorder-item data-effect-card={effect.type}>
              <div class="section-heading effect-heading">
                <button class="reorder-handle" data-effect-handle disabled={activeEffects.length < 2}
                  aria-label={`Move ${label}. Position ${i + 1} of ${activeEffects.length}. Drag, or use the up and down arrow keys.`}
                  use:dragReorder={{ axis: 'y', index: i, disabled: activeEffects.length < 2, onlift: () => feel(prefs, 'switch'), onmove: moveEffectTo }}
                  onkeydown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); moveEffectTo(i, i + (e.key === 'ArrowUp' ? -1 : 1), true); } }}
                  ><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></button
                ><button
                  class="effect-toggle"
                  class:active={effect.enabled}
                  aria-pressed={effect.enabled}
                  aria-label={`${label}, ${effect.enabled ? 'on' : 'off'}`}
                  onclick={() => {
                    checkpoint();
                    const effects = copy(activeEffects);
                    effects[i].enabled = !effect.enabled;
                    patchEffects(effects);
                  }}><span aria-hidden="true">{effect.enabled ? '●' : '○'}</span> {label}</button
                ><button
                  class="icon-button"
                  onclick={() => {
                    checkpoint();
                    patchEffects(activeEffects.filter((_, j) => j !== i));
                  }}
                  aria-label={`Remove ${label}`}><Icon name="close" size={16} /></button
                >
              </div>
              {#each MOBILE_EFFECTS.find(d => d.type === effect.type)?.controls || EFFECT_PARAM_DEFS[effect.type] || [] as p}<label class="range-row"
                  ><span>{p.name}</span>{#if p.type === "select" && p.options}<select aria-label={p.name} value={effect.params[p.param] ?? p.default} disabled={!effect.enabled} onchange={e=>{checkpoint();setEffect(i,p.param,Number(e.currentTarget.value));}}>{#each p.options as option}<option value={option.value}>{option.label}</option>{/each}</select>{:else}<input
                    type="range"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    data-default={p.default}
                    value={effect.params[p.param] ?? p.default}
                    class="blue-fill"
                    style:--range-fill={sliderFill(Number(effect.params[p.param] ?? p.default), p.min, p.max)}
                    disabled={!effect.enabled}
                    onpointerdown={checkpoint}
                    oninput={(e) => setEffect(i, p.param, Number(e.currentTarget.value))}
                  /><output>{Number(effect.params[p.param] ?? p.default).toFixed(2)}</output>{/if}</label
                >{/each}
            </div>{/each}
          </div>
          {#if !activeEffects.length}<div class="empty-state">
              <Icon name="fx" size={32} />
              <h2>No effects added</h2>
              <p>Choose an effect for the selected scope.</p>
            </div>{/if}
          {/if}

{/snippet}
<input type="file" accept="image/*,video/*" aria-label="Shader source media" bind:this={shaderMediaInput} onchange={importShaderSource} hidden />


<svelte:window onkeydown={onKey} onpointerdowncapture={pressOffControls} />
<input class="file-input" type="file" accept="video/*" multiple aria-label="Import videos" bind:this={videoInput} onchange={importMedia} />
<input class="file-input" type="file" accept="image/*" multiple aria-label="Import photos" bind:this={photoInput} onchange={importMedia} />
<input class="file-input" type="file" accept="video/*,image/*" multiple aria-label="Import media" bind:this={mediaInput} onchange={importMedia} />
<input class="file-input" type="file" accept=".ghostset,application/json,application/octet-stream" aria-label="Open a set file" bind:this={setInput} onchange={importSet} />
<div class="studio" data-layout={layoutInfo.layout} data-inspector={layoutInfo.inspector} class:compact-preview={compactPreview && tab!=='map' && tab!=='flux'} class:flux-tab={tab==='flux'} class:flux-perform={tab==='perform'&&fluxPerform} class:tempo-open={tempoOpen} class:docked-inspector={dockedInspector} class:tablet use:touchSliders={show} use:secondFingerTaps class:clip-editing={clipControlsOpen} class:performance={tab === 'perform'} class:mixing={mixerOpen} class:clean class:mapping={tab === 'map'}>
  <header class="app-header">
    <div class="brand">
      <img class="brand-mark" src="./icon-new.png" alt="" />
      <img class="brand-wordmark" src="./logo-wordmark.svg" alt="Ghost Arcade" />
    </div>
    <button class="flux-live" class:active={fluxPerform} aria-pressed={fluxPerform} aria-label={fluxPerform?'Flux on the preview: on':'Flux on the preview: off'} title="Play Flux on the preview while performing"
      onclick={()=>{fluxPerform=!fluxPerform;feel(prefs,'switch');if(!fluxPerform&&tab!=='flux'&&flux.active){flux={...flux,active:false,latch:false};if(engine)engine.flux=flux;}}}><Icon name="flux" size={18}/><span>{fluxPerform?'ON':'FLUX'}</span></button>
    <button class="flux-live scramble" aria-label="Scramble shader and effect settings" title="Scramble every playing shader and effect" onclick={scramble}><Icon name="fx" size={16}/><span>RND</span></button>
    <button class="set-title" onclick={() => (settings = true)}>{show.name}<span>⌄</span></button>
    <div class="header-actions">
      <button class="icon-button" disabled={!canUndo} onclick={() => undo()} aria-label="Undo"
        ><Icon name="undo" /></button
      ><button class="icon-button" disabled={!canRedo} onclick={() => undo(true)} aria-label="Redo"
        ><Icon name="redo" /></button
      ><button class="icon-button output-button" class:active={outputStatus.state==='live'} class:no-display={noDisplayConnected(outputStatus)} onclick={() => openOutput(noDisplayConnected(outputStatus))} aria-label={noDisplayConnected(outputStatus) ? 'No projector connected. Connect a projector' : 'Output settings'}
        ><Icon name="output" />{#if noDisplayConnected(outputStatus)}<span class="status-dot" aria-hidden="true"></span>{/if}</button
      ><button class="icon-button" onclick={() => (settings = true)} aria-label="Set settings"
        ><Icon name="settings" /></button
      >
    </div>
  </header>
  <nav class="tabs" aria-label="Workspace">
    {#each navItems as t}
      <button class:active={navActive(t.id,tab,mixerOpen,interactiveOpen,clipControlsOpen)} aria-pressed={navActive(t.id,tab,mixerOpen,interactiveOpen,clipControlsOpen)} aria-current={navActive(t.id,tab,mixerOpen,interactiveOpen,clipControlsOpen) ? 'page' : undefined}
        onclick={()=>navTo(t.id)}><Icon name={t.icon}/><span>{t.label}</span></button>
    {/each}
  </nav>
  <main class="workspace">
    <section class="monitor">
      <div class="monitor-heading">
        <span role="status" aria-label={blackout ? 'Output blacked out' : frozen ? 'Output held' : 'Output live'}><i class:stopped={blackout}></i>{blackout ? 'BLACKOUT' : frozen ? 'HOLD' : 'PROGRAM'}</span><span
          >{show.quality}p <b>·</b> {#if detail < 1}<em class="detail-reduced" data-detail title="Detail lowered to hold the frame rate">DETAIL {Math.round(detail * 100)}%</em>{' '}<b>·</b>{' '}{/if}{fps} FPS</span
        >
      </div>
      <div class="preview-frame">
        <div class="preview" class:staged={!!stageShown} bind:this={preview} onclick={selectPreviewScreen}>
          {#if stageShown}<div class="stage-layer" bind:this={stageLayer}><StageBackdrop template={stageShown} width={layoutInfo.mixer === 'docked' ? 1280 : 960} /></div>{/if}
          {#key canvasGeneration}<canvas bind:this={output} aria-label="Live video output"></canvas>{/key}
          {#if stageShown}<span class="stage-chip" data-stage-chip aria-hidden="true">DEMO STAGE</span>{/if}
          {#if visualsDown}<div class="visuals-down" role="alert"><strong>{visualsRestarting ? 'Restarting visuals…' : 'Visuals interrupted'}</strong><span>Your set is safe.</span><button data-restart-visuals disabled={visualsRestarting} onclick={() => restartVisuals(true)}>Restart visuals</button></div>{/if}
          {#if tab === 'map' && !clean}
            <MappingCanvas bind:this={mappingCanvas} surfaces={show.surfaces} selected={selectedSurface} selection={mapSelection} point={selectedPoint} snap={mappingSnap} grid={mappingGrid} multi={mapMulti} tool={mappingTool==='paint'?'view':mapDraw?'draw':'edit'} canvas={output} backdrop={stageLayer} basis={mapBasis}
              highlight={dropSurface} quietLabels={!!stageShown}
              onchange={mapChange} onbegin={mapCanvasBegin} oncommit={persist} onnotice={message=>flash(message)} ondrawn={drawnSurface}
              mask={mapMask} maskPoint={mapMaskPoint} maskTool={mapMaskTool} onmask={mapMaskSet} ontaps={count=>mapTapped=count}
              onselect={(index,point,selection)=>{selectedSurface=index;selectedPoint=point;mapSelection=selection;}}/>
          {/if}
          {#if (tab==='flux' || (tab==='perform' && fluxPerform)) && !clean && !visualsDown}<FluxPad value={flux} onchange={value=>{flux=value;if(engine)engine.flux=value;}}/>{/if}
          {#if tab==='map' && mappingTool==='paint' && show.mapping && !clean}
            <PaintPad surfaces={show.surfaces} config={paint} beat={()=>engine?.beatClock?.()??0} onstroke={startStroke} onfinish={finishStroke} onlimit={()=>flash('Paint memory is full. Clear or undo strokes to keep drawing.')}/>
          {/if}
        </div>
        <RecordControl source={programCanvas} hidden={tab==='map' || clean || visualsDown} onsuccess={reviewWhen} {audioSource} />
        {#if tab==='perform' && coachCurrent && (coachCurrent.tab==='perform'||coachCurrent.skippable) && !clean && !visualsDown}<CoachStrip step={coach.step} steps={coachSteps(coach.track)} actionLabel={coachCurrent.id==='connect'?'Connect':''} onaction={connectProjector} onskip={coachCurrent.skippable?()=>coachMove(coachSkip(coach)):null} onclose={()=>setPrefs({coachDone:true})}/>{/if}
      </div>
      <div class="monitor-tools">
        {#if tab==='perform' && !interactiveLive}<button class="tempo-chip" class:active={tempoOpen} aria-expanded={tempoOpen} aria-label={`Tempo ${show.bpm} BPM. Tap in time to set it; hold for tempo and audio.`} onpointerdown={tempoDown} onpointerup={tempoUp} onpointercancel={tempoUp} onpointerleave={tempoUp} onclick={()=>{if(performance.now()-tempoPress>1000)toggleTempo();}}><strong>{show.bpm}</strong>BPM</button><button class="q-chip" class:active={show.quantize} aria-pressed={show.quantize} aria-label="Quantize launches to the beat" title="Quantize launches to the beat" onclick={()=>{show.quantize=!show.quantize;if(!show.quantize)cancelQueued();persist();}}>Q</button><button class="ab-chip" class:active={show.dualDeck} aria-pressed={show.dualDeck} aria-label="A/B decks" onclick={()=>setDual(!show.dualDeck)}>A/B</button><div class="autopilot-bar">
            <button class:running={autoOn} class:paused={autoPaused} aria-pressed={autoOn} aria-label={autoPaused?'Resume Autopilot':autoOn?'Turn Autopilot off':'Turn Autopilot on'} disabled={!autoClips&&!autoParams} onclick={()=>autoOn?stopAuto():startAuto()}><Icon name="autopilot" size={18}/><strong>Auto</strong><span>{autoOn?'ON':autoPaused?'PAUSED':'OFF'}</span></button>
            <button class="auto-settings" aria-label="Autopilot settings" aria-expanded={autoSettings} onclick={()=>autoSettings=!autoSettings}><Icon name="settings" size={18}/></button>
          </div>{/if}
        {#if interactiveLive}<button onclick={openInteractive}>Interactive</button><button onclick={()=>interactiveWorkspace?.restoreMix()}>Return to mix</button>{/if}
        <span>{tab === 'map' ? mappingTool==='paint'?'PAINT · '+paint.brush.toUpperCase():show.mapping?'Drag points to fit your surface':'MAPPING OFF · OUTPUT UNCHANGED' : interactiveLive?'DECK PREVIEW · INTERACTIVE ON OUTPUT':tab==='flux'?'FLUX · PLAY ON THE PICTURE':''}</span><span class="live-group">{#if tab==='perform' && !interactiveLive}<button
          class="audio-in" class:on={mic} data-audio-input aria-haspopup="dialog" aria-expanded={tempoOpen} aria-label={`Audio input: ${mic ? audioNames[audioSource] : 'Off'}`} title="Audio input" onclick={toggleTempo}
          ><Icon name={audioIcons[audioSource]} size={16} />{#if mic}<span class="audio-bars" aria-hidden="true"><i style:transform={`scaleY(${Math.max(0.15, audioLevel * 0.8)})`}></i><i style:transform={`scaleY(${Math.max(0.15, audioLevel)})`}></i><i style:transform={`scaleY(${Math.max(0.15, audioLevel * 0.6)})`}></i></span>{/if}</button
        >{/if}<button
          class:active={frozen}
          onclick={setFrozen}
          aria-pressed={frozen} aria-label={frozen ? 'Resume output' : 'Hold output'}><Icon name={frozen ? 'play' : 'pause'} size={16} /><span class="tool-label">{frozen ? 'Resume' : 'Hold'}</span></button
        ><button class:danger={blackout} onclick={setBlackout} aria-pressed={blackout} aria-label="Blackout"
          ><Icon name="blackout" size={16} /><span class="tool-label">Blackout</span></button
        ></span>
      </div>
      {#if tablet && tab==='perform' && !clean}<PerformanceMixer embedded {show} {selectedLayer} onstart={checkpoint} onselect={changeLayer} oncontrols={openControls} onclose={()=>mixerOpen=false} onblendopen={()=>engine?.prepareBlends()} onchange={(i,patch)=>{show.layers[i]={...show.layers[i],...patch};persist();}} onmaster={value=>{show.master=value;persist();}} oncrossfade={value=>{show.crossfade=value;persist();}} oncrossfadesettings={value=>{show.crossfadeSettings=value;persist();}} />{/if}
    </section>
    <section class="control-panel">

      <div class="panel-scroll" inert={clipControlsOpen && !dockedInspector && layoutInfo.inspector!=='bottom'}>
        {#if tab === 'perform'}
          {#if repairOffer && !clean}<section class="repair-offer" data-repair-offer aria-label="Fix this set">
            <p>{repairSummary(repairOffer)} Nothing has been changed.</p>
            <div><button class="primary" data-repair-fix onclick={fixSet}>Fix this set</button><button data-repair-keep onclick={() => (repairOffer = null)}>Keep as it is</button></div>
            <small>You can undo the fix. It also stays in Set settings.</small>
          </section>{/if}
            <StudioDecks {show} {selectedLayer} {pending} {loading} highlight={freshPad}
              onSelect={changeLayer}
              onControls={openControls}
              onMixer={openMixer}
              onLaunch={(row, clip) => { autoEvent('launch'); handLaunch(row); changeLayer(row); void launch(clip, row); }}
              launchOnDown={prefs.launchOnTouchDown}
              onTap={(row,clip)=>toggleClip(clip,row)}
              onRemove={(row,column)=>{const id=show.launchGrid[row][column];if(show.layers[row].clipId===id||pending[row]?.clip.id===id||launchingClips[row]?.clipId===id)stopRow(row);else checkpoint();show.launchGrid[row][column]=null;persist();}}
              onStop={stopRow}
              onEdit={(row, column) => openPicker({ row, column })}
              onDual={setDual}
              onMix={(value) => { show.crossfade = value; persist(); }}
              onArrange={()=>autoEvent('arrange')}
              onMove={(from,to)=>{
                if(from.row===to.row&&from.column===to.column)return;
                checkpoint();autoEvent('arrange');
                const grid=show.launchGrid.map(row=>[...row]);
                const clip=grid[from.row][from.column];if(!clip)return;
                grid[from.row][from.column]=grid[to.row][to.column]??null;
                grid[to.row][to.column]=clip;
                show.launchGrid=grid;persist();
              }}
            ><BlockTabs slot="blocks" tabs={blockTabList} canAdd={blockTabList.length < MAX_BLOCKS}
              onselect={selectBlock} onadd={newBlock} onrename={renameBlockTab} onduplicate={copyBlock} ondelete={deleteBlockTab} onmove={moveBlockTab} onlift={()=>feel(prefs,'switch')} />
<svelte:fragment slot="autopilot-settings">          {#if autoSettings}<section class="auto-options" aria-label="Autopilot settings">
            <div class="auto-switches">
              <button aria-pressed={autoClips} class:active={autoClips} onclick={()=>{autoClips=!autoClips;if(!autoClips&&!autoParams)stopAuto();else autoEvent('settings');}}><Icon name="grid" size={16}/>Clips</button>
              <button aria-pressed={autoParams} class:active={autoParams} onclick={()=>{autoParams=!autoParams;if(!autoClips&&!autoParams)stopAuto();else autoEvent('settings');}}><Icon name="controls" size={16}/>Parameters</button>
            </div>
            <div class="auto-fields"><label>Change clips<select aria-label="Change clips" bind:value={autoInterval} onchange={()=>autoEvent('settings')}><option value={4}>4 beats</option><option value={8}>8 beats</option><option value={16}>16 beats</option><option value={32}>32 beats</option></select></label>
            <label>Order<select aria-label="Clip order" bind:value={autoRandom} onchange={()=>autoEvent('settings')}><option value={false}>In order</option><option value={true}>Random</option></select></label></div>
            <label class="auto-amount">Variation / 4 beats <output>{Math.round(autoVariation*100)}%</output><input type="range" min="0" max=".4" step=".01" data-default=".12" bind:value={autoVariation} aria-label="Autopilot variation"/></label>
            <div class="auto-rows">{#each show.layers.slice(0,show.dualDeck?8:4) as l,i}<button aria-label={`Autopilot layer ${i+1}`} aria-pressed={autoRows[i]} class:active={autoRows[i]} onclick={()=>{autoRows[i]=!autoRows[i];autoEvent('settings');}}>L{i+1}</button>{/each}</div>
            <p>Follows BPM / Tap. Cameras stay manual. Changes apply to selected, enabled layers, and take effect right away. Launching or stopping a clip by hand pauses Autopilot until you resume it.</p>
          </section>{/if}
</svelte:fragment></StudioDecks>
          
          <div class="phone-mix">
            <label class="range-row"
              ><span>Layer level</span><input
                type="range"
                min="0"
                max="1"
                step=".001"
                data-default="1"
                value={layer.opacity}
                onpointerdown={checkpoint}
                oninput={(e) => patchLayer({ opacity: Number(e.currentTarget.value) })}
              /><output>{Math.round(layer.opacity * 100)}%</output></label
            >
            <label class="range-row"
              ><span>Master level</span><input
                type="range"
                min="0"
                max="1"
                step=".001"
                data-default="1"
                bind:value={show.master}
                oninput={persist}
              /><output>{Math.round(show.master * 100)}%</output></label
            >
          </div>


        {:else if tab === 'flux'}
          <FluxPanel value={flux} onchange={value=>{flux=value;if(engine)engine.flux=value;}}/>
        {:else if tab === 'map'}
          {#if coachCurrent && !clean}<CoachStrip inline step={coach.step} steps={coachSteps(coach.track)} actionLabel={coachCurrent.id==='connect'?'Connect':''} onaction={connectProjector} onskip={coachCurrent.skippable?()=>coachMove(coachSkip(coach)):null} onclose={()=>setPrefs({coachDone:true})}/>{/if}
          {#snippet mapHelp()}<p>Mapping fits your visuals onto real things: each <b>surface</b> is a shape you drag onto a box, a wall or a screen.</p><ul><li><b>Edit screens</b>: drag the points in the picture above. Pinch it to zoom in; a loupe shows the point under your finger.</li><li><b>Paint</b>: draw light onto your surfaces with a finger.</li><li><b>Grid</b> and <b>Snap</b> help line points up. <b>Test grid</b> shows lines on the projector so you can see the edges; <b>Identify</b> numbers every surface there.</li></ul><p>With mapping off, the projector shows the whole picture as it is.</p>{/snippet}
          <Section title="Mapping" icon="map" tone="map" class="map-section" info={mapHelp} infoLabel="How mapping works">
          <div class="segmented wide mapping-tools">
            <button class:active={mappingTool==='edit'} aria-pressed={mappingTool==='edit'} onclick={()=>mappingTool='edit'}><Icon name="map" size={17}/>Edit screens</button>
            <button class:active={mappingTool==='paint'} aria-pressed={mappingTool==='paint'} onclick={paintMode}><Icon name="paint" size={17}/>Paint</button>
          </div>
          {#if mappingTool==='paint'}<PaintPanel onselect={index=>selectedSurface=index} value={paint} surfaces={show.surfaces} selected={selectedSurface} onchange={patchPaint} onundo={()=>{checkpoint();patchPaint({strokes:paint.strokes.slice(0,-1)});}} onclear={()=>{checkpoint();patchPaint({strokes:[],loop:false});}}/>{/if}
          {#if !show.mapping}<p class="hint mapping-off-hint" role="status">Mapping is off, so your output is unchanged. Turn it on here, or move a corner to start.</p>{/if}
          <div class="mapping-toolbar">
            <button
              class="mapping-switch"
              class:active={show.mapping}
              aria-pressed={show.mapping}
              onclick={() => {
                checkpoint();
                show.mapping = !show.mapping;
                persist();
              }}><Icon name="power" size={16} />{show.mapping ? 'Mapping on' : 'Mapping off'}</button
            ><button class:active={mappingGrid} aria-pressed={mappingGrid} onclick={()=>mappingGrid=!mappingGrid}><Icon name="grid" size={16}/>Grid</button><button class:active={mappingSnap} aria-pressed={mappingSnap} onclick={()=>mappingSnap=!mappingSnap}><Icon name="snap" size={16}/>Snap</button><button class:active={testGrid} aria-pressed={testGrid} onclick={toggleGrid}><Icon name="grid" size={16} />Test grid</button
            ><button class="identify-button" class:active={mapIdentify} aria-pressed={mapIdentify} onclick={()=>mapIdentify=!mapIdentify} aria-label="Identify surfaces on the projector"><MapIcon name="identify" size={16} />Identify</button
            ><button class="templates-button" data-open-templates onclick={() => (templatesOpen = true)}><Icon name="library" size={16} />Templates</button>
          </div>
          </Section>
          {#if mappingTool==='edit'}<Section title="What plays" icon="play" tone="deck" class="content-section" subtitle={show.surfaces[selectedSurface] ? `on ${selectedSurface + 1} · ${show.surfaces[selectedSurface].name}` : ''} info="Drag a tile up onto a surface in the picture, or tap a tile to put it on the selected surface. Deck mix shows whatever plays in Perform." infoLabel="How to choose what a surface plays"><SurfaceContentStrip visuals={libraryShaders} media={surfaceMedia} surfaces={show.surfaces} selected={selectedSurface} current={currentChoice} target={preview} hitAt={mappingCanvas ? (x, y) => mappingCanvas?.surfaceAtClient(x, y) ?? null : undefined} onassign={assignSurface} onhover={(i) => (dropSurface = i)} /></Section>{/if}
          {#if capNotice}<p class="cap-notice" role="status" data-surface-cap>{capNotice}</p>{/if}
          {#if stageShown}<div class="stage-note" data-stage-note><p>The room in the picture is a demo stage, shown only here. Your projector shows just the visuals.</p><button onclick={hideStage}>Hide stage</button></div>{/if}
          {#snippet surfacesAdd()}<button class="ga-act add-surface" class:active={addSheet} onclick={() => {addSheet = !addSheet; mapDraw = false;}} aria-label="Add surface" aria-expanded={addSheet}><Icon name="plus" size={18} /><span>Add</span></button>{/snippet}
          <Section title="Surfaces" icon="surface" tone="map" class="surfaces-section" subtitle={`${show.surfaces.length} of 16`} actions={surfacesAdd} info="Tap a surface to choose it, then drag its corners in the picture. Several surfaces can show the same layer. Mapping keeps working while clips change." infoLabel="About surfaces">
          {#if addSheet && mappingTool==='edit'}<AddSurfaceSheet full={show.surfaces.length>=16} onadd={addMappedSurface} ondraw={()=>{addSheet=false;mapDraw=true;show.mapping=true;}} onclose={()=>addSheet=false}/>{/if}
          {#if mapDraw}<p class="hint" role="status">Trace the outline of your object on the canvas above with one finger. <button onclick={()=>mapDraw=false}>Cancel</button></p>{/if}
          <div class="surface-list">
            {#each show.surfaces as s, i}<button
                class:active={selectedSurface === i}
                class:picked={mapSelection.length > 1 && mapSelection.includes(i)}
                onclick={() => {
                  selectedSurface = i;
                  selectedPoint = 0;
                  mapSelection = [];
                }}
                ><span class="surface-index">{i + 1}</span><span
                  ><strong>{s.name}</strong><small class:capped={surfacePlan.capped.includes(i)}
                    >{surfaceContentName(s, i)} · {kindLabel(s)}</small
                  ></span
                >{#if s.locked}<Icon name="lock" size={16} />{/if}<i class:lit={s.enabled}></i></button
              >{/each}
          </div>
          </Section>
          {#if surface && mappingTool==='edit'}
            {#snippet surfaceToggles()}<div class="inline">
                  <button
                    class="icon-button"
                    class:active={surface.locked}
                    aria-pressed={surface.locked}
                    onclick={() => {
                      checkpoint();
                      patchSurface({ locked: !surface.locked });
                    }}
                    aria-label="Lock surface"><Icon name={surface.locked ? 'lock' : 'unlock'} size={17} /></button
                  ><button
                    class="icon-button"
                    class:active={surface.enabled}
                    aria-pressed={surface.enabled}
                    onclick={() => {
                      checkpoint();
                      patchSurface({ enabled: !surface.enabled });
                    }}
                    aria-label="Toggle surface visibility"><Icon name="eye" size={17} /></button
                  >
                </div>{/snippet}
            <Section title={`Surface ${selectedSurface + 1}`} subtitle={surface.name} icon="point" tone="map" class="inspector-card" actions={surfaceToggles}>
              <label class="field"
                >Name<input
                  value={surface.name}
                  onchange={(e) => {
                    checkpoint();
                    patchSurface({ name: e.currentTarget.value });
                  }}
                /></label
              >
              <div class="field-grid">
                <label class="field"
                  >Content<select aria-label="Screen content"
                    value={surface.clipId ? 'clip' : surface.source === 'mix' ? 'mix' : show.dualDeck ? surface.source % 4 : surface.source}
                    onchange={(e) => {
                      if (e.currentTarget.value === 'clip') return;
                      checkpoint();
                      const source = e.currentTarget.value === 'mix' ? 'mix' : Number(e.currentTarget.value);
                      show.surfaces[selectedSurface] = { ...forgetSurfaceClip([surface], surface.clipId ?? '')[0], source };
                      persist();
                    }}
                    >{#if surface.clipId}<option value="clip">Own clip · {show.clips.find(c => c.id === surface.clipId)?.name ?? 'Clip'}</option>{/if}<option value="mix">Full composition</option>{#each show.layers.slice(0,4) as _, i}<option value={i}
                        >Layer {i + 1}{show.dualDeck?' · follows A/B':''}</option
                      >{/each}</select
                  ></label
                ><label class="field"
                  >Fit<select
                    value={surface.fit}
                    onchange={(e) => {
                      checkpoint();
                      patchSurface({ fit: e.currentTarget.value as Surface['fit'] });
                    }}
                    >{#each ['stretch', 'contain', 'fill'] as fit}<option value={fit}
                        >{fit[0].toUpperCase() + fit.slice(1)}</option
                      >{/each}</select
                  ></label
                >
              </div>
              <SurfaceShapePanel surfaces={show.surfaces} index={selectedSurface} point={selectedPoint} onapply={mapApply} onnotice={message=>flash(message)}/>
              <MaskPanel surfaces={show.surfaces} index={selectedSurface} mask={mapMask} point={mapMaskPoint} tool={mapMaskTool} tapped={mapTapped} onapply={next=>mapApply(next)} onlive={mapChange} onstart={mapBegin} oncommit={persist} onmask={mapMaskSet} onfinish={()=>mappingCanvas?.finishPolygon()} onnotice={message=>flash(message)}/>
              <label class="range-row"
                ><span>Edge fade</span><input
                  type="range"
                  min="0"
                  max=".4"
                  step=".005"
                  data-default="0"
                  value={surface.feather}
                  onpointerdown={checkpoint}
                  oninput={(e) => patchSurface({ feather: Number(e.currentTarget.value) })}
                /><output>{Math.round(surface.feather * 100)}%</output></label
              >
              <label class="range-row"
                ><span>Opacity</span><input
                  type="range"
                  min="0"
                  max="1"
                  step=".01"
                  data-default="1"
                  aria-label="Surface opacity"
                  value={surface.opacity ?? 1}
                  onpointerdown={checkpoint}
                  oninput={(e) => patchSurface({ opacity: Number(e.currentTarget.value) })}
                /><output>{Math.round((surface.opacity ?? 1) * 100)}%</output></label
              >
              <div class="range-row"
                ><span>Blend</span><BlendPicker
                  value={surface.blend}
                  scope={surface.name}
                  onstart={checkpoint}
                  onopen={() => engine?.prepareBlends()}
                  onchange={(blend) => patchSurface({ blend })}
                /></div
              >
              <SurfacePlacement placement={surface.placement} disabled={surface.locked} sharing={sameSourceSurfaces(show.surfaces, selectedSurface).length} surfaces={show.surfaces.filter(s => s.enabled).length}
                onstart={checkpoint} onchange={(control, value) => patchSurface({ placement: withControl(surface.placement, control, value) })}
                onreset={() => { checkpoint(); show.surfaces[selectedSurface] = { ...surface, placement: undefined }; persist(); }}
                onsameall={() => { checkpoint(); show.surfaces = sameOnSurfaces(show, selectedSurface, show.surfaces.flatMap((s, i) => (s.enabled ? [i] : []))); persist(); flash('Every surface shows the same picture. Span spreads it across them.'); }}
                onspan={() => { checkpoint(); show.surfaces = spanPlacements(show.surfaces, sameSourceSurfaces(show.surfaces, selectedSurface)); persist(); flash('One picture across the surfaces. Move a corner and span again to refit.'); }} />
              <LookControls value={surface.look} onchange={(look) => { checkpoint(); patchSurface({look}); }} onapplyall={() => {checkpoint(); show.surfaces = show.surfaces.map(s => ({...s,look:copy(surface.look)}));persist();}} />
              <NudgePad at={pointAt(surface,selectedPoint)} label="Point" points={mapPoints.length} index={Math.max(0,mapPoints.indexOf(selectedPoint))} disabled={surface.locked} basis={mapBasis}
                onstart={()=>{mapBegin();leaveStage();}} onnudge={(dx,dy)=>{mapChange(nudgeSurfaces(show.surfaces,selectedSurface,selectedPoint,dx,dy,mapSelection));persist();}}
                onpoint={step=>{const at=mapPoints.indexOf(selectedPoint);selectedPoint=mapPoints[(Math.max(0,at)+step+mapPoints.length)%mapPoints.length]??0;}}/>
              <SurfaceActions surfaces={show.surfaces} index={selectedSurface} selection={mapSelection} multi={mapMulti} solo={mapSolo} pattern={mapPatterns[surface.id]??null}
                onapply={(next,select)=>{mapApply(next);if(select){selectedSurface=select.index;mapSelection=select.selection;selectedPoint=0;}}}
                onmulti={on=>{mapMulti=on;if(on&&mapSelection.length<2)mapSelection=[selectedSurface];}} onsolo={on=>mapSolo=on}
                onpattern={p=>{const next={...mapPatterns};if(p)next[surface.id]=p;else delete next[surface.id];mapPatterns=next;}} onnotice={message=>flash(message)}/>
              <div class="card-actions">
                <button
                  disabled={surface.locked}
                  onclick={() => {
                    checkpoint();
                    patchSurface(resetGeometry(surface));
                  }}>Reset geometry</button
                ><button
                  onclick={() => {
                    checkpoint();
                    show.surfaces = pruneWelds(show.surfaces.filter((_, i) => i !== selectedSurface));
                    selectedSurface = Math.max(0, selectedSurface - 1);
                    selectedPoint = 0;
                    mapSelection = [];
                    persist();
                  }} class="remove-surface"><Icon name="trash" size={16} />Remove</button
                >
              </div>
            </Section>{/if}
          <Section title="Saved" icon="save" tone="neutral" class="map-library-section">
          <div class="map-library" data-map-library>
            <p>Saved in <strong>{show.name}</strong> on this device as you work.</p>
            <div><button data-map-copy onclick={() => duplicateSavedSet(show.id)}><Icon name="copy" size={16} />Save a copy</button><button data-map-sets onclick={() => (settings = true)}><Icon name="save" size={16} />Sets and files</button></div>
          </div>
          </Section>
        {:else if tab === 'fx'}
          {@render sourceControls()}
        {/if}
      </div>
    </section>
      {#if clipControlsOpen || dockedInspector}
        <section class="clip-controls-tray" role={dockedInspector ? 'region' : 'dialog'} aria-label={`Controls for ${rowName(selectedLayer)}${activeClip ? `, ${activeClip.name}` : ''}`} use:focusControlsTray>
          <header class="clip-controls-header">
            <span class="ga-chip" aria-hidden="true"><Icon name="sliders" size={18}/></span><div><span class="eyebrow">{show.dualDeck ? `DECK ${selectedLayer < 4 ? 'A' : 'B'} · LAYER ${selectedLayer % 4 + 1}` : `LAYER ${selectedLayer + 1}`}</span><h2>{activeClip?.name || 'No clip playing'}</h2></div>
            {#if !dockedInspector}<button class="icon-button" data-close-controls aria-label="Close clip controls" onclick={closeControls}><Icon name="close" size={20}/></button>{/if}
          </header>
          {#if frozen || blackout}<div class="controls-notice" role="status">{blackout?'Output is blacked out.':'Output is held.'} Changes appear when you resume.<button onclick={()=>{if(blackout)setBlackout();if(frozen)setFrozen();}}>Resume</button></div>{:else if activeClip && (!layer.enabled || layer.opacity === 0)}<p class="controls-notice" role="status">This layer is muted. Raise its level in Mix to see your changes.</p>{:else if show.dualDeck && (selectedLayer < 4 ? show.crossfade === 1 : show.crossfade === 0)}<p class="controls-notice" role="status">This deck is faded out. Move the A/B crossfader to see your changes.</p>{/if}
          {#if autoOn && autoRows[selectedLayer]}<p class="controls-notice" role="status">Autopilot is on. This row keeps its clip while Controls is open.</p>{/if}
          <div class="clip-controls-body">{@render sourceControls(true)}</div>
        </section>
      {/if}
  </main>
  {#if mixerOpen && !tablet}<PerformanceMixer {show} {selectedLayer} onstart={checkpoint} onselect={changeLayer} oncontrols={openControls} onclose={()=>mixerOpen=false} onblendopen={()=>engine?.prepareBlends()} onchange={(i,patch)=>{show.layers[i]={...show.layers[i],...patch};persist();}} onmaster={value=>{show.master=value;persist();}} oncrossfade={value=>{show.crossfade=value;persist();}} oncrossfadesettings={value=>{show.crossfadeSettings=value;persist();}} />{/if}
  {#if tempoOpen}<div class="sheet-scrim" data-sheet-scrim role="presentation" onclick={(e) => { if (e.target === e.currentTarget) tempoOpen = false; }}><div class="tempo-sheet" role="dialog" aria-label="Tempo and audio" use:focusSheet={()=>(tempoOpen=false)} style={`left:${tempoAnchor.left}px;bottom:${tempoAnchor.bottom}px;--sheet-bottom:${tempoAnchor.bottom}px`}>
    <header><span class="ga-chip small" data-tone="audio" aria-hidden="true"><Icon name="tempo" size={15} /></span><strong>Tempo and audio</strong><button class="icon-button" aria-label="Close tempo and audio" onclick={() => (tempoOpen = false)}><Icon name="close" size={18} /></button></header>
    <div class="tempo-sheet-row">
      <button class="tap" onclick={tap}>Tap tempo</button>
      <div class="beat-dots" aria-hidden="true">{#each [0, 1, 2, 3] as n}<i class:lit={beat === n}></i>{/each}</div>
      <output>{show.bpm} BPM</output>
    </div>
    <div class="audio-sources" role="radiogroup" aria-label="Audio source">
      {#each audioSources as option (option.id)}<button role="radio" aria-checked={audioSource === option.id} class:active={audioSource === option.id} disabled={micBusy} onclick={() => chooseAudio(option.id)}>{option.label}</button>{/each}
    </div>
    {#if audioSource !== 'off'}<div class="audio-meter" aria-hidden="true"><i style:width={`${Math.round(Math.min(1, audioMeter.level / 0.6) * 100)}%`}></i></div>
      {#if audioMeter.bpm > 0 && Math.abs(audioMeter.bpm - show.bpm) >= 1}<button class="audio-action" onclick={() => setBpm(audioMeter.bpm)}>Use {audioMeter.bpm} BPM from the music</button>{/if}{/if}
    {#if audioSource === 'mic'}
      <p>Listens to the room.{nativeAudio ? ' Music playing in other apps keeps playing.' : ''}</p>
    {:else if audioSource === 'player'}
      <div class="audio-transport">
        <button aria-label="Previous track" onclick={() => playerCommand('previous')}><Icon name="left" size={18} /></button>
        <button aria-label={audioState?.playing ? 'Pause' : 'Play'} disabled={!audioState?.tracks.length} onclick={() => playerCommand(audioState?.playing ? 'pause' : 'play')}><Icon name={audioState?.playing ? 'pause' : 'play'} size={18} /></button>
        <button aria-label="Next track" onclick={() => playerCommand('next')}><Icon name="right" size={18} /></button>
        <button class="loop" class:active={audioState?.loop} aria-pressed={!!audioState?.loop} onclick={() => playerCommand('loop', { loop: !audioState?.loop })}>Loop</button>
      </div>
      {#if audioState?.tracks.length}<ul class="audio-tracks">
        {#each audioState.tracks as track (track.id)}<li class:current={track.id === audioState.trackId}>
          <button class="track" onclick={() => playerCommand('play', { id: track.id, position: 0 })}><span>{track.name}</span><small>{track.id === audioState.trackId && audioState.position != null ? `${formatTrackTime(audioState.position)} / ` : ''}{formatTrackTime(track.duration)}</small></button>
          <button class="remove" aria-label={`Remove ${track.name}`} onclick={() => audioCommand(() => removeAudioTrack(track.id), 'Could not remove that track.')}><Icon name="close" size={14} /></button>
        </li>{/each}
      </ul>{:else}<p>Add songs or videos from Files. The visuals follow what plays here.</p>{/if}
      <button class="audio-action" onclick={addAudioTracks}><Icon name="plus" size={16} /><span>Add audio or video</span></button>
    {:else if audioSource === 'phone'}
      <p class="audio-status" class:live={audioMeter.arriving} role="status">{phoneHint}</p>
      <button class="audio-action" onclick={() => audioCommand(startPhoneAudio, 'Phone audio could not start.')}><span>Start phone audio</span></button>
      <p class="with-tip">Plays what other apps play into the visuals.<InfoTip label="About phone audio" text="Phone audio uses a screen broadcast that only sends sound to Ghost Arcade. Stop it from the red pill at the top of the screen. Apple Music and other copy-protected audio arrives silent; use Mic for those." /></p>
    {:else}
      <p>Tap in time to set the tempo. Pick a source and Audio response drives every clip.</p>
    {/if}
  </div></div>{/if}
  <footer class="master-bar" bind:this={footerEl}>
    {#if show.dualDeck}<div class="mobile-decks">
      <button
        onclick={() => {
          show.crossfade = 0;
          persist();
        }}>A</button
      ><input
        aria-label="Mobile deck crossfader"
        type="range"
        min="0"
        max="1"
        step=".001"
        bind:value={show.crossfade}
        oninput={persist}
      /><button
        onclick={() => {
          show.crossfade = 1;
          persist();
        }}>B</button
      >
    </div>{/if}
    <div class="tempo" class:tablet-only={!tablet}>
      <div class="beat-dots">
        {#each [0, 1, 2, 3] as n}<i class:lit={beat === n}></i>{/each}
      </div>
      {#if tablet}<label
        ><input
          aria-label="Tempo in BPM"
          type="number"
          min="30"
          max="240"
          value={show.bpm}
          onchange={(e) => setBpm(Number(e.currentTarget.value))}
        /></label
      ><button
        class="tempo-open"
        class:active={tempoOpen}
        aria-expanded={tempoOpen}
        aria-label="Tempo and audio"
        onclick={toggleTempo}>BPM<span aria-hidden="true">⌄</span></button
      >{/if}<button
        class:active={show.quantize}
        aria-pressed={show.quantize}
        aria-label="Quantize launches to the beat"
        title="Quantize launches to the beat"
        onclick={() => {
          show.quantize = !show.quantize;
          if (!show.quantize) cancelQueued();
          persist();
        }}><span class="phone-label">Q</span><span class="desktop-label">Quantize</span></button
      >
    </div>
    <div class="master-actions">
<label class="master-level"
        ><span>MASTER</span><input
          aria-label="Master output level"
          data-default="1"
          type="range"
          min="0"
          max="1"
          step=".001"
          bind:value={show.master}
          oninput={persist}
        /></label
      >
    </div>
  </footer>
  {#if error}<div class="toast error" role="alert">
      <span>{error}</span>{#if mentionsSettings(error) && canOpenAppSettings()}<button class="toast-action" data-open-settings onclick={() => void openAppSettings()}>Open Settings</button>{/if}<button class="icon-button" onclick={() => (error = '')} aria-label="Dismiss error"
        ><Icon name="close" size={16} /></button
      >
    </div>{:else if notice}<div class="toast" role="status"><span>{notice}</span>{#if noticeAction}<button class="toast-action" data-notice-action onclick={()=>{const action=noticeAction;clearNotice();action?.run();}}>{noticeAction.label}</button>{/if}</div>{/if}
  {#if pickerOpen}<ClipPicker target={editSlot?`${rowName(editSlot.row)} · slot ${editSlot.column+1}`:`${rowName(selectedLayer)} · next free slot`}
    visuals={libraryShaders} media={show.clips.filter(c=>c.kind==='video'||c.kind==='image')} bind:source={pickerSource}
    depth={hasNativeLive()&&lidar===true} depthReason={hasNativeLive()?'Depth camera needs a LiDAR sensor (iPhone Pro or iPad Pro). This device does not have one.':'Depth camera works in the Ghost Arcade app on an iPhone or iPad with LiDAR.'}
    onvisual={addShader} onclip={clip=>assignClip(clip)} onimport={kind=>(kind==='video'?videoInput:kind==='photo'?photoInput:mediaInput).click()}
    oncamera={addCamera} ondepth={addDepth} onremove={removeClip} onclose={closePicker}/>{/if}
  {#if effectBrowser}<EffectBrowser effects={MOBILE_EFFECTS} scope={effectScopeName} onadd={chooseEffect} onclose={() => (effectBrowser = false)} />{/if}
  {#if clean}<button class="exit-clean" onclick={() => (clean = false)}>Return to studio</button>{/if}
</div>
{#if toolkitOpen}<CaptureToolkit mappingSurfaces={cornerView(show.surfaces) as Surface[]} oninteractive={()=>{toolkitOpen=false;openInteractive();}} oninteractiveoutput={interactiveOutput} {oncompanion} onclose={()=>toolkitOpen=false} onprepare={prepareCaptureTool} onshots={importCameraShots}/>{/if}
{#if interactiveMounted}<MobileInteractiveWorkspace bind:this={interactiveWorkspace} open={interactiveOpen} outputLevel={show.master} outputHeld={frozen} outputBlackout={blackout} mappingSurfaces={cornerView(show.surfaces)} outputLabel={blackout&&interactiveLive?'Blackout active':frozen&&interactiveLive?'Output held':outputStatus.state==='live'?`Live · ${outputStatus.display?.name??'External display'}`:outputStatus.state==='connecting'?'Connecting…':outputStatus.state==='off'?'External output disabled':outputStatus.state==='error'?outputStatus.message??'Output needs attention':'No external display connected'} onpreparecamera={prepareCaptureTool} onoutput={interactiveOutput} onoutputsettings={()=>outputSettings=true} onclose={()=>interactiveOpen=false}><nav class="tabs in-studio" slot="nav" aria-label="Workspace">
    {#each navItems as t}
      <button class:active={navActive(t.id,tab,mixerOpen,interactiveOpen,clipControlsOpen)} aria-pressed={navActive(t.id,tab,mixerOpen,interactiveOpen,clipControlsOpen)} aria-current={navActive(t.id,tab,mixerOpen,interactiveOpen,clipControlsOpen) ? 'page' : undefined}
        onclick={()=>navTo(t.id)}><Icon name={t.icon}/><span>{t.label}</span></button>
    {/each}
  </nav></MobileInteractiveWorkspace>{/if}
{#if templatesOpen}<TemplateGallery onapply={applyTemplateById} onlayout={chooseLayout} onclose={() => (templatesOpen = false)} />{/if}
{#if outputSettings}<OutputPanel source={interactiveLive?'interactive':'mix'} status={outputStatus} preferences={outputPreferences} quality={show.quality} wizard={outputSetup} {blackout} master={show.master} ontestpattern={setupTestPattern} onblackout={()=>{if(blackout)setBlackout();}} onmaster={()=>{checkpoint();show.master=1;persist();}} onpresent={()=>presenting=true} onmap={()=>{if(interactiveOpen)interactiveOpen=false;navTo('map');}} onpreferences={value=>{outputPreferences=value;externalOutput?.configure(value);}} onquality={quality=>{show.quality=quality;persist();}} onwireless={()=>externalOutput?.chooseWireless()} onclose={()=>{outputSettings=false;outputSetup=false;setupTestPattern(false);}} onretry={()=>externalOutput?.retry()} onpreview={()=>{outputSettings=false;if(interactiveLive){interactiveOpen=true;interactiveWorkspace?.previewOutput();}else clean=true;}}/>{/if}
{#if presenting}<PresentMode status={outputStatus} {blackout} onblackout={setBlackout} onexit={()=>presenting=false} />{/if}
{#if settings}<div class="modal-backdrop" role="presentation">
    <div
      class="settings-dialog"
      use:focusDialog
      role="dialog"
      aria-modal="true"
      aria-label="Set and output settings"
      tabindex="-1"
    >
      <header class="settings-head">
        <span class="ga-chip" data-tone="neutral" aria-hidden="true"><Icon name="settings" size={18} /></span>
        <h1>Settings</h1>
        <button class="icon-button" onclick={() => (settings = false)} aria-label="Close settings"
          ><Icon name="close" /></button
        >
      </header>
      <Section plain title="This set" icon="save" tone="deck" subtitle={`${setList.length} of ${MAX_SAVED_SETS} on this device`} infoLabel="About saving and sharing sets"
        info={setMedia.files ? 'Export with media puts this set and its photos and videos in one file, ready to open on another iPhone or iPad. Export set only leaves the media on this device. Open set reads both kinds.' : 'A set file holds your layout, clips and blocks. This set uses no imported photos or videos, so the file is complete. Open set reads set files of both kinds.'}>
      <label class="field">Set name<input bind:value={show.name} oninput={persist} /></label>
      <div class="saved-sets" role="group" aria-label="Sets saved on this device">
        {#each setList as set (set.id)}{@const current = set.id === show.id}{@const name = current ? show.name : set.name}
          <div class="set-row" class:current data-set-row={set.id}>
            {#if setEdit?.id === set.id && setEdit.mode === 'rename'}
              <input aria-label="New set name" value={setEdit.name} oninput={(e) => { if (setEdit) setEdit.name = e.currentTarget.value; }} onkeydown={(e) => { if (e.key === 'Enter' && setEdit) renameSavedSet(set.id, setEdit.name); }} />
              <button data-set-save onclick={() => setEdit && renameSavedSet(set.id, setEdit.name)}>Save</button><button onclick={() => (setEdit = null)}>Cancel</button>
            {:else if setEdit?.id === set.id && setEdit.mode === 'delete'}
              <span class="set-confirm">Delete “{name}”? This cannot be undone.</span>
              <button class="danger" data-set-delete-confirm onclick={() => deleteSavedSet(set.id)}>Delete</button><button onclick={() => (setEdit = null)}>Cancel</button>
            {:else}
              <button class="set-open" disabled={current} aria-label={current ? `${name}, open now` : `Open ${name}`} onclick={() => openSavedSet(set.id)}><strong>{name}</strong><small>{current ? 'Open now' : 'Tap to open'}</small></button>
              <button data-set-rename aria-label={`Rename ${name}`} onclick={() => (setEdit = { id: set.id, mode: 'rename', name })}>Rename</button>
              <button class="icon-button" data-set-duplicate aria-label={`Duplicate ${name}`} title="Duplicate set" onclick={() => duplicateSavedSet(set.id)}><Icon name="copy" size={16} /></button>
              <button class="icon-button" data-set-delete aria-label={`Delete ${name}`} disabled={current} title={current ? 'Open another set first' : 'Delete set'} onclick={() => (setEdit = { id: set.id, mode: 'delete', name })}><Icon name="trash" size={16} /></button>
            {/if}
          </div>
        {/each}
      </div>
      <div class="field-grid">
        {#if setMedia.files}<button class="primary export-media" data-export-set-media disabled={exporting} onclick={(e) => exportSet(e, true)}><Icon name="save" /><span>{exporting ? 'Exporting…' : 'Export with media'}<small>{setMedia.files} file{setMedia.files === 1 ? '' : 's'}, {formatBytes(setMedia.bytes)}</small></span></button>{/if}
        <button data-export-set disabled={exporting} onclick={(e) => exportSet(e)}><Icon name="save" />{exporting && !setMedia.files ? 'Exporting…' : setMedia.files ? 'Export set only' : 'Export set'}</button><button data-open-set onclick={() => setInput.click()}
          ><Icon name="upload" />Open set</button
        >
      </div>
      <p class="line" data-export-hint>Saved on this device as you work. Export a set to open it on another device.</p>
      </Section>
      <Section plain title="Picture quality" icon="quality" tone="neutral" infoLabel="About picture quality"
        info="This is the size of the picture. One playing shader renders at that size and several share it, each a little smaller. If the frame rate drops, shader detail lowers itself and the monitor shows it, then comes back when there is room.">
      <label class="field"
        >Output quality<select bind:value={show.quality} onchange={persist}
          ><option value={540}>540p · longer sessions</option><option value={720}>720p · balanced</option><option
            value={1080}>1080p · maximum detail</option
          ></select
        ></label
      >
      <p class="line" data-quality-hint>Higher looks sharper; lower runs cooler and longer.{#if detail < 1} Detail is at {Math.round(detail * 100)}% now.{/if}</p>
      </Section>
      <Section plain title="Projector" icon="projector" tone="output" infoLabel="About projector output"
        info="A projector or TV gets only the finished picture. The controls stay on this device.">
        <p class="line">Choose how the picture reaches your projector or TV.</p>
        <button class="wide-action"
          onclick={() => {
            settings = false;
            outputSettings = true;
          }}><Icon name="output" size={18} />Output settings</button
        >
      </Section>
      {#if needsRepair(setFix)}<Section plain title="Saved by an older version" icon="warning" tone="output" role="group" aria-label="Fix this set" data-repair-settings infoLabel="What the fix changes"
        info={`Changes the blend of rows 1 to 3 to Screen${setFix.inset ? ' and sets the surface back to the full frame' : ''}. Your clips, blocks and looks stay as they are, and Undo brings the set back.`}>
        <p class="line">{repairSummary(setFix)}</p>
        <button class="wide-action" data-repair-fix onclick={fixSet}>Fix this set</button>
      </Section>{/if}
      <Section plain title="Touch and feel" icon="sliders" tone="neutral">
      <div class="feel-card" role="group" aria-label="Touch and feel">
        <label class="switch-row"><span><strong>Haptics</strong><small>A light tap when you launch, stop, black out or switch tabs. iPhone only.</small></span><input type="checkbox" role="switch" data-pref-haptics checked={prefs.haptics} onchange={(e)=>{setPrefs({haptics:e.currentTarget.checked});feel(prefs,'switch');}} /></label>
        <label class="switch-row"><span><strong>Launch on touch-down</strong><small>Clips start the moment your finger lands, not when it lifts. A swipe that starts on a clip launches it too.</small></span><input type="checkbox" role="switch" data-pref-touchdown checked={prefs.launchOnTouchDown} onchange={(e)=>setPrefs({launchOnTouchDown:e.currentTarget.checked})} /></label>
      </div>
      </Section>
      <Section plain title="Storage on this device" icon="save" tone="neutral">
      <div class="storage-card" role="group" aria-label="Storage on this device">
        {#if storage}
          <p data-storage-summary>{setList.length} set{setList.length === 1 ? '' : 's'} · {storage.files} imported file{storage.files === 1 ? '' : 's'}, {formatBytes(storage.bytes)}{#if storage.unused.length}{' · '}{storage.unused.length} not used by any set, {formatBytes(storage.unusedBytes)}{/if}</p>
          {#if mediaConfirm}
            <div class="confirm-row"><span>Delete {storage.unused.length} unused file{storage.unused.length === 1 ? '' : 's'}? This cannot be undone.</span><button class="danger" data-media-delete-confirm disabled={storageBusy} onclick={deleteUnusedMedia}>Delete</button><button onclick={() => (mediaConfirm = false)}>Cancel</button></div>
          {:else if storage.unused.length}
            <button data-media-delete disabled={storageBusy} onclick={() => (mediaConfirm = true)}><Icon name="trash" size={16} />Delete unused media</button>
          {:else}<p class="hint">Every imported file is used by a saved set.</p>{/if}
        {:else}<p class="hint">Media storage is not available right now.</p>{/if}
      </div>
      </Section>
      {#if freshConfirm}
        <div class="confirm-row" role="alertdialog" aria-label="Start a fresh set"><span>Start a fresh set? “{show.name}” stays saved on this device.</span><button data-fresh-confirm onclick={startFreshSet}>Start fresh</button><button onclick={() => (freshConfirm = false)}>Cancel</button></div>
      {:else}
        <button class="subtle" data-fresh onclick={() => (freshConfirm = true)}>Start a fresh set</button>
      {/if}
    </div>
  </div>{/if}

<style>
 .ghost-movements{padding:12px 0}.ghost-movements strong{font-size:12px;color:var(--ga-ink-0)}.ghost-movements>div{display:flex;gap:6px;margin-top:8px}.ghost-movements button{flex:1;min-height:44px;background:var(--ga-selection-bg);border:1px solid var(--ga-selection-line);border-radius:5px;color:var(--ga-ink-0)}
  .mapping-tools{margin-bottom:12px}.mapping-tools button{display:flex;gap:7px;align-items:center;justify-content:center;min-height:44px;}


  .autopilot-bar{display:flex;align-items:center;gap:0;border:1px solid var(--ga-line-2);border-radius:5px;background:var(--ga-slot);padding:0;}
  .autopilot-bar button{display:flex;align-items:center;gap:5px;min-height:44px;border:0;background:transparent;padding:0 7px;}
  .autopilot-bar strong{font-size:12px;font-weight:650;}
  .autopilot-bar button span{font:12px ui-monospace;color:#a6adb9;}
  .autopilot-bar button.running{color:#b7f375;background:#24311c;border-radius:4px;}
  .autopilot-bar button.running span{color:#b7f375;}
  .autopilot-bar button.paused{color:#ffc570;}
  .autopilot-bar button.paused span{color:#ffc570;}
  .auto-options{padding:12px;border:1px solid var(--ga-line-2);border-radius:6px;margin-bottom:10px;background:var(--ga-card);}
  .auto-switches,.auto-fields,.auto-rows{display:flex;gap:8px;margin-bottom:10px;}
  .auto-switches button{display:flex;align-items:center;justify-content:center;gap:8px;flex:1;min-height:44px;}
  .auto-fields label{flex:1;min-width:0;display:grid;gap:6px;font-size:12px;color:var(--ga-ink-2);}
  .auto-fields select{width:100%;font-size:12px;min-height:44px;}
  .auto-amount{display:grid;grid-template-columns:1fr auto;align-items:center;font-size:12px;}
  .auto-amount input{grid-column:1/-1;}
  .auto-amount output{color:#b7f375;font:12px ui-monospace;}
  .auto-rows button{flex:1;min-height:44px;}
  .auto-options p{font-size:12px;color:#a6adb9;line-height:1.5;margin:4px 0;}

  .performance-hidden { display: none !important; }
  :global(html),
  :global(body) {
    margin: 0;
    background: var(--ga-void);
    color: var(--ga-ink-0);
    font-family: var(--ga-font-ui, 'Satoshi', system-ui, sans-serif);
    font-weight: 500;
    -webkit-font-smoothing: antialiased;
    overscroll-behavior: none;
  }
  :global(*) {
    box-sizing: border-box;
  }
  .studio,
  .settings-dialog {
    --bg: var(--ga-void);
    --panel: var(--ga-panel);
    --raised: var(--ga-card);
    --line: var(--ga-line-2);
    --muted: var(--ga-ink-1);
    --text: var(--ga-ink-0);
    --accent: var(--ga-coral);
    --deep: var(--ga-selection-bg);
    --green: var(--ga-green);
    color: var(--text);
    font-size: 13px;
    line-height: 1.45;
    letter-spacing: 0;
  }
  .studio {
    height: 100dvh;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 64px minmax(0, 1fr) 66px;
    background: var(--bg);
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  button,
  input,
  select {
    font: inherit;
    color: inherit;
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 40px;
    border: 1px solid var(--line);
    border-radius: var(--ga-r-hard);
    background: var(--ga-hardware-bg);
    box-shadow: var(--ga-hardware-shadow);
    padding: 8px 12px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    font-weight: 550;
  }
  button:hover {
    border-color: var(--ga-line-3);
  }
  button:active {
    background: var(--ga-raise);
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  button.active,
  button.primary {
    background: var(--deep);
    border-color: var(--ga-selection-line);
    color: var(--ga-selection-ink);
  }
  button.primary {
    background: var(--ga-act-bg);
    border-color: var(--ga-act-line);
    color: var(--ga-act-ink);
    font-weight: 700;
  }
  button.danger {
    background: #572737;
    color: #ffb2bb;
    border-color: #b55268;
  }
  button:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--ga-focus);
    outline-offset: 3px;
  }
  button.subtle {
    background: none;
    color: var(--muted);
  }
  input:not([type='range']):not([type='checkbox']),
  select {
    background: var(--ga-slot);
    border: 1px solid var(--line);
    border-radius: 8px;
    min-height: 44px;
    padding: 9px 12px;
    max-width: 100%;
    font-size: 16px;
  }
  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    width: 100%;
    height: 48px;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
    touch-action: pan-y;
  }
  input[type='range']::-webkit-slider-runnable-track {
    height: 10px;
    border-radius: 5px;
    background: repeating-linear-gradient(90deg, transparent 0 calc(12.5% - 1px), var(--ga-line-2) calc(12.5% - 1px) 12.5%), var(--ga-slot);
    border: 1px solid var(--ga-line-2);
  }
  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 22px;
    height: 28px;
    border-radius: var(--ga-r-hard);
    background: linear-gradient(var(--ga-slider-fill), var(--ga-slider-fill)) center / 10px 2px no-repeat, linear-gradient(180deg, var(--ga-raise), var(--ga-card));
    border: 1px solid var(--ga-line-3);
    box-shadow: 0 2px 5px #0009;
    margin-top: -10px;
  }
  input[type='range']::-moz-range-track {
    height: 8px;
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    border-radius: 5px;
  }
  input[type='range']::-moz-range-progress {
    height: 8px;
    background: var(--ga-slider-fill);
    border-radius: 5px;
  }
  input[type='range']::-moz-range-thumb {
    height: 26px;
    width: 20px;
    background: linear-gradient(var(--ga-slider-fill), var(--ga-slider-fill)) center / 10px 2px no-repeat, linear-gradient(180deg, var(--ga-raise), var(--ga-card));
    border: 1px solid var(--ga-line-3);
    border-radius: var(--ga-r-hard);
  }
  input.blue-fill::-webkit-slider-runnable-track {
    background: repeating-linear-gradient(90deg, transparent 0 calc(12.5% - 1px), var(--ga-line-2) calc(12.5% - 1px) 12.5%), linear-gradient(90deg, var(--ga-blue-600) 0 calc(10px + (100% - 20px) * var(--range-fill, 0)), var(--ga-slot) calc(10px + (100% - 20px) * var(--range-fill, 0)) 100%);
  }
  input.blue-fill::-webkit-slider-thumb {
    background: linear-gradient(var(--ga-blue-300), var(--ga-blue-300)) center / 10px 2px no-repeat, linear-gradient(180deg, var(--ga-raise), var(--ga-card));
  }
  input.blue-fill::-moz-range-progress {
    background: var(--ga-blue-600);
  }
  input.blue-fill::-moz-range-thumb {
    background: linear-gradient(var(--ga-blue-300), var(--ga-blue-300)) center / 10px 2px no-repeat, linear-gradient(180deg, var(--ga-raise), var(--ga-card));
  }
  input[type='checkbox'] {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
  select {
    cursor: pointer;
  }
  h1,
  h2,
  p {
    margin: 0;
  }
  h1 {
    font-size: 15px;
    line-height: 1.3;
    letter-spacing: 0;
    font-weight: 620;
  }
  h2 {
    font-size: 14px;
    letter-spacing: 0;
  }
  .icon-button {
    width: 40px;
    height: 40px;
    flex: none;
    padding: 0;
    background: transparent;
    border-color: transparent;
    box-shadow: none;
  }
  .file-input {
    display: none;
  }
  .primary {
    background: var(--deep);
  }
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    border-bottom: 1px solid var(--line);
    gap: 20px;
    background: var(--ga-faceplate-bg);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 11px;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 750;
    letter-spacing: 0.8px;
  }
  .brand-wordmark { width: 180px; height: 28px; object-fit: contain; }
  .brand-mark {
    width: 30px;
    height: 30px;
    border-radius: 6px;
    object-fit: contain;
    flex: none;
  }
  .set-title {
    box-shadow: none;
    background: transparent;
    border: 0;
    color: var(--muted);
    font-size: 12px;
    max-width: 35%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .set-title span {
    margin-left: 12px;
  }
  .header-actions {
    display: flex;
    gap: 3px;
  }
  .workspace {
    min-width:0;
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(370px, 1fr);
    min-height: 0;
    max-width: 1800px;
    width: 100%;
    margin: 0 auto;
  }
  .monitor {
    padding: 22px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    overflow: auto;
    border-right: 1px solid var(--line);
    background: var(--ga-void);
  }
  .monitor-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--muted);
    font-size: 12px;
    letter-spacing: 1px;
    margin: 0 0 10px;
  }
  .monitor-heading span:first-child {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--ga-ink-0);
  }
  .monitor-heading b {
    padding: 0 5px;
    color: var(--ga-ink-2);
  }
  i {
    width: 6px;
    height: 6px;
    display: inline-block;
    border-radius: 50%;
    background: var(--ga-ink-3);
  }
  .monitor-heading i,
  i.lit {
    background: var(--green);
    box-shadow: 0 0 9px #75d8b638;
  }
  .monitor-heading i.stopped {
    background: #ff778e;
  }
  .preview-frame {
    position: relative;
    width: 100%;
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-soft);
    padding: 5px;
    background: var(--ga-slot);
    box-shadow: inset 0 1px 0 var(--ga-line-2);
  }
  .preview {
    position: relative;
    width: 100%;
    aspect-ratio: 16/9;
    background: #000;
    touch-action: none;
  }
  .preview canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .detail-reduced { font-style: normal; color: #ffc570; }
  .phone-label { display: none; }
  .visuals-down {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 6px;
    padding: 12px;
    text-align: center;
    background: #000c;
    font-size: 12px;
    color: var(--ga-ink-1);
  }
  .visuals-down strong { font-size: 14px; color: var(--ga-ink-0); }
  .visuals-down button {
    min-height: 44px;
    margin-top: 6px;
    padding: 0 18px;
    font-weight: 650;
    background: var(--ga-selection-bg);
    border: 1px solid var(--ga-selection-line);
    border-radius: 5px;
    color: var(--ga-selection-ink);
  }
  .monitor-tools {
    display: flex;
    gap: 5px;
    align-items: center;
    padding: 10px 0 22px;
  }
  .monitor-tools > span {
    margin-right: auto;
    font-size: 12px;
    letter-spacing: 1px;
    color: var(--muted);
  }
  .monitor-tools button {
    font-size: 12px;
    background: transparent;
    min-height: 34px;
    padding: 5px 8px;
  }
  .monitor-tools button.danger {
    background: #572737;
  }
  .mixer {
    border-top: 1px solid var(--line);
    padding-top: 17px;
  }
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
    letter-spacing: 1.1px;
    color: var(--muted);
    font-weight: 650;
    margin: 0 0 12px;
  }
  .section-heading > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 70%;
  }
  .section-heading button {
    font-size: 12px;
    letter-spacing: 0;
    font-weight: 500;
    background: transparent;
    padding: 4px 8px;
    min-height: 32px;
  }
  .channel-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .channel {
    min-width: 0;
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-soft);
    padding: 10px;
  }
  .channel.selected {
    border-color: var(--ga-selection-line);
    background: var(--ga-selection-bg);
  }
  .channel-select {
    box-shadow: none;
    width: 100%;
    border: 0;
    background: none;
    padding: 0;
    gap: 5px;
    justify-content: space-between;
    min-height: 26px;
  }
  .layer-number {
    font-size: 14px;
    font-weight: 700;
    color: var(--ga-ink-0);
  }
  .channel-select > span:nth-child(2) {
    font-size: 12px;
    letter-spacing: 0.6px;
    color: var(--muted);
  }
  .channel > strong {
    display: block;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    font-size: 12px;
    font-weight: 500;
    color: var(--ga-ink-1);
    margin: 12px 0 5px;
  }
  .channel-bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .channel-bottom button {
    min-height: 28px;
    padding: 2px 6px;
    font-size: 12px;
    background: none;
  }
  .channel-bottom button.active {
    background: var(--ga-selection-bg);
    border: 1px solid var(--ga-selection-line);
  }
  .crossfader {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 15px 0 0;
  }
  .crossfader button {
    min-height: 32px;
    height: 32px;
    width: 32px;
    font-size: 12px;
    background: var(--ga-card);
    color: var(--ga-ink-0);
    border-color: var(--ga-line-2);
  }
  .crossfader input {
    accent-color: var(--ga-green);
  }
  .control-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: var(--ga-inspector-bg);
  }
  .tabs {
    background: var(--ga-faceplate-bg);
    display: flex;
    flex: none;
    border-bottom: 1px solid var(--line);
    padding: 0;
    gap: 5px;
  }
  .tabs button {
    flex: 1;
    min-width:0;
    min-height:44px;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: none;
    color: var(--muted);
    padding: 10px 6px 13px;
    font-size: 12px;
    gap: 8px;
  }
  .tabs button.active {
    background: var(--ga-selection-bg);
    color: var(--ga-selection-ink);
    border-bottom-color: var(--ga-selection-line);
  }
  .panel-scroll {
    flex:1;
    min-width:0;
    width:100%;
    box-sizing:border-box;
    overflow-x:hidden;
    -webkit-overflow-scrolling:touch;
    padding: 16px;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--ga-raise) transparent;
  }
  .panel-heading {
    min-width:0;
    flex-wrap:wrap;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }
  .eyebrow {
    display: block;
    color: var(--ga-ink-1);
    font-size: 12px;
    letter-spacing: 1px;
    font-weight: 650;
    margin-bottom: 7px;
  }
  .segmented {
    display: flex;
    background: var(--ga-slot);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 3px;
    flex: none;
  }
  .segmented button {
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    min-height: 30px;
    border-radius: 5px;
    padding: 5px 10px;
  }
  .segmented button.active {
    background: var(--ga-selection-bg);
    color: var(--ga-selection-ink);
  }
  .segmented.wide {
    margin: 16px 0;
    display: flex;
  }
  .segmented.wide button {
    flex: 1;
    min-height: 38px;
    font-size: 12px;
  }
  .layer-tabs {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    margin-bottom: 16px;
  }
  .layer-tabs button {
    min-width: 0;
    gap: 5px;
    padding: 7px 5px;
    background: var(--ga-card);
    color: var(--muted);
    font-size: 12px;
  }
  .layer-tabs button > span {
    color: var(--ga-ink-0);
    font-weight: 700;
  }
  .layer-tabs button > small {
    margin-left: auto;
    font-size: 12px;
    opacity: 0.6;
  }
  .layer-tabs button.active {
    background: var(--ga-selection-bg);
    color: var(--ga-selection-ink);
    border-color: var(--ga-selection-line);
  }
  
  
  .clip-pad img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.8;
    z-index: -2;
  }
  
  .clip-pad.playing {
    border: 2px solid var(--ga-green);
    box-shadow: inset 0 0 0 1px var(--ga-green);
  }
  .clip-pad.queued {
    border-color: #ffd37e;
    border-style: dashed;
  }
  
  .clip-kind {
    position: absolute;
    top: 8px;
    right: 8px;
    font-size: 7px;
    letter-spacing: 0.8px;
    background: var(--ga-slot);
    padding: 2px 4px;
    border-radius: 3px;
    color: var(--ga-ink-1);
  }
  .pad-name {
    position: absolute;
    bottom: 11px;
    left: 11px;
    right: 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .pad-name strong {
    font-size: 12px;
    line-height: 1.2;
    font-weight: 570;
  }
  .pad-name > span {
    font-size: 7px;
    letter-spacing: 1px;
    color: var(--ga-ink-1);
  }
  .playing .pad-name > span {
    color: var(--ga-selection-ink);
  }
  
  
  
  
  
  
  
  
  
  
  
  
  .bank-row {
    display: flex;
    justify-content: center;
    gap: 16px;
    align-items: center;
    margin: 9px 0 18px;
    color: var(--ga-ink-1);
    font-size: 12px;
    letter-spacing: 1.5px;
  }
  .bank-row small {
    color: var(--ga-ink-2);
  }
  .bank-row .icon-button {
    width: 30px;
    height: 30px;
    min-height: 30px;
  }
  .transport-card,
  .inspector-card {
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-soft);
    padding: 16px;
    margin-bottom: 15px;
  }
  .transport-card .section-heading {
    letter-spacing: 0.6px;
  }
  .range-row {
    display: flex;
    gap: 12px;
    align-items: center;
    margin: 9px 0;
    font-size: 12px;
  }
  .range-row > span {
    width: 86px;
    flex: none;
    color: var(--ga-ink-1);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .range-row input {
    min-width: 0;
  }
  .range-row output {
    width: 44px;
    text-align: right;
    flex: none;
    color: var(--ga-blue);
    font:
      12px ui-monospace,
      monospace;
  }
  .range-row select {
    flex: 1;
    min-width: 0;
    text-transform: capitalize;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 12px;
    color: var(--ga-ink-1);
    margin: 13px 0;
  }
  .field-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .field-grid .field {
    min-width: 0;
  }
  .hint {
    font-size: 12px;
    color: var(--ga-ink-1);
    line-height: 1.75;
    margin: 14px 0;
  }
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--ga-ink-1);
    padding: 10px 0;
  }
  .empty-state {
    text-align: center;
    padding: 35px 16px;
    color: var(--ga-ink-1);
  }
  .empty-state h2 {
    margin: 16px 0 10px;
    color: var(--ga-ink-0);
  }
  .empty-state p {
    font-size: 12px;
    line-height: 1.8;
    max-width: 330px;
    margin: auto;
  }
  /* A template's stage behind the picture: the picture is light on it. */
  .preview.staged canvas { position: relative; mix-blend-mode: screen; }
  /* Holds the stage so the mapping canvas can zoom it with the picture. */
  .stage-layer { position: absolute; inset: 0; pointer-events: none; }
  .stage-chip {
    position: absolute; right: 5px; bottom: 5px; z-index: 3; padding: 2px 6px; border-radius: 4px; background: #000a;
    font-size: 12px; letter-spacing: .06em; line-height: 1.3; color: var(--ga-ink-1); pointer-events: none;
  }
  .stage-note { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; }
  .stage-note p { flex: 1; margin: 0; font-size: 12px; line-height: 1.4; color: var(--ga-ink-1); }
  .stage-note button { flex: none; min-height: 44px; padding: 0 14px; font-size: 13px; }
  .templates-button { display: inline-flex; align-items: center; gap: 6px; }
  .map-library { margin: 4px 0 16px; padding: 10px; border: 1px solid var(--ga-line-2); border-radius: 6px; }
  .map-library p { margin: 0 0 8px; font-size: 12px; line-height: 1.4; color: var(--ga-ink-1); }
  .map-library strong { color: var(--ga-ink-0); font-weight: 600; }
  .map-library div { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .map-library button { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; font-size: 13px; }
  .cap-notice { margin: 0 0 12px; padding: 8px 10px; border: 1px solid #ffc57066; border-radius: 6px; background: #ffc5700f; font-size: 12px; line-height: 1.4; color: #ffd9a0; }
  .surface-list small.capped { color: #ffc570; }
  .mapping-toolbar {
    display: flex;
    gap: 7px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .mapping-toolbar button {
    font-size: 12px;
    min-height: 38px;
    padding: 6px 9px;
  }
  .surface-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
    margin-bottom: 18px;
  }
  .surface-list > button {
    justify-content: start;
    text-align: left;
    padding: 10px;
    min-width: 0;
    background: var(--ga-card);
  }
  .surface-list > button.picked { border-color: var(--ga-coral-300, #ff9a8b); }
  .surface-list > button.active {
    background: var(--ga-selection-bg);
    border-color: var(--ga-selection-line);
  }
  .surface-index {
    color: var(--ga-ink-0);
    font-size: 12px;
    border: 1px solid var(--ga-line-3);
    border-radius: 4px;
    width: 24px;
    height: 24px;
    display: grid;
    place-content: center;
    flex: none;
  }
  .surface-list strong {
    font-size: 12px;
    display: block;
    font-weight: 550;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    max-width: 120px;
  }
  .surface-list small {
    font-size: 12px;
    color: var(--ga-ink-1);
    display: block;
    margin-top: 3px;
  }
  .surface-list i {
    margin-left: auto;
    flex: none;
  }
  .inline {
    display: flex;
    gap: 4px;
  }
  .card-actions {
    display: flex;
    justify-content: space-between;
    border-top: 1px solid var(--ga-line-2);
    padding-top: 14px;
    margin-top: 14px;
  }
  .card-actions button {
    font-size: 12px;
    background: none;
    color: var(--ga-ink-1);
    padding: 5px 8px;
    min-height: 34px;
  }
  .master-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 22px;
    border-top: 1px solid var(--line);
    background: var(--ga-faceplate-bg);
    gap: 14px;
  }
  .tempo,
  .master-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .beat-dots {
    display: flex;
    gap: 5px;
    margin-right: 4px;
  }
  .beat-dots i {
    width: 5px;
    height: 5px;
  }
  .beat-dots i.lit {
    background: var(--ga-slider-fill);
  }
  .tempo > label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tempo input {
    width: 66px;
    min-height: 36px !important;
    padding: 5px 4px !important;
    text-align: right;
    font-variant-numeric: tabular-nums;
    border: 0 !important;
    background: none !important;
    font-size: 18px !important;
    font-weight: 620;
  }
  
  .tempo > button {
    font-size: 12px;
    min-height: 35px;
    padding: 5px 9px;
    background: transparent;
    color: var(--ga-ink-1);
  }
  .tempo > button.active {
    background: var(--ga-selection-bg);
    color: var(--ga-selection-ink);
  }
  .master-level {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .master-level span {
    font-size: 12px;
    letter-spacing: 1px;
    color: var(--ga-ink-1);
  }
  .master-level input {
    width: 110px;
  }
  .master-actions .icon-button.recording {
    color: #ff8c9d;
    border: 1px solid #984258;
    background: #3d1d2c;
    width: auto;
    min-width: 40px;
    padding: 0 8px;
  }
  .toast {
    position: fixed;
    bottom: calc(80px + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    max-width: min(540px, calc(100vw - 28px));
    padding: 13px 17px;
    background: var(--ga-raise);
    border: 1px solid var(--ga-line-3);
    border-radius: var(--ga-r-soft);
    box-shadow: 0 8px 40px #0008;
    z-index: 60;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .toast .toast-action {
    min-height: 44px;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 650;
    white-space: nowrap;
    background: var(--ga-selection-bg);
    border: 1px solid var(--ga-selection-line);
    border-radius: 5px;
    color: var(--ga-selection-ink);
  }
  .toast.error {
    background: #462333;
    border-color: #a75e79;
  }
  .toast .icon-button {
    width: 44px;
    height: 44px;
    min-height: 44px;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: #02060cbb;
    backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .settings-dialog {
    max-width: 500px;
    width: 100%;
    max-height: 90dvh;
    overflow-y: auto;
    border: 1px solid var(--ga-line-3);
    background: var(--ga-inspector-bg);
    border-radius: 12px;
    padding: 26px;
    box-shadow: 0 24px 100px #0009;
  }
  .settings-dialog .field-grid button {
    font-size: 12px;
  }
  .saved-sets, .storage-card, .feel-card { display: grid; gap: 6px; margin: 16px 0; }
  .export-media { grid-column: 1 / -1; }
  .export-media span { display: grid; gap: 1px; text-align: left; }
  .export-media small { font-size: 12px; font-weight: 500; opacity: .85; }
  .switch-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 44px; padding: 6px 0; cursor: pointer; }
  .switch-row > span { display: grid; gap: 2px; min-width: 0; }
  .switch-row strong { font-size: 13px; font-weight: 600; color: var(--ga-ink-0); }
  .switch-row small { font-size: 12px; line-height: 1.4; color: var(--ga-ink-1); }
  .switch-row input {
    appearance: none; -webkit-appearance: none; flex: none; position: relative; width: 52px; height: 32px; margin: 0; padding: 0;
    border-radius: 16px; border: 1px solid var(--ga-line-3); background: var(--ga-slot); cursor: pointer; transition: background .15s;
  }
  .switch-row input::after {
    content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%;
    background: var(--ga-ink-1); transition: transform .15s, background .15s;
  }
  .switch-row input:checked { background: var(--ga-blue-500); border-color: var(--ga-blue-400); }
  .switch-row input:checked::after { transform: translateX(20px); background: #fff; }
  .switch-row input:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: 2px; }
  .storage-card { padding: 14px; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-soft); background: var(--ga-sub); }
  .storage-card p { margin: 0; font-size: 12px; line-height: 1.5; color: var(--ga-ink-1); }
  .storage-card > button { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; }
  .set-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .set-row button { min-height: 44px; font-size: 12px; }
  .set-row .set-open { flex: 1; min-width: 0; display: grid; gap: 2px; justify-items: start; text-align: left; padding: 6px 10px; }
  .set-row .set-open strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .set-row .set-open small { font-size: 12px; color: var(--ga-ink-2); }
  .set-row.current .set-open { border-color: var(--ga-selection-line); background: var(--ga-selection-bg); opacity: 1; }
  .set-row input { flex: 1; min-width: 0; min-height: 44px; }
  .set-confirm { flex: 1; min-width: 0; font-size: 12px; line-height: 1.4; color: var(--ga-ink-0); }
  .confirm-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; line-height: 1.4; }
  .confirm-row span { flex: 1 1 180px; min-width: 0; }
  .confirm-row button { min-height: 44px; }
  .recording-result {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .recording-result video {
    width: 100%;
    border-radius: 8px;
    background: #000;
  }
  .mobile-decks {
    display: none;
  }
  .phone-mix {
    display: none;
  }
  input[type='number'] {
    appearance: textfield;
  }
  input[type='number']::-webkit-inner-spin-button,
  input[type='number']::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .exit-clean {
    position: fixed;
    right: 20px;
    top: calc(20px + env(safe-area-inset-top));
    z-index: 5;
    opacity: 0;
    transition: opacity 0.2s;
    font-size: 12px;
  }
  .exit-clean {
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0 !important;
    border: 0;
    border-radius: 0;
    background: none;
    cursor: none;
  }
  .clean {
    display: block;
    background: #000;
    padding: 0;
  }
  .clean .app-header,
  .clean .control-panel,
  .clean .monitor-heading,
  .clean .monitor-tools,
  .clean .mixer,
  .clean .master-bar,
  .clean .toast {
    display: none;
  }
  .clean .workspace,
  .clean .monitor {
    display: block;
    width: 100%;
    height: 100%;
    max-width: none;
    margin: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    background: #000;
  }
  .clean .preview-frame {
    position: absolute;
    inset: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    display: grid;
    place-items: center;
  }
  .clean .preview {
    width: min(100vw, 177.7778dvh);
    aspect-ratio: 16/9;
  }
  @media (min-width: 1500px) {
    .workspace {
      grid-template-columns: minmax(0, 1.35fr) minmax(480px, 1fr);
    }
    .panel-scroll {
      padding: 30px;
    }
    
    .monitor {
      padding: 38px;
    }
  }
  @media (max-width: 1000px) and (min-width: 761px) {
    .workspace {
      grid-template-columns: minmax(0, 1fr) minmax(350px, 1fr);
    }
    .monitor {
      padding: 14px;
    }
    .panel-scroll {
      padding: 18px;
    }
    .channel-grid {
      gap: 5px;
    }
    .channel {
      padding: 6px;
    }
    .channel-select > span:nth-child(2) {
      font-size: 6px;
    }
    .channel > strong {
      font-size: 12px;
    }
    .panel-heading h1 {
      font-size: 15px;
    }
    .tabs {
      padding: 0;
    }
    .tabs button {
      font-size: 12px;
      gap: 5px;
    }
    .master-level {
      display: none;
    }
    .pad-name strong {
      font-size: 12px;
    }
  }
  @media (max-width: 760px) {
    .mobile-decks {
      display: flex;
      grid-column: 1/-1;
      align-items: center;
      gap: 12px;
      height: 30px;
    }
    .mobile-decks button {
      width: 30px;
      min-height: 28px;
      height: 28px;
      padding: 0;
      font-size: 12px;
      background: var(--ga-card);
      border-color: var(--ga-line-2);
    }
    .mobile-decks input {
      min-width: 0;
      accent-color: var(--ga-green);
    }
    .phone-mix {
      display: block;
      padding: 0 0 12px;
    }
    .studio {
      grid-template-rows: 52px minmax(0, 1fr) auto;
    }
    .app-header {
      padding: 0 14px;
      gap: 6px;
    }
    .brand {
      flex: 1;
      min-width: 0;
      font-size: 12px;
      letter-spacing: 1px;
      gap: 8px;
    }
    .brand-wordmark { flex: 1; min-width: 0; max-width: 150px; width: 150px; height: 24px; }
    .brand-mark {
      width: 29px;
      height: 29px;
      font-size: 18px;
    }
    .set-title {
      display: none;
    }
    .header-actions {
      flex: none;
      gap: 0;
    }
    .app-header .icon-button {
      width: 44px;
      height: 44px;
      min-height: 44px;
    }
    .header-actions .icon-button:nth-child(2) {
      display: none;
    }
    .workspace {
      display: flex;
      flex-direction: column;
    }
    .monitor {
      display: block;
      flex: none;
      padding: 10px 14px 0;
      overflow: visible;
      border: 0;
      background: var(--ga-inspector-bg);
    }
    .monitor-heading {
      font-size: 12px;
      margin-bottom: 6px;
    }
    .preview-frame {
      border-radius: 8px;
      padding: 4px;
      max-width: 520px;
      margin: auto;
    }
    .monitor-tools {
      padding: 6px 0;
      max-width: 520px;
      margin: auto;
    }
    .monitor-tools > span {
      font-size: 12px;
      letter-spacing: 0.5px;
    }
    .monitor-tools button {
      font-size: 12px;
      min-height: 28px;
      padding: 3px 7px;
    }
    .monitor-tools button :global(svg) {
      width: 13px;
      height: 13px;
    }
    .mixer {
      display: none;
    }
    .control-panel {
      flex: 1;
      overflow: hidden;
    }
    .tabs {
      order: 0;
      padding: 2px 10px 0;
      gap: 0;
    }
    .tabs button {
      flex-direction: column;
      font-size: 12px;
      padding: 5px 2px;
      gap: 3px;
      min-height: 48px;
    }
    .tabs button :global(svg) {
      width: 17px;
      height: 17px;
    }
    .panel-scroll {
      padding: 16px 14px 20px;
    }
    .panel-heading {
      margin-bottom: 14px;
      gap: 8px;
    }
    h1 {
      font-size: 15px;
    }
    .eyebrow {
      font-size: 12px;
      margin-bottom: 5px;
      letter-spacing: 1.3px;
    }
    .segmented button {
      font-size: 12px;
      padding: 5px 8px;
      min-height: 28px;
    }
    .layer-tabs {
      gap: 5px;
      margin-bottom: 12px;
    }
    .layer-tabs button {
      min-height: 38px;
      font-size: 12px;
    }
    
    
    .pad-name {
      bottom: 9px;
      left: 9px;
    }
    .pad-name strong {
      font-size: 12px;
    }
    .pad-name > span {
      font-size: 6px;
    }
    
    .clip-kind {
      font-size: 6px;
      right: 6px;
      top: 6px;
    }
    .master-bar {
      display: grid;
      grid-template-columns: max-content max-content;
      min-width:0;
      overflow-x:auto;
      padding: 4px 8px;
      gap: 4px;
    }
    .tempo {
      gap: 5px;
    }
    .beat-dots {
      display: none;
    }
    .tempo input {
      width: 49px;
      font-size: 17px !important;
    }
    .tempo > label {
      gap: 4px;
    }
    
    .tempo > button {
      min-height: 36px;
      padding: 5px 8px;
      font-size: 12px;
    }
    .master-bar button { min-height:44px; }
    .master-bar .mobile-decks button { min-height:28px; }
    .master-actions > button { padding:4px 8px; }
    .master-actions {
      gap: 2px;
    }
    
    .master-level {
      display: none;
    }
    .desktop-label {
      display: none;
    }
    .phone-label {
      display: inline;
    }
    .transport-card,
    .inspector-card {
      padding: 13px;
    }
    .range-row {
      gap: 8px;
    }
    .range-row > span {
      width: 77px;
      font-size: 12px;
    }
    .range-row output {
      font-size: 12px;
    }
    .mapping .monitor {
      padding: 15px 20px 0;
    }
    .mapping .preview-frame {
      padding: 0;
      border-radius: 0;
    }
    .surface-list {
      gap: 6px;
    }
    .surface-list strong {
      max-width: 95px;
    }
    .modal-backdrop {
      padding: 12px;
      align-items: flex-end;
    }
    .settings-dialog {
      border-radius: 18px 18px 8px 8px;
      padding: 22px 19px;
      max-height: 92dvh;
    }
    .settings-dialog h1 {
      font-size: 22px;
    }
    .settings-dialog input,
    .settings-dialog select {
      font-size: 16px !important;
    }
  }
  @media (max-height: 650px) and (orientation: landscape) {
    .phone-mix {
      display: block;
    }
    .studio {
      grid-template-rows: 48px minmax(0, 1fr) auto;
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 1fr);
    }
    .monitor {
      display: flex;
      padding: 12px;
      justify-content: center;
      overflow: auto;
    }
    .mixer {
      display: none;
    }
    .preview-frame {
      max-width: none;
    }
    .panel-scroll {
      padding: 13px;
    }
    .tabs {
      padding-top: 0;
    }
    .tabs button {
      padding: 7px 3px;
    }
    
    .master-level {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
      animation: none !important;
    }
  }
  @media (min-width: 1000px) {
    .performance:not(.clean) .workspace { grid-template-columns: minmax(270px, .72fr) minmax(0, 2fr); }
    .performance:not(.clean) .monitor { justify-content: flex-start; padding-top: 28px; }
  }

  .scope-context { color:var(--ga-ink-1);font-size:12px;margin-bottom:16px; }
  .mixing .panel-scroll { padding-bottom:380px; }
  @media(max-width:760px){
    .studio.performance .monitor {display:block;padding:15px 20px 0;}
    .studio.performance .preview-frame {width:auto;padding:0;border-radius:0;}
    .range-row {grid-template-columns:minmax(0,1fr) 46px;gap:0 10px;font-size:13px;margin:10px 0;}
    .range-row>span {grid-column:1;grid-row:1;}
    .range-row>output {grid-column:2;grid-row:1;}
    .range-row>input[type='range'], .range-row>select, .range-row>:global(.blend-trigger) {grid-column:1/-1;grid-row:2;min-height:48px;}
    .studio.mixing .monitor {display:block;}
    .mixing .workspace {padding-bottom:0;}
    .mixing .panel-scroll {padding-bottom:360px;}
    .mixing.performance .panel-heading, .mixing.performance :global(.deck-toolbar), .mixing.performance :global(.deck-hint), .mixing.performance :global(.add-columns) {display:none;}
    .mixing.performance .panel-scroll {padding-top:6px;}
    .performance .phone-mix {display:none;}
  }

  .deck-view-switch{flex:none}

  .clip-controls-tray{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;min-height:0;min-width:0;background:var(--ga-inspector-bg);border-top:1px solid var(--ga-line-3);box-shadow:0 -8px 24px #0004;animation:controls-in 180ms ease-out;}
  .clip-controls-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none;padding:10px 14px;border-bottom:1px solid var(--ga-line-2);background:var(--ga-faceplate-bg);}
  .clip-controls-header>div{min-width:0;}.clip-controls-header h2{font-size:15px;line-height:1.3;overflow-wrap:anywhere;}.clip-controls-header .eyebrow{margin-bottom:3px;font-size:12px;}.clip-controls-header .icon-button{width:44px;height:44px;min-height:44px;}
  .clip-controls-body{flex:1;min-height:0;min-width:0;padding:12px 14px max(18px,env(safe-area-inset-bottom));overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}
  .clip-controls-body .segmented{margin:0 0 12px;}.clip-controls-body .segmented button{min-height:44px;font-size:12px;}.clip-controls-body .inspector-card{margin-top:12px;}.clip-controls-body .range-row{display:grid;min-width:0;grid-template-columns:minmax(0,1fr) 52px;gap:0 10px;}.clip-controls-body .range-row>span{width:auto;min-width:0;font-size:12px;grid-column:1;grid-row:1;overflow:visible;overflow-wrap:anywhere;}.clip-controls-body .range-row>output{width:auto;font-size:12px;grid-column:2;grid-row:1;}.clip-controls-body .range-row>input,.clip-controls-body .range-row>select,.clip-controls-body .range-row>:global(.blend-trigger){grid-column:1/-1;grid-row:2;width:100%;min-width:0;min-height:44px;}.clip-controls-body .section-heading{flex-wrap:wrap;gap:8px;}.clip-controls-body .section-heading button{min-height:44px;}.clip-controls-body .toggle-row{min-height:44px;gap:12px;}.clip-controls-body .toggle-row>span{min-width:0;overflow-wrap:anywhere;}
  .controls-notice{display:flex;align-items:center;gap:8px;flex:none;margin:0;padding:8px 14px;background:var(--ga-coral-soft);color:var(--ga-coral);font-size:12px;line-height:1.4;}.controls-notice button{min-height:44px;margin-left:auto;}
  @keyframes controls-in{from{transform:translateY(32px);opacity:0;}to{transform:translateY(0);opacity:1;}}
  .clip-controls-body .look-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;}
  .clip-controls-body .look-actions button{width:100%;min-height:44px;}
  @media(max-width:760px) and (max-height:650px){.studio.clip-editing .monitor{padding-top:8px;}.studio.clip-editing .preview-frame{max-width:min(100%,34dvh);}.clip-controls-header{padding-top:6px;padding-bottom:6px;}}
  @media(prefers-reduced-motion:reduce){.clip-controls-tray{animation:none;}}
  /* Effect chain: one card per effect, with a drag handle to reorder. */
  .add-effect{display:flex;align-items:center;gap:6px;min-height:44px!important;padding:0 14px!important;font-size:13px!important;font-weight:700!important;background:var(--ga-act-bg)!important;border-color:var(--ga-act-line);color:var(--ga-act-ink);box-shadow:var(--ga-act-glow);--ga-icon-tone:var(--ga-act-ink);}
  .add-effect:disabled{background:var(--ga-hardware-bg)!important;border-color:var(--ga-line-2);color:var(--ga-ink-1);box-shadow:none;--ga-icon-tone:var(--ga-ink-1);}
  .effect-chain{display:grid;gap:0;}
  .effect-heading{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;gap:6px;}
  .effect-heading .reorder-handle{display:grid;place-items:center;width:44px;height:44px;min-height:44px;padding:0;color:var(--ga-ink-1);touch-action:none;cursor:grab;border:1px solid var(--ga-line-2);border-radius:6px;}
  .effect-heading .reorder-handle:disabled{opacity:.3;}
  .effect-heading .effect-toggle{min-height:44px;justify-content:flex-start;text-align:left;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .effect-heading .icon-button{width:44px;height:44px;min-height:44px;}
  .repair-offer{display:grid;gap:8px;margin:0 0 8px;padding:10px 12px;border:1px solid var(--ga-coral-line);border-radius:var(--ga-r-soft);background:var(--ga-coral-soft);}
  .repair-offer p{margin:0;font-size:13px;line-height:1.4;color:var(--ga-ink-0);}
  .repair-offer div{display:flex;flex-wrap:wrap;gap:8px;}
  .repair-offer button{min-height:44px;padding:0 14px;font-size:13px;font-weight:650;}
  .repair-offer small{font-size:12px;color:var(--ga-ink-1);}
</style>
