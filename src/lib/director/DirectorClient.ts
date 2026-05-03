/**
 * Director Client — Handles communication with the Director server proxy.
 *
 * Sends chat messages via the `http_fetch_stream` IPC handler (SSE streaming),
 * parses Anthropic-format streaming events, and dispatches them to the
 * director store for UI display + tool execution.
 */

import { get } from 'svelte/store';
import { invoke } from '$lib/bridge';
import { licenseStatus } from '$lib/stores/license';
import { directorStore } from '$lib/stores/director';
import type { DirectorChatRequest, DirectorToolCall, DirectorToolResult } from './types';

// Server endpoint — update to your production URL
const DIRECTOR_API_URL = 'https://ghostarcade.live/api/director/chat';
const DIRECTOR_SUPPORT_URL = 'https://ghostarcade.live/api/director/support';

// For dev: use localhost
// const DIRECTOR_API_URL = 'http://localhost:3000/api/director/chat';

let activeStreamCleanups: Array<() => void> = [];

/**
 * Send a message to the Director and stream the response.
 * Handles the full flow: send → stream text → detect tool calls → execute → continue.
 */
export async function sendDirectorMessage(
  userMessage: string,
  appState: Record<string, any>,
  toolExecutor: (toolCall: DirectorToolCall) => Promise<DirectorToolResult>
): Promise<void> {
  const license = get(licenseStatus);
  const store = get(directorStore);

  // Add user message to store
  directorStore.addUserMessage(userMessage);
  directorStore.startStreaming();

  try {
    // Build API request — license_id may be the license_key or UUID depending
    // on the Electron license module. Send both so the server can match either.
    const request: DirectorChatRequest = {
      licenseKey: (license as any).license_key || license.license_id || '',
      machineId: license.machine_id || '',
      sessionId: store.sessionId,
      messages: directorStore.getApiMessages(),
      appState,
    };

    // Send via streaming IPC
    const result = await invoke<{ streamId: string; status: number }>('http_fetch_stream', {
      url: DIRECTOR_API_URL,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!result?.streamId) {
      directorStore.setError('Failed to connect to Director server');
      return;
    }

    // Accumulate tool calls from stream
    const pendingToolCalls: DirectorToolCall[] = [];
    let currentToolId = '';
    let currentToolName = '';
    let currentToolInput = '';

    // Listen for stream chunks
    const api = (window as any).electronAPI;
    if (!api?.on) {
      directorStore.setError('Streaming not available (missing electronAPI.on)');
      return;
    }

    await new Promise<void>((resolve) => {
      const cleanupChunk = api.on('director-stream-chunk', (data: any) => {
        if (data.streamId !== result.streamId) return;

        // Anthropic streaming event types
        switch (data.type) {
          case 'content_block_start': {
            if (data.content_block?.type === 'tool_use') {
              currentToolId = data.content_block.id || '';
              currentToolName = data.content_block.name || '';
              currentToolInput = '';
            }
            break;
          }

          case 'content_block_delta': {
            if (data.delta?.type === 'text_delta' && data.delta.text) {
              directorStore.appendStreamingText(data.delta.text);
            } else if (data.delta?.type === 'input_json_delta' && data.delta.partial_json) {
              currentToolInput += data.delta.partial_json;
            }
            break;
          }

          case 'content_block_stop': {
            if (currentToolId && currentToolName) {
              let parsedInput = {};
              try { parsedInput = JSON.parse(currentToolInput); } catch {}
              const tc: DirectorToolCall = {
                id: currentToolId,
                name: currentToolName,
                input: parsedInput,
                status: 'pending',
              };
              pendingToolCalls.push(tc);
              directorStore.addStreamingToolCall(tc);
              currentToolId = '';
              currentToolName = '';
              currentToolInput = '';
            }
            break;
          }

          case 'message_stop': {
            // Stream complete
            break;
          }

          case 'error': {
            directorStore.setError(data.error || 'Stream error');
            break;
          }

          // Handle flattened SSE format from our server proxy
          case 'text_delta': {
            if (data.text) directorStore.appendStreamingText(data.text);
            break;
          }

          case 'tool_use': {
            if (data.id && data.name) {
              const tc: DirectorToolCall = {
                id: data.id,
                name: data.name,
                input: data.input || {},
                status: 'pending',
              };
              pendingToolCalls.push(tc);
              directorStore.addStreamingToolCall(tc);
            }
            break;
          }
        }
      });

      const cleanupEnd = api.on('director-stream-end', (data: any) => {
        if (data.streamId !== result.streamId) return;
        cleanupChunk();
        cleanupEnd();
        resolve();
      });

      activeStreamCleanups.push(cleanupChunk, cleanupEnd);

      // Safety timeout
      setTimeout(() => {
        cleanupChunk();
        cleanupEnd();
        resolve();
      }, 120000);
    });

    // Finalize the assistant message
    directorStore.finalizeStreaming();

    // Execute any tool calls
    if (pendingToolCalls.length > 0) {
      const toolResults: DirectorToolResult[] = [];

      for (const tc of pendingToolCalls) {
        directorStore.updateToolCallStatus(tc.id, 'executing');
        try {
          const result = await toolExecutor(tc);
          toolResults.push(result);
          directorStore.updateToolCallStatus(tc.id, 'success', result.content);
        } catch (err) {
          const errResult: DirectorToolResult = {
            toolCallId: tc.id,
            content: `Error: ${(err as Error).message || 'Unknown error'}`,
            isError: true,
          };
          toolResults.push(errResult);
          directorStore.updateToolCallStatus(tc.id, 'error', errResult.content);
        }
      }

      // Send tool results back for continuation (the LLM needs to see tool results)
      // This triggers another streaming round
      const continuationMessages = directorStore.getApiMessages();
      // Add tool results as the next user turn
      const toolResultContent = toolResults.map(r =>
        `[Tool ${r.toolCallId}]: ${r.content}`
      ).join('\n');

      await sendDirectorMessage(
        `[Tool results]\n${toolResultContent}`,
        appState,
        toolExecutor
      );
    }

  } catch (err) {
    console.error('[Director] Send error:', err);
    directorStore.setError((err as Error).message || 'Failed to communicate with Director');
  }
}

/**
 * Send a support ticket from a Director conversation.
 */
export async function sendSupportTicket(
  userMessage: string,
  conversation: any[]
): Promise<string | null> {
  try {
    const license = get(licenseStatus);
    const result = await invoke<{ status: number; body: string }>('http_fetch', {
      method: 'POST',
      url: DIRECTOR_SUPPORT_URL,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: license.license_id || '',
        machineId: license.machine_id || '',
        userMessage,
        conversation,
      }),
    });
    if (result.status === 200 || result.status === 201) {
      const data = JSON.parse(result.body);
      return data.ticketId || 'submitted';
    }
    return null;
  } catch (err) {
    console.error('[Director] Support ticket error:', err);
    return null;
  }
}

/** Cancel any active streams */
export function cancelDirectorStream() {
  activeStreamCleanups.forEach(fn => fn());
  activeStreamCleanups = [];
  directorStore.finalizeStreaming();
}
