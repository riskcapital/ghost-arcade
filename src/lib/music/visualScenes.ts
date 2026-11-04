/**
 * The visual voice library and each set's visual scenes.
 *
 * A scene is a stack of visual voices, each following its own sound, all
 * drawn in the set's palette: one ink and one accent. Voices draw light on
 * black and screen-blend, so they add up the same in any order. Scenes load
 * into a Music Studio instance (studioPlugin.ts, studioTarget.ts): a clip in
 * a VJ cell or a mapping layer, never across the deck's rows.
 */

import { parseISF } from '../isf/parser';
import { VOICE_SOURCE_INPUT, type VoiceSourceId } from './visualVoices';
import type { StudioSet } from './studioSets';
import { STUDIO_PALETTES } from './studioPlugin';

export interface VoiceShader {
  file: string;
  name: string;
  /** The set it was drawn for. Any voice works in any set. */
  family: StudioSet;
  /** One line on what it is. */
  blurb: string;
  /** A themed collection it belongs to, with its own tab in the visual browser. */
  pack?: VoicePack;
}

export type VoicePack = 'glitch' | 'cosmos';
export const VOICE_PACKS: readonly { id: VoicePack; label: string }[] = [{ id: 'glitch', label: 'Glitch' }, { id: 'cosmos', label: 'Cosmos' }];

