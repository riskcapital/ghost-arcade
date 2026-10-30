<script lang="ts">
  import type { VJClip } from '../stores/vjClipLauncher';
  export let clip: VJClip;
  export let onChange: (patch: { faderStart?: boolean | null; ignoreColumnTrigger?: boolean | null }) => void;
  const options = [{ key: 'faderStart', label: 'Fader start', hint: 'Restart this video when its layer fader rises from zero.' },
    { key: 'ignoreColumnTrigger', label: 'Ignore column trigger', hint: 'Keep this clip playing when another column is launched.' }] as const;
  const value = (raw: string) => raw === 'inherit' ? null : raw === 'on';
</script>
<div data-help-page="clip-launcher" class="launch-options">
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
  .launch-options { padding: 8px 12px; display: grid; gap: 6px; }
  label { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: var(--ga-control-h, 26px); font-size: var(--ga-text-control, 12px); color: var(--ga-ink-0, #f2ede4); }
  select { height: var(--ga-control-h, 26px); box-sizing: border-box; padding: 0 8px; background: var(--ga-slot, #060504); color: var(--ga-ink-0, #f2ede4); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); font: inherit; }
</style>
