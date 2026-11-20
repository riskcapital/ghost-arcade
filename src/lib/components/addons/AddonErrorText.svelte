<script lang="ts">
  /** Why a licence action failed, in words. */
  import type { AddonActionCode } from '../../addons/addonAccess';

  let { code, maxMachines = 2 }: { code: AddonActionCode; maxMachines?: number } = $props();
</script>

{#if code === 'network'}Couldn't reach ghostarcade.live. Check the internet connection and try again.
{:else if code === 'invalid_key'}That licence key isn't known. Check it on your account page at ghostarcade.live.
{:else if code === 'bad_key'}That doesn't look like a licence key. It looks like GA-XXXX-XXXX-XXXX-XXXX.
{:else if code === 'licence_inactive'}This licence is no longer active. Your account page at ghostarcade.live says why.
{:else if code === 'machine_limit'}This licence is already on {maxMachines} computers. Move it from one of them to this one:
{:else if code === 'machine_not_activated'}This computer was deactivated on the website. Activate your key again to use it here.
{:else if code === 'no_key'}There's no licence key on this computer yet.
{:else if code === 'not_available'}The extension isn't available for this licence.
{:else if code === 'unavailable'}Licences need the desktop app.
{:else}The licence server couldn't answer just now. Try again in a minute.
{/if}