export const VOICE_SHADERS: readonly VoiceShader[] = [
  { file: 'VX-Barcode.fs', name: 'Barcode', family: 'berlin', blurb: 'Black and white data stripes that re-roll on every hit' },
  { file: 'VX-LightLines.fs', name: 'Light Lines', family: 'berlin', blurb: 'Frames of light rushing down a dark corridor' },
  { file: 'VX-Panels.fs', name: 'Panels', family: 'berlin', blurb: 'Architectural light panels that fire in patterns' },
  { file: 'VX-Glyphs.fs', name: 'Glyphs', family: 'berlin', blurb: 'A readout of the notes as they play' },
  { file: 'VX-EchoRings.fs', name: 'Echo Rings', family: 'dub', blurb: 'Rings that repeat like a tape echo' },
  { file: 'VX-Smoke.fs', name: 'Smoke', family: 'dub', blurb: 'Smoke rising from where each bass note lands' },
  { file: 'VX-Scope.fs', name: 'Scope', family: 'dub', blurb: 'The notes drawn as oscilloscope figures' },
  { file: 'VX-Nebula.fs', name: 'Nebula', family: 'bath', blurb: 'Deep veils of light that open as pads swell' },
  { file: 'VX-Cymatics.fs', name: 'Cymatics', family: 'bath', blurb: 'Sand settling into the figure of each note' },
  { file: 'VX-Aurora.fs', name: 'Aurora', family: 'bath', blurb: 'A curtain of light for every note of the chord' },
  { file: 'VX-VideoSynth.fs', name: 'Video Synth', family: 'analog', blurb: 'Oscillators in the raster, tuned to the notes' },
  { file: 'VX-Wobbulator.fs', name: 'Wobbulator', family: 'analog', blurb: 'Scan lines bent by the sound itself' },
  { file: 'VX-ScanField.fs', name: 'Scan Field', family: 'analog', blurb: 'A scan-processor landscape that ripples on each hit' },
  { file: 'VX-Feedback.fs', name: 'Feedback', family: 'analog', blurb: 'Camera-into-monitor feedback, seeded by hits' },  { file: 'VX-Automaton.fs', name: 'Automaton', family: 'berlin', blurb: 'A cellular automaton that prints one row per hit' },
  { file: 'VX-Compression.fs', name: 'Compression', family: 'berlin', blurb: 'Codec blocks rebuilt from a few patterns' },
  { file: 'VX-Datamosh.fs', name: 'Datamosh', family: 'berlin', blurb: 'A picture smeared along its own motion' },
  { file: 'VX-DataPlot.fs', name: 'Data Plot', family: 'berlin', blurb: 'The notes as scientific plots in hairlines' },
  { file: 'VX-DataStream.fs', name: 'Data Stream', family: 'berlin', blurb: 'Rows of bits streaming across the frame' },
  { file: 'VX-Spectra.fs', name: 'Spectra', family: 'berlin', blurb: 'A one-bit spectrum of the sounding notes' },
  { file: 'VX-TestPattern.fs', name: 'Test Pattern', family: 'berlin', blurb: 'Test signal zones that step on each hit' },
  { file: 'VX-BitCounter.fs', name: 'Bit Counter', family: 'berlin', blurb: 'Every note written out in binary columns' },
  { file: 'VX-GlitchCollage.fs', name: 'Glitch Collage', family: 'berlin', blurb: 'Panels of a picture cut and re-cut on hits' },
  { file: 'VX-LedGrid.fs', name: 'LED Grid', family: 'berlin', blurb: 'A wall of LEDs playing the rhythm' },
  { file: 'VX-Monolith.fs', name: 'Monolith', family: 'berlin', blurb: 'Stone monoliths under two hard lights' },
  { file: 'VX-Oscillogram.fs', name: 'Oscillogram', family: 'berlin', blurb: 'A scrolling trace of the playing note' },
  { file: 'VX-PixelSort.fs', name: 'Pixel Sort', family: 'berlin', blurb: 'A picture whose pixels sort into streaks' },
  { file: 'VX-PointCloud.fs', name: 'Point Cloud', family: 'berlin', blurb: 'A turning cloud of points on a torus' },
  { file: 'VX-PulseBars.fs', name: 'Pulse Bars', family: 'berlin', blurb: 'Tall light bars fired one after another' },
  { file: 'VX-Scanner.fs', name: 'Scanner', family: 'berlin', blurb: 'A bar of light swept across on each hit' },
  { file: 'VX-SignalTear.fs', name: 'Signal Tear', family: 'berlin', blurb: 'Bands of a figure torn sideways on hits' },
  { file: 'VX-TunnelLines.fs', name: 'Tunnel Lines', family: 'berlin', blurb: 'Hairline rings receding to a point' },
  { file: 'VX-HazeBeams.fs', name: 'Haze Beams', family: 'dub', blurb: 'Narrow beams through smoke, one per note' },
  { file: 'VX-RippleTank.fs', name: 'Ripple Tank', family: 'dub', blurb: 'Contour lines of water rung by each hit' },
  { file: 'VX-SpeakerCone.fs', name: 'Speaker Cone', family: 'dub', blurb: 'A big driver pushing with the bass' },
  { file: 'VX-SpeakerStack.fs', name: 'Speaker Stack', family: 'dub', blurb: 'A sound-system stack seen from low down' },
  { file: 'VX-Spring.fs', name: 'Spring', family: 'dub', blurb: 'Waves running down a spring reverb' },
  { file: 'VX-TapeLoop.fs', name: 'Tape Loop', family: 'dub', blurb: 'A multi-head tape echo as a diagram' },
  { file: 'VX-Vinyl.fs', name: 'Vinyl', family: 'dub', blurb: 'A dubplate turning under the stylus' },
  { file: 'VX-Breath.fs', name: 'Breath', family: 'bath', blurb: 'One fine ring that opens as the sound swells' },
  { file: 'VX-Caustics.fs', name: 'Caustics', family: 'bath', blurb: 'Light on the floor of still water' },
  { file: 'VX-Horizon.fs', name: 'Horizon', family: 'bath', blurb: 'A still horizon over calm water' },
  { file: 'VX-InkBloom.fs', name: 'Ink Bloom', family: 'bath', blurb: 'Ink dropped into still water' },
  { file: 'VX-Moon.fs', name: 'Moon', family: 'bath', blurb: 'A moon whose phase is the chord' },
  { file: 'VX-RoseCurves.fs', name: 'Rose Curves', family: 'bath', blurb: 'A harmonograph swung by the chord' },
  { file: 'VX-Starfield.fs', name: 'Starfield', family: 'bath', blurb: 'A deep field of stars that streak on hits' },
  { file: 'VX-FrameStore.fs', name: 'Frame Store', family: 'analog', blurb: 'An early digital frame buffer, written on hits' },
  { file: 'VX-Moire.fs', name: 'Moire', family: 'analog', blurb: 'Interfering gratings, one per note' },
  { file: 'VX-OscBank.fs', name: 'Osc Bank', family: 'analog', blurb: 'One oscillator trace per sounding note' },
  { file: 'VX-ScopeGrid.fs', name: 'Scope Grid', family: 'analog', blurb: 'A wall of small oscilloscopes' },
  { file: 'VX-Stairs.fs', name: 'Stairs', family: 'analog', blurb: 'A staircase wavefolder in light' },
  { file: 'VX-SyncRoll.fs', name: 'Sync Roll', family: 'analog', blurb: 'A test picture that rolls when it loses sync' },
  { file: 'VX-VectorText.fs', name: 'Vector Text', family: 'analog', blurb: 'Note names written in beam strokes' },
  { file: 'VX-Colorizer.fs', name: 'Colorizer', family: 'analog', blurb: 'A light field sliced into colour bands' },
  // The Glitch pack.
  { file: 'VX-VHSTracking.fs', name: 'VHS Tracking', family: 'dub', pack: 'glitch', blurb: 'A night drive off worn tape; hits throw the tracking out' },
  { file: 'VX-CRTCollapse.fs', name: 'CRT Collapse', family: 'analog', pack: 'glitch', blurb: 'A TV station ident on an old tube that switches off on hits' },
  { file: 'VX-Interlace.fs', name: 'Interlace', family: 'analog', pack: 'glitch', blurb: 'A spinning ring of level meters whose two fields split on hits' },
  { file: 'VX-Hologram.fs', name: 'Hologram', family: 'bath', pack: 'glitch', blurb: 'A projected head of glowing slices that breaks up on hits' },
  { file: 'VX-HexDump.fs', name: 'Hex Dump', family: 'berlin', pack: 'glitch', blurb: 'A memory dump whose bytes corrupt and spread on hits' },
  { file: 'VX-ASCIIRot.fs', name: 'ASCII Rot', family: 'berlin', pack: 'glitch', blurb: 'A lit 3D form drawn in text, rotting in accent on hits' },
  { file: 'VX-WrongStride.fs', name: 'Wrong Stride', family: 'berlin', pack: 'glitch', blurb: 'A raw picture read with the wrong stride, shearing on hits' },
  { file: 'VX-BadSectors.fs', name: 'Bad Sectors', family: 'berlin', pack: 'glitch', blurb: 'A disk platter where bad sectors spread on hits' },
  { file: 'VX-Bitplanes.fs', name: 'Bitplanes', family: 'berlin', pack: 'glitch', blurb: 'A glowing picture split into its eight bit planes on every hit' },
  { file: 'VX-DitherStorm.fs', name: 'Dither Storm', family: 'analog', pack: 'glitch', blurb: 'A glowing globe drawn only in dither, crushed by shock fronts' },
  { file: 'VX-PixelDrip.fs', name: 'Pixel Drip', family: 'dub', pack: 'glitch', blurb: 'A pixel picture that melts into drips on hits and re-forms' },
  { file: 'VX-PixelBurst.fs', name: 'Pixel Burst', family: 'berlin', pack: 'glitch', blurb: 'A chunky pixel figure that explodes in depth and snaps back' },
  { file: 'VX-ShardBreak.fs', name: 'Shard Break', family: 'bath', pack: 'glitch', blurb: 'A glass pane over light shatters into radial shards on hits' },
  { file: 'VX-BrokenMirror.fs', name: 'Broken Mirror', family: 'bath', pack: 'glitch', blurb: 'A kaleidoscope behind a cracked pane slips out of register' },
  { file: 'VX-RadialTear.fs', name: 'Radial Tear', family: 'berlin', pack: 'glitch', blurb: 'Rings of a great dial torn into sectors that jump and smear' },
  { file: 'VX-TileFlip.fs', name: 'Tile Flip', family: 'berlin', pack: 'glitch', blurb: 'A wall of tiles flips in waves to show corrupted backs' },
  { file: 'VX-WireCorrupt.fs', name: 'Wire Corrupt', family: 'analog', pack: 'glitch', blurb: 'A glowing wire sculpture that tears apart on hits and heals' },
  { file: 'VX-BeamBurn.fs', name: 'Beam Burn', family: 'analog', pack: 'glitch', blurb: 'A phosphor beam that flares, skips and scorches the glass on hits' },
  { file: 'VX-NeonFault.fs', name: 'Neon Fault', family: 'dub', pack: 'glitch', blurb: 'A neon sign that buzzes and drops letters on hits' },
  { file: 'VX-LiquidSignal.fs', name: 'Liquid Signal', family: 'bath', pack: 'glitch', blurb: 'A bold picture melting into glossy streaks, stirred on hits' },
  // Cosmos: psychedelia, deep space, light through glass and water, point clouds,
  // flocks and nebulas. Each has its own transparent background (Cut out).
  { file: 'VX-LiquidLight.fs', name: 'Liquid Light', family: 'dub', pack: 'cosmos', blurb: 'Glossy oil blobs drifting between glass plates that split in two on every hit' },
  { file: 'VX-OpDisc.fs', name: 'Op Disc', family: 'berlin', pack: 'cosmos', blurb: 'A sixties op-art disc bulging into a sphere, ripped by a shock wave on hits' },
  { file: 'VX-Paisley.fs', name: 'Paisley', family: 'analog', pack: 'cosmos', blurb: 'A poster-art paisley rosette whose tails flick out long on hits' },
  { file: 'VX-Mandala.fs', name: 'Mandala', family: 'bath', pack: 'cosmos', blurb: 'A flower mandala that snaps its petals open on hits and re-folds' },
  { file: 'VX-MeltBow.fs', name: 'Melt Bow', family: 'dub', pack: 'cosmos', blurb: 'A melting seventies rainbow whose colours shunt along on hits' },
  { file: 'VX-JuliaJewel.fs', name: 'Julia Jewel', family: 'analog', pack: 'cosmos', blurb: 'A fractal gem that reshapes with the pitch and flashes on hits' },
  { file: 'VX-Ferrofluid.fs', name: 'Ferrofluid', family: 'analog', pack: 'cosmos', blurb: 'Glossy black ferrofluid rising into spikes with the sound, snapping up on hits' },
  { file: 'VX-FractalCoral.fs', name: 'Fractal Coral', family: 'bath', pack: 'cosmos', blurb: 'Glowing branching coral that grows with held notes and flares on hits' },
  { file: 'VX-DrosteFrames.fs', name: 'Droste', family: 'dub', pack: 'cosmos', blurb: 'Frames inside frames winding into a spiral that whips round on hits' },
  { file: 'VX-SpiralGalaxy.fs', name: 'Spiral Galaxy', family: 'bath', pack: 'cosmos', blurb: 'A tilted spiral galaxy whose arms flare one after another on hits' },
  { file: 'VX-EventHorizon.fs', name: 'Event Horizon', family: 'dub', pack: 'cosmos', blurb: 'A black hole whose blazing disk flares and fires jets on hits' },
  { file: 'VX-RingedPlanet.fs', name: 'Ringed Planet', family: 'analog', pack: 'cosmos', blurb: 'A ringed giant whose day side turns with the note, auroras on hits' },
  { file: 'VX-MeteorShower.fs', name: 'Meteor Shower', family: 'berlin', pack: 'cosmos', blurb: 'Meteors raking the sky, with a fireball on every hit' },
  { file: 'VX-Pulsar.fs', name: 'Pulsar', family: 'berlin', pack: 'cosmos', blurb: 'A pulsar in its glowing nebula, sweeping beams through the gas in time with the bar' },
  { file: 'VX-Medusa.fs', name: 'Medusa', family: 'bath', pack: 'cosmos', blurb: 'A glowing jellyfish whose bell clenches on every hit' },
  { file: 'VX-Shallows.fs', name: 'Shallows', family: 'bath', pack: 'cosmos', blurb: 'Looking up through rippling water, shafts of light flashing on hits' },
  { file: 'VX-SoapFilm.fs', name: 'Soap Film', family: 'bath', pack: 'cosmos', blurb: 'A soap bubble swirling with real thin-film colour that ripples on every hit' },
  { file: 'VX-Quicksilver.fs', name: 'Quicksilver', family: 'dub', pack: 'cosmos', blurb: 'Mirror-bright mercury beads that burst into droplets on hits' },
  { file: 'VX-DoubleHelix.fs', name: 'Helix', family: 'analog', pack: 'cosmos', blurb: 'A DNA helix of points that unzips on hits' },
  { file: 'VX-Shockwave.fs', name: 'Shockwave', family: 'berlin', pack: 'cosmos', blurb: 'A globe of points that blasts off a shell on every kick' },
  { file: 'VX-Survey.fs', name: 'Survey', family: 'berlin', pack: 'cosmos', blurb: 'A laser survey flight over mountains drawn in points' },
  { file: 'VX-ScanHead.fs', name: 'Scan Head', family: 'berlin', pack: 'cosmos', blurb: 'A 3D-scanned head whose scan rings slip loose on hits' },
  { file: 'VX-Knotwork.fs', name: 'Knotwork', family: 'bath', pack: 'cosmos', blurb: 'A knot of streaming points that fills in with the sound' },
  { file: 'VX-BaitBall.fs', name: 'Bait Ball', family: 'dub', pack: 'cosmos', blurb: 'A spinning ring of silver fish that a strike splits apart' },
  { file: 'VX-Fireflies.fs', name: 'Fireflies', family: 'bath', pack: 'cosmos', blurb: 'Fireflies swimming round a hidden centre, gliding near and far with the music' },
  { file: 'VX-Pillars.fs', name: 'Pillars', family: 'analog', pack: 'cosmos', blurb: 'Dark dust columns with burning edges that flare as the beat rolls down' },
  { file: 'VX-Remnant.fs', name: 'Remnant', family: 'analog', pack: 'cosmos', blurb: 'The shell of an exploded star that blasts outward on hits' },
  { file: 'VX-Undertow.fs', name: 'Undertow', family: 'dub', pack: 'cosmos', blurb: 'Light poured into a turning current that folds the music back over itself' },
  { file: 'VX-Kaleidobloom.fs', name: 'Kaleidobloom', family: 'bath', pack: 'cosmos', blurb: 'A kaleidoscope that blooms outward in glassy echoes, punched open by every hit' },
  { file: 'VX-Starburst.fs', name: 'Starburst', family: 'berlin', pack: 'cosmos', blurb: 'Sparks fly out of a drifting vanishing point, leaving prism-split speed lines' },
  { file: 'VX-Maelstrom.fs', name: 'Maelstrom', family: 'dub', pack: 'cosmos', blurb: 'A whirlpool of light winding down in spiral arms into a dark eye' },
  { file: 'VX-Marbling.fs', name: 'Marbling', family: 'bath', pack: 'cosmos', blurb: 'Living paper marbling: drops of ink folded into veins by slow eddies' },
  { file: 'VX-Inkwell.fs', name: 'Inkwell', family: 'bath', pack: 'cosmos', blurb: 'Coloured ink dropped into milky water, rolling into plumes on slow currents' },
];

