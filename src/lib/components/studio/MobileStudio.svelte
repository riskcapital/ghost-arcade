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
  import {loadPreferences,savePreferences,feel,type StudioPreferences} from '../../mobile/studio/preferences';
  import {startCoach,coachAfter,coachLaunch,type CoachState} from '../../mobile/studio/coach';
  // Choices of this device (haptics, launch on touch-down, hints already seen). Written at once,
  // so "first run" is decided on the first launch only.
  let prefs=loadPreferences();
  savePreferences(prefs);
  function setPrefs(patch:Partial<StudioPreferences>){prefs={...prefs,...patch};savePreferences(prefs);}
  let coach:CoachState=startCoach();
  function coachMove(next:CoachState){
    if(prefs.coachDone||next===coach)return;
    coach=next;
    if(next.done){setPrefs({coachDone:true});flash('That is the basics. Have a good set.');}
  }
  /** A clip launched by a finger (not Autopilot): the haptic tap and the coach's launch steps. */
  function handLaunch(row:number){
    feel(prefs,'launch');
    // Rows of a deck that is switched off still hold a clip id; they are not playing.
    coachMove(coachLaunch(coach,show.layers.slice(0,show.dualDeck?8:4).flatMap((l,i)=>l.clipId?[i]:[]),row));
  }
  import {MAX_BLOCKS,addBlock,blockTabs,deleteBlock,duplicateBlock,ensureOpenBlock,switchBlock,type BlockState} from '../../mobile/studio/blocks';
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
  import {snapMappingPoint,hitMappingScreens,grabOffset,draggedPoint,holdRepeat} from '../../mobile/studio/mappingInteraction';
  let mappingGrid=false, mappingSnap=false;
  let lastScreenTap={x:-100,y:-100,time:0};
  function selectPreviewScreen(e:MouseEvent){
    if(mappingTool==='paint'||tab!=='map'||(e.target as HTMLElement).closest('.warp-handle'))return;
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
  import PerformanceMixer from "./PerformanceMixer.svelte";
  import LookControls from "./LookControls.svelte";
  import { onMount, tick } from 'svelte';

  function sliderFill(value: number, min: number, max: number): number {
    return max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  }
  import Icon from './StudioIcon.svelte';
  import StudioDecks from './StudioDecks.svelte';
  import { StudioEngine } from '../../mobile/studio/engine';
  import { keepAwake } from '../../mobile/studio/wakeLock';
  import { shareFile, isNativePlatform } from '../../mobile/studio/nativeShare';
  import { standaloneShaderPaths } from '../../mobile/studio/shaderAvailability';
  const libraryShaders=MOBILE_SHADERS.filter(s=>!s.requiresImage&&standaloneShaderPaths.has(s.path)).sort((a,b)=>Number(b.id.startsWith('featured-'))-Number(a.id.startsWith('featured-')));
  import { MOBILE_SHADERS, findShader } from '../../mobile/standaloneShaderList';
  import { MOBILE_EFFECTS } from '../../mobile/standaloneEffects';
  import { EFFECT_PARAM_DEFS } from '../../effects/effectParamDefs';
  import { putAsset, listAssets, deleteAssets, unusedAssets, totalBytes, formatBytes, type AssetInfo } from '../../mobile/studio/assets';
  import {
    loadShow,
    saveCurrentShow,
    savedSets,
    upsertSet,
    removeSet,
    renameSet,
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

  let show = loadShow();
  let setBank = savedSets();
  let tab: 'perform' | 'map' | 'fx' | 'flux' = 'perform';
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
  let drag: { id: number; surface: number; point: number; offset: { x: number; y: number }; moved: boolean } | null = null;
  let nudgeStep = 0.001;
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
    show = defaultShow();
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
  async function refreshStorage() {
    try {
      const all = await listAssets();
      const unused = unusedAssets(all, referencedAssetIds([show, ...setBank, ...history.states]));
      storage = { files: all.length, bytes: totalBytes(all), unused, unusedBytes: totalBytes(unused) };
    } catch { storage = null; }
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
  function beginDrag(e: PointerEvent, index: number) {
    if (!surface || surface.locked) return;
    e.preventDefault();
    selectedPoint = index;
    // Remember where inside the handle the finger landed: the corner then moves by the distance
    // dragged. Touching a handle selects it and changes nothing.
    const offset = grabOffset({ x: e.clientX, y: e.clientY }, surface.points[index], preview.getBoundingClientRect());
    drag = { id: e.pointerId, surface: selectedSurface, point: index, offset, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function dragPoint(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return;
    const r = preview.getBoundingClientRect();
    let point=draggedPoint({x:e.clientX,y:e.clientY},drag.offset,r);
    if(!drag.moved){
      const from=show.surfaces[drag.surface].points[drag.point];
      if(Math.hypot((point.x-from.x)*r.width,(point.y-from.y)*r.height)<1)return;
      drag.moved=true;checkpoint();show.mapping=true;
    }
    if(mappingSnap)point=snapMappingPoint(point,show.surfaces,drag.surface,r.width,r.height);
    show.surfaces[drag.surface] = movePoint(show.surfaces[drag.surface], drag.point, point);
    show = { ...show };
  }
  function endDrag(e: PointerEvent) {
    if (drag?.id !== e.pointerId) return;
    const moved = drag.moved;
    drag = null;
    if (moved) persist();
  }
  function nudge(dx: number, dy: number) {
    if (!surface || surface.locked) return;
    show.mapping = true;
    const p = surface.points[selectedPoint];
    show.surfaces[selectedSurface] = movePoint(surface, selectedPoint, { x: p.x + dx, y: p.y + dy });
    persist();
  }
  function meshPath(s: Surface) {
    return [0, 1, 2, 5, 8, 7, 6, 3, 0].map((i) => `${s.points[i].x * 1000},${s.points[i].y * 562.5}`).join(' ');
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
      const box = footerEl.getBoundingClientRect();
      tempoAnchor = { left: Math.round(box.left) + 10, bottom: Math.round(window.innerHeight - box.top) + 8 };
    }
    tempoOpen = !tempoOpen;
  }
  // A rotation or Split View resize moves the footer: close rather than float in the wrong place.
  $: if (layoutInfo) tempoOpen = false;
  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps = [...taps.slice(-5), now];
    if (taps.length > 1) setBpm(Math.round(60000 / ((now - taps[0]) / (taps.length - 1))));
  }
  async function toggleMic() {
    if (micBusy) return;
    micBusy = true;
    try {
      await engine?.microphone(!mic);
      mic = !mic;
    } catch {
      error = 'Microphone access was not available. Check microphone permission in Settings.';
    } finally {
      micBusy = false;
    }
  }
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
  function closeControls(){clipControlsOpen=false;effectBrowser=false;}
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
  }
  let exporting = false;
  async function exportSet(event?: Event) {
    if (exporting) return;
    exporting = true;
    // The iPad share popover points at the button that was tapped.
    const anchor = event?.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
    try {
      const blob = new Blob([JSON.stringify(show, null, 2)], { type: 'application/json' });
      // Only claim success when the file really left: a finished share sheet, or a started download.
      const done = await shareFile(`${show.name}.ghostset`, blob, 'application/json', anchor);
      if (done) flash(isNativePlatform() ? 'Set shared. Imported media stays on this device.' : 'Set file downloaded. Imported media stays on this device.');
      else flash('Export cancelled. Nothing was shared.');
    } catch (e) {
      error = e instanceof Error && /latest version/.test(e.message) ? e.message : 'This set could not be exported. Try again.';
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
      const next = normalizeShow(JSON.parse(await file.text()));
      if (!roomForNewSet(next.id)) return;
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
      noteUnavailable();
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
    engine = next;
    next.start();
    if (mic) void next.microphone(true).catch(() => { mic = false; });
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
    if(hasNativeLive())void captureCapabilities().then(c=>lidar=!!c.lidar).catch(()=>lidar=false);
    const stopLayout=watchLayout(info=>{layoutInfo=info;if(info.mixer==='docked')mixerOpen=false;});
    let disposed = false;
    try {
      startEngine();
      externalOutput=new ExternalOutput(output,status=>outputStatus=status);
      void engine!.restore(show).then(() => {
        if (!disposed) { refreshParams(); noteUnavailable(); }
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
          <div class="segmented wide" aria-label="Control view"><button class:active={controlView==='source'} onclick={()=>controlView='source'}>Source</button><button class:active={controlView==='effects'} onclick={()=>controlView='effects'}>FX</button></div>
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
            <button class="mic-toggle inline" class:active={mic} aria-pressed={mic} disabled={micBusy} onclick={toggleMic}><Icon name="mic" size={18} /><span>{mic ? 'Microphone on' : 'Microphone off'}</span></button>
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
            <label class="range-row"
              ><span>Blend</span><select
                value={layer.blend}
                onchange={(e) => {
                  checkpoint();
                  patchLayer({ blend: e.currentTarget.value as typeof layer.blend });
                }}
                >{#each ['normal', 'add', 'screen', 'multiply', 'difference'] as mode}<option value={mode}
                    >{mode[0].toUpperCase() + mode.slice(1)}</option
                  >{/each}</select
              ></label
            >
          </details>
          {/if}
          {:else}
          <div class="segmented wide" aria-label="Effect scope">{#each [{id:'comp',name:'Comp'},{id:'layer',name:'Layer'},{id:'clip',name:'Clip'}] as scope}<button class:active={fxScope===scope.id} disabled={scope.id==='clip'&&!activeClip} onclick={()=>fxScope=scope.id as typeof fxScope}>{scope.name}</button>{/each}</div>
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


<svelte:window onkeydown={onKey} />
<input class="file-input" type="file" accept="video/*" multiple aria-label="Import videos" bind:this={videoInput} onchange={importMedia} />
<input class="file-input" type="file" accept="image/*" multiple aria-label="Import photos" bind:this={photoInput} onchange={importMedia} />
<input class="file-input" type="file" accept="video/*,image/*" multiple aria-label="Import media" bind:this={mediaInput} onchange={importMedia} />
<input class="file-input" type="file" accept=".ghostset,application/json" bind:this={setInput} onchange={importSet} />
<div class="studio" data-layout={layoutInfo.layout} data-inspector={layoutInfo.inspector} class:compact-preview={compactPreview && tab!=='map' && tab!=='flux'} class:flux-tab={tab==='flux'} class:docked-inspector={dockedInspector} class:tablet use:touchSliders={show} class:clip-editing={clipControlsOpen} class:performance={tab === 'perform'} class:mixing={mixerOpen} class:clean class:mapping={tab === 'map'}>
  <header class="app-header">
    <div class="brand">
      <img class="brand-mark" src="./icon-new.png" alt="" />
      <img class="brand-wordmark" src="./logo-wordmark.svg" alt="Ghost Arcade" />
    </div>
    <button class="set-title" onclick={() => (settings = true)}>{show.name}<span>⌄</span></button>
    <div class="header-actions">
      <button class="icon-button" disabled={!canUndo} onclick={() => undo()} aria-label="Undo"
        ><Icon name="undo" /></button
      ><button class="icon-button" disabled={!canRedo} onclick={() => undo(true)} aria-label="Redo"
        ><Icon name="redo" /></button
      ><button class="icon-button" class:active={outputStatus.state==='live'} onclick={() => (outputSettings = true)} aria-label="Output settings"
        ><Icon name="output" /></button
      ><button class="icon-button" onclick={() => (settings = true)} aria-label="Set settings"
        ><Icon name="settings" /></button
      >
    </div>
  </header>
  <nav class="tabs" aria-label="Workspace">
    {#each [{id:'perform',label:'Perform',icon:'grid'}, {id:'flux',label:'Flux',icon:'flux'}, {id:'map',label:'Map',icon:'map'}, {id:'interactive',label:'Studio',icon:'depth'}, {id:'tools',label:'Tools',icon:'scan'}, {id:'desktop',label:'Desktop',icon:'output'}] as t}
      <button class:active={!mixerOpen && tab===t.id} aria-pressed={!mixerOpen && tab===t.id}
        onclick={async()=>{feel(prefs,'switch');if(t.id==='desktop'){await prepareCaptureTool();oncompanion();}else if(t.id==='tools')toolkitOpen=true;else if(t.id==='interactive')openInteractive();else selectTab(t.id as typeof tab);}}><Icon name={t.icon}/><span>{t.label}</span></button>
    {/each}
  </nav>
  <main class="workspace">
    <section class="monitor">
      <div class="monitor-heading">
        <span><i class:stopped={blackout}></i>{blackout ? 'BLACKOUT' : frozen ? 'HOLD' : 'PROGRAM'}</span><span
          >{show.quality}p <b>·</b> {#if detail < 1}<em class="detail-reduced" data-detail title="Detail lowered to hold the frame rate">DETAIL {Math.round(detail * 100)}%</em>{' '}<b>·</b>{' '}{/if}{fps} FPS</span
        >
      </div>
      <div class="preview-frame">
        <div class="preview" bind:this={preview} onclick={selectPreviewScreen}>
          {#key canvasGeneration}<canvas bind:this={output} aria-label="Live video output"></canvas>{/key}
          {#if visualsDown}<div class="visuals-down" role="alert"><strong>{visualsRestarting ? 'Restarting visuals…' : 'Visuals interrupted'}</strong><span>Your set is safe.</span><button data-restart-visuals disabled={visualsRestarting} onclick={() => restartVisuals(true)}>Restart visuals</button></div>{/if}
          {#if tab === 'map' && !clean}
            <svg class="mapping-lines" viewBox="0 0 1000 562.5" aria-hidden="true">
              {#if mappingGrid}<defs><pattern id="mapping-guide-grid" width="62.5" height="62.5" patternUnits="userSpaceOnUse"><path d="M62.5 0H0V62.5" fill="none" style="stroke:var(--ga-blue-200)" stroke-opacity=".4" stroke-width="1"/></pattern></defs><rect width="1000" height="562.5" fill="url(#mapping-guide-grid)"/>{/if}
              {#each show.surfaces as s, i}<polyline
                  points={meshPath(s)}
                  class:chosen={i === selectedSurface}
                  class:dim={!s.enabled}
                /><text x={s.points[0].x * 1000 + 12} y={s.points[0].y * 562.5 + 28}>{i + 1} · {s.name}</text>{/each}
              {#if surface?.mode === 'mesh'}{#each [0, 1, 2] as row}<polyline
                    class="mesh-line"
                    points={[0, 1, 2]
                      .map((c) => `${surface.points[row * 3 + c].x * 1000},${surface.points[row * 3 + c].y * 562.5}`)
                      .join(' ')}
                  /><polyline
                    class="mesh-line"
                    points={[0, 1, 2]
                      .map((c) => `${surface.points[c * 3 + row].x * 1000},${surface.points[c * 3 + row].y * 562.5}`)
                      .join(' ')}
                  />{/each}{/if}
            </svg>
            {#if mappingTool==='edit' && surface && !surface.locked}{#each surface.points as p, i}{#if surface.mode === 'mesh' || [0, 2, 6, 8].includes(i)}<button
                    class="warp-handle"
                    class:selected={selectedPoint === i}
                    style:left={`${p.x * 100}%`}
                    style:top={`${p.y * 100}%`}
                    aria-label={`Warp point ${i + 1}`}
                    onpointerdown={(e) => beginDrag(e, i)}
                    onpointermove={dragPoint}
                    onpointerup={endDrag}
                    onpointercancel={endDrag}><span></span></button
                  >{/if}{/each}{/if}
          {/if}
          {#if tab==='flux' && !clean && !visualsDown}<FluxPad value={flux} onchange={value=>{flux=value;if(engine)engine.flux=value;}}/>{/if}
          {#if tab==='map' && mappingTool==='paint' && show.mapping && !clean}
            <PaintPad surfaces={show.surfaces} config={paint} beat={()=>engine?.beatClock?.()??0} onstroke={startStroke} onfinish={finishStroke} onlimit={()=>flash('Paint memory is full. Clear or undo strokes to keep drawing.')}/>
          {/if}
        </div>
      </div>
      <div class="monitor-tools">
        {#if !tablet && tab!=='map' && tab!=='flux'}<button class="preview-toggle" aria-label={compactPreview?'Expand preview':'Compact preview'} aria-pressed={compactPreview} onclick={()=>compactPreview=!compactPreview}><Icon name="eye" size={16}/></button>{/if}
        {#if interactiveLive}<button onclick={openInteractive}>Interactive</button><button onclick={()=>interactiveWorkspace?.restoreMix()}>Return to mix</button>{/if}
        <span>{tab === 'map' ? mappingTool==='paint'?'PAINT · '+paint.brush.toUpperCase():show.mapping?'Drag points to fit your surface':'MAPPING OFF · OUTPUT UNCHANGED' : interactiveLive?'DECK PREVIEW · INTERACTIVE ON OUTPUT':tab==='flux'?'FLUX · PLAY ON THE PICTURE':'LIVE COMPOSITION'}</span><button
          class:active={frozen}
          onclick={setFrozen}
          aria-pressed={frozen}><Icon name={frozen ? 'play' : 'pause'} size={16} />{frozen ? 'Resume' : 'Hold'}</button
        ><button class:danger={blackout} onclick={setBlackout} aria-pressed={blackout}
          ><Icon name="blackout" size={16} />Blackout</button
        >
      </div>
      {#if tablet && tab==='perform' && !clean}<PerformanceMixer embedded {show} {selectedLayer} onstart={checkpoint} onselect={changeLayer} oncontrols={openControls} onclose={()=>mixerOpen=false} onchange={(i,patch)=>{show.layers[i]={...show.layers[i],...patch};persist();}} onmaster={value=>{show.master=value;persist();}} oncrossfade={value=>{show.crossfade=value;persist();}} oncrossfadesettings={value=>{show.crossfadeSettings=value;persist();}} />{/if}
    </section>
    <section class="control-panel">

      <div class="panel-scroll" inert={clipControlsOpen && !dockedInspector && layoutInfo.inspector!=='bottom'}>
        {#if tab === 'perform'}
          {#if !prefs.coachDone && !clean}<CoachStrip step={coach.step} onclose={()=>setPrefs({coachDone:true})}/>{/if}
          <div class="perform-actions"><button onclick={()=>openControls(selectedLayer)} aria-expanded={clipControlsOpen || dockedInspector}><Icon name="controls" size={18}/>Controls <span>L{selectedLayer+1}</span></button><button class="add-clip" data-add-clip aria-haspopup="dialog" onclick={()=>openPicker()}><Icon name="plus" size={18}/>Add</button></div>
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
              onDual={(enabled) => { checkpoint();autoEvent('settings'); show.dualDeck = enabled;if(!enabled&&selectedLayer>=4)changeLayer(0); persist(); }}
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
              onselect={selectBlock} onadd={newBlock} onrename={renameBlockTab} onduplicate={copyBlock} ondelete={deleteBlockTab} />
          <div class="autopilot-bar" slot="autopilot">
            <button class:running={autoOn} class:paused={autoPaused} aria-pressed={autoOn} aria-label={autoPaused?'Resume Autopilot':autoOn?'Turn Autopilot off':'Turn Autopilot on'} disabled={!autoClips&&!autoParams} onclick={()=>autoOn?stopAuto():startAuto()}><Icon name="autopilot" size={18}/><strong>Auto</strong><span>{autoOn?'ON':autoPaused?'PAUSED':'OFF'}</span></button>
            <button class="auto-settings" aria-label="Autopilot settings" aria-expanded={autoSettings} onclick={()=>autoSettings=!autoSettings}><Icon name="settings" size={18}/></button>
          </div>
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
          <div class="panel-heading">
            <div>
              <span class="eyebrow">PROJECTION WORKSPACE</span>
              <h1>Screen mapping</h1>
            </div>
            <button class="icon-button primary" onclick={() => addSurface()} aria-label="Add surface"
              ><Icon name="plus" /></button
            >
          </div>
          <div class="segmented wide mapping-tools">
            <button class:active={mappingTool==='edit'} onclick={()=>mappingTool='edit'}><Icon name="map" size={17}/>Edit screens</button>
            <button class:active={mappingTool==='paint'} onclick={paintMode}><Icon name="paint" size={17}/>Paint</button>
          </div>
          {#if mappingTool==='paint'}<PaintPanel onselect={index=>selectedSurface=index} value={paint} surfaces={show.surfaces} selected={selectedSurface} onchange={patchPaint} onundo={()=>{checkpoint();patchPaint({strokes:paint.strokes.slice(0,-1)});}} onclear={()=>{checkpoint();patchPaint({strokes:[],loop:false});}}/>{/if}
          {#if !show.mapping}<p class="hint mapping-off-hint" role="status">Mapping is off, so your output is unchanged. Turn it on here, or move a corner to start.</p>{/if}
          <div class="mapping-toolbar">
            <button
              class:active={show.mapping}
              aria-pressed={show.mapping}
              onclick={() => {
                checkpoint();
                show.mapping = !show.mapping;
                persist();
              }}>{show.mapping ? 'Mapping on' : 'Mapping off'}</button
            ><button class:active={mappingGrid} aria-pressed={mappingGrid} onclick={()=>mappingGrid=!mappingGrid}><Icon name="grid" size={16}/>Grid</button><button class:active={mappingSnap} aria-pressed={mappingSnap} onclick={()=>mappingSnap=!mappingSnap}><Icon name="snap" size={16}/>Snap</button><button class:active={testGrid} onclick={toggleGrid}><Icon name="grid" size={16} />Test grid</button
            ><select
              aria-label="Stage layout preset"
              value=""
              onchange={(e) => {
                if (e.currentTarget.value) addSurface(e.currentTarget.value);
                e.currentTarget.value = '';
              }}
              ><option value="">Layouts…</option><option value="split">Two panels</option><option value="triptych"
                >Triptych</option><option value="paint-box">Paint box · linked faces</option
              ></select
            >
          </div>
          <div class="surface-list">
            {#each show.surfaces as s, i}<button
                class:active={selectedSurface === i}
                onclick={() => {
                  selectedSurface = i;
                  selectedPoint = 0;
                }}
                ><span class="surface-index">{i + 1}</span><span
                  ><strong>{s.name}</strong><small
                    >{s.source === 'mix' ? 'Full composition' : `Layer ${(show.dualDeck ? s.source % 4 : s.source) + 1}${show.dualDeck ? " · A/B" : ""}`} · {s.mode === 'mesh'
                      ? 'Mesh'
                      : 'Corners'}</small
                  ></span
                >{#if s.locked}<Icon name="lock" size={16} />{/if}<i class:lit={s.enabled}></i></button
              >{/each}
          </div>
          {#if surface && mappingTool==='edit'}<div class="inspector-card">
              <div class="section-heading">
                <span>SURFACE {selectedSurface + 1}</span>
                <div class="inline">
                  <button
                    class="icon-button"
                    class:active={surface.locked}
                    onclick={() => {
                      checkpoint();
                      patchSurface({ locked: !surface.locked });
                    }}
                    aria-label="Lock surface"><Icon name={surface.locked ? 'lock' : 'unlock'} size={17} /></button
                  ><button
                    class="icon-button"
                    class:active={surface.enabled}
                    onclick={() => {
                      checkpoint();
                      patchSurface({ enabled: !surface.enabled });
                    }}
                    aria-label="Toggle surface visibility"><Icon name="eye" size={17} /></button
                  >
                </div>
              </div>
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
                    value={surface.source === 'mix' ? 'mix' : show.dualDeck ? surface.source % 4 : surface.source}
                    onchange={(e) => {
                      checkpoint();
                      patchSurface({ source: e.currentTarget.value === 'mix' ? 'mix' : Number(e.currentTarget.value) });
                    }}
                    ><option value="mix">Full composition</option>{#each show.layers.slice(0,4) as _, i}<option value={i}
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
              <div class="segmented wide">
                <button
                  class:active={surface.mode === 'corners'}
                  disabled={surface.locked}
                  onclick={() => {
                    checkpoint();
                    patchSurface({ mode: 'corners' });
                    selectedPoint = 0;
                  }}>Corner warp</button
                ><button
                  class:active={surface.mode === 'mesh'}
                  disabled={surface.locked}
                  onclick={() => {
                    checkpoint();
                    patchSurface({ mode: 'mesh' });
                  }}>3 × 3 mesh</button
                >
              </div>
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
              <LookControls value={surface.look} onchange={(look) => { checkpoint(); patchSurface({look}); }} onapplyall={() => {checkpoint(); show.surfaces = show.surfaces.map(s => ({...s,look:copy(surface.look)}));persist();}} />
              <div class="nudge">
                <span>Point {selectedPoint + 1}<small>Tap to step, hold to repeat</small></span>
                <div class="nudge-steps" role="group" aria-label="Nudge step size">{#each [{step:0.001,label:'0.1%'},{step:0.01,label:'1%'}] as option}<button data-nudge-step class:active={nudgeStep===option.step} aria-pressed={nudgeStep===option.step} onclick={()=>nudgeStep=option.step}>{option.label}</button>{/each}</div>
                {#each [{x:-1,y:0,label:'Nudge left',glyph:'←'},{x:0,y:-1,label:'Nudge up',glyph:'↑'},{x:0,y:1,label:'Nudge down',glyph:'↓'},{x:1,y:0,label:'Nudge right',glyph:'→'}] as arrow}<button class="nudge-arrow" disabled={surface.locked} aria-label={arrow.label} use:holdRepeat={{start:checkpoint,step:()=>nudge(arrow.x*nudgeStep,arrow.y*nudgeStep)}}>{arrow.glyph}</button>{/each}
              </div>
              <div class="card-actions">
                <button
                  disabled={surface.locked}
                  onclick={() => {
                    checkpoint();
                    patchSurface({ points: fullFramePoints() });
                  }}>Reset geometry</button
                ><button
                  onclick={() => {
                    checkpoint();
                    show.surfaces = show.surfaces.filter((_, i) => i !== selectedSurface);
                    selectedSurface = Math.max(0, selectedSurface - 1);
                    persist();
                  }}><Icon name="trash" size={16} />Remove</button
                >
              </div>
            </div>{/if}
          <p class="hint">
            Route one layer to several surfaces. Warp points move the actual image, including outside its original
            rectangle. Mapping remains live during clip changes.
          </p>
        {:else if tab === 'fx'}
          {@render sourceControls()}
        {/if}
      </div>
    </section>
      {#if clipControlsOpen || dockedInspector}
        <section class="clip-controls-tray" aria-label="Clip controls" use:focusControlsTray>
          <header class="clip-controls-header">
            <div><span class="eyebrow">{show.dualDeck ? `DECK ${selectedLayer < 4 ? 'A' : 'B'} · LAYER ${selectedLayer % 4 + 1}` : `LAYER ${selectedLayer + 1}`}</span><h2>{activeClip?.name || 'No clip playing'}</h2></div>
            {#if !dockedInspector}<button class="icon-button" data-close-controls aria-label="Close clip controls" onclick={closeControls}><Icon name="close" size={20}/></button>{/if}
          </header>
          {#if frozen || blackout}<div class="controls-notice" role="status">{blackout?'Output is blacked out.':'Output is held.'} Changes appear when you resume.<button onclick={()=>{if(blackout)setBlackout();if(frozen)setFrozen();}}>Resume</button></div>{:else if activeClip && (!layer.enabled || layer.opacity === 0)}<p class="controls-notice" role="status">This layer is muted. Raise its level in Mix to see your changes.</p>{:else if show.dualDeck && (selectedLayer < 4 ? show.crossfade === 1 : show.crossfade === 0)}<p class="controls-notice" role="status">This deck is faded out. Move the A/B crossfader to see your changes.</p>{/if}
          {#if autoOn && autoRows[selectedLayer]}<p class="controls-notice" role="status">Autopilot is on. This row keeps its clip while Controls is open.</p>{/if}
          <div class="clip-controls-body">{@render sourceControls(true)}</div>
        </section>
      {/if}
  </main>
  {#if mixerOpen && !tablet}<PerformanceMixer {show} {selectedLayer} onstart={checkpoint} onselect={changeLayer} oncontrols={openControls} onclose={()=>mixerOpen=false} onchange={(i,patch)=>{show.layers[i]={...show.layers[i],...patch};persist();}} onmaster={value=>{show.master=value;persist();}} oncrossfade={value=>{show.crossfade=value;persist();}} oncrossfadesettings={value=>{show.crossfadeSettings=value;persist();}} />{/if}
  {#if tempoOpen}<div class="tempo-sheet" role="dialog" aria-label="Tempo and audio" style={`left:${tempoAnchor.left}px;bottom:${tempoAnchor.bottom}px`}>
    <header><strong>TEMPO AND AUDIO</strong><button class="icon-button" aria-label="Close tempo and audio" onclick={() => (tempoOpen = false)}><Icon name="close" size={18} /></button></header>
    <div class="tempo-sheet-row">
      <button class="tap" onclick={tap}>Tap tempo</button>
      <div class="beat-dots" aria-hidden="true">{#each [0, 1, 2, 3] as n}<i class:lit={beat === n}></i>{/each}</div>
      <output>{show.bpm} BPM</output>
    </div>
    <button class="mic-toggle" class:active={mic} aria-pressed={mic} disabled={micBusy} onclick={toggleMic} aria-label={mic ? 'Disable microphone' : 'Enable microphone'}><Icon name="mic" size={18} /><span>{mic ? 'Microphone on' : 'Microphone off'}</span></button>
    <p>Tap in time to set the tempo. The microphone drives Audio response on every clip.</p>
  </div>{/if}
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
    <div class="tempo">
      <div class="beat-dots">
        {#each [0, 1, 2, 3] as n}<i class:lit={beat === n}></i>{/each}
      </div>
      <label
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
      ><button
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
    <div class="master-actions">{#if flux.active}<button aria-label="Release Flux" onclick={()=>{flux={...flux,active:false,latch:false};if(engine)engine.flux=flux;}}>FX off</button>{/if}{#if !tablet}<button class:active={mixerOpen} onclick={()=>mixerOpen=!mixerOpen} aria-label="Open performance mixer">Mix</button>{/if}
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
      <span>{error}</span><button class="icon-button" onclick={() => (error = '')} aria-label="Dismiss error"
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
{#if toolkitOpen}<CaptureToolkit mappingSurfaces={show.surfaces} oninteractive={()=>{toolkitOpen=false;openInteractive();}} oninteractiveoutput={interactiveOutput} {oncompanion} onclose={()=>toolkitOpen=false} onprepare={prepareCaptureTool} onshots={importCameraShots}/>{/if}
{#if interactiveMounted}<MobileInteractiveWorkspace bind:this={interactiveWorkspace} open={interactiveOpen} outputLevel={show.master} outputHeld={frozen} outputBlackout={blackout} mappingSurfaces={show.surfaces} outputLabel={blackout&&interactiveLive?'Blackout active':frozen&&interactiveLive?'Output held':outputStatus.state==='live'?`Live · ${outputStatus.display?.name??'External display'}`:outputStatus.state==='connecting'?'Connecting…':outputStatus.state==='off'?'External output disabled':outputStatus.state==='error'?outputStatus.message??'Output needs attention':'No external display connected'} onpreparecamera={prepareCaptureTool} onoutput={interactiveOutput} onoutputsettings={()=>outputSettings=true} onclose={()=>interactiveOpen=false}/>{/if}
{#if outputSettings}<OutputPanel source={interactiveLive?'interactive':'mix'} status={outputStatus} preferences={outputPreferences} quality={show.quality} onpreferences={value=>{outputPreferences=value;externalOutput?.configure(value);}} onquality={quality=>{show.quality=quality;persist();}} onwireless={()=>externalOutput?.chooseWireless()} onclose={()=>outputSettings=false} onretry={()=>externalOutput?.retry()} onpreview={()=>{outputSettings=false;if(interactiveLive){interactiveOpen=true;interactiveWorkspace?.previewOutput();}else clean=true;}}/>{/if}
{#if settings}<div class="modal-backdrop" role="presentation">
    <div
      class="settings-dialog"
      use:focusDialog
      role="dialog"
      aria-modal="true"
      aria-label="Set and output settings"
      tabindex="-1"
    >
      <div class="panel-heading">
        <div>
          <span class="eyebrow">GHOST ARCADE</span>
          <h1>Your set, your stage</h1>
        </div>
        <button class="icon-button" onclick={() => (settings = false)} aria-label="Close settings"
          ><Icon name="close" /></button
        >
      </div>
      <label class="field">Set name<input bind:value={show.name} oninput={persist} /></label>
      <div class="saved-sets" role="group" aria-label="Sets saved on this device">
        <span class="eyebrow">SAVED ON THIS DEVICE · {setList.length} OF {MAX_SAVED_SETS}</span>
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
              <button class="icon-button" data-set-delete aria-label={`Delete ${name}`} disabled={current} title={current ? 'Open another set first' : 'Delete set'} onclick={() => (setEdit = { id: set.id, mode: 'delete', name })}><Icon name="trash" size={16} /></button>
            {/if}
          </div>
        {/each}
      </div>
      <div class="field-grid">
        <button data-export-set disabled={exporting} onclick={exportSet}><Icon name="save" />{exporting ? 'Exporting…' : 'Export set'}</button><button onclick={() => setInput.click()}
          ><Icon name="upload" />Open set</button
        >
      </div>
      <p class="hint">
        Automatically saved on this device. Set files contain your layout, clips, and scenes; imported media must also
        exist on the receiving device.
      </p>
      <label class="field"
        >Output quality<select bind:value={show.quality} onchange={persist}
          ><option value={540}>540p · longer sessions</option><option value={720}>720p · balanced</option><option
            value={1080}>1080p · maximum detail</option
          ></select
        ></label
      >
      <p class="hint" data-quality-hint>This is the output size. One playing shader renders at that size and several share it, each a little smaller. If the frame rate drops, shader detail lowers itself and the monitor shows it, then returns when there is room.{#if detail < 1} Detail is at {Math.round(detail * 100)}% now.{/if}</p>
      <div class="info-card">
        <Icon name="output" />
        <div>
          <strong>Project with clean output</strong>
          <p>
            Open Output settings in the header to configure a wireless or wired display. Connected displays receive only the finished composition; controls stay on this device.
          </p>
          <button
            onclick={() => {
              settings = false;
              outputSettings = true;
            }}>Output settings</button
          >
        </div>
      </div>
      <div class="feel-card" role="group" aria-label="Touch and feel">
        <span class="eyebrow">TOUCH AND FEEL</span>
        <label class="switch-row"><span><strong>Haptics</strong><small>A light tap when you launch, stop, black out or switch tabs. iPhone only.</small></span><input type="checkbox" role="switch" data-pref-haptics checked={prefs.haptics} onchange={(e)=>{setPrefs({haptics:e.currentTarget.checked});feel(prefs,'switch');}} /></label>
        <label class="switch-row"><span><strong>Launch on touch-down</strong><small>Clips start the moment your finger lands, not when it lifts. A swipe that starts on a clip launches it too.</small></span><input type="checkbox" role="switch" data-pref-touchdown checked={prefs.launchOnTouchDown} onchange={(e)=>setPrefs({launchOnTouchDown:e.currentTarget.checked})} /></label>
      </div>
      <div class="storage-card" role="group" aria-label="Storage on this device">
        <span class="eyebrow">STORAGE ON THIS DEVICE</span>
        {#if storage}
          <p data-storage-summary>{setList.length} set{setList.length === 1 ? '' : 's'} · {storage.files} imported file{storage.files === 1 ? '' : 's'}, {formatBytes(storage.bytes)}{#if storage.unused.length}{' · '}{storage.unused.length} not used by any set, {formatBytes(storage.unusedBytes)}{/if}</p>
          {#if mediaConfirm}
            <div class="confirm-row"><span>Delete {storage.unused.length} unused file{storage.unused.length === 1 ? '' : 's'}? This cannot be undone.</span><button class="danger" data-media-delete-confirm disabled={storageBusy} onclick={deleteUnusedMedia}>Delete</button><button onclick={() => (mediaConfirm = false)}>Cancel</button></div>
          {:else if storage.unused.length}
            <button data-media-delete disabled={storageBusy} onclick={() => (mediaConfirm = true)}><Icon name="trash" size={16} />Delete unused media</button>
          {:else}<p class="hint">Every imported file is used by a saved set.</p>{/if}
        {:else}<p class="hint">Media storage is not available right now.</p>{/if}
      </div>
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
  .autopilot-bar button span{font:10px ui-monospace;color:#a6adb9;}
  .autopilot-bar button.running{color:#b7f375;background:#24311c;border-radius:4px;}
  .autopilot-bar button.running span{color:#b7f375;}
  .autopilot-bar button.paused{color:#ffc570;}
  .autopilot-bar button.paused span{color:#ffc570;}
  .auto-options{padding:12px;border:1px solid var(--ga-line-2);border-radius:6px;margin-bottom:10px;background:var(--ga-card);}
  .auto-switches,.auto-fields,.auto-rows{display:flex;gap:8px;margin-bottom:10px;}
  .auto-switches button{display:flex;align-items:center;justify-content:center;gap:8px;flex:1;min-height:44px;}
  .auto-fields label{flex:1;min-width:0;display:grid;gap:6px;font-size:11px;color:var(--ga-ink-2);}
  .auto-fields select{width:100%;font-size:12px;min-height:44px;}
  .auto-amount{display:grid;grid-template-columns:1fr auto;align-items:center;font-size:12px;}
  .auto-amount input{grid-column:1/-1;}
  .auto-amount output{color:#b7f375;font:11px ui-monospace;}
  .auto-rows button{flex:1;min-height:44px;}
  .auto-options p{font-size:11px;color:#a6adb9;line-height:1.5;margin:4px 0;}

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
    background: var(--ga-coral-soft);
    border-color: var(--ga-coral-line);
    color: var(--ga-coral);
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
    font-size: 11px;
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
    font-size: 10px;
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
    font-size: 9px;
    letter-spacing: 1px;
    color: var(--muted);
  }
  .monitor-tools button {
    font-size: 11px;
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
    font-size: 10px;
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
    font-size: 11px;
    letter-spacing: 0;
    font-weight: 500;
    background: transparent;
    padding: 4px 8px;
    min-height: 32px;
  }
  .section-heading select {
    font-size: 12px;
    letter-spacing: 0;
    min-height: 36px;
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
    font-size: 8px;
    letter-spacing: 0.6px;
    color: var(--muted);
  }
  .channel > strong {
    display: block;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    font-size: 10px;
    font-weight: 500;
    color: var(--ga-ink-1);
    margin: 12px 0 5px;
  }
  .channel-bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .channel-bottom button {
    min-height: 28px;
    padding: 2px 6px;
    font-size: 8px;
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
    font-size: 9px;
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
    font-size: 11px;
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
    font-size: 10px;
  }
  .layer-tabs button > span {
    color: var(--ga-ink-0);
    font-weight: 700;
  }
  .layer-tabs button > small {
    margin-left: auto;
    font-size: 8px;
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
    font-size: 9px;
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
    font-size: 11px;
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
      11px ui-monospace,
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
    font-size: 11px;
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
    font-size: 11px;
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
  .mapping-lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .mapping-lines polyline {
    fill: none;
    stroke: var(--ga-blue-300);
    stroke-width: 1;
    stroke-dasharray: 6 5;
    vector-effect: non-scaling-stroke;
  }
  .mapping-lines polyline.chosen {
    stroke: var(--ga-blue-200);
    stroke-width: 2;
    stroke-dasharray: none;
  }
  .mapping-lines polyline.dim {
    opacity: 0.3;
  }
  .mapping-lines text {
    font-size: 17px;
    fill: #e3edff;
    paint-order: stroke;
    stroke: var(--ga-blue-900);
    stroke-width: 3px;
  }
  .mapping-lines polyline.mesh-line {
    stroke: var(--ga-blue-300);
    opacity: 0.6;
    stroke-width: 1;
    stroke-dasharray: none;
  }
  .warp-handle {
    box-shadow: none;
    position: absolute;
    transform: translate(-50%, -50%);
    width: 44px;
    height: 44px;
    border: 0 !important;
    background: none !important;
    padding: 0;
    touch-action: none;
    z-index: 2;
  }
  .warp-handle span {
    width: 14px;
    height: 14px;
    border: 2px solid #e4f0ff;
    border-radius: 50%;
    background: var(--ga-blue-400);
    box-shadow: 0 0 0 4px #07101b66;
  }
  .warp-handle.selected span {
    background: #91f0d0;
    border-color: #fff;
    box-shadow: 0 0 0 5px #7decc32a;
  }
  .mapping-toolbar {
    display: flex;
    gap: 7px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .mapping-toolbar button,
  .mapping-toolbar select {
    font-size: 11px;
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
  .surface-list > button.active {
    background: var(--ga-selection-bg);
    border-color: var(--ga-selection-line);
  }
  .surface-index {
    color: var(--ga-ink-0);
    font-size: 11px;
    border: 1px solid var(--ga-line-3);
    border-radius: 4px;
    width: 24px;
    height: 24px;
    display: grid;
    place-content: center;
    flex: none;
  }
  .surface-list strong {
    font-size: 11px;
    display: block;
    font-weight: 550;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    max-width: 120px;
  }
  .surface-list small {
    font-size: 9px;
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
  .nudge {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 16px 0;
  }
  .nudge > span {
    font-size: 11px;
    margin-right: auto;
    color: var(--ga-ink-1);
  }
  .nudge small {
    display: block;
    font-size: 8px;
    color: var(--ga-ink-2);
    margin-top: 3px;
  }
  .nudge button {
    min-height: 36px;
    width: 36px;
    padding: 0;
    font-size: 16px;
  }
  /* Label on its own line, then step size and the four arrows together on one row. */
  .nudge { flex-wrap: wrap; row-gap: 8px; }
  .nudge > span { flex: 1 1 100%; margin-right: 0; }
  .nudge .nudge-arrow { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  .nudge-steps { display: flex; gap: 2px; margin-right: auto; }
  .nudge .nudge-steps button { width: auto; min-width: 40px; padding: 0 7px; font-size: 11px; }
  .nudge .nudge-steps button.active { background: var(--ga-selection-bg); border-color: var(--ga-selection-line); color: var(--ga-selection-ink); }
  .card-actions {
    display: flex;
    justify-content: space-between;
    border-top: 1px solid var(--ga-line-2);
    padding-top: 14px;
    margin-top: 14px;
  }
  .card-actions button {
    font-size: 10px;
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
    font-size: 10px;
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
    font-size: 9px;
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
    min-height: 36px;
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
    width: 30px;
    height: 30px;
    min-height: 30px;
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
  .set-row .set-open small { font-size: 10px; color: var(--ga-ink-2); }
  .set-row.current .set-open { border-color: var(--ga-selection-line); background: var(--ga-selection-bg); opacity: 1; }
  .set-row input { flex: 1; min-width: 0; min-height: 44px; }
  .set-confirm { flex: 1; min-width: 0; font-size: 12px; line-height: 1.4; color: var(--ga-ink-0); }
  .confirm-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; line-height: 1.4; }
  .confirm-row span { flex: 1 1 180px; min-width: 0; }
  .confirm-row button { min-height: 44px; }
  .info-card {
    display: flex;
    gap: 14px;
    padding: 17px;
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-soft);
    margin: 20px 0;
    background: var(--ga-sub);
  }
  .info-card > :global(svg) {
    flex: none;
    color: var(--ga-blue);
  }
  .info-card strong {
    font-size: 13px;
  }
  .info-card p {
    font-size: 11px;
    color: var(--ga-ink-1);
    line-height: 1.7;
    margin: 8px 0 12px;
  }
  .info-card button {
    font-size: 11px;
  }
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
      font-size: 9px;
    }
    .panel-heading h1 {
      font-size: 15px;
    }
    .tabs {
      padding: 0;
    }
    .tabs button {
      font-size: 10px;
      gap: 5px;
    }
    .master-level {
      display: none;
    }
    .pad-name strong {
      font-size: 11px;
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
      font-size: 11px;
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
      font-size: 9px;
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
      font-size: 8px;
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
      font-size: 8px;
      letter-spacing: 0.5px;
    }
    .monitor-tools button {
      font-size: 10px;
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
      font-size: 9px;
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
      font-size: 8px;
      margin-bottom: 5px;
      letter-spacing: 1.3px;
    }
    .segmented button {
      font-size: 10px;
      padding: 5px 8px;
      min-height: 28px;
    }
    .layer-tabs {
      gap: 5px;
      margin-bottom: 12px;
    }
    .layer-tabs button {
      min-height: 38px;
      font-size: 10px;
    }
    
    
    .pad-name {
      bottom: 9px;
      left: 9px;
    }
    .pad-name strong {
      font-size: 10px;
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
      font-size: 9px;
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
      font-size: 10px;
    }
    .range-row output {
      font-size: 10px;
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
    .nudge button {
      width: 35px;
      height: 39px;
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
    .range-row>input[type='range'], .range-row>select {grid-column:1/-1;grid-row:2;min-height:48px;}
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
  .clip-controls-header>div{min-width:0;}.clip-controls-header h2{font-size:15px;line-height:1.3;overflow-wrap:anywhere;}.clip-controls-header .eyebrow{margin-bottom:3px;font-size:9px;}.clip-controls-header .icon-button{width:44px;height:44px;min-height:44px;}
  .clip-controls-body{flex:1;min-height:0;min-width:0;padding:12px 14px max(18px,env(safe-area-inset-bottom));overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}
  .clip-controls-body .segmented{margin:0 0 12px;}.clip-controls-body .segmented button{min-height:44px;font-size:12px;}.clip-controls-body .inspector-card{margin-top:12px;}.clip-controls-body .range-row{display:grid;min-width:0;grid-template-columns:minmax(0,1fr) 52px;gap:0 10px;}.clip-controls-body .range-row>span{width:auto;min-width:0;font-size:12px;grid-column:1;grid-row:1;overflow:visible;overflow-wrap:anywhere;}.clip-controls-body .range-row>output{width:auto;font-size:12px;grid-column:2;grid-row:1;}.clip-controls-body .range-row>input,.clip-controls-body .range-row>select{grid-column:1/-1;grid-row:2;width:100%;min-width:0;min-height:44px;}.clip-controls-body .section-heading{flex-wrap:wrap;gap:8px;}.clip-controls-body .section-heading button{min-height:44px;}.clip-controls-body .toggle-row{min-height:44px;gap:12px;}.clip-controls-body .toggle-row>span{min-width:0;overflow-wrap:anywhere;}
  .controls-notice{display:flex;align-items:center;gap:8px;flex:none;margin:0;padding:8px 14px;background:var(--ga-coral-soft);color:var(--ga-coral);font-size:11px;line-height:1.4;}.controls-notice button{min-height:44px;margin-left:auto;}
  @keyframes controls-in{from{transform:translateY(32px);opacity:0;}to{transform:translateY(0);opacity:1;}}
  .clip-controls-body .look-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;}
  .clip-controls-body .look-actions button{width:100%;min-height:44px;}
  @media(max-width:760px) and (max-height:650px){.studio.clip-editing .monitor{padding-top:8px;}.studio.clip-editing .preview-frame{max-width:min(100%,34dvh);}.clip-controls-header{padding-top:6px;padding-bottom:6px;}}
  @media(prefers-reduced-motion:reduce){.clip-controls-tray{animation:none;}}
  /* Effect chain: one card per effect, with a drag handle to reorder. */
  .add-effect{display:flex;align-items:center;gap:6px;min-height:44px!important;padding:0 14px!important;font-size:13px!important;font-weight:650!important;background:var(--ga-selection-bg)!important;border-color:var(--ga-selection-line);color:var(--ga-selection-ink);}
  .effect-chain{display:grid;gap:0;}
  .effect-heading{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;gap:6px;}
  .effect-heading .reorder-handle{display:grid;place-items:center;width:44px;height:44px;min-height:44px;padding:0;color:var(--ga-ink-1);touch-action:none;cursor:grab;border:1px solid var(--ga-line-2);border-radius:6px;}
  .effect-heading .reorder-handle:disabled{opacity:.3;}
  .effect-heading .effect-toggle{min-height:44px;justify-content:flex-start;text-align:left;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .effect-heading .icon-button{width:44px;height:44px;min-height:44px;}
</style>
