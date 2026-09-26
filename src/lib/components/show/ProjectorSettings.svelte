<script lang="ts">
  /**
   * Settings > Show Control > Projectors (PJLink class 1). Saved with the
   * project. Cues and the scheduler address these by id, or all of them.
   *
   * Passwords are write-only here: committing the field stores the value in
   * this computer's credential store (never the project file) and clears
   * the field again. The placeholder says whether one is saved.
   */
  import { projectors, PJLINK_DEFAULT_PORT, type Projector, type ProjectorStatus } from '../../show/projectors';
  import type { ProjectorCommand } from '../../show/cueList';

  $: st = $projectors;
  let busy: Record<string, boolean> = {};

  async function run(p: Projector, command: ProjectorCommand) {
    busy = { ...busy, [p.id]: true };
    try {
      await projectors.command(p.id, command);
      await projectors.poll(p.id);
    } finally {
      busy = { ...busy, [p.id]: false };
    }
  }
  async function poll(p: Projector) {
    busy = { ...busy, [p.id]: true };
    try {
      await projectors.poll(p.id);
    } finally {
      busy = { ...busy, [p.id]: false };
    }
  }

  function statusText(s: ProjectorStatus | undefined): string {
    if (!s || s.polledAt === null && !s.lastCommand) return 'Not polled yet';
    if (!s.online) return `Offline${s.lastError ? `: ${s.lastError}` : ''}`;
    const parts = [
      s.power === 'on' ? 'On' : s.power === 'off' ? 'Standby' : s.power === 'warming' ? 'Warming up' : s.power === 'cooling' ? 'Cooling down' : 'Power unknown',
      s.shutter === 'closed' ? 'shutter closed' : s.shutter === 'open' ? 'shutter open' : '',
      s.input ? `input ${s.input}` : '',
      s.lampHours !== null ? `${s.lampHours} lamp hours` : '',
    ].filter(Boolean);
    return parts.join(', ');
  }
  async function commitPassword(p: Projector, input: HTMLInputElement) {
    const value = input.value;
    input.value = '';
    if (!value) return;
    busy = { ...busy, [p.id]: true };
    try {
      await projectors.setPassword(p.id, value);
    } finally {
      busy = { ...busy, [p.id]: false };
    }
  }
  async function clearPassword(p: Projector) {
    busy = { ...busy, [p.id]: true };
    try {
      await projectors.setPassword(p.id, '');
    } finally {
      busy = { ...busy, [p.id]: false };
    }
  }

  function faults(s: ProjectorStatus | undefined): string {
    if (!s?.errors) return '';
    return Object.entries(s.errors).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k} ${v}`).join(', ');
  }
</script>

<div class="pj-panel" data-projector-settings>
  {#each st.projectors as p (p.id)}
    {@const s = st.status[p.id]}
    <div class="pj-card" data-projector-id={p.id}>
      <div class="pj-head">
        <span class="pj-dot" class:online={s?.online} class:offline={s && !s.online && s.polledAt !== null}></span>
        <input class="pj-name" type="text" value={p.name} onchange={(e) => projectors.update(p.id, { name: e.currentTarget.value })} aria-label="Projector name" data-projector-name />
        <label class="pj-enabled"><input type="checkbox" checked={p.enabled} onchange={(e) => projectors.update(p.id, { enabled: e.currentTarget.checked })} /> Enabled</label>
        <button class="pj-remove" onclick={() => projectors.remove(p.id)} aria-label="Remove projector">×</button>
      </div>
      <div class="pj-fields">
        <label>Address <input type="text" placeholder="192.168.1.50" value={p.host} onchange={(e) => projectors.update(p.id, { host: e.currentTarget.value })} data-projector-host /></label>
        <label>Port <input class="pj-port" type="number" min="1" max="65535" value={p.port} onchange={(e) => projectors.update(p.id, { port: Number(e.currentTarget.value) || PJLINK_DEFAULT_PORT })} data-projector-port /></label>
        <label>Password
          <input
            type="password"
            autocomplete="new-password"
            placeholder={p.hasPassword ? 'Saved on this computer' : 'none'}
            value=""
            onchange={(e) => commitPassword(p, e.currentTarget)}
            data-projector-password
          />
        </label>
        {#if p.hasPassword}
          <button class="pj-clear" disabled={busy[p.id]} onclick={() => clearPassword(p)} title="Delete the saved password from this computer" data-projector-clear-password>Clear</button>
        {/if}
      </div>
      {#if s?.credentialError}
        <div class="pj-cred-error" data-projector-credential-error>
          {s.credentialError}
          <button class="pj-clear" onclick={() => projectors.retryPasswordMigration(p.id)}>Retry</button>
        </div>
      {:else if s?.passwordSessionOnly}
        <div class="pj-cred-note" data-projector-session-only>Password saved for this session only: this computer has no secure storage for it. Enter it again after a restart.</div>
      {:else if s?.passwordMissing}
        <div class="pj-cred-note" data-projector-password-missing>This project expects a password that is not saved on this computer. Enter it again.</div>
      {/if}
      <div class="pj-status" data-projector-status>
        {statusText(s)}
        {#if faults(s)}<span class="pj-faults">Faults: {faults(s)}</span>{/if}
        {#if s?.lastCommand}
          <span class="pj-last" class:bad={!s.lastCommand.ok}>Last command: {s.lastCommand.action} {s.lastCommand.ok ? 'OK' : `failed (${s.lastCommand.error ?? 'no reply'})`}</span>
        {/if}
      </div>
      <div class="pj-buttons">
        <button disabled={busy[p.id] || !p.host} onclick={() => run(p, 'power-on')} data-projector-cmd="power-on">Power on</button>
        <button disabled={busy[p.id] || !p.host} onclick={() => run(p, 'power-off')} data-projector-cmd="power-off">Power off</button>
        <button disabled={busy[p.id] || !p.host} onclick={() => run(p, 'shutter-close')} data-projector-cmd="shutter-close">Shutter close</button>
        <button disabled={busy[p.id] || !p.host} onclick={() => run(p, 'shutter-open')} data-projector-cmd="shutter-open">Shutter open</button>
        <button disabled={busy[p.id] || !p.host} onclick={() => poll(p)} data-projector-cmd="poll">Check status</button>
      </div>
    </div>
  {/each}
  {#if st.projectors.length === 0}
    <p class="sc-hint">No projectors yet. Add one by its IP address; PJLink must be enabled in the projector's network menu.</p>
  {/if}
  <div class="pj-footer">
    <button class="pj-add" onclick={() => projectors.add()} data-projector-add>+ Add projector</button>
    <label class="pj-poll">Check status every
      <input type="number" min="5" max="3600" value={st.pollSeconds} onchange={(e) => projectors.setPollSeconds(Number(e.currentTarget.value))} />
      seconds
    </label>
  </div>
</div>

<style>
  .pj-panel { display: flex; flex-direction: column; gap: 10px; }
  .pj-card { background: #111116; border: 1px solid #2a2a30; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .pj-head { display: flex; align-items: center; gap: 8px; }
  .pj-dot { width: 9px; height: 9px; border-radius: 50%; background: #555; flex-shrink: 0; }
  .pj-dot.online { background: #5fdc76; box-shadow: 0 0 6px #5fdc76; }
  .pj-dot.offline { background: #f87171; }
  .pj-name { flex: 1; font-weight: 700; }
  .pj-enabled { font-size: 12px; color: #aaa; display: inline-flex; align-items: center; gap: 4px; }
  .pj-remove { background: none; border: none; color: #888; font-size: 16px; cursor: pointer; }
  .pj-remove:hover { color: #fff; }
  .pj-fields { display: flex; gap: 10px; flex-wrap: wrap; }
  .pj-fields label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #888; }
  .pj-port { width: 72px; }
  .pj-fields { align-items: center; }
  .pj-clear {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid #33333a;
    background: #15151b;
    color: #ddd;
    cursor: pointer;
  }
  .pj-cred-note { font-size: 12px; color: #f0c674; }
  .pj-cred-error { font-size: 12px; color: #ff8a80; display: flex; gap: 8px; align-items: center; }
  .pj-status { font-size: 12px; color: #bbb; display: flex; flex-direction: column; gap: 2px; }
  .pj-faults { color: #f0c674; }
  .pj-last { color: #888; }
  .pj-last.bad { color: #ff8a80; }
  .pj-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
  .pj-buttons button, .pj-add {
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 4px;
    border: 1px solid #33333a;
    background: #15151b;
    color: #ddd;
    cursor: pointer;
  }
  .pj-buttons button:disabled { opacity: 0.4; cursor: default; }
  .pj-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .pj-poll { font-size: 12px; color: #888; display: inline-flex; align-items: center; gap: 6px; }
  .pj-poll input { width: 64px; }
  input[type='text'], input[type='password'], input[type='number'] {
    background: #09090c;
    border: 1px solid #33333a;
    border-radius: 4px;
    color: #e7e7eb;
    padding: 5px 7px;
    font: inherit;
    font-size: 12px;
  }
</style>
