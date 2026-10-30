<script lang="ts">
  import { project } from '../stores/layers';
  import type { WLEDGroup, WLEDGroupMember } from '../types';

  function addGroup() {
    const index = ($project.wledGroups ?? []).length + 1;
    project.addWLEDGroup({
      id: `wled-group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: `LED Group ${index}`,
      members: [],
    });
  }

  function memberKey(member: WLEDGroupMember): string {
    return `${member.controllerId}:${member.rangeId ?? '*'}`;
  }

  function isMember(group: WLEDGroup, member: WLEDGroupMember): boolean {
    const key = memberKey(member);
    return group.members.some(item => memberKey(item) === key);
  }

  function toggleMember(group: WLEDGroup, member: WLEDGroupMember) {
    const key = memberKey(member);
    const members = isMember(group, member)
      ? group.members.filter(item => memberKey(item) !== key)
      : [...group.members, member];
    project.updateWLEDGroup(group.id, { members });
  }
</script>

<section data-help-page="settings" class="groups-panel">
  <header>
    <div>
      <h4>Fixture Groups</h4>
      <p>Combine WLED controllers, named ranges and Art-Net or sACN fixtures into reusable LED FX targets.</p>
    </div>
    <button onclick={addGroup}>+ Add group</button>
  </header>

  {#each $project.wledGroups ?? [] as group (group.id)}
    <article>
      <div class="group-heading">
        <input
          value={group.name}
          onchange={(event) => project.updateWLEDGroup(group.id, { name: (event.target as HTMLInputElement).value })}
          aria-label="LED group name"
        />
        <span>{group.members.length} target{group.members.length === 1 ? '' : 's'}</span>
        <button class="remove" onclick={() => project.removeWLEDGroup(group.id)} title="Remove group">×</button>
      </div>
      <div class="member-grid">
        {#each $project.wledControllers ?? [] as controller (controller.id)}
          <label>
            <input
              type="checkbox"
              checked={isMember(group, { controllerId: controller.id })}
              onchange={() => toggleMember(group, { controllerId: controller.id })}
            />
            <span>{controller.name}<small>All {controller.ledCount} LEDs</small></span>
          </label>
          {#each controller.ranges ?? [] as range (range.id)}
            <label class="range-member">
              <input
                type="checkbox"
                checked={isMember(group, { controllerId: controller.id, rangeId: range.id })}
                onchange={() => toggleMember(group, { controllerId: controller.id, rangeId: range.id })}
              />
              <span>{range.name}<small>{controller.name} · {range.start + 1}-{range.start + range.count}</small></span>
            </label>
          {/each}
        {/each}
        {#each $project.pixelMap?.fixtures ?? [] as fixture (fixture.id)}
          <label class="fixture-member">
            <input
              type="checkbox"
              checked={isMember(group, { controllerId: fixture.id })}
              onchange={() => toggleMember(group, { controllerId: fixture.id })}
            />
            <span>{fixture.name}<small>{fixture.protocol === 'sacn' ? 'sACN' : 'Art-Net'} fixture · {fixture.pixelCount} pixels</small></span>
          </label>
        {/each}
      </div>
    </article>
  {/each}

  {#if ($project.wledGroups ?? []).length === 0}
    <div class="empty">No groups yet. Effects can still target all LEDs, a controller, or one named range.</div>
  {/if}
</section>

<style>
  .groups-panel {
    display: grid;
    gap: 10px;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--ga-line-2);
  }

  header,
  .group-heading {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  header {
    justify-content: space-between;
  }

  h4 {
    margin: 0;
    color: var(--ga-ink-0);
    font-size: 13px;
  }

  p,
  .empty {
    margin: 3px 0 0;
    color: var(--ga-ink-2);
    font-size: 10px;
  }

  button,
  input {
    font: inherit;
  }

  header button,
  .remove {
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-card);
    color: var(--ga-ink-1);
    cursor: pointer;
  }

  header button {
    padding: 6px 9px;
  }

  article {
    border: 1px solid var(--ga-line-2);
    background: var(--ga-card);
  }

  .group-heading {
    display: grid;
    grid-template-columns: minmax(100px, 1fr) auto 28px;
    padding: 8px;
    border-bottom: 1px solid var(--ga-line-2);
  }

  .group-heading input {
    min-width: 0;
    border: 1px solid var(--ga-line-2);
    background: var(--ga-slot);
    color: var(--ga-ink-0);
    padding: 6px 7px;
  }

  .group-heading span {
    color: var(--ga-ink-2);
    font-size: var(--ga-text-micro, 9px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    text-transform: uppercase;
  }

  .remove {
    width: 28px;
    height: 28px;
    color: var(--ga-rec, #ff3b30);
  }

  .member-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    background: var(--ga-raise);
  }

  label {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px;
    background: var(--ga-card);
    color: var(--ga-ink-1);
    font-size: 11px;
    cursor: pointer;
  }

  label input {
    accent-color: var(--ga-blue-300);
  }

  label span {
    display: grid;
  }

  label small {
    color: var(--ga-ink-2);
    font-size: 9px;
  }

  .range-member {
    color: #b98cff;
  }

  .fixture-member {
    color: #7fe3b0;
  }

  .empty {
    padding: 12px;
    border: 1px dashed var(--ga-line-2);
    text-align: center;
  }
</style>
