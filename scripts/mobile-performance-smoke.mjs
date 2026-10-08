import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:1437/native-mobile.html');
 assert.equal(await page.getByRole('button',{name:'Library',exact:true}).count(),0);
 await page.getByRole('button',{name:'Mixer',exact:true}).click();
 await page.waitForTimeout(250);
 const monitor=await page.locator('.preview').boundingBox();assert.ok(monitor.width>300 && monitor.y<150,'Full-size monitor stays at top');
 const f=page.getByRole('slider',{name:'L1 opacity',exact:true});const b=await f.boundingBox();
 await page.mouse.move(b.x+b.width/2,b.y+b.height*.2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height*.6);await page.mouse.up();
 console.log('fader',await f.getAttribute('aria-valuenow'));assert.ok(Math.abs(Number(await f.getAttribute('aria-valuenow'))-40)<4);
 await page.getByRole('button',{name:'Solo L2',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Solo L2',exact:true}).getAttribute('aria-pressed'),'true');
 await page.screenshot({path:'/tmp/mobile-performance-mixer.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:'Mixer source controls',exact:true}).click();
 assert.equal(await page.getByRole('region',{name:'Performance mixer'}).count(),0);
 await page.getByRole('button',{name:'FX',exact:true}).click();
 for(const [scope,effect] of [['Comp','invert'],['Layer','rgbShift'],['Clip','invert']]){
  await page.getByRole('button',{name:scope,exact:true}).click();await page.getByLabel('Add effect',{exact:true}).selectOption(effect);
 }
 await page.waitForTimeout(400);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('ga-mobile-studio-v1')));
 assert.equal(saved.effects[0].type,'invert');assert.equal(saved.layers[0].effects[0].type,'rgbShift');assert.equal(saved.clips.find(c=>c.id===saved.layers[0].clipId).effects[0].type,'invert');
 await page.screenshot({path:'/tmp/mobile-performance-fx.png'});
 await page.getByRole('button',{name:'Perform',exact:true}).click();
 await page.getByRole('button',{name:'Add clip to row 2 column 4',exact:true}).click();
 await page.getByRole('button',{name:'← Back to deck',exact:true}).click();
 await page.setViewportSize({width:1194,height:834});await page.getByRole('button',{name:'Mixer',exact:true}).click();await page.screenshot({path:'/tmp/mobile-performance-tablet.png'});
 const render=await page.evaluate(async()=>{
 const {StudioCompositor}=await import('/src/lib/mobile/studio/compositor.ts');const {StandaloneRenderer}=await import('/src/lib/mobile/standaloneRenderer.ts');const {defaultShow}=await import('/src/lib/mobile/studio/model.ts');
 const canvas=document.createElement('canvas'),c=new StudioCompositor(canvas),g=c.context,r=new StandaloneRenderer(canvas,g),s=defaultShow();s.mapping=false;s.quality=540;s.layers.forEach(l=>{l.enabled=true;l.opacity=1;l.clipId='test';});
 const inputs=[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]].map(color=>{const t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,1,1,0,g.RGBA,g.UNSIGNED_BYTE,new Uint8Array(color));return{texture:t,width:16,height:9};});
 const p=()=>{const a=new Uint8Array(4);g.readPixels(480,270,1,1,g.RGBA,g.UNSIGNED_BYTE,a);return[...a].slice(0,3);};const out=[];
 c.render(s,inputs);out.push(p());s.layers[0].opacity=.5;c.render(s,inputs);out.push(p());s.layers[0].opacity=1;
 const post=input=>r.processTexture(input,[{type:'invert',enabled:true,params:{amount:1}}],0);
 c.render(s,inputs,false,false,0,0,0,post);out.push(p());s.master=0;c.render(s,inputs,false,false,0,0,0,post);out.push(p());s.master=1;c.render(s,inputs,true,false,0,0,0,post);out.push(p());s.layers[2].solo=true;c.render(s,inputs);out.push(p());
 s.layers.forEach((l,i)=>{l.solo=false;l.enabled=i===0;});
 g.bindTexture(g.TEXTURE_2D,inputs[0].texture);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,2,2,0,g.RGBA,g.UNSIGNED_BYTE,new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255]));
 const corners=()=>[[240,135],[720,135],[240,405],[720,405]].map(([x,y])=>{const a=new Uint8Array(4);g.readPixels(x,y,1,1,g.RGBA,g.UNSIGNED_BYTE,a);return[...a].slice(0,3);});
 c.render(s,inputs);const before=corners();c.render(s,inputs,false,false,0,0,0,post);const after=corners();
 const error=g.getError();r.destroy();c.destroy();return{out,error,before,after};
 });console.log(render);assert.equal(render.error,0);
 const expected=[[255,0,0],[128,128,0],[0,255,255],[0,0,0],[0,0,0],[0,0,255]];
 render.out.forEach((p,i)=>p.forEach((v,j)=>assert.ok(Math.abs(v-expected[i][j])<3,`pixel ${i}: ${p}`)));
 render.before.forEach((p,i)=>p.forEach((v,j)=>assert.ok(Math.abs(255-v-render.after[i][j])<3,'Composition FX orientation')));
 assert.deepEqual(errors,[]);console.log('PASS mixer drag and controls, independent FX scopes, library-on-add, hierarchy, GPU composition FX, master/blackout and solo');
}finally{await browser.close();}
