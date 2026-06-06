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
  <div class="director-panel">
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
            <span class="dp-live-badge"><span class="dp-live-dot"></span>LIVE</span>
          {/if}
          <button class="dp-close" onclick={() => directorStore.setOpen(false)}>×</button>
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
            <span class="dp-auto-status running">● RUNNING</span>
          {:else}
            <span class="dp-auto-status">IDLE</span>
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
        <span class="dp-mapping-label">SURFACE PRESETS</span>
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
                    <div class="dp-action-header"><span class="dp-action-dot"></span>ACTIONS EXECUTED</div>
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
    background: #0d0d1a;
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 64px rgba(0,0,0,0.7), 0 0 40px rgba(232,67,147,0.05);
    animation: dp-slideUp 0.3s ease-out;
    overflow: hidden;
    font-family: 'Inter', -apple-system, sans-serif;
  }

  @keyframes dp-slideUp {
    from { opacity: 0; transform: translateY(16px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* ─── HEADER ─── */
  .dp-header { padding: 12px 14px 0; flex-shrink: 0; }

  .dp-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .dp-logo-group { display: flex; align-items: center; gap: 8px; }
  .dp-logo-group img { border-radius: 4px; }
  .dp-logo-text { display: flex; flex-direction: column; }
  .dp-title { font-size: 13px; font-weight: 700; color: #f0f0f5; line-height: 1; }
  .dp-subtitle { font-family: 'JetBrains Mono', monospace; font-size: 8px; color: #606078; letter-spacing: 2px; margin-top: 1px; }

  .dp-header-actions { display: flex; align-items: center; gap: 8px; }
  .dp-live-badge {
    display: flex; align-items: center; gap: 5px;
    background: rgba(74,222,128,0.15); padding: 3px 8px; border-radius: 4px;
    font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600;
    color: #4ade80; letter-spacing: 1px;
  }
  .dp-live-dot { width: 5px; height: 5px; border-radius: 50%; background: #4ade80; animation: dp-pulse 2s ease-in-out infinite; }
  @keyframes dp-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  .dp-close {
    background: none; border: none; color: #606078; font-size: 18px;
    cursor: pointer; padding: 0 4px; line-height: 1;
  }
  .dp-close:hover { color: #f0f0f5; }

  /* AUDIO STRIP */
  .dp-audio-strip {
    display: flex; align-items: center; gap: 8px;
    background: #16162a; border: 1px solid rgba(255,255,255,0.06);
    border-radius: 6px; padding: 6px 10px; margin-bottom: 8px;
  }
  .dp-bpm { font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 800; color: #e84393; }
  .dp-bpm-label { font-family: 'JetBrains Mono', monospace; font-size: 8px; color: #606078; letter-spacing: 1px; }
  .dp-level-bar { flex: 1; height: 3px; background: #0d0d1a; border-radius: 2px; overflow: hidden; }
  .dp-level-fill { height: 100%; background: linear-gradient(90deg, #e84393, #ff6b35); border-radius: 2px; transition: width 0.1s; }

  /* TABS */
  .dp-tabs {
    display: flex; background: #16162a; border-radius: 7px; padding: 3px; gap: 2px; margin-bottom: 6px;
  }
  .dp-tab {
    flex: 1; padding: 7px 4px; text-align: center;
    font-size: 10px; font-weight: 600; color: #606078;
    background: transparent; border: none; border-radius: 5px;
    cursor: pointer; transition: all 0.2s; display: flex;
    align-items: center; justify-content: center; gap: 4px;
  }
  .dp-tab:hover { color: #a0a0b8; background: #222240; }
  .dp-tab.active { color: #f0f0f5; background: #222240; box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
  .dp-tab-dot { width: 4px; height: 4px; border-radius: 50%; background: #e84393; }

  /* ─── CHAT ─── */
  .dp-chat {
    flex: 1; display: flex; flex-direction: column;
    background: var(--bg-secondary, #1a1a2e); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 8px; margin: 0 14px; min-height: 0; overflow: hidden;
  }

  .dp-messages {
    flex: 1; overflow-y: auto; padding: 14px 12px;
    display: flex; flex-direction: column; gap: 12px;
    scrollbar-width: thin; scrollbar-color: #222240 transparent;
  }
  .dp-messages::-webkit-scrollbar { width: 3px; }
  .dp-messages::-webkit-scrollbar-thumb { background: #222240; border-radius: 2px; }

  /* Welcome */
  .dp-welcome { text-align: center; padding: 24px 12px; }
  .dp-welcome-title { font-size: 14px; font-weight: 600; color: #f0f0f5; margin-bottom: 6px; }
  .dp-welcome-hint { font-size: 11px; color: #606078; line-height: 1.6; }

  /* Messages */
  .dp-msg { display: flex; gap: 8px; animation: dp-msgIn 0.3s ease both; max-width: 92%; }
  @keyframes dp-msgIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .dp-msg.user { align-self: flex-end; flex-direction: row-reverse; }
  .dp-msg.ai { align-self: flex-start; }
  .dp-msg-avatar {
    width: 24px; height: 24px; border-radius: 5px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-family: 'JetBrains Mono', monospace; font-size: 8px; font-weight: 800;
  }
  .dp-msg.ai .dp-msg-avatar { background: rgba(232,67,147,0.2); color: #e84393; }
  .dp-msg.user .dp-msg-avatar { background: rgba(168,85,247,0.15); color: #a855f7; }
  .dp-msg-body { display: flex; flex-direction: column; gap: 2px; }
  .dp-msg-meta { font-family: 'JetBrains Mono', monospace; font-size: 8px; color: #45455a; letter-spacing: 0.5px; }
  .dp-msg.user .dp-msg-meta { text-align: right; }
  .dp-msg-content {
    padding: 9px 12px; font-size: 12px; line-height: 1.55;
    border-radius: 7px; color: #f0f0f5; white-space: pre-wrap; word-break: break-word;
  }
  .dp-msg.ai .dp-msg-content { background: #16162a; border: 1px solid rgba(255,255,255,0.06); }
  .dp-msg.user .dp-msg-content { background: rgba(168,85,247,0.15); border: 1px solid rgba(168,85,247,0.3); }

  /* Action cards */
  .dp-action-card {
    background: #0d0d1a; border: 1px solid rgba(255,255,255,0.06);
    border-radius: 6px; padding: 8px 10px; margin-top: 6px;
  }
  .dp-action-header {
    font-family: 'JetBrains Mono', monospace; font-size: 8px; font-weight: 600;
    letter-spacing: 1.5px; color: #e84393; margin-bottom: 6px;
    display: flex; align-items: center; gap: 5px;
  }
  .dp-action-dot { width: 4px; height: 4px; border-radius: 50%; background: #e84393; box-shadow: 0 0 6px rgba(232,67,147,0.4); }
  .dp-action-item {
    display: flex; align-items: center; gap: 6px;
    font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #a0a0b8;
    padding: 4px 8px; background: var(--bg-secondary, #1a1a2e); border-radius: 3px; margin-bottom: 2px;
  }
  .dp-action-check { font-size: 10px; color: #4ade80; }
  .dp-action-detail { color: #606078; margin-left: auto; font-size: 9px; }

  /* Typing */
  .dp-typing { display: flex; gap: 4px; padding: 4px 0; }
  .dp-dot {
    width: 5px; height: 5px; border-radius: 50%; background: #e84393;
    animation: dp-bounce 1.2s ease-in-out infinite;
  }
  .dp-dot:nth-child(2) { animation-delay: 0.15s; }
  .dp-dot:nth-child(3) { animation-delay: 0.3s; }
  @keyframes dp-bounce { 0%,60%,100% { transform: translateY(0); opacity: 0.3; } 30% { transform: translateY(-5px); opacity: 1; } }

  .dp-error {
    font-size: 11px; color: #ef4444; padding: 8px 10px;
    background: rgba(239,68,68,0.08); border-radius: 5px;
    border: 1px solid rgba(239,68,68,0.15);
    font-family: 'JetBrains Mono', monospace;
  }

  /* QUICK COMMANDS */
  .dp-quick-cmds {
    display: flex; gap: 4px; padding: 6px 10px; overflow-x: auto;
    border-top: 1px solid rgba(255,255,255,0.06); scrollbar-width: none;
  }
  .dp-quick-cmds::-webkit-scrollbar { display: none; }
  .dp-cmd-pill {
    white-space: nowrap; padding: 5px 10px;
    font-size: 10px; font-weight: 500; color: #a0a0b8;
    background: #16162a; border: 1px solid rgba(255,255,255,0.06);
    border-radius: 16px; cursor: pointer; transition: all 0.2s; flex-shrink: 0;
  }
  .dp-cmd-pill:hover { border-color: rgba(232,67,147,0.2); color: #fd79a8; background: rgba(232,67,147,0.1); }

  /* ─── INPUT ─── */
  .dp-input-area { padding: 8px 14px 10px; flex-shrink: 0; }
  .dp-input-wrapper {
    background: #16162a; border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px; padding: 3px; display: flex; align-items: center; gap: 3px;
    transition: all 0.2s;
  }
  .dp-input-wrapper:focus-within { border-color: rgba(232,67,147,0.3); box-shadow: 0 0 0 3px rgba(232,67,147,0.06); }
  .dp-input-field {
    flex: 1; background: transparent; border: none; outline: none;
    color: #f0f0f5; font-size: 12px; padding: 8px 10px;
    caret-color: #e84393; font-family: inherit;
  }
  .dp-input-field::placeholder { color: #45455a; font-size: 11px; }
  .dp-send-btn {
    width: 30px; height: 30px; border-radius: 6px; border: none;
    background: #e84393; color: #fff; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s; flex-shrink: 0;
  }
  .dp-send-btn:hover { background: #fd79a8; box-shadow: 0 0 12px rgba(232,67,147,0.3); }
  .dp-send-btn:disabled { opacity: 0.3; cursor: default; }
  .dp-send-btn.cancel { background: #ef4444; font-size: 12px; }

  /* MIC BUTTON */
  .dp-mic-btn {
    width: 30px; height: 30px; border-radius: 6px; border: none;
    background: transparent; color: #606078; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s; flex-shrink: 0;
  }
  .dp-mic-btn:hover { color: #a0a0b8; background: #222240; }
  .dp-mic-btn.listening {
    color: #ef4444; background: rgba(239,68,68,0.12);
    animation: dp-mic-pulse 1s ease-in-out infinite;
  }
  @keyframes dp-mic-pulse { 0%,100% { box-shadow: none; } 50% { box-shadow: 0 0 12px rgba(239,68,68,0.3); } }

  /* AUTO VJ BAR */
  .dp-auto-bar {
    margin: 6px 14px; padding: 10px 12px;
    background: linear-gradient(135deg, #16162a, #222240);
    border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
    flex-shrink: 0;
  }
  .dp-auto-header {
    display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
  }
  .dp-auto-title { font-size: 12px; font-weight: 700; color: #f0f0f5; }
  .dp-auto-badge {
    font-family: 'JetBrains Mono', monospace; font-size: 8px; font-weight: 600;
    color: #e84393; background: rgba(232,67,147,0.2);
    padding: 2px 6px; border-radius: 3px; letter-spacing: 1px;
  }
  .dp-auto-status {
    margin-left: auto; font-family: 'JetBrains Mono', monospace;
    font-size: 9px; color: #606078;
  }
  .dp-auto-status.running { color: #4ade80; }
  .dp-auto-controls { display: flex; align-items: center; gap: 6px; }
  .dp-transport-btn {
    height: 34px; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all 0.2s; background: var(--bg-secondary, #1a1a2e); color: #a0a0b8; font-size: 11px; font-weight: 600;
  }
  .dp-transport-btn.play {
    flex: 1; background: #e84393; border-color: #e84393; color: white; gap: 6px;
  }
  .dp-transport-btn.play:hover { background: #fd79a8; }
  .dp-transport-btn.stop { width: 34px; color: #ef4444; }
  .dp-transport-btn.stop:hover { background: rgba(239,68,68,0.12); }
  .dp-auto-select {
    background: var(--bg-secondary, #1a1a2e); border: 1px solid rgba(255,255,255,0.08);
    color: #a0a0b8; font-size: 10px; padding: 6px 8px; border-radius: 5px;
  }

  /* MAPPING PRESETS */
  .dp-mapping-presets {
    margin: 6px 14px; flex-shrink: 0;
  }
  .dp-mapping-label {
    font-family: 'JetBrains Mono', monospace; font-size: 8px;
    color: #606078; letter-spacing: 2px; margin-bottom: 6px; display: block;
  }
  .dp-preset-grid {
    display: flex; gap: 4px;
  }
  .dp-preset {
    flex: 1; aspect-ratio: 1; max-width: 60px;
    background: #16162a; border: 1px solid rgba(255,255,255,0.06);
    border-radius: 8px; cursor: pointer; transition: all 0.2s;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 4px; padding: 6px 2px; color: #606078;
  }
  .dp-preset:hover {
    background: #222240; border-color: rgba(255,255,255,0.1);
    color: #e84393; transform: translateY(-1px);
  }
  .dp-preset span {
    font-size: 8px; font-weight: 500; text-align: center;
  }
</style>
