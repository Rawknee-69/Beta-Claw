export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'read',
    description: 'Read a file. Returns content, truncated to 8000 chars.',
    input_schema: {
      type: 'object',
      properties: {
        path:   { type: 'string', description: 'File path' },
        offset: { type: 'number', description: 'Byte offset (optional)' },
        limit:  { type: 'number', description: 'Max chars (optional)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write',
    description: 'Write content to a file inside the group workspace. Relative paths resolve to the workspace root (e.g. "skills/weather.js" → .workspaces/{groupId}/skills/weather.js). Creates parent directories automatically.',
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'Relative path from workspace root (e.g. "skills/weather.js")' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'exec',
    description: 'Run a shell command via bash -c. Default working directory is the group workspace (.workspaces/{groupId}/), so use relative paths (e.g. "node skills/weather.js"). Returns stdout, stderr, exit code.',
    input_schema: {
      type: 'object',
      properties: {
        cmd:     { type: 'string', description: 'Shell command (use relative paths — cwd is workspace root)' },
        cwd:     { type: 'string', description: 'Override working directory (optional absolute path)' },
        timeout: { type: 'number', description: 'Timeout ms, default 30000' },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'list',
    description: 'List directory contents.',
    input_schema: {
      type: 'object',
      properties: {
        path:      { type: 'string', description: 'Directory path' },
        recursive: { type: 'boolean', description: 'Include subdirs' },
      },
      required: ['path'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web. Returns top 5 results with title, url, snippet.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (3-6 words ideal)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch a URL. Returns response body (truncated to 12000 chars).',
    input_schema: {
      type: 'object',
      properties: {
        url:     { type: 'string', description: 'URL to fetch' },
        method:  { type: 'string', description: 'GET | POST | PUT, default GET' },
        headers: { type: 'object', description: 'Request headers (optional)' },
        body:    { type: 'string', description: 'Request body (optional)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'memory_read',
    description: "Read this group's MEMORY.md file.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'memory_write',
    description: 'Append a fact to MEMORY.md.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Fact to remember' },
      },
      required: ['content'],
    },
  },
];
