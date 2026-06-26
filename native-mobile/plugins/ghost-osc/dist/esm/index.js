import { registerPlugin } from '@capacitor/core';

export const GhostOsc = registerPlugin('GhostOsc', {
  web: () => import('./web.js').then(m => new m.GhostOscWeb()),
});
