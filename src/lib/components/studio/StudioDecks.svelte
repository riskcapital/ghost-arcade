<script lang="ts">
  import Icon from './StudioIcon.svelte';
  import {onDestroy} from 'svelte';
  import type { Show, Clip, Layer } from '../../mobile/studio/model';
  import ClipThumbnail from './ClipThumbnail.svelte';
  export let show: Show;
  export let selectedLayer: number;
  export let pending: Record<number, {clip: Clip; at: number}>;
  export let loading: boolean[];
  export let onSelect: (row: number) => void;
  export let onControls: (row: number) => void;
  export let onLaunch: (row: number, clip: Clip) => void;
  export let onTap: (row:number,clip:Clip)=>void;
  export let onRemove:(row:number,column:number)=>void;
  export let onStop: (row: number) => void;
  export let onEdit: (row: number, column: number) => void;
  export let onMixer: (row:number)=>void;
  export let onDual: (enabled: boolean) => void;
  type Slot={row:number;column:number};
  export let onMove:(from:Slot,to:Slot)=>void;
  export let onArrange:()=>void;
  let picked:Slot|null=null;
  let drop:Slot|null=null;
  let drag:{id:number;from:Slot;clip:Clip;x:number;y:number;startX:number;startY:number;moving:boolean;el:HTMLElement}|null=null;
  let scrollFrame=0;
  const same=(a:Slot|null,b:Slot|null)=>!!a&&!!b&&a.row===b.row&&a.column===b.column;
  function targetAt(x:number,y:number):Slot|null{
    const el=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-clip-slot]');
    return el?{row:Number(el.dataset.row),column:Number(el.dataset.column)}:null;
  }
  function scrollDrag(){
    if(!drag?.moving)return;
    const el=document.elementFromPoint(drag.x,drag.y);
    const matrix=el?.closest<HTMLElement>('.matrix');
    if(matrix){const r=matrix.getBoundingClientRect();const left=r.left+100;
      matrix.scrollLeft+=drag.x>r.right-32?12:drag.x<left+20?-12:0;}
    let parent=el?.parentElement;
    while(parent){
      if(parent.scrollHeight>parent.clientHeight&&/auto|scroll/.test(getComputedStyle(parent).overflowY)){
        const r=parent.getBoundingClientRect();parent.scrollTop+=drag.y>r.bottom-40?10:drag.y<r.top+40?-10:0;break;
      }
      parent=parent.parentElement;
    }
    drop=targetAt(drag.x,drag.y);
    scrollFrame=requestAnimationFrame(scrollDrag);
  }
  function dragDown(e:PointerEvent,row:number,column:number,clip?:Clip){
    if(!arrange||!clip){holdPad(e,row,column,clip);return;}
    if(drag||e.button!==0)return;
    cancelHold();suppressTap=false;e.preventDefault();e.stopPropagation();
    const el=e.currentTarget as HTMLElement;el.setPointerCapture(e.pointerId);
    drag={id:e.pointerId,from:{row,column},clip,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moving:false,el};
    hold={id:e.pointerId,x:e.clientX,y:e.clientY,timer:setTimeout(()=>{cancelDrag();openMenu(row,column,clip);},500)};
  }
  function dragMove(e:PointerEvent){
    if(!drag||drag.id!==e.pointerId){movePad(e);return;}
    e.preventDefault();e.stopPropagation();drag={...drag,x:e.clientX,y:e.clientY};
    if(!drag.moving&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>7){cancelHold();drag.moving=true;picked=null;scrollFrame=requestAnimationFrame(scrollDrag);}
    if(drag.moving)drop=targetAt(e.clientX,e.clientY);
  }
  function dragEnd(e:PointerEvent){
    cancelHold();if(!drag||drag.id!==e.pointerId)return;
    e.stopPropagation();const d=drag;drag=null;cancelAnimationFrame(scrollFrame);drop=null;
    if(d.el.hasPointerCapture(d.id))d.el.releasePointerCapture(d.id);
    if(d.moving){
      suppressTap=true;
      const target=e.type==='pointerup'?targetAt(e.clientX,e.clientY):null;
      if(target&&!same(d.from,target))onMove(d.from,target);
    }else if(e.type==='pointerup'){
      // Tap-to-pick/drop is also available to keyboard and assistive input.
      suppressTap=true;arrangeTap(d.from,d.clip);
    }
  }
  function cancelDrag(){cancelHold();cancelAnimationFrame(scrollFrame);const d=drag;drag=null;drop=null;if(d?.el.hasPointerCapture(d.id))d.el.releasePointerCapture(d.id);}
  function arrangeTap(slot:Slot,clip?:Clip){
    if(picked){if(!same(picked,slot))onMove(picked,slot);picked=null;}
    else if(clip)picked=slot;
    else onEdit(slot.row,slot.column);
  }
  export let onMix: (value: number) => void;
  let dragStart: {x:number;scroll:number;id:number}|null=null;
  let dragged=false;
  function startDrag(e:PointerEvent){dragged=false;if(e.pointerType==='touch'||drag)return;dragStart={x:e.clientX,scroll:(e.currentTarget as HTMLElement).scrollLeft,id:e.pointerId};}
  function moveDrag(e:PointerEvent){if(!dragStart)return;const dx=e.clientX-dragStart.x;if(Math.abs(dx)>6){dragged=true;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);(e.currentTarget as HTMLElement).scrollLeft=dragStart.scroll-dx;}}
  let menu: {row:number;column:number;clip:Clip}|null=null;
  let dialog:HTMLDialogElement;
  let hold: {id:number;x:number;y:number;timer:ReturnType<typeof setTimeout>}|null=null;
  let suppressTap=false;
  function cancelHold(){if(hold)clearTimeout(hold.timer);hold=null;}
  function openMenu(row:number,column:number,clip:Clip){cancelHold();suppressTap=true;menu={row,column,clip};dialog.showModal();}
  function holdPad(e:PointerEvent,row:number,column:number,clip?:Clip){cancelHold();suppressTap=false;if(!clip||e.button!==0||!e.isPrimary)return;hold={id:e.pointerId,x:e.clientX,y:e.clientY,timer:setTimeout(()=>openMenu(row,column,clip),500)};}
  function movePad(e:PointerEvent){if(hold&&Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>10)cancelHold();}
  function closeMenu(){dialog.close();menu=null;}
  function menuAction(remove=false){const slot=menu;closeMenu();if(slot){if(remove)onRemove(slot.row,slot.column);else onEdit(slot.row,slot.column);}}
  onDestroy(()=>{cancelHold();cancelDrag();});
  let arrange = false;
  $: columnCount=Math.min(48,Math.max(8,...show.launchGrid.map(row=>row.length+1)));
  $: columns=Array.from({length:columnCount},(_,i)=>i);
  $: decks = show.dualDeck ? [[0, 1, 2, 3], [4, 5, 6, 7]] : [[0, 1, 2, 3]];
  function clipAt(row: number, column: number) { return show.clips.find(c => c.id === show.launchGrid[row]?.[column]); }
  function columnLaunch(rows: number[], column: number) {
    for (const row of rows) { const clip = clipAt(row, column); if (clip) onLaunch(row, clip); }
  }
