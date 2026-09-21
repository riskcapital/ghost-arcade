exports.default = async function beforePack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { ensureWindowsFfmpeg } = await import('../scripts/ensure-windows-ffmpeg.mjs');
  await ensureWindowsFfmpeg({ platform: 'win32', arch: context.arch === 1 ? 'x64' : String(context.arch) });
};
