import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1194,height:834}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.MOBILE_STUDIO_URL || 'http://127.0.0.1:1437/native-mobile.html');await page.getByRole('button',{name:'Dual deck',exact:true}).waitFor();
 assert.equal(await page.getByRole('slider',{name:'Deck mix',exact:true}).count(),0);
 await page.getByRole('button',{name:/Launch .* on row 2/}).first().click();await page.waitForTimeout(300);
 await page.getByRole('button',{name:'Dual deck',exact:true}).click();
 await page.getByRole('slider',{name:'Deck mix',exact:true}).fill('0.4');
 await page.screenshot({path:'/tmp/mobile-decks-ipad.png',fullPage:true});
 await page.getByRole('button',{name:'Arrange clips',exact:true}).click();
 await page.getByRole('button',{name:/Replace .* on row 1/}).first().click();
 await page.getByRole('textbox',{name:'Search shaders'}).fill('Infinite Grid');
 await page.locator('.library-grid button').first().click();
 assert.ok(await page.getByRole('button',{name:/Infinite Grid on row 1/}).isVisible());
 await page.getByRole('button',{name:'Launch Infinite Grid on row 1',exact:true}).click();
 await page.waitForTimeout(350);
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/mobile-decks-iphone.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.reload();await page.getByRole('button',{name:'Launch Infinite Grid on row 1',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS direct row launching, single/dual deck, fader, arrange/library assignment, full catalog search, mobile bounds and persistence');
}finally{await browser.close()}
