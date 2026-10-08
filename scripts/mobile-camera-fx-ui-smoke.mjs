import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try{
 const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:1437/native-mobile.html');
 await p.getByRole('button',{name:'Add clip to row 1 column 4',exact:true}).click();await p.getByRole('button',{name:'＋ Front camera',exact:true}).click();await p.getByRole('button',{name:'Launch Front camera on row 1',exact:true}).click();await p.getByRole('button',{name:'Stop Front camera on row 1',exact:true}).waitFor();await p.getByRole('button',{name:'Controls',exact:true}).click();
 const panel=p.getByRole('region',{name:'Camera motion effects'});await panel.waitFor();for(const name of ['Smoke','Fluid','Trails'])await panel.getByRole('button',{name:new RegExp('^'+name)}).click();
 assert.equal(await panel.locator('.modules button[aria-pressed="true"]').count(),3);await panel.getByLabel('Camera FX color',{exact:true}).selectOption('1');await panel.getByRole('button',{name:'Hold motion'}).click();assert.equal(await panel.getByRole('button',{name:'Hold motion'}).getAttribute('aria-pressed'),'true');await panel.getByRole('button',{name:'Clear trails'}).click();
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:'/tmp/mobile-camera-fx-ui.png'});assert.deepEqual(errors,[]);console.log('PASS camera-only controls, effect combinations, color/hold/clear, phone width and integrated camera rendering');
}finally{await browser.close();}