export const voiceShaderByFile = (file: string): VoiceShader | undefined => VOICE_SHADERS.find((v) => v.file === file);

/** Each set's palette: one ink and one accent. */
export const SET_PALETTES = STUDIO_PALETTES;

export interface SceneVoice {
  file: string;
  source: VoiceSourceId;
  /** Look inputs to set, by name. */
  params?: Record<string, number>;
  /** How much of it shows, 0-1. */
  level?: number;
}

export interface VisualScene {
  id: string;
  name: string;
  set: StudioSet;
  /** The voices, bottom to top. */
  voices: SceneVoice[];
}

export const VISUAL_SCENES: readonly VisualScene[] = [
  { id: 'berlin-data', name: 'Readout', set: 'berlin', voices: [
    { file: 'VX-ScanField.fs', source: 'bass', params: { relief: 0.3, ripple: 0.85, flow: 0.25 } },
    { file: 'VX-Panels.fs', source: 'snare' },
    { file: 'VX-Barcode.fs', source: 'hats', params: { bands: 3, density: 0.35 }, level: 0.6 },
    { file: 'VX-Glyphs.fs', source: 'lead' },
  ] },
  { id: 'berlin-corridor', name: 'Corridor', set: 'berlin', voices: [
    { file: 'VX-LightLines.fs', source: 'kick' },
    { file: 'VX-Barcode.fs', source: 'hats', level: 0.7 },
    { file: 'VX-Panels.fs', source: 'snare', level: 0.8 },
    { file: 'VX-Glyphs.fs', source: 'bass', level: 0.8 },
  ] },
  { id: 'berlin-bits', name: 'Data', set: 'berlin', voices: [
    { file: 'VX-DataStream.fs', source: 'hats', level: 0.8 },
    { file: 'VX-Barcode.fs', source: 'kick', level: 0.6 },
    { file: 'VX-BitCounter.fs', source: 'bass' },
    { file: 'VX-DataPlot.fs', source: 'lead', level: 0.8 },
  ] },
  { id: 'berlin-glitch', name: 'Glitch', set: 'berlin', voices: [
    { file: 'VX-GlitchCollage.fs', source: 'kick', level: 0.8 },
    { file: 'VX-SignalTear.fs', source: 'snare' },
    { file: 'VX-PixelSort.fs', source: 'bass', level: 0.7 },
    { file: 'VX-TestPattern.fs', source: 'hats', level: 0.5 },
  ] },
  { id: 'berlin-monolith', name: 'Monolith', set: 'berlin', voices: [
    { file: 'VX-Monolith.fs', source: 'kick', level: 0.8 },
    { file: 'VX-PulseBars.fs', source: 'hats', level: 0.7 },
    { file: 'VX-Scanner.fs', source: 'snare' },
    { file: 'VX-TunnelLines.fs', source: 'bass', level: 0.8 },
  ] },
  { id: 'dub-chamber', name: 'Echo chamber', set: 'dub', voices: [
    { file: 'VX-Smoke.fs', source: 'bass' },
    { file: 'VX-EchoRings.fs', source: 'kick' },
    { file: 'VX-Scope.fs', source: 'chords' },
    { file: 'VX-Feedback.fs', source: 'fx' },
  ] },
  { id: 'dub-system', name: 'Sound system', set: 'dub', voices: [
    { file: 'VX-ScanField.fs', source: 'kick', params: { relief: 0.2, ripple: 1, ring: 0.8 } },
    { file: 'VX-Smoke.fs', source: 'bass', level: 0.8 },
    { file: 'VX-EchoRings.fs', source: 'snare' },
    { file: 'VX-Scope.fs', source: 'played' },
  ] },
  { id: 'dub-yard', name: 'Yard', set: 'dub', voices: [
    { file: 'VX-SpeakerStack.fs', source: 'kick', level: 0.8 },
    { file: 'VX-SpeakerCone.fs', source: 'bass' },
    { file: 'VX-HazeBeams.fs', source: 'chords', level: 0.7 },
    { file: 'VX-TapeLoop.fs', source: 'snare', level: 0.8 },
  ] },
  { id: 'dub-plate', name: 'Dubplate', set: 'dub', voices: [
    { file: 'VX-Vinyl.fs', source: 'bass', level: 0.8 },
    { file: 'VX-Spring.fs', source: 'snare' },
    { file: 'VX-RippleTank.fs', source: 'kick', level: 0.7 },
  ] },
  { id: 'dub-glitch', name: 'Glitch', set: 'dub', voices: [
    { file: 'VX-Datamosh.fs', source: 'bass', level: 0.7 },
    { file: 'VX-SignalTear.fs', source: 'snare' },
    { file: 'VX-TapeLoop.fs', source: 'fx', level: 0.8 },
  ] },
  { id: 'bath-night', name: 'Night sky', set: 'bath', voices: [
    { file: 'VX-Nebula.fs', source: 'pad', level: 0.65 },
    { file: 'VX-Aurora.fs', source: 'chords' },
    // Bowls and drone count as pads.
    { file: 'VX-Cymatics.fs', source: 'pad' },
    { file: 'VX-Scope.fs', source: 'lead', level: 0.7 },
  ] },
  { id: 'bath-water', name: 'Still water', set: 'bath', voices: [
    { file: 'VX-Nebula.fs', source: 'pad', level: 0.8 },
    { file: 'VX-ScanField.fs', source: 'played', params: { relief: 0.15, ripple: 0.6, ring: 0.95, flow: 0.08, lines: 120 } },
    { file: 'VX-Cymatics.fs', source: 'chords' },
  ] },
  { id: 'bath-moon', name: 'Moonrise', set: 'bath', voices: [
    { file: 'VX-Horizon.fs', source: 'pad', level: 0.8 },
    { file: 'VX-Moon.fs', source: 'chords' },
    { file: 'VX-Starfield.fs', source: 'lead', level: 0.6 },
  ] },
  { id: 'bath-pool', name: 'Pool', set: 'bath', voices: [
    { file: 'VX-Caustics.fs', source: 'pad', level: 0.7 },
    { file: 'VX-InkBloom.fs', source: 'played' },
    { file: 'VX-Breath.fs', source: 'chords', level: 0.8 },
  ] },
  { id: 'bath-pendulum', name: 'Pendulum', set: 'bath', voices: [
    { file: 'VX-RoseCurves.fs', source: 'chords' },
    { file: 'VX-Breath.fs', source: 'pad', level: 0.7 },
    { file: 'VX-Starfield.fs', source: 'played', level: 0.5 },
  ] },
  { id: 'analog-patch', name: 'Patch bay', set: 'analog', voices: [
    { file: 'VX-VideoSynth.fs', source: 'played' },
    { file: 'VX-Wobbulator.fs', source: 'bass' },
    { file: 'VX-Feedback.fs', source: 'fx' },
    { file: 'VX-ScanField.fs', source: 'kick', level: 0.7 },
  ] },
  { id: 'analog-signal', name: 'Signal', set: 'analog', voices: [
    { file: 'VX-Feedback.fs', source: 'played' },
    { file: 'VX-Wobbulator.fs', source: 'bass' },
    { file: 'VX-Scope.fs', source: 'chords' },
  ] },  { id: 'analog-lab', name: 'Test bench', set: 'analog', voices: [
    { file: 'VX-ScopeGrid.fs', source: 'played', level: 0.8 },
    { file: 'VX-OscBank.fs', source: 'chords' },
    { file: 'VX-SyncRoll.fs', source: 'kick', level: 0.6 },
    { file: 'VX-VectorText.fs', source: 'lead' },
  ] },
  { id: 'analog-colour', name: 'Colour', set: 'analog', voices: [
    { file: 'VX-Colorizer.fs', source: 'pad', level: 0.8 },
    { file: 'VX-Moire.fs', source: 'chords', level: 0.7 },
    { file: 'VX-Stairs.fs', source: 'bass' },
  ] },
  { id: 'analog-store', name: 'Frame store', set: 'analog', voices: [
    { file: 'VX-FrameStore.fs', source: 'kick', level: 0.8 },
    { file: 'VX-Wobbulator.fs', source: 'bass', level: 0.8 },
    { file: 'VX-Stairs.fs', source: 'hats', level: 0.6 },
  ] },
];

export const scenesForSet = (set: StudioSet): VisualScene[] => VISUAL_SCENES.filter((s) => s.set === set);

/** Inputs a voice shader declares, parsed once per source. */
const inputCache = new Map<string, ShaderInput[]>();

export interface ShaderInput {
  NAME: string;
  LABEL?: string;
  TYPE: string;
  DEFAULT?: unknown;
  MIN?: number;
  MAX?: number;
  VALUES?: number[];
  LABELS?: string[];
}

export function shaderInputs(code: string): ShaderInput[] {
  const cached = inputCache.get(code);
  if (cached) return cached;
  let inputs: ShaderInput[] = [];
  try {
    inputs = (parseISF(code).metadata.INPUTS ?? []) as ShaderInput[];
  } catch {
    inputs = [];
  }
  if (inputCache.size > 100) inputCache.clear();
  inputCache.set(code, inputs);
  return inputs;
}

export function isVoiceShader(code: string | undefined): boolean {
  return !!code && shaderInputs(code).some((i) => i.NAME === VOICE_SOURCE_INPUT);
}
