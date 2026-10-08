<script lang="ts">
 import Icon from './StudioIcon.svelte';
 import type {PaintConfig,PaintLink,Edge} from '../../mobile/studio/paint';
 import type {Surface} from '../../mobile/studio/model';
 export let value:PaintConfig;export let surfaces:Surface[];export let selected:number;
 export let onselect:(index:number)=>void;
 export let onchange:(patch:Partial<PaintConfig>)=>void;export let onundo:()=>void;export let onclear:()=>void;
 let target='',edge:Edge='bottom',entry:Edge='top',flip=false,linksOpen=false;
 const brushes=[{id:'light',name:'Light',icon:'paint'},{id:'smoke',name:'Smoke',icon:'smoke'},{id:'slime',name:'Slime',icon:'drop'}] as const;
 const colors=['#5cdaff','#beff63','#ff914d','#f76bda','#b599ff','#ffffff'];
 $: source=surfaces[selected];
 $: candidates=surfaces.filter(s=>s.id!==source?.id);
 $: if(!candidates.some(s=>s.id===target))target=candidates[0]?.id??'';
 function link(){
  if(!source||!target)return;
  const next:PaintLink={from:source.id,edge,to:target,entry,flip};
  // One connection per boundary; a link is bidirectional.
  const used=(l:PaintLink,id:string,e:Edge)=>(l.from===id&&l.edge===e)||(l.to===id&&l.entry===e);
  onchange({links:[...value.links.filter(l=>!used(l,next.from,next.edge)&&!used(l,next.to,next.entry)),next].slice(-32)});
 }
