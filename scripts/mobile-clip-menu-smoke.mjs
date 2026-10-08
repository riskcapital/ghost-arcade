import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const b=await chromium.launch({channel:'chrome',headless:true});
try{
 const p=await b.newPage({viewport:{width:390,height:844}});await p.goto('http://127.0.0.1:1437/native-mobile.html');await p.waitForTimeout(400);
 const pad=p.locator('.clip-row').first().locator('.pad').first();
 async function hold(){const r=await pad.boundingBox();await p.mouse.move(r.x+30,r.y+30);await p.mouse.down();await p.waitForTimeout(600);await p.mouse.up();}
 await hold();await p.getByRole('dialog',{name:'Clip actions'}).waitFor();assert.ok(await pad.evaluate(el=>el.classList.contains('live')));
 await p.getByRole('button',{name:'Cancel',exact:true}).click();await hold();await p.getByRole('button',{name:'Replace clip',exact:true}).click();await p.locator('.library-grid').waitFor();
 const audit=await p.evaluate(async()=>{const {MOBILE_SHADERS}=await import('/src/lib/mobile/standaloneShaderList.ts');const {standaloneShaderPaths}=await import('/src/lib/mobile/studio/shaderAvailability.ts');const selected=MOBILE_SHADERS.filter(s=>!s.requiresImage&&standaloneShaderPaths.has(s.path));const bad=[];for(const s of selected){const img=new Image();img.src='/ISF/thumbnails/'+s.path.slice(4,-3).replaceAll('/','_')+'.jpg';try{await img.decode();}catch{bad.push(s.id);}}return{total:MOBILE_SHADERS.length,available:selected.length,bad};});assert.deepEqual(audit.bad,[]);assert.ok(audit.available<audit.total);
 await p.getByRole('button',{name:'Perform',exact:true}).click();await hold();await p.getByRole('button',{name:'Remove clip',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.clip-row .pad')?.classList.contains('empty'));assert.ok(await pad.evaluate(el=>el.classList.contains('empty')));assert.equal(await pad.evaluate(el=>el.classList.contains('live')),false);
 console.log('PASS long hold does not toggle; replace opens curated library; remove clears slot and stops active source',audit);
}finally{await b.close();}
