import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');const b=await chromium.launch({channel:'chrome',headless:true});
try{const p=await b.newPage({viewport:{width:390,height:844}});await p.goto('http://127.0.0.1:1437/native-mobile.html');
 assert.equal(await p.getByRole('button',{name:'Record output',exact:true}).count(),0);
 await p.getByRole('button',{name:'Blocks',exact:true}).click();await p.getByRole('button',{name:'Save as new block',exact:true}).click();await p.getByRole('button',{name:'Save as new block',exact:true}).click();
 await p.getByRole('button',{name:'Clips',exact:true}).click();await p.getByRole('button',{name:'Add clip to row 1 column 4',exact:true}).click();await p.getByRole('textbox',{name:'Search shaders'}).fill('Infinite Grid');await p.locator('.library-grid button').first().click();await p.waitForTimeout(400);
 const before=await p.evaluate(()=>JSON.parse(localStorage.getItem('ga-mobile-studio-v1')));
 await p.getByRole('button',{name:'Blocks',exact:true}).click();await p.locator('.scene-pad').nth(0).click();await p.waitForTimeout(350);
 let s=await p.evaluate(()=>JSON.parse(localStorage.getItem('ga-mobile-studio-v1')));assert.equal(s.launchGrid[0][3],null);assert.equal(s.layers[0].clipId,before.layers[0].clipId);assert.equal(s.scenes[1].launchGrid[0][3],before.launchGrid[0][3]);
 await p.getByRole('button',{name:'Blocks',exact:true}).click();await p.locator('.scene-pad').nth(1).click();await p.waitForTimeout(350);await p.reload();await p.waitForTimeout(350);s=await p.evaluate(()=>JSON.parse(localStorage.getItem('ga-mobile-studio-v1')));assert.equal(s.launchGrid[0][3],before.launchGrid[0][3]);console.log('PASS independent saved Blocks, switching preserves live clips, reload persistence, recording removed');
}finally{await b.close();}
