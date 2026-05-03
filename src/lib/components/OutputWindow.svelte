<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invoke } from '$lib/bridge';
  import type { RenderEngine } from '../renderer/engine';

  export let isOpen = false;
  export let onClose: () => void = () => {};
  // Reference to the main canvas engine (kept for API compatibility)
  export let mainEngine: RenderEngine | null = null;

  // Output rotation (0, 90, 180, 270 degrees)
  export let rotation: number = 0;

  // Show cursor on output window (for live performance)
  export let showCursor: boolean = false;

  // Input slice/crop region (normalized 0-1 coordinates)
  export let cropRegion: { x: number; y: number; width: number; height: number } = {
    x: 0,
    y: 0,
    width: 1,
    height: 1
  };

  // Methods to update settings from parent
  export function setRotation(deg: number) {
    rotation = deg % 360;
  }

  export function setCropRegion(region: { x: number; y: number; width: number; height: number }) {
    cropRegion = { ...region };
  }

  export function setShowCursor(show: boolean) {
    showCursor = show;
  }

  export function toggleCursor() {
    showCursor = !showCursor;
    return showCursor;
  }

  // Update cursor position from main viewport (normalized 0-1 coordinates)
  export function updateCursorPosition(x: number, y: number) {
    // Cursor position forwarding can be added later
  }

  // Clear cursor when mouse leaves the main viewport
  export function clearCursor() {
    // Cursor clearing can be added later
  }

  // Open output window — opens a draggable window (double-click to fullscreen)
  export async function openPopup(preferExternal: boolean = true) {
    try {
      // Get available displays from Electron
      const displays: any[] = await invoke('get_displays');

      let target = displays[0]; // fallback to first display
      if (preferExternal) {
        // Pick the first non-primary display
        const external = displays.find((d: any) => !d.isPrimary);
        if (external) {
          target = external;
        }
      }

      // Open at 1280x720 centered on the target display (not full size)
      const winW = Math.min(1280, target.width);
      const winH = Math.min(720, target.height);
      const x = target.x + Math.round((target.width - winW) / 2);
      const y = target.y + Math.round((target.height - winH) / 2);

      await invoke('create_output_window', {
        width: winW, height: winH, x, y,
        fullscreen: false,
        displayId: target.id,
      });
      isOpen = true;
      console.log(`[Output] Window opened on display "${target.label}" (${winW}x${winH})`);
    } catch (error) {
      console.error('Failed to create output window:', error);
      // Fallback: open without display info
      try {
        await invoke('create_output_window', {
          width: 1280, height: 720,
          x: 100, y: 100,
          fullscreen: false,
        });
        isOpen = true;
      } catch (e2) {
        alert('Could not open output window: ' + e2);
      }
    }
  }

  // Open fullscreen on external monitor (or primary if no external)
  export async function openFullscreenExternal() {
    try {
      const result: any = await invoke('output_fullscreen_external');
      isOpen = true;
      console.log(`[Output] Fullscreen on display ${result.displayId}, external=${result.isExternal}`);
    } catch (error) {
      console.error('Failed to open fullscreen output:', error);
    }
  }

  // Toggle fullscreen on existing output window
  export async function toggleFullscreen() {
    try {
      return await invoke('output_toggle_fullscreen');
    } catch (error) {
      console.error('Failed to toggle fullscreen:', error);
      return false;
    }
  }

  // Open output fullscreen in current window (local fallback)
  export function openFullscreen(containerEl: HTMLElement) {
    if (containerEl.requestFullscreen) {
      containerEl.requestFullscreen();
    }
  }

  export function close() {
    invoke('close_output_window').catch(() => {});
    isOpen = false;
    onClose();
  }

  onDestroy(() => {
    close();
  });
</script>
