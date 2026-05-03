/**
 * Ghost Arcade Director — Type Definitions
 *
 * Types for the in-app AI agent that operates the software through
 * natural language. Messages flow: App → Server Proxy → Anthropic → App.
 */

// ─── Message Types ──────────────────────────────────────────────────

export interface DirectorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: DirectorToolCall[];
  toolResults?: DirectorToolResult[];
  timestamp: number;
  /** Set when user flags this message for support review */
  supportTicketId?: string;
}

export interface DirectorToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
  /** Populated after local execution */
  status?: 'pending' | 'executing' | 'success' | 'error';
  /** Human-readable result summary */
  resultSummary?: string;
}

export interface DirectorToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

// ─── Streaming Types ────────────────────────────────────────────────

export interface DirectorStreamChunk {
  type: 'text_delta' | 'tool_use' | 'tool_use_input' | 'content_block_stop' | 'message_stop' | 'error' | 'ping';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  /** Partial JSON input being built during streaming */
  partialInput?: string;
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
}

// ─── API Request/Response ───────────────────────────────────────────

export interface DirectorChatRequest {
  licenseKey: string;
  machineId: string;
  sessionId: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; [key: string]: any }>;
  }>;
  appState: Record<string, any>;
}

export interface DirectorSupportRequest {
  licenseKey: string;
  machineId: string;
  userMessage: string;
  conversation: DirectorMessage[];
}

// ─── Store State ────────────────────────────────────────────────────

export interface DirectorState {
  isOpen: boolean;
  messages: DirectorMessage[];
  isStreaming: boolean;
  /** Currently accumulating assistant text during streaming */
  streamingText: string;
  /** Currently accumulating tool calls during streaming */
  streamingToolCalls: DirectorToolCall[];
  error: string | null;
  sessionId: string;
}

// ─── Tool Schema ────────────────────────────────────────────────────

export interface DirectorToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}
