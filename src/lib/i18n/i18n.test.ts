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

  it('falls back to English for an unknown language code', () => {
    expect(normalizeLanguage('xx')).toBe('en');
    expect(normalizeLanguage('ja')).toBe('ja');
    expect(UI_LANGUAGES[0].code).toBe('en');
  });
});
