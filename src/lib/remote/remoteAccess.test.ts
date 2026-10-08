import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { authorizedHost, permittedSource } = require('../../../server/remote-access.cjs');

describe('desktop privilege boundary', () => {
  const secret = 'a-long-private-host-secret-that-never-goes-in-QR';
  it('requires both the private credential and a loopback connection', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(authorizedHost(secret, secret, ip)).toBe(true);
    for (const ip of ['192.168.1.2', '127.0.0.1.evil', '::ffff:192.168.1.2', undefined]) expect(authorizedHost(secret, secret, ip)).toBe(false);
    expect(authorizedHost(secret, 'phone-pairing-code', '127.0.0.1')).toBe(false);
    expect(authorizedHost(null, '', '127.0.0.1')).toBe(false);
  });
  it('accepts exact advertised sources and refuses unadvertised URLs and executable content', () => {
    const select = (sourceType: string, sourceSrc: string) => permittedSource({layerId:'L1',sourceType,sourceSrc},
      [{src:'blob:known-video'}], [{src:'/ISF/Safe.fs'}, {src:'library-shader:mine'}]);
    expect(select('shader','/ISF/Safe.fs')).toBe(true);
    expect(select('shader','library-shader:mine')).toBe(true);
    expect(select('video','blob:known-video')).toBe(true);
    for (const src of ['http://localhost/admin','http://169.254.169.254/','file:///etc/passwd','/ISF/Safe.fs?redirect=evil','data:text/html,test']) {
      expect(select('shader',src)).toBe(false);
      expect(select('threejs',src)).toBe(false);
    }
    // App 1.0 falls back to the bundled manifest until the desktop's list arrives.
    expect(select('shader','./ISF/DM-Plasma%20Wave.fs')).toBe(true);
    expect(select('shader','/ISF/packs/Neon.fs')).toBe(true);
    for (const src of ['./ISF/../../secrets.fs','//evil.example/ISF/a.fs','./ISF/a.fs#x','http://x/ISF/a.fs','./ISF/a.js']) expect(select('shader',src)).toBe(false);
    expect(select('threejs','./ISF/a.fs')).toBe(false);
    expect(select('color','#ff8800')).toBe(true);
    expect(select('color','url(http://internal/)')).toBe(false);
  });
});
