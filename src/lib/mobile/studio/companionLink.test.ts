import {describe,it,expect} from 'vitest';
import {parseCompanionLink,isLocalNetworkHost,companionHost,rememberedDesktop,rememberedDesktopSocket,forgetDesktop} from './companionLink';
describe('native desktop pairing',()=>{
 const link='http://192.168.1.3:9002/?pair=ABCD-EFGH-1234-5678&ws=9003#/mobile';
 it('accepts browser and app QR links with the correct host and ports',()=>{const normalized=parseCompanionLink(link);expect(new URL(normalized).hostname).toBe('192.168.1.3');expect(new URL(normalized).searchParams.get('ws')).toBe('9003');expect(parseCompanionLink('ghostarcade://pair?url='+encodeURIComponent(link))).toBe(normalized);});
 it('rejects non-pairing URLs and credentials',()=>{for(const value of ['javascript:alert(1)','https://example.com','ghostarcade://other?url='+encodeURIComponent(link),'http://user:pass@localhost/?pair=ABCDEFGH12345678',link.replace('ws=9003','ws=99999')])expect(()=>parseCompanionLink(value)).toThrow();});
 it('does not retain arbitrary paths or query parameters',()=>{const u=new URL(parseCompanionLink(link.replace('/?','/evil?unused=yes&')));expect(u.pathname).toBe('/');expect(u.searchParams.has('unused')).toBe(false);});
});
describe('pairing links must point at the local network',()=>{
 const pair='/?pair=ABCDEFGH12345678';
 it('accepts loopback, private, link-local, CGNAT and .local hosts',()=>{
  for(const host of ['10.0.0.7','172.16.4.2','172.31.255.1','192.168.0.12','169.254.10.20','127.0.0.1','100.64.0.9','100.127.1.1','localhost','studio-mac.local','Studio-Mac.LOCAL','[::1]','[fe80::1c2b:3d4e]','[fd12:3456::9]'])
   expect(()=>parseCompanionLink(`http://${host}:9002${pair}`),host).not.toThrow();
  // A desktop written as a single number is still the same private address.
  expect(new URL(parseCompanionLink(`http://3232235779:9002${pair}`)).hostname).toBe('192.168.1.3');
 });
 it('refuses anything that could be someone else\'s server',()=>{
  for(const host of ['203.0.113.5','8.8.8.8','172.32.0.1','172.15.0.1','192.169.1.1','100.128.0.1','169.253.1.1','evil.example','192.168.1.3.evil.example','local','mylocal','notlocal.com','[2001:db8::1]','134744072'])
   expect(()=>parseCompanionLink(`http://${host}:9002${pair}`),host).toThrow(/not on your local network/);
  expect(()=>parseCompanionLink('ghostarcade://pair?url='+encodeURIComponent(`https://evil.example${pair}`))).toThrow(/not on your local network/);
 });
 it('names the host that was refused and the host to confirm',()=>{
  expect(()=>parseCompanionLink(`https://evil.example${pair}`)).toThrow(/evil\.example/);
  expect(companionHost(parseCompanionLink(`http://192.168.1.3:9002${pair}`))).toBe('192.168.1.3');
  expect(companionHost(parseCompanionLink(`http://[fe80::1]:9002${pair}`))).toBe('fe80::1');
  expect(isLocalNetworkHost('')).toBe(false);
 });
 it('explains a bad paste in plain words instead of the platform error',()=>{
  for(const value of ['not a link','','   ','192.168.1.3','ghostarcade://pair','ghostarcade://pair?url=nonsense']){
   let message='';try{parseCompanionLink(value);}catch(e){message=(e as Error).message;}
   expect(message,value).toMatch(/pairing link/i);
   expect(message).not.toMatch(/Failed to construct|Invalid URL/);
  }
 });
});
describe('the remembered desktop',()=>{
 function storage(initial:Record<string,string>){const data=new Map(Object.entries(initial));return {data,getItem:(k:string)=>data.get(k)??null,removeItem:(k:string)=>{data.delete(k);}};}
 it('is offered as a link to confirm again, built from what a successful connection stored',()=>{
  const s=storage({'ghost-arcade_pairing_token':'ABCDEFGH12345678','ghost-arcade_server_url':'ws://192.168.1.3:9003'});
  const remembered=rememberedDesktop(s)!;
  expect(remembered.host).toBe('192.168.1.3');
  const u=new URL(remembered.link);
  expect(u.searchParams.get('pair')).toBe('ABCDEFGH12345678');expect(u.searchParams.get('ws')).toBe('9003');expect(u.protocol).toBe('http:');
  expect(rememberedDesktop(storage({'ghost-arcade_pairing_token':'ABCDEFGH12345678','ghost-arcade_server_url':'wss://studio.local'}))!.link.startsWith('https://studio.local/')).toBe(true);
 });
 it('is nothing without both a code and an address, or when the address is not local',()=>{
  expect(rememberedDesktop(storage({'ghost-arcade_pairing_token':'ABCDEFGH12345678'}))).toBeNull();
  expect(rememberedDesktop(storage({'ghost-arcade_server_url':'ws://192.168.1.3:9001'}))).toBeNull();
  expect(rememberedDesktop(storage({'ghost-arcade_pairing_token':'ABCDEFGH12345678','ghost-arcade_server_url':'ws://203.0.113.5:9001'}))).toBeNull();
  expect(rememberedDesktop(null)).toBeNull();
 });
 it('gives the socket address for a job of its own (sending a scan), local network only',()=>{
  const socket=rememberedDesktopSocket(storage({'ghost-arcade_pairing_token':'abcd-efgh-1234-5678','ghost-arcade_server_url':'ws://192.168.1.3:9003/old?x=1#y'}))!;
  expect(socket).toEqual({host:'192.168.1.3',url:'ws://192.168.1.3:9003/?pair=ABCDEFGH12345678'});
  expect(rememberedDesktopSocket(storage({'ghost-arcade_pairing_token':'ABCDEFGH12345678','ghost-arcade_server_url':'ws://203.0.113.5:9001'}))).toBeNull();
  expect(rememberedDesktopSocket(storage({'ghost-arcade_pairing_token':'ABCDEFGH12345678','ghost-arcade_server_url':'http://192.168.1.3:9001'}))).toBeNull();
  expect(rememberedDesktopSocket(storage({'ghost-arcade_pairing_token':'ABCDEFGH12345678','ghost-arcade_server_url':'ws://u:p@192.168.1.3:9001'}))).toBeNull();
  expect(rememberedDesktopSocket(storage({'ghost-arcade_server_url':'ws://192.168.1.3:9001'}))).toBeNull();
  expect(rememberedDesktopSocket(null)).toBeNull();
 });
 it('can be forgotten',()=>{
  const s=storage({'ghost-arcade_pairing_token':'ABCDEFGH12345678','ghost-arcade_server_url':'ws://192.168.1.3:9003','ga-mobile-studio-v1':'{}'});
  forgetDesktop(s);
  expect([...s.data.keys()]).toEqual(['ga-mobile-studio-v1']);
  expect(rememberedDesktop(s)).toBeNull();
 });
});
describe('the ghostarcade.live/connect link from Mobile Control',()=>{
 const lan='http://192.168.1.3:9002/?pair=ABCD-EFGH-1234-5678&ws=9003#/mobile';
 const smart='https://ghostarcade.live/connect#host=192.168.1.3%3A9002&pair=ABCDEFGH12345678&ws=9003';
 it('comes down to the same desktop as the old LAN link',()=>{
  expect(parseCompanionLink(smart)).toBe(parseCompanionLink(lan));
  expect(parseCompanionLink('https://www.ghostarcade.live/connect/#host=192.168.1.3:9002&pair=ABCDEFGH12345678&ws=9003')).toBe(parseCompanionLink(lan));
  expect(parseCompanionLink('ghostarcade://pair?url='+encodeURIComponent(smart))).toBe(parseCompanionLink(lan));
 });
 it('keeps the default socket port implicit and accepts IPv6 and .local desktops',()=>{
  const u=new URL(parseCompanionLink('https://ghostarcade.live/connect#host=studio.local:9002&pair=ABCDEFGH12345678'));
  expect(u.host).toBe('studio.local:9002');expect(u.searchParams.has('ws')).toBe(false);
  expect(companionHost(parseCompanionLink('https://ghostarcade.live/connect#host=%5Bfe80%3A%3A1%5D%3A9002&pair=ABCDEFGH12345678'))).toBe('fe80::1');
 });
 it('refuses the link on any other website',()=>{
  for(const site of ['https://evil.example','https://ghostarcade.live.evil.example','https://ghostarcade.com'])
   expect(()=>parseCompanionLink(`${site}/connect#host=192.168.1.3:9002&pair=ABCDEFGH12345678`),site).toThrow(/not ghostarcade\.live/);
  // Plain http is not the website: it falls back to the LAN rules and has no pairing code.
  expect(()=>parseCompanionLink('http://ghostarcade.live/connect#host=192.168.1.3:9002&pair=ABCDEFGH12345678')).toThrow();
 });
 it('refuses a desktop that is not on the local network, and a malformed one',()=>{
  expect(()=>parseCompanionLink('https://ghostarcade.live/connect#host=203.0.113.5:9002&pair=ABCDEFGH12345678')).toThrow(/not on your local network/);
  expect(()=>parseCompanionLink('https://ghostarcade.live/connect#host=evil.example&pair=ABCDEFGH12345678')).toThrow(/not on your local network/);
  for(const value of ['https://ghostarcade.live/connect','https://ghostarcade.live/connect#pair=ABCDEFGH12345678','https://ghostarcade.live/connect#host=192.168.1.3/evil&pair=ABCDEFGH12345678','https://ghostarcade.live/connect#host=user@192.168.1.3&pair=ABCDEFGH12345678'])
   expect(()=>parseCompanionLink(value),value).toThrow(/desktop address/);
  expect(()=>parseCompanionLink('https://ghostarcade.live/connect#host=192.168.1.3:9002')).toThrow(/pairing code/);
  expect(()=>parseCompanionLink('https://ghostarcade.live/connect#host=192.168.1.3:9002&pair=ABCDEFGH12345678&ws=99999')).toThrow(/port/);
  expect(()=>parseCompanionLink('https://ghostarcade.live/connect#host=192.168.1.3:99999&pair=ABCDEFGH12345678')).toThrow(/pairing link/);
 });
 it('drops anything else in the fragment',()=>{
  const u=new URL(parseCompanionLink(smart+'&next=https%3A%2F%2Fevil.example'));
  expect(u.pathname).toBe('/');expect([...u.searchParams.keys()].sort()).toEqual(['pair','ws']);expect(u.hash).toBe('#/mobile');
 });
});
