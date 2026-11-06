import { describe, expect, it } from 'vitest';
import { parseEditorInput } from './editorLinks';

describe('parseEditorInput', () => {
  it('takes a username', () => {
    expect(parseEditorInput(' p5 ')).toEqual({ kind: 'user', username: 'p5' });
    expect(parseEditorInput('@codingtrain')).toEqual({ kind: 'user', username: 'codingtrain' });
    expect(parseEditorInput('jane.doe_99')).toEqual({ kind: 'user', username: 'jane.doe_99' });
  });

  it('takes a profile link', () => {
    for (const link of [
      'https://editor.p5js.org/p5',
      'https://editor.p5js.org/p5/sketches',
      'editor.p5js.org/p5/sketches/',
      'https://editor.p5js.org/p5/collections/abc123',
    ]) {
      expect(parseEditorInput(link), link).toEqual({ kind: 'user', username: 'p5' });
    }
  });

  it('takes a link to one sketch, in any of its views', () => {
    for (const link of [
      'https://editor.p5js.org/p5/sketches/4GluUaiHzPj',
      'editor.p5js.org/p5/full/4GluUaiHzPj',
      'https://editor.p5js.org/p5/embed/4GluUaiHzPj?autoplay=1',
      'https://preview.p5js.org/p5/present/4GluUaiHzPj',
      'https://editor.p5js.org/editor/p5/projects/4GluUaiHzPj',
    ]) {
      expect(parseEditorInput(link), link).toEqual({ kind: 'sketch', username: 'p5', id: '4GluUaiHzPj' });
    }
  });

  it('turns away anything else', () => {
    for (const input of ['', 'https://openprocessing.org/sketch/123', 'https://editor.p5js.org/', 'https://editor.p5js.org/p5/sketches/not%20an%20id', 'two words', '..']) {
      expect(parseEditorInput(input).kind, input).toBe('invalid');
    }
  });
});
