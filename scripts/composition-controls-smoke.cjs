// Run with Electron and Vite; verifies real Mapping inspector scroll geometry.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ga-composition-controls-')));
const fixture = path.join(__dirname, '../public/__composition_controls_smoke.html');
if (fs.existsSync(fixture)) throw new Error('Existing fixture; refusing to overwrite.');
fs.writeFileSync(fixture, `<!doctype html><body style="margin:0;background:#090c11;color:white"><div id="host" style="height:600px;width:320px"></div>
<script type="module">
import {mount,tick} from '/node_modules/.vite/deps/svelte.js';import Panel from '/src/lib/components/LayerPanel.svelte';import {project} from '/src/lib/stores/layers.ts';
project.addLayer('Test layer');project.setMappingCompositionEnabled(true);
for(let i=0;i<12;i++)project.addMappingCompositionEffect('blur');
mount(Panel,{target:document.getElementById('host')});await tick();window.fixtureReady=true;
</script></body>`);
process.on('exit', () => fs.rmSync(fixture, { force: true }));
app.whenReady().then(async () => {
 const win = new BrowserWindow({width:800,height:700,show:false,webPreferences:{sandbox:true}});
 win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('[browser]', message); });
 try {
  await win.loadURL(`${process.env.GA_HELP_TEST_URL || 'http://localhost:1438'}/__composition_controls_smoke.html`);
  for(let i=0;i<300;i++){if(await win.webContents.executeJavaScript('!!window.fixtureReady'))break;await new Promise(r=>setTimeout(r,100));}
  const result=await win.webContents.executeJavaScript(`(async()=>{
   if(!window.fixtureReady)throw new Error('Fixture failed to load');
   const wait=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   if(!document.querySelector('.composition-edit-btn'))throw new Error('Composition button missing: '+document.body.innerText.slice(0,1000));
   document.querySelector('.composition-edit-btn').click();await wait();
   if(!document.querySelector('.composition-effect-name'))throw new Error('Composition effects missing: '+document.body.innerText.slice(0,1000));
   document.querySelector('.composition-effect-name').click();await wait();
   const results=[];
   for(const height of [600,420]){
    document.querySelector('#host').style.height=height+'px';await wait();
    const region=document.querySelector('.mapping-composition-panel');
    if(!(region.clientHeight>0&&region.scrollHeight>region.clientHeight))throw new Error('No bounded scroll area at '+height);
    region.scrollTop=region.scrollHeight;await wait();
    const last=region.querySelector('.composition-effect-item:last-child').getBoundingClientRect();
    const bounds=region.getBoundingClientRect();
    if(!(region.scrollTop>0&&last.bottom<=bounds.bottom+1&&last.bottom>bounds.top))throw new Error('Cannot reach final effect at '+height);
    if(document.querySelector('.layer-list').getBoundingClientRect().height<60)throw new Error('Layer list lost its usable height');
    results.push({height,viewport:region.clientHeight,content:region.scrollHeight,scrollTop:region.scrollTop});
   }
   return results;
  })()`);
  fs.writeFileSync(path.join(os.tmpdir(),'ga-composition-scroll.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({passed:true,results:result},null,2));app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
