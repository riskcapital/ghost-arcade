<script lang="ts">
  /** Small line icons used only by the mapping tools. */
  let { name, size = 18 }: { name: string; size?: number } = $props();
  const paths: Record<string, string> = {
    quad: 'M4 6l15-2 1 15-16 1Z',
    mesh: 'M4 4h16v16H4ZM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16',
    shape: 'M12 3l8 6-3 11H7L4 9Z',
    circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
    draw: 'M3 17c3-6 6-9 9-6s5 3 9-4M3 21h18',
    curve: 'M4 18C4 8 20 16 20 6M4 18h0M20 6h0',
    zoom: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.5 15.5 20 20M8 10.5h5M10.5 8v5',
    fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    mirrorH: 'M12 3v18M9 6 3 18h6ZM15 6l6 12h-6Z',
    mirrorV: 'M3 12h18M6 9 18 3v6ZM6 15l12 6v-6Z',
    duplicate: 'M8 8h12v12H8ZM4 16V4h12',
    group: 'M3 3h8v8H3ZM13 13h8v8h-8ZM11 7h4a2 2 0 0 1 2 2v4',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M6 13l6 6 6-6',
    solo: 'M12 3a4 4 0 0 1 4 4v3a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4ZM5 11a7 7 0 0 0 14 0M12 18v3',
    identify: 'M4 4h16v16H4ZM9 9l2-1v8M14 8h3l-3 8',
    weld: 'M7 7a3 3 0 1 0 0 .1M17 17a3 3 0 1 0 0 .1M9 9l6 6',
    unweld: 'M7 7a3 3 0 1 0 0 .1M17 17a3 3 0 1 0 0 .1M9 9l2 2M13 13l2 2',
    mask: 'M3 5h18v14H3ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    polygon: 'M5 19l2-13 11 2 2 10Z',
    image: 'M3 5h18v14H3ZM3 16l5-5 4 4 3-3 6 6M15 9a1 1 0 1 0 0 .1',
    invert: 'M12 3a9 9 0 1 0 0 18ZM12 3a9 9 0 0 1 0 18',
    add: 'M12 5v14M5 12h14',
    remove: 'M5 12h14',
    smooth: 'M3 17C8 17 8 7 12 7s4 10 9 10',
    corner: 'M3 18 12 6l9 12',
    rotate: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
    scale: 'M4 20 20 4M14 4h6v6M10 20H4v-6',
    point: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 2v4M12 18v4M2 12h4M18 12h4',
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.point} /></svg>
