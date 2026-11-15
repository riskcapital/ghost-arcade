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
    // Panel and section icons.
    // Touch tools of the Interactive editor.
    'tool-throw': 'M13 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0ZM2 8h8M4 12h6M2 16h8',
    'tool-push': 'M3 12h11m-4-5 5 5-5 5M19 4v16',
    'tool-pour': 'M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12ZM9 15c0 2 1.3 3.4 3 3.4',
    'tool-ignite': 'M12 22c3.9 0 7-2.8 7-6.8 0-4.6-4.2-6.8-5-12.2-2.8 1.8-4.8 4.6-4.8 7.8-1-.8-1.8-1.9-2-3.6C5.6 9 5 11.6 5 15.2 5 19.2 8.1 22 12 22Z',
    'tool-attract': 'M12 12h.01M2 12h6m-2.5-2.5L8 12l-2.5 2.5M22 12h-6m2.5-2.5L16 12l2.5 2.5M12 2v6M9.5 5.5 12 8l2.5-2.5M12 22v-6m-2.5 2.5L12 16l2.5 2.5',
    'tool-repel': 'M12 12h.01M8 12H2m2.5-2.5L2 12l2.5 2.5M16 12h6m-2.5-2.5L22 12l-2.5 2.5M12 8V2M9.5 4.5 12 2l2.5 2.5M12 16v6m-2.5-2.5L12 22l2.5-2.5',
    'tool-vortex': 'M12 12.5a.8.8 0 1 1 .8-.8M12.8 11.7a3 3 0 1 1-3-3 5.5 5.5 0 0 1 5.5 5.5 8 8 0 0 1-8 8M9.8 8.7a8.3 8.3 0 0 1 11.2 3.3',
    info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6M12 7.6v.2',
    help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.2 1-1.2 1.8v.5M12 16.8v.2',
    warning: 'M12 3 2 20h20ZM12 10v4.5M12 17.2v.2',
    projector: 'M3 8h18v9H3ZM14 12.5a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM6 11h5M6 14h5M6 17v2M18 17v2',
    cable: 'M7 3v4M11 3v4M5 7h8v4a4 4 0 0 1-8 0ZM9 15v2a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4V9',
    airplay: 'M6 17H3V4h18v13h-3M7 21l5-6 5 6Z',
    rotate: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
    mirror: 'M12 3v18M9 7 3 17h6ZM15 7l6 10h-6Z',
    frame: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    quality: 'M3 5h18v14H3ZM7 9v6M7 12h3M10 9v6M14 9h2a3 3 0 0 1 0 6h-2Z',
    gauge: 'M4 17a8 8 0 1 1 16 0M12 17l4-5M3 20h18',
    surface: 'M4 6.5 19 4l1 15.5-16 .5ZM4 6.5h0',
    crop: 'M6 2v16h16M2 6h16v16',
    look: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 3v18M12 7.5h4.8M12 12h6M12 16.5h4.8',
    point: 'M12 3v4M12 17v4M3 12h4M17 12h4M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    layers: 'm3 8 9-4 9 4-9 4ZM3 12.5l9 4 9-4M3 17l9 4 9-4',
    tempo: 'M8 3h8l4 18H4ZM12 16l5-9M7.5 16h9',
    wave: 'M3 12h1M7 8v8M11 4v16M15 8v8M19 10v4M21 12h0',
    note: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    phone: 'M7 2h10v20H7ZM11 18h2',
    'mic-off': 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0ZM5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8M3 3l18 18',
    power: 'M12 3v8M6.4 6.4a8 8 0 1 0 11.2 0',
    sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
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
