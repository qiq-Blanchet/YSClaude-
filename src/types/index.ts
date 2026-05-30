export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  createdAt: number;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface HiddenRange {
  from: number;
  to: number;
}

export interface Conversation {
  id: string;
  title: string;
  systemPrompt: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  hiddenRanges?: HiddenRange[];
}

export interface Diary {
  id: string;
  title: string;
  content: string;
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface APIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ModelOption {
  id: string;
  name: string;
  apiConfigIndex: number;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
      }>;
      required: string[];
    };
  };
}
