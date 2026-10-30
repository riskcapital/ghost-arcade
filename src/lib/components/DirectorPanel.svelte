<script lang="ts">
  import { directorStore, isDirectorOpen, isDirectorStreaming } from '../stores/director';
  import { sendDirectorMessage, sendSupportTicket, cancelDirectorStream } from '../director/DirectorClient';
  import { executeToolCall } from '../director/DirectorToolExecutor';
  import { buildStateSnapshot } from '../director/DirectorStateSnapshot';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { audioStore } from '../stores/audio';
  import { get } from 'svelte/store';
  import { tick } from 'svelte';
  import type { DirectorToolCall, DirectorToolResult } from '../director/types';

  let inputText = '';
  let messagesEl: HTMLElement | null = null;
  let activeTab: 'vj' | 'mapping' | 'generate' | 'support' = 'vj';

  // ─── Speech-to-text (Web Speech API — free, no API cost) ───
  let isListening = false;
  let recognition: any = null;

  function toggleVoice() {
    if (isListening && recognition) {
      recognition.stop();
      isListening = false;
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e: any) => {
      const last = e.results[e.results.length - 1];
      if (last.isFinal) {
        inputText = last[0].transcript;
        isListening = false;
        // Auto-send after voice input
        send();
      } else {
        // Show interim results in the input field
        inputText = last[0].transcript;
      }
    };

    recognition.onerror = () => { isListening = false; };
    recognition.onend = () => { isListening = false; };

    recognition.start();
    isListening = true;
  }

  // ─── Auto VJ Mode (BPM-synced randomizer) ───
  let autoVJRunning = false;
  let autoVJInterval: ReturnType<typeof setInterval> | null = null;
  let autoVJBeatCount = 0;
  let autoVJBeatsPerChange = 16; // Change every N beats
  let autoVJMode: 'vj' | 'performer' = 'vj';

  function startAutoVJ() {
    autoVJRunning = true;
    autoVJBeatCount = 0;

    // Use live BPM from audio analyzer if available, otherwise default to 120.
    // manualBPM (if set) wins over detected BPM via the store's own logic.
    const audio = get(audioStore);
    const detectedBpm = audio.bpm > 0 ? audio.bpm : 120;
    const bpm = Math.max(30, Math.min(300, detectedBpm));
    const beatInterval = 60000 / bpm;

    autoVJInterval = setInterval(() => {
      autoVJBeatCount++;
      if (autoVJBeatCount % autoVJBeatsPerChange === 0) {
        autoVJTriggerRandom();
      }
    }, beatInterval);
  }

  function stopAutoVJ() {
    autoVJRunning = false;
    if (autoVJInterval) { clearInterval(autoVJInterval); autoVJInterval = null; }
  }

  function autoVJTriggerRandom() {
    const vj = $vjClipLauncher;
    if (autoVJMode === 'vj' && vj.isLive) {
      // Pick a random column and trigger it
      const col = Math.floor(Math.random() * vj.numColumns);
      vjClipLauncher.triggerColumn(col);
    }
    // Performer mode: handled by SynthVision's auto-mode which already exists
  }

  const quickCommands: Record<string, string[]> = {
    vj: ['build a deck', 'swap shaders', 'more intense', 'calm it down', 'save preset', 'add effects'],
    mapping: ['setup cube', 'add 6 layers', 'align grid', 'add feather', 'projection map'],
    generate: ['create shader', 'dark techno visual', 'ambient particles', 'generate video'],
    support: ['report bug', 'how to map', 'keyboard shortcuts', 'export help'],
  };

  async function send() {
    const text = inputText.trim();
    if (!text || $isDirectorStreaming) return;
    inputText = '';
    await sendDirectorMessage(text, buildStateSnapshot(), executeToolCall);
    await tick();
    scrollToBottom();
  }

  function sendQuick(cmd: string) {
    inputText = cmd;
    send();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function scrollToBottom() {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  $: if ($directorStore.messages.length || $directorStore.streamingText) {
    tick().then(scrollToBottom);
  }

  $: isVJLive = $isDirectorOpen ? $vjClipLauncher.isLive : false;
</script>

{#if $isDirectorOpen}
  <div data-help-page="ai-generation" class="director-panel">
    <!-- HEADER -->
    <div class="dp-header">
      <div class="dp-header-top">
        <div class="dp-logo-group">
          <img src="{import.meta.env.BASE_URL}director-icon.png" alt="" width="22" height="22" />
          <div class="dp-logo-text">
            <span class="dp-title">Director</span>
          </div>
        </div>
        <div class="dp-header-actions">
          {#if isVJLive}
            <span class="dp-live-badge"><span class="dp-live-dot"></span>Live</span>
          {/if}
          <button aria-label="Close Director" class="dp-close" onclick={() => directorStore.setOpen(false)}>×</button>
        </div>
      </div>

      <!-- Audio strip removed — was causing FPS drops from 60Hz store subscriptions -->

      <!-- TABS -->
      <div class="dp-tabs">
        {#each [['vj','VJ'], ['mapping','Mapping'], ['generate','Generate'], ['support','Support']] as [id, label]}
          <button class="dp-tab" class:active={activeTab === id} onclick={() => activeTab = id as any}>
            {#if activeTab === id}<span class="dp-tab-dot"></span>{/if}
            {label}
          </button>
        {/each}
      </div>
    </div>

    <!-- AUTO VJ BAR (VJ tab only) -->
    {#if activeTab === 'vj'}
      <div class="dp-auto-bar">
        <div class="dp-auto-header">
          <span class="dp-auto-title">Auto VJ</span>
          <span class="dp-auto-badge">+AI</span>
          {#if autoVJRunning}
            <span class="dp-auto-status running">● Running</span>
          {:else}
            <span class="dp-auto-status">Idle</span>
          {/if}
        </div>
        <div class="dp-auto-controls">
          {#if autoVJRunning}
            <button class="dp-transport-btn stop" onclick={stopAutoVJ}>■</button>
          {:else}
            <button class="dp-transport-btn play" onclick={startAutoVJ}>▶ Start</button>
          {/if}
          <select class="dp-auto-select" bind:value={autoVJBeatsPerChange}>
            <option value={4}>4 beats</option>
            <option value={8}>8 beats</option>
            <option value={16}>16 beats</option>
            <option value={32}>32 beats</option>
          </select>
        </div>
      </div>
    {/if}

    <!-- MAPPING PRESETS (Mapping tab only) -->
    {#if activeTab === 'mapping'}
      <div class="dp-mapping-presets">
        <span class="dp-mapping-label">Surface presets</span>
        <div class="dp-preset-grid">
          <button class="dp-preset" onclick={() => sendQuick('Create a single full-screen media layer')}>
            <svg viewBox="0 0 32 32" width="28" height="28"><rect x="4" y="8" width="24" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
            <span>Screen</span>
          </button>
          <button class="dp-preset" onclick={() => sendQuick('Create a 3-sided pyramid mapping layout with 3 triangle layers')}>
            <svg viewBox="0 0 32 32" width="28" height="28"><path d="M8 24L16 6L24 24Z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
            <span>Pyramid</span>
          </button>
          <button class="dp-preset" onclick={() => sendQuick('Create a 6-face cube mapping layout in isometric view with 6 layers')}>
            <svg viewBox="0 0 32 32" width="28" height="28"><rect x="8" y="10" width="12" height="12" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2" transform="rotate(-15 14 16)"/><rect x="14" y="10" width="12" height="12" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2" transform="rotate(15 20 16)"/></svg>
            <span>Cube</span>
          </button>
          <button class="dp-preset" onclick={() => sendQuick('Create 3 rectangular layers side by side for a stage backdrop')}>
            <svg viewBox="0 0 32 32" width="28" height="28"><rect x="3" y="12" width="8" height="14" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="12" y="6" width="8" height="20" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="21" y="12" width="8" height="14" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
            <span>Stage</span>
          </button>
          <button class="dp-preset" onclick={() => sendQuick('Create 4 layers arranged in a 2x2 grid')}>
            <svg viewBox="0 0 32 32" width="28" height="28"><rect x="4" y="4" width="11" height="11" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="17" y="4" width="11" height="11" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="4" y="17" width="11" height="11" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="17" y="17" width="11" height="11" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
            <span>Grid</span>
          </button>
          <button class="dp-preset" onclick={() => sendQuick('Create a custom mapping layout — ask me what shape I need')}>
            <svg viewBox="0 0 32 32" width="28" height="28"><polygon points="16,3 29,12 29,24 16,29 3,24 3,12" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
            <span>Custom</span>
          </button>
        </div>
      </div>
    {/if}

    <!-- CHAT -->
    <div class="dp-chat">
      <div class="dp-messages" bind:this={messagesEl}>
        {#if $directorStore.messages.length === 0 && !$isDirectorStreaming}
          <div class="dp-welcome">
            <p class="dp-welcome-title">What can I help with?</p>
            <p class="dp-welcome-hint">I can build VJ decks, set up projection mapping, generate shaders, and control your entire setup by voice or text.</p>
          </div>
        {/if}

        {#each $directorStore.messages as msg (msg.id)}
          <div class="dp-msg" class:user={msg.role === 'user'} class:ai={msg.role === 'assistant'}>
            <div class="dp-msg-avatar">{msg.role === 'user' ? 'You' : 'iV'}</div>
            <div class="dp-msg-body">
              <div class="dp-msg-meta">
                {msg.role === 'user' ? 'You' : 'Ghost Arcade AI'} · {new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
              </div>
              <div class="dp-msg-content">
                {msg.content}
                {#if msg.toolCalls?.length}
                  <div class="dp-action-card">
                    <div class="dp-action-header"><span class="dp-action-dot"></span>Actions executed</div>
                    {#each msg.toolCalls as tc}
                      <div class="dp-action-item">
                        <span class="dp-action-check">{tc.status === 'success' ? '✓' : tc.status === 'error' ? '✗' : '⟳'}</span>
                        <span>{tc.name}</span>
                        {#if tc.resultSummary}<span class="dp-action-detail">{tc.resultSummary}</span>{/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/each}

        {#if $isDirectorStreaming}
          <div class="dp-msg ai">
            <div class="dp-msg-avatar">iV</div>
            <div class="dp-msg-body">
              <div class="dp-msg-meta">Ghost Arcade AI</div>
              <div class="dp-msg-content">
                {#if $directorStore.streamingText}
                  {$directorStore.streamingText}
                {:else}
                  <div class="dp-typing">
                    <span class="dp-dot"></span><span class="dp-dot"></span><span class="dp-dot"></span>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/if}

        {#if $directorStore.error}
          <div class="dp-error">{$directorStore.error}</div>
        {/if}
      </div>

      <!-- QUICK COMMANDS -->
      <div class="dp-quick-cmds">
        {#each (quickCommands[activeTab] || []) as cmd}
          <button class="dp-cmd-pill" onclick={() => sendQuick(cmd)}>{cmd}</button>
        {/each}
      </div>
    </div>

    <!-- INPUT -->
    <div class="dp-input-area">
      <div class="dp-input-wrapper">
        <button class="dp-mic-btn" class:listening={isListening} onclick={toggleVoice} title={isListening ? 'Stop listening' : 'Voice input'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </button>
        <input
          class="dp-input-field"
          type="text"
          placeholder={isListening ? 'Listening...' : 'Tell Ghost Arcade what to do...'}
          bind:value={inputText}
          onkeydown={handleKeydown}
          disabled={$isDirectorStreaming}
        />
        {#if $isDirectorStreaming}
          <button class="dp-send-btn cancel" onclick={cancelDirectorStream}>■</button>
        {:else}
          <button class="dp-send-btn" onclick={send} disabled={!inputText.trim() && !isListening}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .director-panel {
    position: fixed;
    bottom: 30px;
    right: 8px;
    width: 420px;
    max-height: 75vh;
    z-index: 9991;
    background: var(--ga-panel);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-soft);
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 64px rgba(0,0,0,0.7);
    animation: dp-slideUp 0.3s ease-out;
    overflow: hidden;
    font-family: var(--ga-font-ui, system-ui, sans-serif);
    color: var(--ga-ink-0);
  }

  @keyframes dp-slideUp {
    from { opacity: 0; transform: translateY(16px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* ─── HEADER ─── */
  .dp-header { padding: 12px 12px 0; flex-shrink: 0; }

  .dp-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .dp-logo-group { display: flex; align-items: center; gap: 8px; }
  .dp-logo-group img { border-radius: var(--ga-r-hard); }
  .dp-logo-text { display: flex; flex-direction: column; }
  .dp-title { font-size: var(--ga-text-title); font-weight: var(--ga-weight-title); color: var(--ga-ink-0); line-height: 1; }
  .dp-subtitle { font-size: var(--ga-text-micro); color: var(--ga-ink-2); margin-top: 1px; }

  .dp-header-actions { display: flex; align-items: center; gap: 8px; }
  .dp-live-badge {
    display: flex; align-items: center; gap: 5px;
    background: color-mix(in srgb, var(--ga-live) 15%, transparent); padding: 2px 8px; border-radius: var(--ga-r-hard);
    font-size: var(--ga-text-meta); font-weight: var(--ga-weight-control);
    color: var(--ga-live);
  }
  .dp-live-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--ga-live); animation: dp-pulse 2s ease-in-out infinite; }
  @keyframes dp-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  .dp-close {
    background: none; border: none; color: var(--ga-ink-2); font-size: 20px;
    cursor: pointer; padding: 0 4px; line-height: 1;
  }
  .dp-close:hover { color: var(--ga-ink-0); }

  /* AUDIO STRIP */
  .dp-audio-strip {
    display: flex; align-items: center; gap: 8px;
    background: var(--ga-card); border: 1px solid var(--ga-line-1);
    border-radius: var(--ga-r-hard); padding: 6px 10px; margin-bottom: 8px;
  }
  .dp-bpm { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: var(--ga-text-heading); font-weight: 700; color: var(--ga-ink-0); }
  .dp-bpm-label { font-size: var(--ga-text-micro); color: var(--ga-ink-2); }
  .dp-level-bar { flex: 1; height: 3px; background: var(--ga-slot); border-radius: 2px; overflow: hidden; }
  .dp-level-fill { height: 100%; background: var(--ga-live); border-radius: 2px; transition: width 0.1s; }

  /* TABS: the shared segmented look */
  .dp-tabs {
    display: flex; background: var(--ga-slot); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard); padding: 2px; gap: 2px; margin-bottom: 8px;
  }
  .dp-tab {
    flex: 1; height: calc(var(--ga-control-h) - 4px); padding: 0 4px; text-align: center;
    font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); color: var(--ga-ink-1);
    background: transparent; border: none; border-radius: calc(var(--ga-r-hard) - 1px);
    cursor: pointer; transition: all 0.2s; display: flex;
    align-items: center; justify-content: center; gap: 4px;
  }
  .dp-tab:hover:not(.active) { color: var(--ga-ink-0); background: rgba(255, 255, 255, 0.05); }
  .dp-tab.active { color: var(--ga-selection-ink); background: var(--ga-selection-bg); box-shadow: inset 0 0 0 1px var(--ga-selection-line); }
  .dp-tab-dot { display: none; }

  /* ─── CHAT ─── */
  .dp-chat {
    flex: 1; display: flex; flex-direction: column;
    background: var(--ga-card); border: 1px solid var(--ga-line-1);
    border-radius: var(--ga-r-hard); margin: 0 12px; min-height: 0; overflow: hidden;
  }

  .dp-messages {
    flex: 1; overflow-y: auto; padding: 12px;
    display: flex; flex-direction: column; gap: 12px;
    scrollbar-width: thin; scrollbar-color: var(--ga-line-3) transparent;
  }
  .dp-messages::-webkit-scrollbar { width: 3px; }
  .dp-messages::-webkit-scrollbar-thumb { background: var(--ga-line-3); border-radius: 2px; }

  /* Welcome */
  .dp-welcome { text-align: center; padding: 24px 12px; }
  .dp-welcome-title { font-size: var(--ga-text-title); font-weight: var(--ga-weight-title); color: var(--ga-ink-0); margin-bottom: 6px; }
  .dp-welcome-hint { font-size: var(--ga-text-control); color: var(--ga-ink-2); line-height: 1.6; }

  /* Messages */
  .dp-msg { display: flex; gap: 8px; animation: dp-msgIn 0.3s ease both; max-width: 92%; }
  @keyframes dp-msgIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .dp-msg.user { align-self: flex-end; flex-direction: row-reverse; }
  .dp-msg.ai { align-self: flex-start; }
  .dp-msg-avatar {
    width: 24px; height: 24px; border-radius: var(--ga-r-hard); flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: var(--ga-text-micro); font-weight: 700;
  }
  .dp-msg.ai .dp-msg-avatar { background: var(--ga-sub); color: var(--ga-ink-0); }
  .dp-msg.user .dp-msg-avatar { background: var(--ga-selection-bg); color: var(--ga-selection-ink); }
  .dp-msg-body { display: flex; flex-direction: column; gap: 2px; }
  .dp-msg-meta { font-size: var(--ga-text-micro); color: var(--ga-ink-2); }
  .dp-msg.user .dp-msg-meta { text-align: right; }
  .dp-msg-content {
    padding: 8px 12px; font-size: var(--ga-text-body); line-height: 1.55;
    border-radius: var(--ga-r-soft); color: var(--ga-ink-0); white-space: pre-wrap; word-break: break-word;
  }
  .dp-msg.ai .dp-msg-content { background: var(--ga-sub); border: 1px solid var(--ga-line-1); }
  .dp-msg.user .dp-msg-content { background: var(--ga-selection-bg); border: 1px solid var(--ga-selection-line); color: var(--ga-selection-ink); }

  /* Action cards */
  .dp-action-card {
    background: var(--ga-slot); border: 1px solid var(--ga-line-1);
    border-radius: var(--ga-r-hard); padding: 8px 10px; margin-top: 6px;
  }
  /* Eyebrow label */
  .dp-action-header {
    font-size: var(--ga-text-eyebrow); font-weight: 700; text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking); color: var(--ga-ink-2); margin-bottom: 6px;
    display: flex; align-items: center; gap: 5px;
  }
  .dp-action-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--ga-live); }
  .dp-action-item {
    display: flex; align-items: center; gap: 6px;
    font-size: var(--ga-text-meta); color: var(--ga-ink-1);
    padding: 4px 8px; background: var(--ga-card); border-radius: var(--ga-r-hard); margin-bottom: 2px;
  }
  .dp-action-check { font-size: var(--ga-text-meta); color: var(--ga-live); }
  .dp-action-detail { color: var(--ga-ink-2); margin-left: auto; font-size: var(--ga-text-eyebrow); }

  /* Typing */
  .dp-typing { display: flex; gap: 4px; padding: 4px 0; }
  .dp-dot {
    width: 5px; height: 5px; border-radius: 50%; background: var(--ga-ink-1);
    animation: dp-bounce 1.2s ease-in-out infinite;
  }
  .dp-dot:nth-child(2) { animation-delay: 0.15s; }
  .dp-dot:nth-child(3) { animation-delay: 0.3s; }
  @keyframes dp-bounce { 0%,60%,100% { transform: translateY(0); opacity: 0.3; } 30% { transform: translateY(-5px); opacity: 1; } }

  .dp-error {
    font-size: var(--ga-text-control); color: var(--ga-rec); padding: 8px 10px;
    background: color-mix(in srgb, var(--ga-rec) 8%, transparent); border-radius: var(--ga-r-hard);
    border: 1px solid color-mix(in srgb, var(--ga-rec) 25%, transparent);
  }

  /* QUICK COMMANDS */
  .dp-quick-cmds {
    display: flex; gap: 4px; padding: 6px 8px; overflow-x: auto;
    border-top: 1px solid var(--ga-line-1); scrollbar-width: none;
  }
  .dp-quick-cmds::-webkit-scrollbar { display: none; }
  .dp-cmd-pill {
    white-space: nowrap; height: var(--ga-control-h-sm); padding: 0 10px;
    font-size: var(--ga-text-meta); font-weight: var(--ga-weight-control); color: var(--ga-ink-1);
    background: var(--ga-sub); border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard); cursor: pointer; transition: all 0.2s; flex-shrink: 0;
  }
  .dp-cmd-pill:hover { border-color: var(--ga-line-3); color: var(--ga-ink-0); }

  /* ─── INPUT ─── */
  .dp-input-area { padding: 8px 12px 12px; flex-shrink: 0; }
  .dp-input-wrapper {
    background: var(--ga-slot); border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-soft); padding: 2px; display: flex; align-items: center; gap: 2px;
    transition: all 0.2s;
  }
  .dp-input-wrapper:focus-within { border-color: var(--ga-focus); }
  .dp-input-field {
    flex: 1; background: transparent; border: none; outline: none;
    color: var(--ga-ink-0); font-size: var(--ga-text-body); padding: 8px 10px;
    font-family: inherit;
  }
  .dp-input-field::placeholder { color: var(--ga-ink-2); font-size: var(--ga-text-control); }
  .dp-send-btn {
    width: 30px; height: 30px; border-radius: calc(var(--ga-r-soft) - 2px); border: none;
    background: var(--ga-accent-gradient, var(--ga-violet)); color: var(--ga-blue-800); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s; flex-shrink: 0;
  }
  .dp-send-btn svg { fill: currentColor; }
  .dp-send-btn:hover { filter: brightness(1.06); }
  .dp-send-btn:disabled { opacity: 0.3; cursor: default; }
  .dp-send-btn.cancel { background: var(--ga-rec); color: #fff; font-size: var(--ga-text-body); }

  /* MIC BUTTON */
  .dp-mic-btn {
    width: 30px; height: 30px; border-radius: calc(var(--ga-r-soft) - 2px); border: none;
    background: transparent; color: var(--ga-ink-2); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s; flex-shrink: 0;
  }
  .dp-mic-btn:hover { color: var(--ga-ink-0); background: var(--ga-sub); }
  .dp-mic-btn.listening {
    color: var(--ga-rec); background: color-mix(in srgb, var(--ga-rec) 12%, transparent);
    animation: dp-mic-pulse 1s ease-in-out infinite;
  }
  @keyframes dp-mic-pulse { 0%,100% { box-shadow: none; } 50% { box-shadow: 0 0 12px rgba(239,68,68,0.3); } }

  /* AUTO VJ BAR */
  .dp-auto-bar {
    margin: 0 12px 8px; padding: 10px 12px;
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard);
    flex-shrink: 0;
  }
  .dp-auto-header {
    display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
  }
  .dp-auto-title { font-size: var(--ga-text-body); font-weight: var(--ga-weight-title); color: var(--ga-ink-0); }
  .dp-auto-badge {
    font-size: var(--ga-text-micro); font-weight: 700;
    color: var(--ga-ink-1); border: 1px solid var(--ga-line-2);
    padding: 1px 5px; border-radius: var(--ga-r-hard);
  }
  .dp-auto-status {
    margin-left: auto;
    font-size: var(--ga-text-meta); color: var(--ga-ink-2);
  }
  .dp-auto-status.running { color: var(--ga-live); }
  .dp-auto-controls { display: flex; align-items: center; gap: 6px; }
  .dp-transport-btn {
    height: var(--ga-control-h); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all 0.2s; background: var(--ga-sub); color: var(--ga-ink-1); font-size: var(--ga-text-control); font-weight: var(--ga-weight-control);
  }
  .dp-transport-btn.play {
    flex: 1; background: var(--ga-accent-gradient, var(--ga-violet)); border-color: transparent; color: var(--ga-blue-800); gap: 6px;
    border-radius: var(--ga-r-soft); font-weight: 700;
  }
  .dp-transport-btn.play:hover { filter: brightness(1.06); }
  .dp-transport-btn.stop { width: var(--ga-control-h); color: var(--ga-rec); }
  .dp-transport-btn.stop:hover { background: color-mix(in srgb, var(--ga-rec) 12%, transparent); }
  .dp-auto-select {
    height: var(--ga-control-h); background: var(--ga-slot); border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-0); font-size: var(--ga-text-control); padding: 0 8px; border-radius: var(--ga-r-hard);
  }

  /* MAPPING PRESETS */
  .dp-mapping-presets {
    margin: 0 12px 8px; flex-shrink: 0;
  }
  /* Eyebrow section label */
  .dp-mapping-label {
    font-size: var(--ga-text-eyebrow); font-weight: 700; text-transform: uppercase;
    color: var(--ga-ink-2); letter-spacing: var(--ga-eyebrow-tracking); margin-bottom: 6px; display: block;
  }
  .dp-preset-grid {
    display: flex; gap: 4px;
  }
  .dp-preset {
    flex: 1; aspect-ratio: 1; max-width: 60px;
    background: var(--ga-card); border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-tile, 7px); cursor: pointer; transition: all 0.2s;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 4px; padding: 6px 2px; color: var(--ga-ink-1);
  }
  .dp-preset:hover {
    border-color: var(--ga-line-3);
    color: var(--ga-ink-0);
  }
  .dp-preset span {
    font-size: var(--ga-text-micro); font-weight: var(--ga-weight-control); text-align: center;
  }
</style>
