<script lang="ts">
  export let name = 'play';
  export let size = 20;
  const paths: Record<string, string> = {
    autopilot: 'M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5M18 3v4h-4M6 21v-4h4M9 12h6M12 9v6',
    smoke: 'M5 21c-4-5 7-5 3-11M11 21c-4-7 8-8 3-17M17 21c-3-4 6-7 3-11',
    trails: 'M3 7h9M3 12h6M3 17h9M21 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    paint: 'm14 3 7 7-10 10H4v-7ZM12 5l7 7M3 21h7',
    drop: 'M12 2S4 11 4 15a8 8 0 0 0 16 0c0-4-8-13-8-13ZM8 15c0 3 2 4 4 4',
    link: 'm9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
    scan: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M7 8l5-3 5 3v8l-5 3-5-3ZM7 8l5 3 5-3M12 11v8',
    depth: 'm3 7 9-4 9 4-9 4ZM3 12l9 4 9-4M3 17l9 4 9-4',
    dualcam: 'M3 5h11v14H3ZM17 8l4-3v14l-4-3ZM6 10h5M6 14h5',
    play: 'm8 5 11 7-11 7Z',
    pause: 'M8 5v14M16 5v14',
    grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
    map: 'm3 5 7-2 5 3 6-2v15l-6 2-5-3-7 2ZM10 3v15M15 6v15',
    mixer: 'M5 3v6m0 6v6M2 9h6v6H2ZM12 3v11m0 5v2M9 14h6v5H9ZM19 3v3m0 6v9M16 6h6v6h-6Z',
    flux: 'M3 16C5 3 9 3 12 12s7 9 9-4M3 8c2 13 6 13 9 4s7-9 9 4',
    controls: 'M3 6h5m6 0h7M3 12h11m6 0h1M3 18h2m6 0h10M8 3h6v6H8ZM14 9h6v6h-6ZM5 15h6v6H5Z',
    snap: 'M5 3v10a7 7 0 0 0 14 0V3h-4v10a3 3 0 0 1-6 0V3ZM5 7h4M15 7h4',
    fx: 'm12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z',
    library: 'M4 5h16v15H4ZM8 2h8M8 9h8M8 13h5',
    plus: 'M12 5v14M5 12h14',
    close: 'm6 6 12 12M18 6 6 18',
    settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
    output: 'M3 4h18v13H3ZM8 21h8M12 17v4',
    mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0ZM5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8',
    record: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    undo: 'M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12',
    redo: 'm15 4 5 5-5 5M20 9H10a6 6 0 0 0 0 12',
    restart: 'M6 5v14M19 5 9 12l10 7Z',
    lock: 'M6 10h12v11H6ZM8 10V6a4 4 0 0 1 8 0v4',
    unlock: 'M6 10h12v11H6ZM8 10V6a4 4 0 0 1 8 0',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm7 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
    trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    save: 'M4 3h13l4 4v14H3V3ZM7 3v6h9V3M7 21v-8h10v8',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
    search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-2 4 7 7',
    left: 'm14 5-7 7 7 7',
    right: 'm10 5 7 7-7 7',
    blackout: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM6 6l12 12',
    copy: 'M8 8h13v13H8ZM16 8V3H3v13h5',
    check: 'm5 12 4 4L19 6',
    camera: 'M3 7h5l2-3h4l2 3h5v14H3Zm6 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={paths[name] || paths.play} /></svg
>
