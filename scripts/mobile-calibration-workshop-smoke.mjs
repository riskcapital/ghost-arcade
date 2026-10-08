import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:1437/native-mobile.html');
 await page.getByRole('button',{name:'Tools',exact:true}).click();await page.getByRole('button',{name:/Projector calibration/}).click();
 const photo=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=600;const x=c.getContext('2d');x.fillStyle='#24344a';x.fillRect(0,0,800,600);return c.toDataURL('image/png').split(',')[1];}),'base64');
 await page.getByRole('dialog').locator('input[type=file]').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:photo});
 const target=page.getByRole('application',{name:'Tap reference photo to place outline points'});await target.waitFor();
 async function point(x,y){await target.click({position:{x:(await target.boundingBox()).width*x,y:(await target.boundingBox()).height*y}});}
 for(const [x,y] of [[.1,.1],[.9,.2],[.9,.9],[.1,.9]])await point(x,y);
 await page.getByRole('button',{name:'Add projector',exact:true}).click();
 for(const [x,y] of [[.2,.3],[.8,.3],[.8,.8],[.2,.8]])await point(x,y);
 await page.getByRole('button',{name:'Add surface',exact:true}).click();
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem('ghost-calibration-drafts-v1'))[0]);assert.equal(draft.projectors.length,1);assert.equal(draft.surfaces.length,1);assert.equal(draft.reference.width,800);
 await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true}));
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export preparation'}).click();const download=await downloadPromise;assert.ok(download.suggestedFilename().endsWith('.ghostcal.json'));
 const layout=await page.getByRole('dialog').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth}));assert.ok(layout.scroll<=layout.width+1);
 await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:/Feed studio/}).click();
 assert.equal(await page.getByRole('button',{name:'Depth map',exact:true}).isDisabled(),true);
 // Simulate native sensor packets; validates actual preview shader and stream cleanup, not camera hardware.
 const result=await page.evaluate(async()=>{
  const {DesktopFeedPreview}=await import('/src/lib/mobile/studio/desktopFeed.ts');
  const {stopNativeFeeds}=await import('/src/lib/mobile/studio/nativeLive.ts');
  const realFetch=window.fetch,calls=[];window.Capacitor={getPlatform:()=> 'ios',nativePromise:async(p,m,a)=>{calls.push(a.sources);return{};}};
  window.fetch=async(url,opts)=>{if(!String(url).startsWith('ghostcapture:'))return realFetch(url,opts);const depth=String(url).endsWith('depth'),w=32,h=24,b=new ArrayBuffer(48+w*h*(depth?2:1.5)),v=new DataView(b);[0x47414331,depth?1:0,1,w,h,8].forEach((n,i)=>v.setUint32(i*4,n,true));[1,1,.5,.5].forEach((n,i)=>v.setFloat32(24+i*4,n,true));if(depth){for(let i=48;i<b.byteLength;i+=2)v.setUint16(i,2000,true);}else{new Uint8Array(b,48,w*h).fill(160);new Uint8Array(b,48+w*h).fill(128);}return new Response(b);};
  const results=[];
  for(const kind of ['rear','front','dual','depth','contours','points']){const canvas=document.createElement('canvas');document.body.append(canvas);const preview=new DesktopFeedPreview(canvas,kind,s=>{throw new Error(s);});await preview.start();await new Promise(r=>setTimeout(r,120));const g=canvas.getContext('webgl'),pixels=new Uint8Array(canvas.width*canvas.height*4);g.readPixels(0,0,canvas.width,canvas.height,g.RGBA,g.UNSIGNED_BYTE,pixels);let lit=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]+pixels[i+1]+pixels[i+2]>0)lit++;const stream=preview.createVideoStream(),track=stream.getVideoTracks()[0],description=preview.descriptor();preview.destroy();results.push({kind,lit,ended:track.readyState,description});canvas.remove();await stopNativeFeeds();}
  window.fetch=realFetch;return {results,calls};
 });
 for(const r of result.results){assert.ok(r.lit>100,r.kind+' must render');assert.equal(r.ended,'ended');assert.equal(r.description.metricDepth,false);}
 assert.ok(result.calls.some(c=>c?.includes('rear')&&c.includes('front')));assert.equal(result.calls.at(-1).length,0);assert.deepEqual(errors,[]);
 await page.setViewportSize({width:1194,height:834});assert.ok(await page.getByRole('button',{name:'Back',exact:true}).isVisible());
 console.log('PASS phone workshop photo import, corner/surface tracing, save/export, no horizontal overflow, capability gates; six GPU feed previews, captureStream tracks and cleanup; tablet layout',result.results.map(r=>({kind:r.kind,lit:r.lit})));
}finally{await browser.close();}
