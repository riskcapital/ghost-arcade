import { describe, expect, it } from 'vitest';
import type { InteractiveScene, Interaction } from './interactive';
import { createScenePublisher, SCENE_PUBLISH_MS } from './scenePublisher';

const sceneA = { name: 'a' } as unknown as InteractiveScene;
const sceneB = { name: 'b' } as unknown as InteractiveScene;
const touch = (x: number): Interaction => ({ id: 'p1', point: { x, y: 0.5 }, strength: 1 });

function rig() {
  const sent: Array<{ scene: InteractiveScene; inputs: Interaction[]; active: boolean; paused: boolean }> = [];
  const pub = createScenePublisher((scene, inputs, active, paused) => sent.push({ scene, inputs, active, paused }));
  return { sent, pub };
}

describe('the Interactive Studio scene publisher', () => {
  it('sends once, then nothing while nothing changes (was 20 a second)', () => {
    const { sent, pub } = rig();
    for (let ms = 0; ms < 10_000; ms += 16) pub.tick(ms, sceneA, [], false, false);
    expect(sent).toHaveLength(1);
  });

  it('sends a new scene, output on or off, and pause, at most every SCENE_PUBLISH_MS', () => {
    const { sent, pub } = rig();
    pub.tick(0, sceneA, [], false, false);
    expect(pub.tick(10, sceneB, [], false, false)).toBe(false);
    expect(pub.tick(SCENE_PUBLISH_MS + 1, sceneB, [], false, false)).toBe(true);
    pub.tick(200, sceneB, [], true, false);
    pub.tick(300, sceneB, [], true, true);
    pub.tick(400, sceneB, [], true, true);
    expect(sent.map((s) => [s.scene, s.active, s.paused])).toEqual([[sceneA, false, false], [sceneB, false, false], [sceneB, true, false], [sceneB, true, true]]);
  });

  it('streams a live touch, held still or moving, and the release once', () => {
    const { sent, pub } = rig();
    pub.tick(0, sceneA, [], false, false);
    const held = touch(0.2);
    let ms = 100;
    for (; ms < 1100; ms += 16) pub.tick(ms, sceneA, [held], false, false);
    const whileHeld = sent.length - 1;
    expect(whileHeld).toBeGreaterThanOrEqual(15);
    expect(whileHeld).toBeLessThanOrEqual(1000 / SCENE_PUBLISH_MS);
    for (; ms < 3000; ms += 16) pub.tick(ms, sceneA, [], false, false);
    expect(sent.length - 1 - whileHeld).toBe(1);
    expect(sent[sent.length - 1].inputs).toEqual([]);
  });

  it('now() sends whatever changed, and the next tick does not send it again', () => {
    const { sent, pub } = rig();
    pub.now(0, sceneA, [], true, false);
    pub.tick(500, sceneA, [], true, false);
    expect(sent).toHaveLength(1);
  });
});
