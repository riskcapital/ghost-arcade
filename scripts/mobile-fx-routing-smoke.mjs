import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/ISF/**/*.fs',r=>r.fulfill({body:'/*{"INPUTS":[]}*/\nvoid main(){gl_FragColor=vec4(.8,.2,.1,1.);}',contentType:'text/plain'}));
 await page.goto('http://127.0.0.1:1437/native-mobile.html');await page.waitForTimeout(600);
 const pixel=(x=.5,y=.5)=>page.evaluate(([x,y])=>new Promise(resolve=>requestAnimationFrame(()=>{const c=document.querySelector('canvas'),g=c.getContext('webgl'),a=new Uint8Array(4);g.readPixels(Math.floor(c.width*x),Math.floor(c.height*y),1,1,g.RGBA,g.UNSIGNED_BYTE,a);resolve([...a].slice(0,3));})),[x,y]);
 const near=(actual,expected)=>actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<3,`${actual} != ${expected}`));
 near(await pixel(),[204,51,26]);await page.getByRole('button',{name:'Hold',exact:true}).click();
 await page.getByRole('button',{name:'Controls',exact:true}).click();await page.getByRole('button',{name:'FX',exact:true}).click();await page.getByLabel('Add effect',{exact:true}).selectOption('invert');await page.waitForTimeout(120);near(await pixel(),[51,204,229]);
 await page.getByRole('button',{name:'Clip',exact:true}).click();await page.getByLabel('Add effect',{exact:true}).selectOption('invert');await page.waitForTimeout(120);near(await pixel(),[204,51,26]);
 await page.getByRole('button',{name:'Comp',exact:true}).click();await page.getByLabel('Add effect',{exact:true}).selectOption('invert');await page.getByRole('button',{name:'Map',exact:true}).click();await page.waitForTimeout(150);near(await pixel(),[51,204,229]);near(await pixel(.02,.02),[0,0,0]);
 await page.getByRole('button',{name:'Perform',exact:true}).click();await page.getByRole('button',{name:'Mixer',exact:true}).click();await page.waitForTimeout(250);
 const monitor=await page.locator('.preview').boundingBox();assert.ok(monitor.width>300);assert.ok(monitor.y<130);
 const matrix=page.locator('.matrix').first(),box=await matrix.boundingBox();
 await page.mouse.move(box.x+290,box.y+55);await page.mouse.down();await page.mouse.move(box.x+105,box.y+55,{steps:10});await page.mouse.up();
 assert.ok(await matrix.evaluate(el=>el.scrollLeft)>100,'Drag reveals more columns');
 assert.equal(await page.locator('.pad strong').count(),0);assert.equal(await page.getByRole('button',{name:'Next clip page'}).count(),0);
 await page.screenshot({path:'/tmp/mobile-revised-mixer.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 console.log('PASS clip/layer FX on held source; composition FX clipped by mapping; full monitor; compact drag-scrolling grid');
}finally{await browser.close();}
