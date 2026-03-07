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
    name: 'write_file',
    description: 'Write content to a file. Creates directories as needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file and return its content.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files and folders in a directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path. Use . for current.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'run_cmd',
    description: 'Run a shell command. Returns stdout, stderr, exit code.',
    input_schema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Command to run via bash -c' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web. Returns top 5 results.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'cron_add',
    description: 'Schedule a recurring task. Returns the task ID.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Task name' },
        cron: { type: 'string', description: 'Cron expression e.g. 0 9 * * 1-5' },
        instruction: { type: 'string', description: 'What to do when task fires' },
      },
      required: ['name', 'cron', 'instruction'],
    },
  },
  {
    name: 'cron_list',
    description: 'List all scheduled tasks.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'cron_delete',
    description: 'Delete a scheduled task by ID.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_save',
    description: 'Save a fact or preference to long-term memory.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Fact to remember' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_search',
    description: 'Search long-term memory.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
];
