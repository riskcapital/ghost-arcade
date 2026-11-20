<script lang="ts">
  // The phone app's front door. Every cold launch opens on the welcome screen, unless the app
  // was opened by a pairing link: then it goes straight to the studio with Mobile Control
  // pairing open. The studio starts on the first choice and then stays mounted: the home
  // button lays the welcome screen over it, so the set, the decks and a live output keep
  // running, and the welcome screen's shader only runs while it is showing.
  import { onMount } from 'svelte';
  import NativeStudioApp from './NativeStudioApp.svelte';
  import PhoneWelcome from './PhoneWelcome.svelte';
  import { launchScreen, setLaunchPath, type LaunchPath } from '../../mobile/studio/launchIntent';

  let deciding = true;
  let welcome = false;
  let studio = false;
  let launchLink = '';

  const cap = (window as any).Capacitor;
  const native = () => ['ios', 'android'].includes(cap?.getPlatform?.());

  /** The link waiting in the pairing inbox, taken (it is only handed out once). */
  async function takeInbox(): Promise<string | null> {
    if (!native()) return null;
    try {
      const plugin = cap.getPlatform() === 'ios' ? 'StudioCapture' : 'CompanionLink';
      const result = await Promise.race([
        cap.nativePromise(plugin, 'takePairingLink', {}),
        new Promise<{ url?: string }>((resolve) => setTimeout(() => resolve({}), 600)),
      ]);
      return result?.url || null;
    } catch {
      return null;
    }
  }

  function openStudioForPairing(link: string) {
    launchLink = link;
    welcome = false;
    studio = true;
  }

  function choose(path: LaunchPath) {
    setLaunchPath(path);
    welcome = false;
    studio = true;
  }

  function home() {
    welcome = true;
  }

  onMount(() => {
    let disposed = false;
    void takeInbox().then((link) => {
      if (disposed) return;
      deciding = false;
      if (link && launchScreen(link) === 'pairing') openStudioForPairing(link);
      else welcome = true;
    });
    // A link that arrives while the welcome screen is up, before the studio has started, is
    // taken here. Once the studio runs, its own inbox watcher takes it and calls onpairing.
    const arrived = async () => {
      if (studio || deciding) return;
      const link = await takeInbox();
      if (!disposed && link && !studio) openStudioForPairing(link);
    };
    window.addEventListener('ghost-pairing-link', arrived);
    return () => {
      disposed = true;
      window.removeEventListener('ghost-pairing-link', arrived);
    };
  });

  function pairingArrived() {
    if (welcome) {
      welcome = false;
      setLaunchPath('resume');
    }
  }
</script>

{#if studio}
  <div class="studio-host" inert={welcome}>
    <NativeStudioApp {launchLink} onpairing={pairingArrived} onhome={home} />
  </div>
{/if}
{#if welcome}<PhoneWelcome onchoose={choose} />{/if}

<style>
  .studio-host { display: contents; }
</style>
