<script lang="ts">
  /**
   * Settings > Show Control > Timecode. Saved with the project.
   */
  import { onMount } from 'svelte';
  import { timecodeChase, type TimecodeSettings } from '../../show/timecode/timecodeChase';
  import {
    TIMECODE_RATES,
    formatSecondsAsTimecode,
    parseTimecodeToSeconds,
    rateLabel,
    type TimecodeRate,
  } from '../../show/timecode/timecode';

  const settings = timecodeChase.settings;
  const status = timecodeChase.status;
  $: s = $settings;
  $: st = $status;
  $: displayRate = (s.rate === 'auto' ? st.rate ?? 25 : s.rate) as TimecodeRate;

  let audioInputs: MediaDeviceInfo[] = [];
  let midiInputs: Array<{ id: string; name: string }> = [];

  async function refreshDevices() {
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices?.();
      audioInputs = (devices ?? []).filter((d) => d.kind === 'audioinput');
    } catch {
      audioInputs = [];
    }
    try {
      if (navigator.requestMIDIAccess) {
        const access = await navigator.requestMIDIAccess({ sysex: false });
        const list: Array<{ id: string; name: string }> = [];
        access.inputs.forEach((input) => list.push({ id: input.id, name: input.name ?? input.id }));
        midiInputs = list;
      }
    } catch {
      midiInputs = [];
    }
  }
  onMount(() => {
    void refreshDevices();
  });

  function patch(p: Partial<TimecodeSettings>) {
    timecodeChase.configure(p);
  }

  let offsetText = '';
  let offsetError = '';
  $: if (!offsetFocused) offsetText = formatSecondsAsTimecode(s.offset, displayRate);
  let offsetFocused = false;
  function commitOffset() {
    offsetFocused = false;
    const v = parseTimecodeToSeconds(offsetText, displayRate);
    if (v === null) {
      offsetError = 'Use HH:MM:SS:FF';
      return;
    }
    offsetError = '';
    patch({ offset: v });
  }

  const LOCK_LABEL: Record<string, string> = {
    off: 'Off',
    searching: 'Searching',
    locked: 'Locked',
    freewheel: 'Freewheeling',
    lost: 'Lost',
  };
</script>

