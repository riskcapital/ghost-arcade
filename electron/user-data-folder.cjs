/**
 * Where Ghost Arcade Studio keeps its data.
 *
 * Every version before Studio kept it in a folder named after the code
 * package, "ghost-arcade" (package.json has no productName), and so does
 * Studio, so settings, the autosave, pairing and project media are all there
 * after updating. It is pinned so a product name added to package.json one day
 * cannot move it.
 *
 * Studio 2.0.0 used a new "Ghost Arcade" folder by mistake. Someone who started
 * on 2.0.0 with no earlier version keeps that one; everyone else goes back to
 * "ghost-arcade", where their data has been all along.
 */
const fs = require('fs');
const path = require('path');

function studioUserDataFolder(appData, exists = fs.existsSync) {
  const usual = path.join(appData, 'ghost-arcade');
  const studio200 = path.join(appData, 'Ghost Arcade');
  if (!exists(usual) && exists(path.join(studio200, 'Local Storage'))) return studio200;
  return usual;
}

module.exports = { studioUserDataFolder };
