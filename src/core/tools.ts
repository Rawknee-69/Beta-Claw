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
    description: 'Create or overwrite a file with the given content. Creates parent directories automatically. Use this whenever the user asks to create, save, or write any file (HTML, CSS, JS, Python, config, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (relative to current directory). E.g. "index.html", "src/app.ts", "scripts/run.py"' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read and return the content of a file. Use to inspect existing files before editing them.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List all files and folders in a directory. Use "." for the current directory. Use this to explore the project structure.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path. Use "." for current directory.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'run_cmd',
    description: 'Run any shell command via bash. Use this for EVERYTHING system-related: creating folders (mkdir), listing files (ls), running scripts (node, python, bash), installing packages (npm install, pip install), git operations, compiling code, starting servers, checking processes, etc. NEVER say you cannot do something — use this tool instead.',
    input_schema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Shell command to run. Examples: "mkdir -p my-folder", "npm install express", "python script.py", "git status", "ls -la"' },
        cwd: { type: 'string', description: 'Working directory for the command (optional, defaults to current directory)' },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web and return the top results. Use this when the user asks about current events, documentation, prices, news, or anything that requires up-to-date information.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'send_whatsapp',
    description: 'Send a WhatsApp message to a phone number or group. Use this when the user asks you to message them on WhatsApp, send a reminder, or communicate via WhatsApp. The "to" field should be the JID (phone number with country code + @s.whatsapp.net, or group JID). If you do not know the JID, use the sender\'s groupId from the conversation context.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'WhatsApp JID — phone number like "1234567890@s.whatsapp.net" or group JID like "120363xxx@g.us"' },
        message: { type: 'string', description: 'Message text to send' },
      },
      required: ['to', 'message'],
    },
  },
  {
    name: 'cron_add',
    description: 'Schedule a recurring task using a cron expression. Use this when the user asks to run something periodically (every N minutes, daily, weekly, etc.). The instruction is what the assistant will do when the task fires.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short descriptive name for the task' },
        cron: { type: 'string', description: 'Cron expression. Examples: "* * * * *" (every minute), "*/30 * * * *" (every 30 min), "0 9 * * 1-5" (9am weekdays)' },
        instruction: { type: 'string', description: 'What to do when the task fires. E.g. "Send a WhatsApp message asking how the user is doing"' },
      },
      required: ['name', 'cron', 'instruction'],
    },
  },
  {
    name: 'cron_list',
    description: 'List all currently scheduled recurring tasks.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'cron_delete',
    description: 'Delete a scheduled recurring task by its ID (from cron_list).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_skill',
    description: 'Get the full step-by-step instructions for a skill by its command name. ALWAYS call this first when a user asks for something a skill covers (e.g. "add gmail", "check status", "add telegram"). Read the returned instructions and follow them exactly using your available tools.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Skill command name, e.g. "add-gmail", "status", "add-telegram". Omit the leading slash.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'memory_save',
    description: 'Save a fact, preference, or piece of information to long-term memory so it persists across conversations.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact or information to remember' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_search',
    description: 'Search long-term memory for stored facts and preferences.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for in memory' },
      },
      required: ['query'],
    },
  },
];
