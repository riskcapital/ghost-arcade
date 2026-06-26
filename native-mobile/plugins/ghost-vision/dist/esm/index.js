import { registerPlugin } from '@capacitor/core';

export const GhostVision = registerPlugin('GhostVision', {
  web: () => import('./web.js').then(m => new m.GhostVisionWeb()),
});
