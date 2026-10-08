import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const b=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try{
 const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await p.goto('http://127.0.0.1:1437/native-mobile.html');
 await p.getByRole('button',{name:'Add clip to row 1 column 4',exact:true}).click();
 const bounds=await p.evaluate(()=>{const panel=document.querySelector('.panel-scroll'),grid=document.querySelector('.library-grid');return{page:document.documentElement.scrollWidth,width:innerWidth,panel:panel.getBoundingClientRect().width,grid:grid.getBoundingClientRect().width,scroll:panel.scrollHeight-panel.clientHeight};});
 assert.equal(bounds.page,bounds.width);assert.ok(bounds.grid<390);assert.ok(bounds.panel<=390);assert.ok(bounds.scroll>500);
 await p.locator('.library-grid button').nth(40).scrollIntoViewIfNeeded();assert.ok(await p.locator('.panel-scroll').evaluate(el=>el.scrollTop)>100);
 await p.locator('.panel-scroll').evaluate(el=>el.scrollTop=0);await p.screenshot({path:'/tmp/mobile-library-fixed.png'});
 await p.getByRole('button',{name:'＋ Front camera',exact:true}).click();await p.getByRole('button',{name:'Launch Front camera on row 1',exact:true}).click();await p.waitForTimeout(500);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('ga-mobile-studio-v1')).layers[0].fit),'fill');
 await p.getByRole('button',{name:'Flux',exact:true}).click();const on=p.getByRole('button',{name:'Flux stay on',exact:true});assert.equal(await on.innerText(),'Off');await on.click();assert.equal(await on.innerText(),'On');assert.ok(await p.getByRole('button',{name:'Release Flux',exact:true}).isVisible());
 const pad=p.getByRole('application',{name:/Flux XY pad/});await pad.tap();assert.ok(await p.getByRole('button',{name:'Release Flux',exact:true}).isVisible());await on.click();assert.equal(await on.innerText(),'Off');assert.equal(await p.getByRole('button',{name:'Release Flux',exact:true}).count(),0);await pad.tap();assert.equal(await p.getByRole('button',{name:'Release Flux',exact:true}).count(),0);
 console.log('PASS bounded scrollable phone library, camera Fill default, Flux On retains / Off releases');
}finally{await b.close();}