<div class="tc-panel" data-timecode-settings>
  <div class="tc-status" class:locked={st.lock === 'locked'} class:freewheel={st.lock === 'freewheel'} class:lost={st.lock === 'lost'} data-tc-status={st.lock}>
    <span class="tc-dot"></span>
    <span class="tc-lock">{LOCK_LABEL[st.lock] ?? st.lock}{st.lock === 'locked' && !st.running ? ' (parked)' : ''}</span>
    <span class="tc-label">{st.label ?? '--:--:--:--'}</span>
    {#if st.rate}<span class="tc-rate">{rateLabel(st.rate, st.dropFrame)}</span>{/if}
    <span class="tc-show">show {st.showTime === null ? '--' : formatSecondsAsTimecode(st.showTime, displayRate)}</span>
    <span class="tc-frames">{st.framesReceived} frames</span>
    {#if s.source === 'ltc'}
      <span class="tc-meter" title="LTC input level"><span style="width: {Math.min(100, st.inputPeak * 100)}%"></span></span>
    {/if}
  </div>
  {#if st.error}<p class="tc-error">{st.error}</p>{/if}

  <div class="sc-row">
    <div class="sc-label">
      <span class="sc-title">Source</span>
      <span class="sc-hint">LTC is SMPTE timecode on an audio input. MTC arrives over MIDI.</span>
    </div>
    <select value={s.source} onchange={(e) => patch({ source: e.currentTarget.value as TimecodeSettings['source'] })} data-tc-source>
      <option value="off">Off</option>
      <option value="ltc">LTC (audio input)</option>
      <option value="mtc">MTC (MIDI)</option>
    </select>
  </div>

  {#if s.source === 'ltc'}
    <div class="sc-row">
      <div class="sc-label"><span class="sc-title">Audio input</span></div>
      <select value={s.ltcDeviceId} onchange={(e) => patch({ ltcDeviceId: e.currentTarget.value })}>
        <option value="">System default</option>
        {#each audioInputs as d (d.deviceId)}
          <option value={d.deviceId}>{d.label || d.deviceId}</option>
        {/each}
      </select>
    </div>
    <div class="sc-row">
      <div class="sc-label"><span class="sc-title">Channel</span></div>
      <select value={String(s.ltcChannel)} onchange={(e) => patch({ ltcChannel: Number(e.currentTarget.value) })}>
        <option value="0">Left (or mono)</option>
        <option value="1">Right</option>
      </select>
    </div>
  {:else if s.source === 'mtc'}
    <div class="sc-row">
      <div class="sc-label"><span class="sc-title">MIDI input</span></div>
      <select value={s.mtcInputId} onchange={(e) => patch({ mtcInputId: e.currentTarget.value })}>
        <option value="">Every input</option>
        {#each midiInputs as m (m.id)}
          <option value={m.id}>{m.name}</option>
        {/each}
      </select>
    </div>
  {/if}

  <div class="sc-row">
    <div class="sc-label">
      <span class="sc-title">Frame rate</span>
      <span class="sc-hint">Auto uses the rate the source reports.</span>
    </div>
    <select value={String(s.rate)} onchange={(e) => patch({ rate: e.currentTarget.value === 'auto' ? 'auto' : (Number(e.currentTarget.value) as TimecodeRate) })}>
      <option value="auto">Auto</option>
      {#each TIMECODE_RATES as r}
        <option value={String(r)}>{rateLabel(r)}</option>
      {/each}
    </select>
  </div>

  <div class="sc-row">
    <div class="sc-label">
      <span class="sc-title">Show offset</span>
      <span class="sc-hint">The timecode that is show time zero, for example 01:00:00:00.</span>
    </div>
    <div class="tc-offset">
      <input
        type="text"
        bind:value={offsetText}
        onfocus={() => (offsetFocused = true)}
        onblur={commitOffset}
        onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
        data-tc-offset
      />
      {#if offsetError}<span class="tc-error">{offsetError}</span>{/if}
    </div>
  </div>

  <div class="sc-row">
    <div class="sc-label">
      <span class="sc-title">Freewheel</span>
      <span class="sc-hint">Keep running this long when timecode drops out, then pause the show.</span>
    </div>
    <div class="tc-inline">
      <input type="number" min="0" max="60" step="0.5" value={s.freewheelSeconds} onchange={(e) => patch({ freewheelSeconds: parseFloat(e.currentTarget.value) || 0 })} />
      <span>seconds</span>
    </div>
  </div>

  <div class="sc-row">
    <div class="sc-label">
      <span class="sc-title">Chase the show timeline</span>
      <span class="sc-hint">The timeline plays, stops and locates with the timecode. Its markers fire their cues.</span>
    </div>
    <input type="checkbox" checked={s.chaseTimeline} onchange={(e) => patch({ chaseTimeline: e.currentTarget.checked })} />
  </div>
  <div class="sc-row">
    <div class="sc-label">
      <span class="sc-title">Fire timecoded cues</span>
      <span class="sc-hint">Cues with a timecode fire as the chased clock passes it.</span>
    </div>
    <input type="checkbox" checked={s.chaseCues} onchange={(e) => patch({ chaseCues: e.currentTarget.checked })} />
  </div>
</div>

<style>
  .tc-panel { display: flex; flex-direction: column; gap: 4px; }
  .tc-status {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.3);
    font-size: 12px;
    margin-bottom: 8px;
  }
  .tc-dot { width: 10px; height: 10px; border-radius: 50%; background: #666; }
  .tc-status.locked .tc-dot { background: #5fdc76; box-shadow: 0 0 8px #5fdc76; }
  .tc-status.freewheel .tc-dot { background: #f0c674; }
  .tc-status.lost .tc-dot { background: #f87171; }
  .tc-lock { font-weight: 700; min-width: 86px; }
  .tc-label { font-family: var(--font-jetbrains), monospace; font-size: 16px; color: #fff; }
  .tc-rate, .tc-show, .tc-frames { color: var(--text-muted, #888); }
  .tc-meter { width: 80px; height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 3px; overflow: hidden; }
  .tc-meter span { display: block; height: 100%; background: #5fdc76; }
  .tc-error { color: #ff8a80; font-size: 11px; margin: 0; }
  .tc-offset input { width: 110px; font-family: var(--font-jetbrains), monospace; }
  .tc-inline { display: flex; align-items: center; gap: 6px; }
  .tc-inline input { width: 64px; }
</style>
