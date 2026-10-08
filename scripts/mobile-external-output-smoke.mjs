import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const b=await chromium.launch({channel:'chrome',headless:true});
try{
 const p=await b.newPage({viewport:{width:390,height:844}});
 await p.addInitScript(()=>{window.testOutputStates=[];window.webkit={messageHandlers:{ghostOutput:{postMessage:m=>{if(m.type==='status')window.testOutputStates.push(m.state);}}}};const original=HTMLCanvasElement.prototype.captureStream;HTMLCanvasElement.prototype.captureStream=function(...args){const s=original.apply(this,args);window.testOutputStream=s;return s;};});
 await p.route('**/ISF/**/*.fs',r=>r.fulfill({body:'/*{"INPUTS":[]}*/\nvoid main(){gl_FragColor=vec4(.8,.2,.1,1.);}',contentType:'text/plain'}));
 await p.goto('http://127.0.0.1:1437/native-mobile.html');await p.waitForTimeout(400);
 const popupEvent=p.waitForEvent('popup');await p.evaluate(()=>window.dispatchEvent(new CustomEvent('ghost-external-display',{detail:{connected:true}})));const out=await popupEvent;
 await p.waitForFunction(()=>window.testOutputStates.includes('live'));
 assert.equal(await out.locator('video').count(),1);assert.equal(await out.locator('button').count(),0);
 const pixel=await out.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=56;const g=c.getContext('2d');g.drawImage(document.querySelector('video'),0,0,100,56);return [...g.getImageData(50,28,1,1).data];});assert.ok(pixel[0]>190&&pixel[1]<65&&pixel[2]<40,`Video frame ${pixel}`);
 await p.getByRole('button',{name:'Map',exact:true}).click();assert.equal(await out.locator('video').count(),1);assert.equal(await out.locator('button,svg').count(),0);
 await p.getByRole('button',{name:'Output settings',exact:true}).click();
 await p.getByRole('button',{name:'Wired · HDMI / USB-C',exact:true}).click();
 const ratePopup=p.waitForEvent('popup');await p.getByLabel('Output frame rate',{exact:true}).selectOption('60');await ratePopup;await p.waitForFunction(()=>window.testOutputStates.at(-1)==='live');
 assert.equal(await p.evaluate(()=>window.testOutputStream.getVideoTracks()[0].getSettings().frameRate),60);
 await p.getByLabel('Output render resolution',{exact:true}).selectOption('540');await p.waitForFunction(()=>document.querySelector('canvas').height===540);
 await p.getByLabel('Enable clean external output',{exact:true}).uncheck();await p.waitForFunction(()=>window.testOutputStates.at(-1)==='off');assert.equal(await p.evaluate(()=>window.testOutputStream.getVideoTracks()[0].readyState),'ended');
 const enabledPopup=p.waitForEvent('popup');await p.getByLabel('Enable clean external output',{exact:true}).check();await enabledPopup;await p.waitForFunction(()=>window.testOutputStates.at(-1)==='live');
 assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('ga-mobile-output-v1')).method),'wired');
 await p.screenshot({path:'/tmp/mobile-output-settings.png'});await p.getByRole('button',{name:'Close output settings',exact:true}).click();
 await p.evaluate(()=>window.dispatchEvent(new CustomEvent('ghost-external-display',{detail:{connected:false}})));await p.waitForFunction(()=>window.testOutputStates.at(-1)==='disconnected');assert.equal(await p.evaluate(()=>window.testOutputStream.getVideoTracks()[0].readyState),'ended');
 const secondEvent=p.waitForEvent('popup');await p.evaluate(()=>window.dispatchEvent(new CustomEvent('ghost-external-display',{detail:{connected:true}})));await secondEvent;await p.waitForFunction(()=>window.testOutputStates.at(-1)==='live');
 console.log('PASS clean output receives compositor pixels, excludes controls and mapping overlays, releases capture on disconnect and reconnects');
}finally{await b.close();}
