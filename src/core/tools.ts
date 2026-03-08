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

  // ── Filesystem ─────────────────────────────────────────────────────────────

  {
    name: 'read',
    description: 'Read file contents. Optionally slice to a line range with offset/limit. Blocked on secrets paths.',
    input_schema: {
      type: 'object',
      properties: {
        path:   { type: 'string', description: 'File path to read' },
        offset: { type: 'number', description: 'First line to read (1-based, optional)' },
        limit:  { type: 'number', description: 'Max lines to return (optional)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write',
    description: 'Write or overwrite a file. Bare filenames go to .workspace/work/. Creates parent dirs automatically.',
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'Destination file path' },
        content: { type: 'string', description: 'Full content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'append',
    description: 'Append text to the end of a file (creates it if missing).',
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'File path to append to' },
        content: { type: 'string', description: 'Content to append' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete',
    description: 'Delete a file or empty directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list',
    description: 'List a directory. Set recursive=true for a tree view. Use "." for current directory.',
    input_schema: {
      type: 'object',
      properties: {
        path:      { type: 'string', description: 'Directory path' },
        recursive: { type: 'boolean', description: 'Include subdirectories recursively' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search',
    description: 'Search files. type="name" finds files matching a glob pattern; type="content" searches file contents with a regex (uses ripgrep when available).',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (name search) or regex (content search)' },
        path:    { type: 'string', description: 'Root directory to search in (default: .)' },
        type:    { type: 'string', description: '"name" or "content" (default: name)', enum: ['name', 'content'] },
      },
      required: ['pattern'],
    },
  },

  // ── System ─────────────────────────────────────────────────────────────────

  {
    name: 'exec',
    description: 'Run any shell command via bash. Use for git, npm, mkdir, ls, compiling code, starting processes, etc. NEVER say you cannot do something — use exec instead.',
    input_schema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional, defaults to project root)' },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'python',
    description: 'Execute a Python 3 code snippet and return stdout/stderr. Great for calculations, data processing, file parsing, or any scripting task.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python 3 code to execute' },
      },
      required: ['code'],
    },
  },
  {
    name: 'node',
    description: 'Execute a Node.js (ESM) code snippet and return stdout/stderr. Use for JavaScript computations, JSON manipulation, or Node.js-specific tasks.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Node.js ESM code to execute' },
      },
      required: ['code'],
    },
  },
  {
    name: 'process',
    description: 'Manage system processes. list: show running processes; kill: terminate by PID or name; spawn: start a background command.',
    input_schema: {
      type: 'object',
      properties: {
        action:  { type: 'string', description: 'Action: list, kill, or spawn', enum: ['list', 'kill', 'spawn'] },
        pid:     { type: 'number', description: 'Process ID (for kill)' },
        name:    { type: 'string', description: 'Process name to kill or command to spawn' },
        args:    { type: 'string', description: 'Arguments for spawn (space-separated)' },
      },
      required: ['action'],
    },
  },

  // ── Web ────────────────────────────────────────────────────────────────────

  {
    name: 'web_search',
    description: 'Search the web via Brave or Serper and return top results. Use for current events, documentation, prices, or anything needing up-to-date info.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description: 'Make an HTTP request (GET/POST/PUT/DELETE) and return the response body. Use for APIs, webhooks, or fetching web pages.',
    input_schema: {
      type: 'object',
      properties: {
        url:     { type: 'string', description: 'Full URL to request' },
        method:  { type: 'string', description: 'HTTP method (default: GET)', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        headers: { type: 'string', description: 'JSON string of request headers' },
        body:    { type: 'string', description: 'Request body for POST/PUT' },
      },
      required: ['url'],
    },
  },
  {
    name: 'download',
    description: 'Download a file from a URL and save it to .workspace/downloads/. Returns the saved file path.',
    input_schema: {
      type: 'object',
      properties: {
        url:      { type: 'string', description: 'URL to download' },
        filename: { type: 'string', description: 'Filename to save as (inferred from URL if omitted)' },
      },
      required: ['url'],
    },
  },

  // ── Browser ────────────────────────────────────────────────────────────────

  {
    name: 'browser',
    description: 'Control a Chromium browser via Playwright. Actions: open (navigate to URL), click (click a selector), type (type text into a selector), extract (get text/HTML from a selector), screenshot (save to .workspace/images/), close (close browser). Requires playwright installed.',
    input_schema: {
      type: 'object',
      properties: {
        action:   { type: 'string', description: 'Action to perform', enum: ['open', 'click', 'type', 'extract', 'screenshot', 'close'] },
        url:      { type: 'string', description: 'URL to navigate to (for open)' },
        selector: { type: 'string', description: 'CSS selector or text to target (for click/type/extract)' },
        text:     { type: 'string', description: 'Text to type (for type action)' },
        path:     { type: 'string', description: 'Screenshot filename (for screenshot, saved to .workspace/images/)' },
      },
      required: ['action'],
    },
  },

  // ── Memory ─────────────────────────────────────────────────────────────────

  {
    name: 'memory_read',
    description: 'Read the full memory file (memory.md) for the current group. Returns stored facts, preferences, and notes.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'memory_write',
    description: 'Write a fact, preference, or note to long-term memory. Persists across conversations.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact or information to remember' },
        section: { type: 'string', description: 'Memory section heading to write under (optional, e.g. "User Preferences")' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_search',
    description: 'Search long-term memory using full-text search. Returns the most relevant stored facts.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for in memory' },
      },
      required: ['query'],
    },
  },

  // ── Automation ─────────────────────────────────────────────────────────────

  {
    name: 'cron',
    description: 'Manage recurring scheduled tasks. add: create a new cron job; list: show all; delete: remove by id; update: change expression or instruction.',
    input_schema: {
      type: 'object',
      properties: {
        action:      { type: 'string', description: 'add, list, delete, or update', enum: ['add', 'list', 'delete', 'update'] },
        name:        { type: 'string', description: 'Task name (for add/update)' },
        expr:        { type: 'string', description: 'Cron expression, e.g. "0 9 * * 1-5" (for add/update)' },
        instruction: { type: 'string', description: 'What to do when the task fires (for add/update)' },
        id:          { type: 'string', description: 'Task ID (for delete/update)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'scheduler',
    description: 'Schedule a one-time task at a specific future time (ISO 8601 timestamp). list: show pending; cancel: remove by id.',
    input_schema: {
      type: 'object',
      properties: {
        action:      { type: 'string', description: 'add, list, or cancel', enum: ['add', 'list', 'cancel'] },
        name:        { type: 'string', description: 'Task name (for add)' },
        at:          { type: 'string', description: 'ISO 8601 datetime to run at, e.g. "2026-03-10T09:00:00Z" (for add)' },
        instruction: { type: 'string', description: 'What to do at the scheduled time (for add)' },
        id:          { type: 'string', description: 'Task ID (for cancel)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'heartbeat',
    description: 'Manage the heartbeat system. now: trigger immediate tick; status: show config and recent ticks; pause: disable heartbeat for a group; resume: re-enable.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action to perform', enum: ['now', 'status', 'pause', 'resume'] },
        config: { type: 'string', description: 'JSON config overrides for the heartbeat (optional)' },
      },
      required: ['action'],
    },
  },

  // ── Agent Management ───────────────────────────────────────────────────────

  {
    name: 'session',
    description: 'Inspect agent sessions. list: show all active groups/sessions with message counts; get: return current session metadata.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list or get', enum: ['list', 'get'] },
      },
      required: ['action'],
    },
  },
  {
    name: 'context',
    description: 'Manage conversation context. get: return current injected context; inject: add extra text that will be prepended to the next system prompt turn; clear: remove injected context.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'get, inject, or clear', enum: ['get', 'inject', 'clear'] },
        value:  { type: 'string', description: 'Text to inject (for inject action)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'history',
    description: 'Access conversation history for the current group. get: return last N messages; clear: delete all history for this group.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'get or clear', enum: ['get', 'clear'] },
        limit:  { type: 'number', description: 'Number of messages to return (default: 20, for get)' },
      },
      required: ['action'],
    },
  },

  // ── System Config ──────────────────────────────────────────────────────────

  {
    name: 'config',
    description: 'Read or write MicroClaw configuration. get: return full config or a specific key; set: update a non-secret value.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'get or set', enum: ['get', 'set'] },
        key:    { type: 'string', description: 'Config key to read or write (optional for get to return all)' },
        value:  { type: 'string', description: 'New value (for set)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'env',
    description: 'Read safe, non-secret environment variables: PATH, HOME, USER, SHELL, NODE_ENV, PWD, TERM, LANG. API keys and secrets are never returned.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Specific variable name to read (optional; returns all safe vars if omitted)' },
      },
      required: [],
    },
  },
  {
    name: 'logs',
    description: 'Tail the MicroClaw application log (.micro/logs/app.log). Returns the last N lines.',
    input_schema: {
      type: 'object',
      properties: {
        lines: { type: 'number', description: 'Number of lines to return (default: 50)' },
      },
      required: [],
    },
  },

  // ── Image Generation ───────────────────────────────────────────────────────

  {
    name: 'generate_image',
    description: 'Generate an image from a text prompt using DALL-E 3 (requires OPENAI_API_KEY). For persona images, read the Appearance section from the Persona Supplement in the system prompt and pass it as the prompt.',
    input_schema: {
      type: 'object',
      properties: {
        prompt:  { type: 'string', description: 'Detailed description of the image to generate' },
        size:    { type: 'string', description: 'Image size: "1024x1024" (default), "1792x1024" (wide), or "1024x1792" (tall)', enum: ['1024x1024', '1792x1024', '1024x1792'] },
        quality: { type: 'string', description: '"standard" (default) or "hd"', enum: ['standard', 'hd'] },
      },
      required: ['prompt'],
    },
  },

  // ── Persona ────────────────────────────────────────────────────────────────

  {
    name: 'persona_update',
    description: 'Update a field in the persona supplement (user name, appearance, tone, notes). Use immediately when the user says "call me X", "my name is Y", "you look like …", "update your persona", or describes how you should address them.',
    input_schema: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          description: 'Section to update: "User Name", "User Nickname", "Appearance", "Tone Examples", or "Notes"',
          enum: ['User Name', 'User Nickname', 'Appearance', 'Tone Examples', 'Notes'],
        },
        value: { type: 'string', description: 'New content for the field' },
      },
      required: ['field', 'value'],
    },
  },

  // ── Infrastructure ─────────────────────────────────────────────────────────

  {
    name: 'get_skill',
    description: 'Load the full instruction set for a skill by command name. ALWAYS call this first when the user invokes a skill command (e.g. "add-gmail", "status", "add-telegram"). Follow the returned instructions exactly.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Skill command name without the leading slash, e.g. "add-gmail", "status"' },
      },
      required: ['command'],
    },
  },
];
