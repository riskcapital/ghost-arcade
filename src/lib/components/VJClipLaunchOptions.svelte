<script lang="ts">
  import type { VJClip } from '../stores/vjClipLauncher';
  export let clip: VJClip;
  export let onChange: (patch: { faderStart?: boolean | null; ignoreColumnTrigger?: boolean | null }) => void;
  const options = [{ key: 'faderStart', label: 'Fader Start', hint: 'Restart this video when its layer fader rises from zero.' },
    { key: 'ignoreColumnTrigger', label: 'Ignore Column Trigger', hint: 'Keep this clip playing when another column is launched.' }] as const;
  const value = (raw: string) => raw === 'inherit' ? null : raw === 'on';
</script>
<div class="launch-options">
  {#each options as option}
    <label title={option.hint}>
      {option.label}
      <select aria-label={'Clip ' + option.label} value={clip[option.key] === undefined ? 'inherit' : clip[option.key] ? 'on' : 'off'}
        onchange={(e) => onChange({ [option.key]: value(e.currentTarget.value) })}>
        <option value="inherit">Use layer</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    </label>
  {/each}
</div>
<style>
  .launch-options { padding: 8px 12px; display: grid; gap: 8px; }
  label { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
  select { background: #222; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 4px; }
</style>
