// Shared horizontal range interaction. Native keyboard semantics remain intact.
export function touchSliders(root:HTMLElement, _state?:unknown){
 const active=new Map<number,HTMLInputElement>();
 const ranges=()=>Array.from(root.querySelectorAll<HTMLInputElement>('input[type="range"]'));
 const fill=(el:HTMLInputElement)=>{
  const min=Number(el.min||0),max=Number(el.max||100);
  el.style.setProperty('--touch-fill',String(Math.max(0,Math.min(1,(el.valueAsNumber-min)/(max-min||1)))));
  el.classList.add('studio-range');
 };
 const refresh=()=>ranges().forEach(fill);
 const write=(el:HTMLInputElement,e:PointerEvent)=>{
  const r=el.getBoundingClientRect(),min=Number(el.min||0),max=Number(el.max||100);
  const fraction=Math.max(0,Math.min(1,(e.clientX-r.left-13)/Math.max(1,r.width-26)));
  const step=el.step==='any'?0:Number(el.step||1);
  let value=min+fraction*(max-min);
  if(step)value=min+Math.round((value-min)/step)*step;
  const next=String(Math.max(min,Math.min(max,Number(value.toFixed(8)))));
  if(el.value!==next){el.value=next;fill(el);el.dispatchEvent(new Event('input',{bubbles:true}));}
 };
 const down=(e:PointerEvent)=>{
  const el=e.target;if(!(el instanceof HTMLInputElement)||el.type!=='range'||el.disabled||e.button!==0)return;
  if([...active.values()].includes(el))return;
  e.preventDefault();el.focus({preventScroll:true});active.set(e.pointerId,el);el.setPointerCapture(e.pointerId);queueMicrotask(()=>{if(active.get(e.pointerId)===el)write(el,e);});
 };
 const move=(e:PointerEvent)=>{const el=active.get(e.pointerId);if(el){e.preventDefault();write(el,e);}};
 const end=(e:PointerEvent)=>{const el=active.get(e.pointerId);if(!el)return;active.delete(e.pointerId);if(e.type==='pointerup')write(el,e);if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);el.dispatchEvent(new Event('change',{bubbles:true}));};
 const input=(e:Event)=>{if(e.target instanceof HTMLInputElement&&e.target.type==='range')fill(e.target);};
 const observer=new MutationObserver(refresh);observer.observe(root,{childList:true,subtree:true});
 refresh();root.addEventListener('pointerdown',down,{capture:true,passive:false});root.addEventListener('pointermove',move,{capture:true,passive:false});
 root.addEventListener('pointerup',end,true);root.addEventListener('pointercancel',end,true);root.addEventListener('input',input);
 return{update(){queueMicrotask(refresh);},destroy(){observer.disconnect();for(const [id,el] of active)if(el.hasPointerCapture(id))el.releasePointerCapture(id);active.clear();root.removeEventListener('pointerdown',down,true);root.removeEventListener('pointermove',move,true);root.removeEventListener('pointerup',end,true);root.removeEventListener('pointercancel',end,true);root.removeEventListener('input',input);}};
}
