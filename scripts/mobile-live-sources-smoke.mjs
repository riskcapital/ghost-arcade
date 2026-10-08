import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:1437/native-mobile.html');
 const result=await page.evaluate(async()=>{
  const {NativeLiveSource,parseLiveFrame,acquireNativeFeed,stopNativeFeeds}=await import('/src/lib/mobile/studio/nativeLive.ts');
  function packet(depth=false){const w=32,h=24,b=new ArrayBuffer(48+w*h*(depth?2:1.5)),v=new DataView(b);[0x47414331,depth?1:0,1,w,h,0].forEach((n,i)=>v.setUint32(i*4,n,true));[.8,1,.5,.5].forEach((n,i)=>v.setFloat32(24+i*4,n,true));if(depth){for(let i=48;i<b.byteLength;i+=2)v.setUint16(i,2000,true);}else{new Uint8Array(b,48,w*h).fill(128);for(let y=0;y<h/2;y++)for(let x=0;x<w/2;x++){const o=48+w*h+y*w+x*2;v.setUint8(o,x<w/4?255:128);v.setUint8(o+1,x<w/4?128:255);}}return b;}
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const gl=canvas.getContext('webgl',{preserveDrawingBuffer:true});const release=[];
  function source(kind){return new NativeLiveSource(gl,kind,{feed:{kind,users:1,closed:false,frame:parseLiveFrame(packet(kind==='depth'))},release:()=>release.push(kind)},s=>{throw new Error(s);});}
  const pixel=(x,y)=>{const b=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return [...b];};
  const rear=source('rear');rear.draw({});const rearLeft=pixel(100,200),rearRight=pixel(540,200);
  const front=source('front');front.draw({});const frontLeft=pixel(100,200),frontRight=pixel(540,200);
  const depth=source('depth');const looks=[];for(let look=0;look<4;look++){depth.draw({depthLook:look,depthSize:9});const {width,height}=depth.textureOutput;const pix=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pix);let visible=0;for(let i=3;i<pix.length;i+=4)if(pix[i])visible++;looks.push(visible);}
  depth.draw({depthFar:1});const cut=pixel(320,240);depth.draw({depthDissolve:1});const dissolve=pixel(320,240);
  const patch=packet(true),pv=new DataView(patch);for(let y=0;y<24;y++)for(let x=0;x<32;x++)pv.setUint16(48+2*(y*32+x),x<16&&y<12?2000:0,true);
  const patchSource=new NativeLiveSource(gl,'depth',{feed:{kind:'depth',users:1,closed:false,frame:parseLiveFrame(patch)},release:()=>{}},s=>{throw new Error(s);});
  const orientation=[];for(const mode of [0,3]){patchSource.draw({depthLook:mode,depthSize:24});const {width,height}=patchSource.textureOutput;const pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const counts=[0,0,0,0];for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[(y*width+x)*4+3])counts[(y>=height/2?2:0)+(x>=width/2?1:0)]++;orientation.push({width,height,counts});}patchSource.destroy();
  const rotatedPacket=packet();new DataView(rotatedPacket).setUint32(20,4,true);
  const arRear=new NativeLiveSource(gl,'rear',{feed:{kind:'rear',users:1,closed:false,frame:parseLiveFrame(rotatedPacket)},release:()=>{}},s=>{throw new Error(s);});
  arRear.draw({});const arTop=pixel(100,500),arBottom=pixel(100,100);arRear.destroy();
  if(arTop[2]<=arTop[0]||arBottom[0]<=arBottom[2])throw new Error('AR rear camera did not rotate clockwise independently of color flags.');
  const err=gl.getError();[rear,front,depth].forEach(s=>s.destroy());
  const calls=[];window.Capacitor={getPlatform:()=> 'ios',nativePromise:async(p,m,a)=>{calls.push(a.sources);return{};}};
  const realFetch=window.fetch;window.fetch=async(url,options)=>String(url).startsWith('ghostcapture:')?new Response(packet(String(url).endsWith('depth')),{status:200}):realFetch(url,options);
  const a=await acquireNativeFeed('rear'),b=await acquireNativeFeed('front');let conflict=false;try{await acquireNativeFeed('depth');}catch{conflict=true;}a.release();b.release();await stopNativeFeeds();
  // End-to-end engine: camera texture -> clip/layer FX -> composition -> mapping.
  const {StudioEngine}=await import('/src/lib/mobile/studio/engine.ts');const {defaultShow}=await import('/src/lib/mobile/studio/model.ts');
  const show=defaultShow();show.clips=[{id:'depth',kind:'depth',name:'Depth'}];show.layers.forEach(l=>l.clipId=null);show.layers[0].clipId='depth';show.layers[0].params={depthLook:0};show.mapping=false;show.surfaces=[];show.quality=540;
  const out=document.createElement('canvas');document.body.append(out);const engine=new StudioEngine(out,()=>show),errors=[];engine.onError=e=>errors.push(e);await engine.launch(0,show.clips[0]);engine.start();
  const read=()=>new Promise(resolve=>setTimeout(()=>requestAnimationFrame(()=>{const g=out.getContext('webgl'),b=new Uint8Array(4);g.readPixels(out.width/2,out.height/2,1,1,g.RGBA,g.UNSIGNED_BYTE,b);resolve([...b]);}),100));
  const plain=await read();show.layers[0].effects=[{id:'invert',type:'invert',enabled:true,params:{}}];const inverted=await read();show.layers[0].opacity=0;const muted=await read();
  await engine.launch(0,{id:'front',kind:'camera',facing:'user',name:'Front'});
  await engine.launch(0,show.clips[0]);
  await engine.launch(0,{id:'rear',kind:'camera',facing:'environment',name:'Rear'});
  engine.destroy();await stopNativeFeeds();out.remove();window.fetch=realFetch;
  return {orientation,rearLeft,rearRight,frontLeft,frontRight,looks,cut,dissolve,err,release,calls,conflict,plain,inverted,muted,errors};
 });
 for(const o of result.orientation){assert.equal(o.width,480);assert.equal(o.height,640);assert.ok(o.counts[3]>1000);assert.ok(o.counts[3]>Math.max(...o.counts.slice(0,3))*10,'Depth and point-cloud patch must rotate clockwise to top-right');}
 assert.deepEqual(result.frontLeft,result.rearRight);assert.deepEqual(result.frontRight,result.rearLeft);assert.ok(result.rearLeft[2]>result.rearLeft[0]);assert.ok(result.rearRight[0]>result.rearRight[2]);assert.ok(result.looks.every(n=>n>500),'All depth GPU looks draw');assert.equal(result.cut[3],0);assert.equal(result.dissolve[3],0);assert.equal(result.err,0);assert.ok(result.conflict);assert.ok(result.calls.some(c=>c.includes('rear')&&c.includes('front')));assert.equal(result.calls.at(-1).length,0);assert.deepEqual(result.errors,[]);assert.ok(result.plain[0]>50);assert.ok(Math.abs(result.inverted[0]-(255-result.plain[0]))<4);assert.equal(result.muted[0],0);
 console.log('PASS binary planes, camera GPU color/selfie mirror, four depth looks, distance/dissolve transparency, simultaneous camera leases, hardware conflict guard, native source layer FX + opacity',result);
}finally{await browser.close();}
