import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
execFileSync('swiftc',['native-mobile/ios/App/App/ScanCore.swift','scripts/mobile-scan-core.test.swift','-o','/tmp/mobile-scan-core-test']);
console.log(execFileSync('/tmp/mobile-scan-core-test',['/tmp/mobile-native-scan-test.ply'],{encoding:'utf8'}).trim());
const fixture=Array.from(readFileSync('/tmp/mobile-native-scan-test.ply'));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const p=await browser.newPage({viewport:{width:390,height:844}});
 await p.goto('http://127.0.0.1:1437/native-mobile.html');
 await p.route('**/native-large-scan.ply',route=>route.fulfill({body:readFileSync('/tmp/mobile-native-scan-test.ply.large.ply'),contentType:'application/octet-stream'}));
 const big=await p.evaluate(async()=>{const {parsePLYBufferProgressive}=await import('/src/lib/splat/plyLoader.ts');const data=await (await fetch('/native-large-scan.ply')).arrayBuffer();const result=await parsePLYBufferProgressive(data,{maxPoints:10000});return{source:result.sourceVertexCount,count:result.vertices.length,decimated:result.wasDecimated};});
 assert.equal(big.source,1600002);assert.ok(big.count<=10000);assert.equal(big.decimated,true);
 const parsed=await p.evaluate(async bytes=>{const {parsePLYBuffer}=await import('/src/lib/splat/plyLoader.ts');return parsePLYBuffer(new Uint8Array(bytes).buffer);},fixture);
 assert.equal(parsed.sourceVertexCount,2);assert.equal(parsed.vertices.length,2);assert.equal(parsed.dataType,'pointcloud');
 assert.deepEqual(parsed.vertices.map(v=>[v.x,v.y,v.z,v.r,v.g,v.b]),[[0,0,-2,255,0,0],[2,1,1,0,128,255]]);
 await p.getByRole('button',{name:'Tools',exact:true}).click();
 await p.getByRole('dialog',{name:'Capture toolkit'}).waitFor();
 assert.equal(await p.getByRole('button',{name:/LiDAR scan/}).isDisabled(),true);
 await p.getByRole('button',{name:'Close capture toolkit'}).click();
 const nav=await p.locator('nav.tabs').evaluate(el=>({right:el.lastElementChild.getBoundingClientRect().right,width:innerWidth}));
 assert.ok(nav.right<=nav.width,`Toolbar overflows: ${JSON.stringify(nav)}`);
 await p.evaluate(()=>{
  window.captureCalls=[];window.fakeScans=[];
  window.Capacitor={getPlatform:()=> 'ios',convertFileSrc:url=>url,nativePromise:async(plugin,method,args)=>{
   window.captureCalls.push({plugin,method,args});
   if(method==='capabilities')return{lidar:true,dualCamera:true,platform:'ios'};
   if(method==='listScans')return{scans:window.fakeScans};
   if(method==='openScanner'){window.fakeScans.push({id:'test-scan',name:'Stage scan',points:25000,bytes:375000,created:new Date().toISOString(),thumbnail:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="navy"/></svg>'),url:'file:///scan.ply',mode:args.mode});return{};}
   if(method==='deleteScan'){window.fakeScans=[];return{};}
   if(method==='openDualCamera')return{shots:[{name:'Rear camera',url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}]};
   return{};
  }};
 });
 await p.getByRole('button',{name:'Tools',exact:true}).click();
 await p.getByRole('button',{name:/LiDAR scan/}).click();await p.getByText('Stage scan',{exact:true}).waitFor();
 await p.getByRole('button',{name:'Share PLY'}).click();
 assert.ok(await p.evaluate(()=>window.captureCalls.some(c=>c.method==='shareScan'&&c.args.id==='test-scan')));
 await p.getByRole('button',{name:'Delete',exact:true}).click();await p.getByRole('button',{name:'Keep scan'}).click();assert.equal(await p.getByText('Stage scan',{exact:true}).count(),1);
 await p.screenshot({path:'/tmp/mobile-capture-toolkit.png'});
 await p.getByRole('button',{name:'Delete',exact:true}).click();await p.getByRole('button',{name:'Delete scan',exact:true}).click();await p.getByText('Your scans live here').waitFor();
 await p.getByRole('button',{name:/Dual camera/}).click();await p.getByText('1 camera images added to the clip library.').waitFor();
 await p.getByRole('button',{name:/Depth playground/}).click();assert.ok(await p.evaluate(()=>window.captureCalls.some(c=>c.method==='openScanner'&&c.args.mode==='live')));
 console.log('PASS actual Swift PLY reads in desktop importer; native capability gating; scanner refresh/share/delete; dual-camera still import; depth launch');
}finally{await browser.close();}
