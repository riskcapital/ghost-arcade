import { describe, it, expect } from 'vitest';
import { clipFilePath, clipFilePaths, fileNameOf, localPathFromUrl, matchFoundFiles } from './clipFiles';

describe('clip files', () => {
  it('reads the path out of an app or file URL', () => {
    expect(localPathFromUrl('ghost-asset://localhost/Users/me/My%20Show/a%231.mov')).toBe('/Users/me/My Show/a#1.mov');
    expect(localPathFromUrl('file:///Users/me/a.mov')).toBe('/Users/me/a.mov');
    expect(localPathFromUrl('ghost-asset://localhost/C:/shows/a.mov')).toBe('C:/shows/a.mov');
    expect(localPathFromUrl('blob:http://localhost/1')).toBeNull();
    expect(localPathFromUrl('https://example.com/a.mov')).toBeNull();
    expect(localPathFromUrl('ghost-asset://localhost/%E0%A4%A')).toBeNull();
  });

  it('finds the file behind a clip, wherever it is recorded', () => {
    expect(clipFilePath({ src: 'ghost-asset://localhost/a/b.mov' })).toBe('/a/b.mov');
    expect(clipFilePath({ src: 'blob:x', _assetRef: { kind: 'local-file', originalPath: '/a/c.mov' } })).toBe('/a/c.mov');
    // A URL or a built-in source is not a file, whatever its reference says.
    expect(clipFilePath({ src: 'https://example.com/a.mov', _assetRef: { kind: 'local-file', originalPath: '/a/c.mov' } })).toBeNull();
    expect(clipFilePath({ src: 'plugin://performer-world' })).toBeNull();
    expect(clipFilePath(null)).toBeNull();
  });

  it('lists each file once across grids', () => {
    const a = { src: 'ghost-asset://localhost/a.mov' }, b = { src: 'ghost-asset://localhost/b.mov' };
    expect(clipFilePaths([[[a, null, b]], undefined, [[a], [{ src: 'shader-1' }]]])).toEqual(['/a.mov', '/b.mov']);
  });

  it('pairs missing files with a folder search by name, ignoring case', () => {
    const moves = matchFoundFiles(
      ['/old/pack/One.mov', '/old/pack/two.mov', 'C:\\old\\three.mov', '/same/four.mov'],
      { 'one.mov': '/new/One.mov', 'three.mov': 'D:\\new\\three.mov', 'four.mov': '/same/four.mov' },
    );
    expect(moves).toEqual({ '/old/pack/One.mov': '/new/One.mov', 'C:\\old\\three.mov': 'D:\\new\\three.mov' });
    expect(fileNameOf('C:\\old\\three.mov')).toBe('three.mov');
  });
});

describe('shader clips', () => {
  it('never count as missing a file: their code is in the project', () => {
    expect(clipFilePath({ type: 'shader', shaderCode: 'void main(){}', src: 'ghost-asset://localhost/Users/me/Shows/ISF/Featured-tide.fs' })).toBeNull();
  });
  it('still check a video clip', () => {
    expect(clipFilePath({ type: 'video', src: 'ghost-asset://localhost/Users/me/clip.mov' })).toBe('/Users/me/clip.mov');
  });
});
