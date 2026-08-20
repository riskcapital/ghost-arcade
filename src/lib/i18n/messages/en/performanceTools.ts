export default {
  directorButton: {
    title: 'Director AI Agent (Ctrl+Shift+D)',
    ariaLabel: 'Open Director AI Agent',
  },
  director: {
    title: 'Director',
    live: 'LIVE',
    liveAria: 'Director live output',
    close: 'Close Director',
    tabs: {
      vj: 'VJ',
      mapping: 'Mapping',
      generate: 'Generate',
      support: 'Support',
    },
    auto: {
      title: 'Auto VJ',
      running: '● RUNNING',
      idle: 'IDLE',
      start: '▶ Start',
      stop: 'Stop Auto VJ',
      beats: '{count} beats',
      beatsLabel: 'Beats per visual change',
    },
    mapping: {
      title: 'SURFACE PRESETS',
      presets: {
        screen: {
          label: 'Screen',
          command: 'Create a single full-screen media layer',
        },
        pyramid: {
          label: 'Pyramid',
          command: 'Create a 3-sided pyramid mapping layout with 3 triangle layers',
        },
        cube: {
          label: 'Cube',
          command: 'Create a 6-face cube mapping layout in isometric view with 6 layers',
        },
        stage: {
          label: 'Stage',
          command: 'Create 3 rectangular layers side by side for a stage backdrop',
        },
        grid: {
          label: 'Grid',
          command: 'Create 4 layers arranged in a 2x2 grid',
        },
        custom: {
          label: 'Custom',
          command: 'Create a custom mapping layout — ask me what shape I need',
        },
      },
    },
    welcome: {
      title: 'What can I help with?',
      hint: 'I can build VJ decks, set up projection mapping, generate shaders, and control your entire setup by voice or text.',
    },
    messages: {
      user: 'You',
      assistant: 'Ghost Arcade AI',
      actionsExecuted: 'ACTIONS EXECUTED',
    },
    toolStatus: {
      pending: 'Pending',
      executing: 'Executing',
      success: 'Succeeded',
      error: 'Failed',
      unknown: 'Unknown status',
    },
    quick: {
      vj: {
        buildDeck: { label: 'build a deck', command: 'build a deck' },
        swapShaders: { label: 'swap shaders', command: 'swap shaders' },
        moreIntense: { label: 'more intense', command: 'more intense' },
        calmDown: { label: 'calm it down', command: 'calm it down' },
        savePreset: { label: 'save preset', command: 'save preset' },
        addEffects: { label: 'add effects', command: 'add effects' },
      },
      mapping: {
        setupCube: { label: 'setup cube', command: 'setup cube' },
        addLayers: { label: 'add 6 layers', command: 'add 6 layers' },
        alignGrid: { label: 'align grid', command: 'align grid' },
        addFeather: { label: 'add feather', command: 'add feather' },
        projectionMap: { label: 'projection map', command: 'projection map' },
      },
      generate: {
        createShader: { label: 'create shader', command: 'create shader' },
        darkTechnoVisual: { label: 'dark techno visual', command: 'dark techno visual' },
        ambientParticles: { label: 'ambient particles', command: 'ambient particles' },
        generateVideo: { label: 'generate video', command: 'generate video' },
      },
      support: {
        reportBug: { label: 'report bug', command: 'report bug' },
        howToMap: { label: 'how to map', command: 'how to map' },
        keyboardShortcuts: { label: 'keyboard shortcuts', command: 'keyboard shortcuts' },
        exportHelp: { label: 'export help', command: 'export help' },
      },
    },
    input: {
      stopListening: 'Stop listening',
      voiceInput: 'Voice input',
      listening: 'Listening...',
      placeholder: 'Tell Ghost Arcade what to do...',
      ariaLabel: 'Message Director',
      cancel: 'Cancel response',
      send: 'Send message',
    },
  },
  performancePad: {
    title: 'PERFORMANCE PAD',
    ariaLabel: 'Performance XY pad. Drag to control bound parameters.',
    status: {
      live: 'LIVE',
      ready: 'READY',
    },
    axis: {
      x: 'X',
      y: 'Y',
      momentum: 'MOM',
      none: '-- none --',
      xAria: 'X-axis parameter',
      yAria: 'Y-axis parameter',
      momentumAria: 'Momentum',
    },
    triggerAria: 'Trigger {label}',
    triggers: {
      flash: 'FLASH',
      glitch: 'GLITCH',
      color: 'COLOR',
      freeze: 'FREEZE',
      drop: 'DROP',
      random: 'RANDOM',
    },
  },
};