</script>
<div class="deck-toolbar">
  <div class="deck-options"><div class="mode"><button class="deck-switch" class:active={show.dualDeck} aria-label="Dual decks" aria-pressed={show.dualDeck} title="A/B decks — toggle a second deck" onclick={() => {cancelDrag();picked=null;onDual(!show.dualDeck);}}><svg width="19" height="16" viewBox="0 0 24 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1" y="2" width="9" height="16" rx="2"/><rect x="14" y="2" width="9" height="16" rx="2"/></svg><strong>A/B</strong></button></div><slot name="autopilot"/></div>
  <div class="deck-actions"><slot name="view-switch"/><button class="arrange-toggle" aria-label={arrange?'Done arranging':'Arrange clips'} class:active={arrange} aria-pressed={arrange} onclick={() => {cancelDrag();picked=null;arrange=!arrange;onArrange();}}><Icon name={arrange?'check':'grid'} size={16}/><span class="arrange-label">{arrange ? 'Done arranging' : 'Arrange clips'}</span></button></div>
</div>
<slot name="autopilot-settings"/>
{#if arrange}<p class="arrange-help">{picked?'Tap a destination to move or swap. Tap the selected clip to cancel.':'Drag clips to move; drop on another to swap. Hold for Replace / Remove.'}</p>{/if}
<div class="decks" class:dual={show.dualDeck} class:arranging={arrange}>
  {#each decks as rows, deck}
    <section class="deck" aria-label={show.dualDeck ? `Deck ${deck === 0 ? 'A' : 'B'}` : 'Clip launcher'}>
      {#if show.dualDeck}<header><strong>{show.dualDeck ? `DECK ${deck === 0 ? 'A' : 'B'}` : 'CLIP LAUNCHER'}</strong><span>{show.dualDeck ? `${Math.round((deck === 0 ? 1 - show.crossfade : show.crossfade) * 100)}% OUTPUT` : 'LIVE MIX'}</span></header>{/if}
      <div class="matrix" style={`--columns:${columnCount}`} onpointerdown={startDrag} onpointermove={moveDrag} onpointerup={()=>dragStart=null} onpointercancel={()=>dragStart=null} onlostpointercapture={()=>dragStart=null} onclickcapture={e=>{if(dragged){e.preventDefault();e.stopPropagation();dragged=false;}}}>
        <div class="column-row"><span class="row-label">LAYERS</span>{#each columns as col}<button aria-label={`Launch ${show.dualDeck ? (deck === 0 ? 'A' : 'B') : 'deck'} column ${col + 1}`} onclick={() => columnLaunch(rows, col)} disabled={arrange}>▶ {col + 1}</button>{/each}</div>
        {#each rows as row}
          <div class="clip-row" class:selected={row === selectedLayer}>
            <div class="row-control">
              <button class="row-name" onclick={() => onSelect(row)} aria-label={`Select layer ${row+1}`} aria-pressed={selectedLayer === row}>L{show.dualDeck ? row % 4 + 1 : row + 1}</button>
              <button class="level-button" aria-label={`Mix row ${row+1}`} onclick={()=>onMixer(row)} style={`--level:${show.layers[row].opacity*100}%`}>{Math.round(show.layers[row].opacity*100)}%</button>
              <button class="stop" aria-label={`Stop row ${row + 1}`} onclick={() => onStop(row)}>■</button>
            </div>
            {#each columns as column}
              {@const clip = show.clips.find(c => c.id === show.launchGrid[row]?.[column])}
              <div class="clip-slot" data-clip-slot data-row={row} data-column={column}>
              <button class="pad" class:picked={same(picked,{row,column})} class:drag-source={!!drag?.moving&&same(drag.from,{row,column})} class:drop-target={same(drop,{row,column})} class:live={!!clip && show.layers[row].clipId === clip.id} class:queued={!!clip && pending[row]?.clip.id === clip.id} class:empty={!clip}
                aria-label={clip ? `${arrange ? 'Move' : show.layers[row].clipId===clip.id ? 'Select' : pending[row]?.clip.id===clip.id ? 'Select queued' : 'Launch'} ${clip.name} on row ${row + 1}` : `Add clip to row ${row + 1} column ${column + 1}`}
                onpointerdown={e=>dragDown(e,row,column,clip)} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd} onlostpointercapture={()=>{if(drag)cancelDrag();}}
                oncontextmenu={e=>{if(clip){e.preventDefault();openMenu(row,column,clip);}}}
                onkeydown={e=>{if(clip&&(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))){e.preventDefault();openMenu(row,column,clip);}}}
                onclick={() => { if(suppressTap){suppressTap=false;return;} if(arrange)arrangeTap({row,column},clip);else if(!clip)onEdit(row,column);else onTap(row,clip); }}>
                {#if clip}{#key clip.id}<ClipThumbnail {clip}/>{/key}{#if arrange}<span class="drag-grip" aria-hidden="true">⠿</span>{/if}<span class="status-dot" aria-hidden="true"></span>{:else}<span class="plus">+</span>{/if}
              </button>
              {#if clip && show.layers[row].clipId === clip.id && !arrange}
                <button class="clip-settings" disabled={loading[row]} aria-label={`Edit ${clip.name} on ${show.dualDeck ? `Deck ${row < 4 ? 'A' : 'B'} · Layer ${row % 4 + 1}` : `Layer ${row + 1}`}`} title={`Edit ${clip.name}`} onpointerdown={e=>{e.stopPropagation();cancelHold();}} onclick={e=>{e.stopPropagation();e.currentTarget.focus({preventScroll:true});suppressTap=false;onControls(row);}}><Icon name="settings" size={16}/></button>
              {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>

{#if show.dualDeck}
  <div class="deck-mix"><button aria-label="Cut to deck A" onclick={() => onMix(0)}>A</button><div><label for="studio-deck-mix">DECK CROSSFADER <span>{Math.round((1-show.crossfade)*100)} / {Math.round(show.crossfade*100)}</span></label><input style={`--range-fill: ${show.crossfade}`} id="studio-deck-mix" aria-label="Deck mix" type="range" min="0" max="1" step=".001" value={show.crossfade} oninput={e => onMix(Number(e.currentTarget.value))} /></div><button aria-label="Cut to deck B" onclick={() => onMix(1)}>B</button></div>
{/if}
<dialog bind:this={dialog} class="clip-menu" aria-label="Clip actions" onclose={()=>menu=null} onclick={e=>{if(e.target===dialog)closeMenu();}}>
 {#if menu}<div class="menu-content"><strong>{menu.clip.name}</strong><span>L{menu.row+1} · Slot {menu.column+1}</span><button onclick={()=>menuAction()}>Replace clip</button><button class="remove" onclick={()=>menuAction(true)}>Remove clip</button><button onclick={closeMenu}>Cancel</button></div>{/if}
</dialog>
<p class="deck-hint">{arrange ? 'Drag or tap two slots to move / swap. Playing clips continue unchanged.' : 'Tap to play. Use the gear on a playing clip to edit its look. Double-tap a playing clip to stop. Hold to replace or remove.'}</p>
{#if drag?.moving}<div class="drag-preview" style:left={`${drag.x}px`} style:top={`${drag.y}px`}><ClipThumbnail clip={drag.clip}/><span>{drag.clip.name}</span></div>{/if}
<svelte:window onkeydown={e=>{if(e.key==='Escape'){cancelDrag();picked=null;}}} onblur={()=>{cancelDrag();picked=null;}}/>
<style>
 .clip-slot{position:relative;min-width:0;}
 .clip-slot .pad{width:100%;display:block;}
 .clip-settings{position:absolute;right:0;top:0;z-index:2;width:44px;height:44px;min-height:44px;padding:0;display:grid;place-items:center;background:transparent;border:0;box-shadow:none;color:var(--ga-ink-0);}
 .clip-settings::before{content:'';position:absolute;inset:7px;border:1px solid var(--ga-line-3);border-radius:6px;background:var(--ga-faceplate-bg);box-shadow:0 2px 8px #0008;}
 .clip-settings :global(svg){position:relative;pointer-events:none;}
 .clip-settings:hover::before,.clip-settings:focus-visible::before{background:var(--ga-selection-bg);border-color:var(--ga-selection-line);}
 .deck-switch{display:flex;align-items:center;gap:5px;white-space:nowrap}.deck-options,.deck-actions{min-width:0}.deck-toolbar{gap:4px}.deck-actions{flex-wrap:nowrap!important;gap:4px!important}

 .deck-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:nowrap}.deck-actions .arrange-toggle{margin-left:0}

 @media(max-width:450px){.arrange-label{display:none}.arrange-toggle{justify-content:center;min-width:44px;}}
 .deck-options{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;}
 .arrange-toggle{display:flex;align-items:center;gap:6px;margin-left:auto;}
 .deck-toolbar .deck-options button,.deck-toolbar .arrange-toggle{min-height:44px;}
 .arrange-help{font-size:11px;line-height:1.5;color:#bdc6d4;margin:0 0 8px;}
 .arranging .pad:not(.empty){touch-action:none;cursor:grab;}
 .arranging .pad.picked,.arranging .pad.drop-target{outline:2px solid #b7f375;outline-offset:-3px;}
 .arranging .pad.drag-source{opacity:.35;}
 .drag-grip{position:absolute;left:4px;top:3px;background:#0009;color:#fff;border-radius:3px;padding:0 4px;pointer-events:none;}
 .drag-preview{position:fixed;z-index:10000;width:82px;height:66px;transform:translate(-50%,-65%);pointer-events:none;border:2px solid #b7f375;border-radius:5px;overflow:hidden;background:#0c0e13;box-shadow:0 8px 24px #0009;}
 .drag-preview span{position:absolute;bottom:0;left:0;right:0;padding:3px;background:#000b;font-size:9px;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

 .clip-menu{position:fixed;inset:0;margin:auto;width:min(340px,calc(100% - 24px));max-height:80dvh;padding:0;border:1px solid var(--ga-line-3);border-radius:12px;background:var(--ga-inspector-bg);color:var(--ga-ink-0);box-shadow:0 16px 60px #000c;}
 .clip-menu::backdrop{background:#0009}.menu-content{display:grid;gap:8px;padding:18px}.menu-content strong{font-size:15px;overflow-wrap:anywhere}.menu-content span{font-size:11px;color:var(--ga-ink-2);margin-bottom:8px}.menu-content button{min-height:48px;font-size:14px}.menu-content .remove{color:#f3a6a6}.pad{-webkit-touch-callout:none;}

 .level-button{grid-column:1/-1;min-height:40px;background:linear-gradient(90deg,var(--ga-selection-bg) var(--level),var(--ga-slot) var(--level));font-size:11px}
  button, select { color:var(--ga-ink-0); background:var(--ga-hardware-bg); border:1px solid var(--ga-line-2); border-radius:var(--ga-r-hard); font:inherit; }
  button {cursor:pointer;min-height:40px;box-shadow:var(--ga-hardware-shadow);touch-action:manipulation}
  button:disabled {opacity:.4} button:hover:not(:disabled){border-color:var(--ga-line-3)}
  button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--ga-focus);outline-offset:2px}
  .deck-toolbar,.mode,.pages{display:flex;align-items:center;gap:6px}
  .deck-toolbar{justify-content:space-between;margin-bottom:12px;font-size:12px;flex-wrap:nowrap}
  .deck-toolbar button{padding:7px 10px}.active{background:var(--ga-selection-bg);border-color:var(--ga-selection-line);color:var(--ga-selection-ink)}
  .decks{display:grid;gap:12px}.decks.dual{grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))}
  .deck{min-width:0;background:var(--ga-void);border:1px solid var(--ga-line-2);border-radius:var(--ga-r-soft);overflow:hidden}
  header{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;font-size:11px;letter-spacing:.06em;background:var(--ga-faceplate-bg);border-bottom:1px solid var(--ga-line-2);box-shadow:inset 0 1px 0 var(--ga-line-2)}
  header span{font-size:10px;color:var(--ga-ink-2);letter-spacing:.02em}
  .matrix{overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;scrollbar-width:thin;padding:4px;}
  .column-row,.clip-row{display:grid;grid-template-columns:92px repeat(var(--columns),80px);gap:4px;width:max-content;margin-bottom:4px;}
  .clip-row:last-child{margin-bottom:0}.row-label{position:sticky;left:0;z-index:3;background:var(--ga-void);font-size:10px;display:grid;place-items:center;}
  .column-row button{min-height:44px;font-size:11px;}
  .row-control{position:sticky;left:0;z-index:3;display:grid;grid-template-columns:44px 1fr;grid-template-rows:30px 30px;gap:2px;padding:0;background:var(--ga-faceplate-bg);border:1px solid var(--ga-line-2);border-radius:4px;}
  .row-name{grid-row:1/3;grid-column:1;font-weight:650;min-height:0;}.level-button{grid-column:2;min-height:0;font-size:10px;}.stop{grid-column:2;min-height:0;font-size:10px;}
  .selected .row-control{border-color:var(--ga-selection-line)}.selected .row-name{background:var(--ga-selection-bg)}
  .pad{position:relative;isolation:isolate;height:64px;min-height:64px;padding:0;overflow:hidden;background:var(--ga-slot);box-shadow:none;user-select:none;touch-action:pan-x pan-y;}
  .pad img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;}
  .live{border:2px solid var(--ga-selection-line);box-shadow:inset 0 0 0 1px var(--ga-selection-line)}.status-dot{position:absolute;right:5px;bottom:5px;width:6px;height:6px;border-radius:50%;background:transparent;}.live .status-dot{background:var(--ga-green);box-shadow:0 0 0 2px #0008}.queued .status-dot{background:#ffc570}.queued{border-color:#ffc570}
  .empty{border-style:dashed;}.plus{font-size:22px;color:var(--ga-ink-2)}.add-columns{font-size:11px;margin:6px 0;min-height:32px;padding:4px 12px;}
  @media(max-width:760px){header{display:none}.deck-toolbar{margin-bottom:6px}.deck-toolbar button{padding:4px 7px;min-height:34px;font-size:11px}.decks{gap:6px}}
  .deck-mix{display:flex;align-items:center;gap:12px;border:1px solid var(--ga-line-2);border-radius:var(--ga-r-soft);padding:10px 12px;background:var(--ga-faceplate-bg)}
  .deck-mix>div{flex:1;min-width:0}.deck-mix button{width:44px;font-weight:650}.deck-mix label{display:flex;justify-content:space-between;font-size:10px;color:var(--ga-ink-1)}
  .deck-hint{font-size:11px;line-height:1.5;color:var(--ga-ink-2)}
  input[type=range]{appearance:none;-webkit-appearance:none;background:transparent;width:100%;height:32px;cursor:pointer;touch-action:pan-y}
  input[type=range]::-webkit-slider-runnable-track{height:8px;border-radius:3px;background:repeating-linear-gradient(90deg,transparent 0 calc(12.5% - 1px),var(--ga-line-2) calc(12.5% - 1px) 12.5%),linear-gradient(90deg,var(--ga-slider-fill) 0 calc(10px + (100% - 20px)*var(--range-fill,0)),var(--ga-slot) calc(10px + (100% - 20px)*var(--range-fill,0)) 100%);box-shadow:inset 0 1px 3px #000d}
  input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:20px;height:26px;margin-top:-9px;border:1px solid #000;border-radius:2px;background:linear-gradient(var(--ga-slider-fill),var(--ga-slider-fill)) center/10px 2px no-repeat,linear-gradient(180deg,#46433d,#1b1916);box-shadow:0 2px 4px #0009,inset 0 1px 0 #ffffff38}
  input[type=range]::-moz-range-track{height:8px;background:var(--ga-slot);border-radius:3px}input[type=range]::-moz-range-progress{height:8px;background:var(--ga-slider-fill)}
  input[type=range]::-moz-range-thumb{width:20px;height:26px;border:1px solid #000;border-radius:2px;background:linear-gradient(var(--ga-slider-fill),var(--ga-slider-fill)) center/10px 2px no-repeat,linear-gradient(180deg,#46433d,#1b1916)}
  @media(max-width:767px){.deck-mix{display:none}}
</style>
