<script lang="ts">
  /**
   * Scenes and the session, in the Studio's top bar where they are easy to
   * find. Save scene keeps everything playing now (beat, loops, the whole
   * sound and the visual voices) as a scene; the menu beside it launches one
   * on the next bar. Session saves the project (scenes, songs and all) or
   * starts a fresh session to build new scenes in.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { captureCurrentScene, launchScene } from '../../music/musicRuntime';
  import { showToast } from '../../stores/errorToast';

  const s = $derived($musicStudio);

  function save() {
    const id = captureCurrentScene();
    const scene = $musicStudio.scenes.find((sc) => sc.id === id);
    showToast(`Saved ${scene?.name ?? 'the scene'}. It is kept with the project; Session > Save keeps it on disk.`, 'info');
  }

  function shortcut(shift: boolean) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: shift ? 'S' : 's', ctrlKey: true, shiftKey: shift, bubbles: true }));
  }

  function session(e: Event) {
    const el = e.target as HTMLSelectElement;
    const action = el.value;
    el.value = '';
    if (action === 'save') shortcut(false);
    else if (action === 'saveas') shortcut(true);
    else if (action === 'new') {
      if (!s.scenes.length || confirm('Start a new session? The session grid goes back to the starter clips and the scenes are cleared. Save first to keep them.')) {
        musicStudio.newSession();
        showToast('New session. Build some loops, then Save scene.', 'info');
      }
    }
  }
</script>

<div class="group" role="group" aria-label="Scenes and session">
  <button class="text-btn" onclick={save} title="Keep everything playing now (beat, loops, sound, effects and visuals) as a scene">Save scene</button>
  <select value={s.sceneId ?? ''} onchange={(e) => { const id = (e.target as HTMLSelectElement).value; if (id) launchScene(id); }} aria-label="Launch a scene" title="Launch a saved scene on the next bar">
    <option value="" disabled>{s.scenes.length ? 'Scenes' : 'No scenes yet'}</option>
    {#each s.scenes as sc (sc.id)}<option value={sc.id}>{sc.id === s.queuedSceneId ? `${sc.name} (next bar)` : sc.name}</option>{/each}
  </select>
  <select class="session" value="" onchange={session} aria-label="Session" title="Save the session with the project, or start a new one">
    <option value="" disabled>Session</option>
    <option value="save">Save (Ctrl+S)</option>
    <option value="saveas">Save as… (Ctrl+Shift+S)</option>
    <option value="new">New session…</option>
  </select>
</div>

<style>
  .group { display: flex; align-items: center; gap: var(--ga-bar-gap, 6px); flex: 0 0 auto; }
  select { height: var(--ga-bar-control-h, 30px); padding: 0 8px; font-size: var(--ga-text-body, 13px); max-width: 150px; }
  /* A menu of actions: as wide as its label. */
  .session { width: 92px; }
  @media (max-width: 1439px) { select { max-width: 116px; } }
  .text-btn { height: var(--ga-bar-control-h, 30px); padding: 0 12px; font-size: var(--ga-text-body, 13px); }
</style>
