import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const b=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try{
 const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await p.addInitScript(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async opts=>{const s=await original(opts);window.testCameraStream=s;return s;};});
 await p.goto('http://127.0.0.1:1437/native-mobile.html');
 const first=p.locator('.clip-row').first().locator('.pad').first();await p.waitForTimeout(400);await first.click();await p.waitForTimeout(300);assert.equal(await first.evaluate(el=>el.classList.contains('live')),false);await first.click();await p.waitForTimeout(400);assert.equal(await first.evaluate(el=>el.classList.contains('live')),true);
 await p.getByRole('button',{name:'Add clip to row 1 column 4',exact:true}).click();await p.getByRole('button',{name:'＋ Front camera',exact:true}).click();
 await p.getByRole('button',{name:'Launch Front camera on row 1',exact:true}).click();await p.getByRole('button',{name:'Stop Front camera on row 1',exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>window.testCameraStream.getVideoTracks()[0].readyState),'live');
 await p.getByRole('button',{name:'Stop Front camera on row 1',exact:true}).click();assert.equal(await p.evaluate(()=>window.testCameraStream.getVideoTracks()[0].readyState),'ended');
 await p.getByRole('button',{name:'Launch Front camera on row 1',exact:true}).click();await p.getByRole('button',{name:'Stop Front camera on row 1',exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>window.testCameraStream.getVideoTracks()[0].readyState),'live');
 const samples=await p.evaluate(async()=>{const {StandaloneRenderer}=await import('/src/lib/mobile/standaloneRenderer.ts');const c=document.createElement('canvas'),src=document.createElement('canvas');src.width=64;src.height=64;const ctx=src.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,32,64);ctx.fillStyle='blue';ctx.fillRect(32,0,32,64);const r=new StandaloneRenderer(c),gl=c.getContext('webgl');const sample=mirror=>{r.loadMediaSource(src,mirror);r.drawFrame(64,64);const a=new Uint8Array(4);gl.readPixels(8,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,a);return [...a];};const result=[sample(false),sample(true),sample(false)];r.destroy();return result;});
 assert.deepEqual(samples,[[255,0,0,255],[0,0,255,255],[255,0,0,255]]);
 console.log('PASS shader toggle, camera toggle stops/restarts capture, GPU selfie mirror and reset for ordinary sources');
}finally{await b.close();}