</script>
<section class="paint-panel" aria-label="Mapping paint controls">
 <header><strong><Icon name="paint" size={19}/>Surface paint</strong><button aria-pressed={value.enabled} class:active={value.enabled} onclick={()=>onchange({enabled:!value.enabled})}>{value.enabled?'Paint on':'Paint off'}</button></header>
 <div class="view-mode"><button class:active={!value.isolate} onclick={()=>onchange({isolate:false})}>Over visuals</button><button class:active={value.isolate} onclick={()=>onchange({isolate:true})}>Paint only</button></div>
 <div class="brushes">{#each brushes as b}<button aria-pressed={value.brush===b.id} class:active={value.brush===b.id} onclick={()=>onchange({brush:b.id})}><Icon name={b.icon}/>{b.name}</button>{/each}</div>
 <div class="colors">{#each colors as color}<button style:--swatch={color} class:chosen={value.color===color} aria-label={`Paint color ${color}`} aria-pressed={value.color===color} onclick={()=>onchange({color})}></button>{/each}<input type="color" aria-label="Custom paint color" value={value.color} oninput={e=>onchange({color:e.currentTarget.value})}/></div>
 <label>Brush size <output>{Math.round(value.size*1000)}</output><input aria-label="Brush size" type="range" min=".015" max=".16" step=".005" value={value.size} oninput={e=>onchange({size:Number(e.currentTarget.value)})}/></label>
 <label>Persistence <output>{value.life}s</output><input aria-label="Paint persistence" type="range" min="1" max="30" step="1" value={value.life} oninput={e=>onchange({life:Number(e.currentTarget.value)})}/></label>
 {#if value.brush==='slime'}<label>Gravity <output>{Math.round(value.gravity*100)}%</output><input aria-label="Slime gravity" type="range" min="0" max="1" step=".01" value={value.gravity} oninput={e=>onchange({gravity:Number(e.currentTarget.value)})}/></label>{/if}
 <div class="actions"><button class:active={value.hold} aria-pressed={value.hold} onclick={()=>onchange({hold:!value.hold})}><Icon name="pause" size={16}/>Freeze</button><button disabled={!value.strokes.length} onclick={onundo}><Icon name="undo" size={16}/>Undo stroke</button><button disabled={!value.strokes.length} onclick={onclear}><Icon name="trash" size={16}/>Clear</button></div>
 <div class="loop"><button class:active={value.loop} aria-pressed={value.loop} onclick={()=>onchange({loop:!value.loop})}><Icon name="autopilot" size={17}/>Gesture loop</button><select aria-label="Gesture loop length" value={value.beats} onchange={e=>onchange({beats:Number(e.currentTarget.value)})}>{#each [4,8,16,32] as beats}<option value={beats}>{beats} beats</option>{/each}</select></div>
 <p>{value.brush==='slime'?'Hold to pour. Slime runs down each face; link edges to carry it onto another screen.':'Draw in the preview. Strokes stay attached when you warp the screens.'} Loops follow BPM / Tap.</p>
 <button class="connections" aria-expanded={linksOpen} onclick={()=>linksOpen=!linksOpen}><Icon name="link" size={18}/>Connected edges <span>{value.links.length}</span></button>
 {#if linksOpen}<div class="link-editor">
  <p>Connect touching faces. Flow crosses either way. Choose the matching direction along both edges.</p>
  <label>From screen<select aria-label="Paint source screen" value={selected} onchange={e=>onselect(Number(e.currentTarget.value))}>{#each surfaces as s,i}<option value={i}>{s.name}</option>{/each}</select></label>
  <div class="pair"><label>Exit edge<select aria-label="Paint exit edge" bind:value={edge}>{#each ['top','right','bottom','left'] as e}<option value={e}>{e}</option>{/each}</select></label><label>Destination<select aria-label="Paint destination screen" bind:value={target}>{#each candidates as s}<option value={s.id}>{s.name}</option>{/each}</select></label></div>
  <div class="pair"><label>Entry edge<select aria-label="Paint entry edge" bind:value={entry}>{#each ['top','right','bottom','left'] as e}<option value={e}>{e}</option>{/each}</select></label><button class:active={flip} aria-pressed={flip} onclick={()=>flip=!flip}>Reverse edge</button></div>
  <button class="connect" disabled={!source||!target} onclick={link}>Connect edges</button>
  {#each value.links as l,i}<div class="connection"><span>{surfaces.find(s=>s.id===l.from)?.name??'Removed screen'} · {l.edge}<br/>↔ {surfaces.find(s=>s.id===l.to)?.name??'Removed screen'} · {l.entry}{l.flip?' · reversed':''}</span><button aria-label={`Remove edge connection ${i+1}`} onclick={()=>onchange({links:value.links.filter((_,j)=>j!==i)})}><Icon name="close" size={16}/></button></div>{/each}
 </div>{/if}
</section>
<style>
 .view-mode{display:flex;gap:6px;margin:12px 0}.view-mode button{flex:1}.link-editor>label{display:flex;flex-direction:column;align-items:stretch;gap:6px}
 .paint-panel{padding:12px;border:1px solid var(--ga-line-3);border-radius:7px;background:var(--ga-inspector-bg);margin:12px 0}
 header,header strong{display:flex;align-items:center;gap:8px}header{justify-content:space-between}header strong{font-size:14px}
 button,select{min-height:44px;border:1px solid var(--ga-line-2);border-radius:5px;background:var(--ga-hardware-bg);color:var(--ga-ink-0);font:inherit;padding:7px 9px;touch-action:manipulation;font-size:12px}
 button{display:flex;align-items:center;justify-content:center;gap:6px}.active{background:var(--ga-selection-bg);border-color:var(--ga-selection-line)}button:disabled{opacity:.4}
 .brushes{display:flex;gap:6px;margin:12px 0}.brushes button{flex:1}.colors{display:flex;gap:4px;align-items:center;margin:10px 0}.colors button{flex:1;min-width:0;position:relative;padding:0}.colors button:before{content:'';width:20px;height:20px;background:var(--swatch);border-radius:50%}.colors .chosen{border-color:var(--swatch)}.colors input{width:40px;height:44px;background:transparent;border:0;padding:0}
 label{display:grid;grid-template-columns:1fr auto;align-items:center;font-size:12px;gap:0 8px;margin-top:8px}label input{grid-column:1/-1;width:100%;min-width:0}output{font:11px ui-monospace;color:#b7f375}
 .actions,.loop,.pair{display:flex;gap:6px;margin:10px 0}.actions button{flex:1;font-size:11px;padding:6px}.loop>*{flex:1;min-width:0}p{font-size:11px;line-height:1.5;color:#aab4c3}
 .connections{width:100%;justify-content:flex-start}.connections span{margin-left:auto;color:#b7f375}.pair>*{flex:1;min-width:0}.pair label{display:flex;flex-direction:column;align-items:stretch;gap:6px}.pair select{width:100%}.pair>button{align-self:end}.connect{width:100%}.connection{display:flex;align-items:center;gap:8px;border-top:1px solid var(--ga-line-2);padding:8px 0;font-size:11px;line-height:1.5}.connection span{flex:1}.connection button{width:44px}
</style>
