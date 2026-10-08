import {writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage();await page.goto(process.env.MOBILE_STUDIO_URL || 'http://127.0.0.1:1437/native-mobile.html');
 const result=await page.evaluate(async()=>{
  const {StandaloneRenderer}=await import('/src/lib/mobile/standaloneRenderer.ts');
  const {MOBILE_SHADERS}=await import('/src/lib/mobile/standaloneShaderList.ts');
  const {standaloneShaderPaths}=await import('/src/lib/mobile/studio/shaderAvailability.ts');
  const library=MOBILE_SHADERS.filter(s=>!s.requiresImage&&standaloneShaderPaths.has(s.path));
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=36;
  const renderer=new StandaloneRenderer(canvas);const failures=[];let passed=0;
  for(const shader of library){try{
    const res=await fetch(encodeURI('/'+shader.path));if(!res.ok)throw Error('Missing source');
    await renderer.loadShaderSource(await res.text(),shader.audioNative,shader.audioInject);
    renderer.setShaderInputs(shader.defaults||{});renderer.drawFrame(64,36);
    const gl=canvas.getContext('webgl');const err=gl.getError();if(err)throw Error('GL '+err);passed++;
  }catch(error){failures.push({id:shader.id,error:String(error)})}}
  renderer.destroy();return {total:library.length,passed,failures};
 });writeFileSync('/tmp/mobile-shader-audit.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}
