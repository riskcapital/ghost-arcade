import {describe,it,expect} from 'vitest';
import {parseCompanionLink} from './companionLink';
describe('native desktop pairing',()=>{
 const link='http://192.168.1.3:9002/?pair=ABCD-EFGH-1234-5678&ws=9003#/mobile';
 it('accepts browser and app QR links with the correct host and ports',()=>{const normalized=parseCompanionLink(link);expect(new URL(normalized).hostname).toBe('192.168.1.3');expect(new URL(normalized).searchParams.get('ws')).toBe('9003');expect(parseCompanionLink('ghostarcade://pair?url='+encodeURIComponent(link))).toBe(normalized);});
 it('rejects non-pairing URLs and credentials',()=>{for(const value of ['javascript:alert(1)','https://example.com','ghostarcade://other?url='+encodeURIComponent(link),'http://user:pass@localhost/?pair=ABCDEFGH12345678',link.replace('ws=9003','ws=99999')])expect(()=>parseCompanionLink(value)).toThrow();});
 it('does not retain arbitrary paths or query parameters',()=>{const u=new URL(parseCompanionLink(link.replace('/?','/evil?unused=yes&')));expect(u.pathname).toBe('/');expect(u.searchParams.has('unused')).toBe(false);});
});
