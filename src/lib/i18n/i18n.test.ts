import { describe, expect, it } from 'vitest';
import { buildPatterns, normalizeLanguage, translateText, UI_LANGUAGES } from './index';

const pack = {
  'Add Layer': 'Añadir capa',
  'Layers: {0}': 'Capas: {0}',
  '{0} of {1}': '{1} de {0}',
  'Selected: {0}': 'Seleccionado: {0}',
  '{0}': 'never',
};

describe('interface translation', () => {
  const patterns = buildPatterns(pack);

  it('translates exact text', () => {
    expect(translateText('Add Layer', pack, patterns)).toBe('Añadir capa');
  });

  it('fills numbers back into a numbered entry, in the order the language needs', () => {
    expect(translateText('Layers: 4', pack, patterns)).toBe('Capas: 4');
    expect(translateText('3 of 12', pack, patterns)).toBe('12 de 3');
    expect(translateText('Layers: 1.50', pack, patterns)).toBe('Capas: 1.50');
  });

  it('matches text with a changing word against its pattern', () => {
    expect(translateText('Selected: Wall', pack, patterns)).toBe('Seleccionado: Wall');
  });

  it('leaves unknown text alone and never builds a match-anything pattern', () => {
    expect(translateText('Something else', pack, patterns)).toBeNull();
    expect(patterns.some((p) => p.regex.test('anything at all'))).toBe(false);
  });

  it('never lets a short pattern swallow a sentence', () => {
    const loose = { '{0} layer{1}': '{0} capa{1}', '{0}: audio files are not layers. {1}': '{0}: los archivos de audio no son capas. {1}' };
    const loosePatterns = buildPatterns(loose);
    expect(translateText('12 layers', loose, loosePatterns)).toBe('12 capas');
    expect(translateText('Audio files are not layers, drop them on the Show timeline', loose, loosePatterns)).toBeNull();
  });

  it('tries the most specific pattern first, whatever the pack order', () => {
    const loose = { '{0} layer{1}': '{0} capa{1}', '{0}: audio files are not layers. {1}': '{0}: los archivos de audio no son capas. {1}' };
    expect(translateText('song.wav: audio files are not layers. Drop it on the timeline.', loose, buildPatterns(loose)))
      .toBe('song.wav: los archivos de audio no son capas. Drop it on the timeline.');
  });

  it('falls back to English for an unknown language code', () => {
    expect(normalizeLanguage('xx')).toBe('en');
    expect(normalizeLanguage('ja')).toBe('ja');
    expect(UI_LANGUAGES[0].code).toBe('en');
  });
});
