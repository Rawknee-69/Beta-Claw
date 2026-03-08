export interface BootstrapFile {
  path: string;
  content: string;
}

export interface HookEvent {
  type:       'command' | 'session' | 'agent' | 'gateway' | 'tool_result';
  action:     string;
  sessionKey: string;
  timestamp:  Date;
  messages:   string[];
  context: {
    sessionId?:       string;
    groupId?:         string;
    channelId?:       string;
    senderId?:        string;
    workspaceDir?:    string;
    bootstrapFiles?:  BootstrapFile[];
    cfg?:             Record<string, unknown>;
    memoryPreloaded?: boolean;
    memoryContent?:   string;
  };
}

export interface ToolResultEvent {
  type:       'tool_result';
  toolName:   string;
  result:     unknown;
  sessionKey: string;
}

export type HookHandler           = (event: HookEvent) => Promise<void>;
export type ToolResultHookHandler = (event: ToolResultEvent) => unknown | undefined;

export interface RegisteredHook {
  id:          string;
  name:        string;
  description: string;
  emoji:       string;
  events:      string[];
  enabled:     boolean;
  source:      'bundled' | 'managed' | 'workspace';
  handlerPath: string;
}
