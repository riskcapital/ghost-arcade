import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:1437/native-mobile.html');
 const result=await p.evaluate(async()=>{
  const {nextAutoClip,varyAutoParams}=await import('/src/lib/mobile/studio/autopilot.ts');
  const {defaultShow}=await import('/src/lib/mobile/studio/model.ts');const s=defaultShow();
  s.clips=[{id:'a',kind:'shader'},{id:'b',kind:'shader'},{id:'c',kind:'camera'},{id:'d',kind:'depth'}];s.launchGrid[0]=['a','c','b','d'];s.layers[0].clipId='a';
  const sequential=nextAutoClip(s,0,false)?.id,random=nextAutoClip(s,0,true,()=>.5)?.id;s.launchGrid[0]=['a','c'];const single=nextAutoClip(s,0,false);
  const params=varyAutoParams([{NAME:'gain',TYPE:'float',MIN:0,MAX:1,DEFAULT:.5},{NAME:'event',TYPE:'event'},{NAME:'hold',TYPE:'bool'}],{gain:.98,hold:false},.2,()=>1);
  return{sequential,random,single:single??null,params};
 });
 assert.equal(result.sequential,'b');assert.equal(result.random,'b');assert.equal(result.single,null);assert.deepEqual(result.params,{gain:1,hold:false});
 await p.getByRole('button',{name:'Autopilot settings',exact:true}).click();
 const slider=p.getByRole('slider',{name:'Autopilot variation'});await slider.scrollIntoViewIfNeeded();
 const box=await slider.boundingBox();await p.mouse.move(box.x+13,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width-13,box.y+box.height/2,{steps:5});await p.mouse.up();
 assert.equal(await slider.inputValue(),'0.4');
 assert.equal(await slider.evaluate(el=>getComputedStyle(el).touchAction),'none');assert.ok(box.height>=48);
 await p.getByLabel('Change clips',{exact:true}).selectOption('4');
 await p.getByRole('button',{name:'Autopilot layer 2',exact:true}).click();await p.getByRole('button',{name:'Autopilot layer 3',exact:true}).click();await p.getByRole('button',{name:'Autopilot layer 4',exact:true}).click();
 const current=await p.locator('button[aria-label^="Stop "][aria-label$=" on row 1"]').first().getAttribute('aria-label');
 await p.getByRole('button',{name:/Autopilot OFF/}).click();
 await p.getByRole('button',{name:/Autopilot ON/}).waitFor();
 await p.waitForFunction(before=>{const el=document.querySelector('button[aria-label^="Stop "][aria-label$=" on row 1"]');return el&&el.getAttribute("aria-label")!==before;},current,{timeout:8000});
 // A manual pad takes over and turns automation off.
 const pad=p.locator('button[aria-label^="Launch "][aria-label$=" on row 1"]').first();await pad.click();
 await p.getByRole('button',{name:/Autopilot OFF/}).waitFor();
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.screenshot({path:'/tmp/mobile-autopilot-polish.png'});assert.deepEqual(errors,[]);
 console.log('PASS autopilot selection/bounds, camera exclusion, touch drag and fill, manual takeover, phone layout');
}finally{await browser.close();}
