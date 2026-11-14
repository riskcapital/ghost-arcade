<script lang="ts">
 import Icon from './StudioIcon.svelte';
 export let onconnect:()=>void;
</script>
<div class="output-banner" role="status" data-output-banner>
 <span class="state"><Icon name="output" size={16}/><span>No projector connected</span></span>
 <button type="button" onclick={onconnect}>Connect a projector</button>
</div>
<style>
 .output-banner{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px;padding:0 0 0 12px;min-height:44px;border:1px solid var(--ga-line-2);border-radius:8px;background:var(--ga-slot);color:var(--ga-ink-1);font:600 12px/1.25 system-ui,-apple-system,sans-serif;}
 .state{display:flex;align-items:center;gap:8px;min-width:0;}
 .state span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .state :global(svg){flex:none;color:#ffc570;}
 button{flex:none;min-height:44px;padding:0 14px;border:0;border-left:1px solid var(--ga-line-2);border-radius:0 7px 7px 0;background:var(--ga-selection-bg);color:var(--ga-selection-ink,var(--ga-ink-0));font:650 13px/1 system-ui,-apple-system,sans-serif;touch-action:manipulation;}
 @media (max-width:760px){.output-banner{max-width:520px;margin:0 auto 6px;}}
</style>
