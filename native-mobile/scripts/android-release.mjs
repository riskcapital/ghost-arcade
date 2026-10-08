import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
const mobile=fileURLToPath(new URL('../',import.meta.url));
const root=fileURLToPath(new URL('../../',import.meta.url));
for(const key of ['GHOST_ANDROID_KEYSTORE','GHOST_ANDROID_STORE_PASSWORD','GHOST_ANDROID_KEY_ALIAS','GHOST_ANDROID_KEY_PASSWORD']) {
 if(!process.env[key])throw new Error(`Missing ${key}. Release signing is required; no debug key fallback.`);
}
if(!existsSync(process.env.GHOST_ANDROID_KEYSTORE))throw new Error('Release keystore does not exist.');
function run(command,args,cwd){const result=spawnSync(command,args,{cwd,env:process.env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
run('npm',['run','build:native-mobile'],root);
run(process.platform==='win32'?'npx.cmd':'npx',['cap','sync','android'],mobile);
run(process.platform==='win32'?'gradlew.bat':'./gradlew',[':app:bundleRelease',':app:lintRelease'],mobile+'android');
console.log('Signed Android bundle: native-mobile/android/app/build/outputs/bundle/release/app-release.aab');
