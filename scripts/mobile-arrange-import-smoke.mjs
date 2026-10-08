import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:1437/native-mobile.html');
 const dual=await p.getByRole('button',{name:'Dual deck',exact:true}).boundingBox(),auto=await p.getByRole('button',{name:/Autopilot OFF/}).boundingBox();
 assert.ok(Math.abs(dual.y-auto.y)<10,'Autopilot beside deck selection');
 await p.getByRole('button',{name:'Arrange clips',exact:true}).click();
 const slot=(r,c)=>p.locator(`[data-clip-slot][data-row="${r}"][data-column="${c}"]`);
 const before=await slot(0,0).getAttribute('aria-label'),other=await slot(0,1).getAttribute('aria-label');
 await slot(0,0).scrollIntoViewIfNeeded();
 let a=await slot(0,0).boundingBox(),b=await slot(0,1).boundingBox();
 await p.mouse.move(a.x+a.width/2,a.y+a.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:6});await p.mouse.up();
 assert.equal(await slot(0,0).getAttribute('aria-label'),other);assert.equal(await slot(0,1).getAttribute('aria-label'),before);
 // Trusted touch drag to another layer.
 await slot(1,1).scrollIntoViewIfNeeded();a=await slot(0,1).boundingBox();b=await slot(1,1).boundingBox();
 const touch=await p.context().newCDPSession(p);
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.equal(await slot(1,1).getAttribute('aria-label'),before.replace('row 1','row 2'));
 // Keyboard/pointer tap-to-pick offers the same move operation.
 await slot(1,1).click();await slot(1,2).click();assert.equal(await slot(1,2).getAttribute('aria-label'),before.replace('row 1','row 2'));
 await p.getByRole('button',{name:'Done arranging',exact:true}).click();
 await p.getByRole('button',{name:'Add clip to row 4 column 4',exact:true}).click();
 const back=await p.getByRole('button',{name:'Back to deck',exact:true}).boundingBox(),title=await p.getByRole('heading',{name:'Load L4 · slot 4',exact:true}).boundingBox();
 assert.ok(title.y>=back.y+back.height+8,'Library title has its own row');
 await p.getByRole('button',{name:'Import',exact:true}).click();
 const chooser=p.waitForEvent('filechooser');await p.getByRole('button',{name:'Videos Show video files only'}).click();
 const file=await chooser;assert.equal(await file.element().getAttribute('accept'),'video/*');assert.equal(file.isMultiple(),true);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.screenshot({path:'/tmp/mobile-library-layout.png'});
 await p.getByRole('button',{name:'Back to deck',exact:true}).click();await p.getByRole('button',{name:'Dual deck',exact:true}).scrollIntoViewIfNeeded();await p.screenshot({path:'/tmp/mobile-deck-toolbar.png'});
 assert.deepEqual(errors,[]);console.log('PASS toolbar placement, mouse/touch swap across layers, tap rearrangement, library header spacing and video-only import picker');
}finally{await browser.close();}
