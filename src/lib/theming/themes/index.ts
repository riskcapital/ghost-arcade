// Theme registry. Add new themes here so the Settings picker + the
// store both pick them up automatically.

import type { Theme } from '../types';
import { STUDIO_THEME } from './studio';
import { ARCADE_THEME } from './arcade';

export const THEMES: Theme[] = [STUDIO_THEME, ARCADE_THEME];

export const DEFAULT_THEME_ID = 'studio';

export function findTheme(id: string): Theme {
  return THEMES.find(t => t.id === id) ?? STUDIO_THEME;
}
