import app from './app';
import audioTools from './audioTools';
import common from './common';
import controlOverlays from './controlOverlays';
import creative from './creative';
import effects from './effects';
import effectTools from './effectTools';
import geometryTools from './geometryTools';
import gpuTools from './gpuTools';
import inputControls from './inputControls';
import layers from './layers';
import led from './led';
import lighting from './lighting';
import liveVisuals from './liveVisuals';
import media from './media';
import mediaTools from './mediaTools';
import mobile from './mobile';
import mobileAdvanced from './mobileAdvanced';
import mobileControls from './mobileControls';
import outputExtras from './outputExtras';
import performanceTools from './performanceTools';
import presets from './presets';
import projection from './projection';
import screens from './screens';
import sequencer from './sequencer';
import settings from './settings';
import shaderAi from './shaderAi';
import shellExtras from './shellExtras';
import spatial from './spatial';
import stage3d from './stage3d';
import stageShow from './stageShow';
import standalone from './standalone';
import systemUi from './systemUi';
import textTools from './textTools';
import timeline from './timeline';
import tourTimeline from './tourTimeline';
import visionAi from './visionAi';
import vj from './vj';
import vjExtras from './vjExtras';
import warpTools from './warpTools';
import windowApps from './windowApps';

export default { app,
  audioTools,
  common,
  controlOverlays,
  creative, effects,
  effectTools,
  geometryTools,
  gpuTools,
  inputControls,
  layers,
  led,
  lighting,
  liveVisuals, media,
  mediaTools,
  model3d: spatial.model3d,
  mobile,
  mobileAdvanced,
  mobileControls,
  outputExtras,
  performanceTools,
  presets,
  projection, screens,
  sequencer,
  settings,
  shaderAi,
  shellExtras,
  spatial,
  splat: spatial.splat,
  stage3d,
  stageShow,
  standalone,
  systemUi,
  textTools,
  timeline,
  tourTimeline,
  visionAi,
  vj,
  vjExtras,
  warpTools,
  windowApps,
};
