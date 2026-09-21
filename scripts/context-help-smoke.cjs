// Run with Electron while the local Vite server is running. Uses an isolated profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-context-help-'));
app.setPath('userData', profile);
const fixture = path.join(__dirname, '../public/__context_help_smoke.html');
if (fs.existsSync(fixture)) throw new Error('Help smoke fixture already exists; refusing to overwrite it.');
fs.writeFileSync(fixture, `<!doctype html><html><body style="background:#090c11;color:white;font:14px system-ui;padding:40px">
<section data-help-page="clip-launcher"><button id="autopilot" title="Autopilot action" aria-describedby="existing">A</button><span id="existing">Layer one</span>
<label>Opacity <input id="range" type="range"></label><button id="disabled" disabled title="Resync unavailable while following Ableton Link">Resync</button>
<button id="literal" data-help="&lt;img src=x onerror=alert(1)&gt;">Literal</button></section>
<div popover id="tray" data-help-page="effects"><button id="lut" title="Load a 3D .cube LUT">LUT</button></div>
<script type="module">import {installContextHelp} from '/src/lib/help/contextHelp.ts'; window.disposeHelp=installContextHelp(); window.helpReady=true;</script></body></html>`);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 700, height: 440, show: false, webPreferences: { sandbox: true } });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('[browser]', message); });
  try {
    await win.loadURL(`${process.env.GA_HELP_TEST_URL || 'http://127.0.0.1:1420'}/__context_help_smoke.html`);
    for (let i=0; i<150; i++) {
      if (await win.webContents.executeJavaScript('Boolean(window.helpReady)')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const result = await win.webContents.executeJavaScript(`(async () => {
      if (!window.helpReady) throw new Error('Help module did not load');
      const checks=[]; const assert=(condition,message)=>{if(!condition)throw new Error(message);checks.push(message)};
      const card=document.querySelector('.ga-context-help'); const a=document.querySelector('#autopilot');
      const hover=el=>el.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));
      const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const key=k=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
      hover(a); assert(card.hidden,'Hover delay avoids flashing while moving'); await sleep(720);
      assert(!card.hidden,'Hover opens help');
      assert(card.querySelector('strong').textContent==='Autopilot action','Icon uses its own label, not a neighboring field');
      assert(!document.querySelector('vite-error-overlay'),'No development compile error overlay');
      assert(card.querySelector('a').href.endsWith('/docs/clip-launcher'),'Correct feature documentation link');
      assert(a.getAttribute('aria-describedby').includes('existing'),'Existing accessible description preserved');
      assert(!a.hasAttribute('title'),'Native title suppressed while custom help owns it');
      a.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:card}));hover(card);await sleep(300);
      assert(!card.hidden,'Pointer can move into the help card');
      a.focus(); key('F1'); assert(document.activeElement===card.querySelector('a'),'F1 focuses documentation link');
      key('Escape'); assert(card.hidden && document.activeElement===a,'Escape returns keyboard focus');
      assert(a.title==='Autopilot action' && a.getAttribute('aria-describedby')==='existing','Dismiss restores title and accessibility');
      const disabled=document.querySelector('#disabled');hover(disabled);await sleep(720);
      assert(card.textContent.includes('unavailable while following'),'Disabled reason remains available');
      disabled.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      assert(card.hidden,'Operating controls dismisses help');
      document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
      const range=document.querySelector('#range');hover(range);await sleep(720);
      assert(card.querySelector('strong').textContent==='Opacity','Wrapped label resolves without input values');
      document.dispatchEvent(new Event('scroll'));assert(card.hidden,'Scrolling dismisses help');
      range.focus();hover(range);await sleep(720);let escapeReachedControl=false;
      range.addEventListener('keydown',e=>{if(e.key==='Escape')escapeReachedControl=true},{once:true});
      key('Escape');assert(card.hidden&&escapeReachedControl,'Help does not swallow Escape needed by the focused control');
      hover(document.querySelector('#literal'));await sleep(720);
      assert(!card.querySelector('img') && card.textContent.includes('<img'),'Authored descriptions render as text, never HTML');
      const tray=document.querySelector('#tray');tray.showPopover();hover(document.querySelector('#lut'));await sleep(720);
      assert(card.matches(':popover-open'),'Help is in the top layer above settings trays');
      const rect=card.getBoundingClientRect();assert(rect.left>=0 && rect.right<=innerWidth && rect.top>=0 && rect.bottom<=innerHeight,'Help fits the viewport');
      window.lastHelpUrl='';window.open=url=>{window.lastHelpUrl=url};card.querySelector('a').click();
      assert(window.lastHelpUrl==='https://ghostarcade.live/docs/effects','Documentation click opens the feature URL');
      tray.hidePopover();hover(a);await sleep(720);
      return checks;
    })()`);
    await win.webContents.capturePage().then(image => fs.writeFileSync(path.join(os.tmpdir(), 'ga-help-card.png'), image.toPNG()));
    await win.webContents.executeJavaScript(`window.disposeHelp(); if(document.querySelector('.ga-context-help'))throw new Error('Help cleanup failed');`);
    console.log(JSON.stringify({ passed: result.length + 1, checks: [...result, 'Cleanup removes help'] }, null, 2));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
app.on('will-quit', () => { fs.rmSync(fixture, { force: true }); });
process.on('exit', () => { fs.rmSync(fixture, { force: true }); });
