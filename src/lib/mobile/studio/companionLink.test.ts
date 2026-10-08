import {describe,it,expect} from 'vitest';
import {parseCompanionLink,isLocalNetworkHost,companionHost,rememberedDesktop,forgetDesktop} from './companionLink';
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
 it('can be forgotten',()=>{
  const s=storage({'ghost-arcade_pairing_token':'ABCDEFGH12345678','ghost-arcade_server_url':'ws://192.168.1.3:9003','ga-mobile-studio-v1':'{}'});
  forgetDesktop(s);
  expect([...s.data.keys()]).toEqual(['ga-mobile-studio-v1']);
  expect(rememberedDesktop(s)).toBeNull();
 });
});
