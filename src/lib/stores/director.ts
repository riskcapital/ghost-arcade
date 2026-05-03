/**
 * Director Store — Session-scoped state for the in-app AI agent.
 * Messages persist during the session but NOT across app restarts.
 */

import { writable, derived, get } from 'svelte/store';
import type { DirectorState, DirectorMessage, DirectorToolCall } from '../director/types';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const INITIAL_STATE: DirectorState = {
  isOpen: false,
  messages: [],
  isStreaming: false,
  streamingText: '',
  streamingToolCalls: [],
  error: null,
  sessionId: generateId(),
};

function createDirectorStore() {
  const { subscribe, update, set } = writable<DirectorState>(INITIAL_STATE);

  return {
    subscribe,

    toggleOpen() {
      update(s => ({ ...s, isOpen: !s.isOpen }));
    },

    setOpen(open: boolean) {
      update(s => ({ ...s, isOpen: open }));
    },

    /** Add a user message to the conversation */
    addUserMessage(content: string): DirectorMessage {
      const msg: DirectorMessage = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      update(s => ({
        ...s,
        messages: [...s.messages, msg],
        error: null,
      }));
      return msg;
    },

    /** Start streaming an assistant response */
    startStreaming() {
      update(s => ({
        ...s,
        isStreaming: true,
        streamingText: '',
        streamingToolCalls: [],
        error: null,
      }));
    },

    /** Append text delta during streaming */
    appendStreamingText(text: string) {
      update(s => ({ ...s, streamingText: s.streamingText + text }));
    },

    /** Add a tool call detected during streaming */
    addStreamingToolCall(toolCall: DirectorToolCall) {
      update(s => ({
        ...s,
        streamingToolCalls: [...s.streamingToolCalls, toolCall],
      }));
    },

    /** Update a streaming tool call's status */
    updateToolCallStatus(toolCallId: string, status: DirectorToolCall['status'], resultSummary?: string) {
      update(s => ({
        ...s,
        streamingToolCalls: s.streamingToolCalls.map(tc =>
          tc.id === toolCallId ? { ...tc, status, resultSummary } : tc
        ),
      }));
    },

    /** Finalize the streaming response into a proper message */
    finalizeStreaming() {
      update(s => {
        const msg: DirectorMessage = {
          id: generateId(),
          role: 'assistant',
          content: s.streamingText,
          toolCalls: s.streamingToolCalls.length > 0 ? s.streamingToolCalls : undefined,
          timestamp: Date.now(),
        };
        return {
          ...s,
          messages: [...s.messages, msg],
          isStreaming: false,
          streamingText: '',
          streamingToolCalls: [],
        };
      });
    },

    /** Set error state */
    setError(error: string) {
      update(s => ({
        ...s,
        isStreaming: false,
        streamingText: '',
        streamingToolCalls: [],
        error,
      }));
    },

    /** Flag a message for support review */
    flagForSupport(messageId: string, ticketId: string) {
      update(s => ({
        ...s,
        messages: s.messages.map(m =>
          m.id === messageId ? { ...m, supportTicketId: ticketId } : m
        ),
      }));
    },

    /** Clear conversation history */
    clearMessages() {
      update(s => ({
        ...s,
        messages: [],
        sessionId: generateId(),
        error: null,
      }));
    },

    /** Get messages formatted for the API (strip UI-only fields) */
    getApiMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
      const state = get({ subscribe });
      return state.messages.map(m => ({
        role: m.role,
        content: m.content,
      }));
    },

    reset() {
      set(INITIAL_STATE);
    },
  };
}

export const directorStore = createDirectorStore();
export const isDirectorOpen = derived(directorStore, $s => $s.isOpen);
export const isDirectorStreaming = derived(directorStore, $s => $s.isStreaming);
