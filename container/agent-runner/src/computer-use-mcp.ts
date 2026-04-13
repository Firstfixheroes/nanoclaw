/**
 * Computer Use MCP Server
 * Gives the agent a virtual desktop it can see and control.
 * Runs on Xvfb display :99 with xdotool for input and scrot for screenshots.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execSync } from 'child_process';
import fs from 'fs';

const DISPLAY = process.env.DISPLAY || ':99';
const SCREENSHOT_PATH = '/tmp/screenshot.png';

function exec(cmd: string): string {
  try {
    return execSync(cmd, {
      env: { ...process.env, DISPLAY },
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
    }).toString().trim();
  } catch (err: unknown) {
    const error = err as { stderr?: Buffer; message: string };
    throw new Error(error.stderr?.toString() || error.message);
  }
}

const server = new McpServer({
  name: 'computer-use',
  version: '1.0.0',
});

server.tool(
  'screenshot',
  'Take a screenshot of the virtual desktop. Returns a base64-encoded PNG image.',
  {},
  async () => {
    try {
      exec(`scrot -o ${SCREENSHOT_PATH}`);
      const imageData = fs.readFileSync(SCREENSHOT_PATH);
      const base64 = imageData.toString('base64');
      return {
        content: [{ type: 'image' as const, data: base64, mimeType: 'image/png' }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'click',
  'Click the mouse at x,y coordinates on the virtual desktop.',
  {
    x: z.number().describe('X coordinate'),
    y: z.number().describe('Y coordinate'),
    button: z.enum(['left', 'right', 'middle']).default('left').describe('Mouse button'),
  },
  async (args: { x: number; y: number; button: string }) => {
    try {
      const buttonNum = args.button === 'left' ? 1 : args.button === 'right' ? 3 : 2;
      exec(`xdotool mousemove ${args.x} ${args.y} click ${buttonNum}`);
      return { content: [{ type: 'text' as const, text: `Clicked ${args.button} at (${args.x}, ${args.y})` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Click failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'double_click',
  'Double-click at x,y coordinates.',
  {
    x: z.number().describe('X coordinate'),
    y: z.number().describe('Y coordinate'),
  },
  async (args: { x: number; y: number }) => {
    try {
      exec(`xdotool mousemove ${args.x} ${args.y} click --repeat 2 1`);
      return { content: [{ type: 'text' as const, text: `Double-clicked at (${args.x}, ${args.y})` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Double-click failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'type_text',
  'Type text using the keyboard on the virtual desktop.',
  { text: z.string().describe('Text to type') },
  async (args: { text: string }) => {
    try {
      // Write text to a temp file and use xdotool to type from it to handle special chars
      fs.writeFileSync('/tmp/xdotype.txt', args.text);
      exec(`xdotool type --clearmodifiers --delay 20 --file /tmp/xdotype.txt`);
      return { content: [{ type: 'text' as const, text: `Typed: "${args.text.slice(0, 100)}${args.text.length > 100 ? '...' : ''}"` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Type failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'press_key',
  'Press a key or key combination. Examples: "Return", "Tab", "ctrl+a", "ctrl+c", "alt+F4", "BackSpace", "Escape".',
  { key: z.string().describe('Key or key combination') },
  async (args: { key: string }) => {
    try {
      exec(`xdotool key -- ${args.key}`);
      return { content: [{ type: 'text' as const, text: `Pressed: ${args.key}` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Key press failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'scroll',
  'Scroll up or down at the current or specified position.',
  {
    direction: z.enum(['up', 'down']).describe('Scroll direction'),
    amount: z.number().default(3).describe('Number of scroll clicks'),
    x: z.number().optional().describe('X coordinate (optional)'),
    y: z.number().optional().describe('Y coordinate (optional)'),
  },
  async (args: { direction: string; amount: number; x?: number; y?: number }) => {
    try {
      if (args.x !== undefined && args.y !== undefined) {
        exec(`xdotool mousemove ${args.x} ${args.y}`);
      }
      const btn = args.direction === 'up' ? 4 : 5;
      exec(`xdotool click --repeat ${args.amount} ${btn}`);
      return { content: [{ type: 'text' as const, text: `Scrolled ${args.direction} ${args.amount} clicks` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Scroll failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'drag',
  'Click and drag from one point to another.',
  {
    from_x: z.number().describe('Start X'),
    from_y: z.number().describe('Start Y'),
    to_x: z.number().describe('End X'),
    to_y: z.number().describe('End Y'),
  },
  async (args: { from_x: number; from_y: number; to_x: number; to_y: number }) => {
    try {
      exec(`xdotool mousemove ${args.from_x} ${args.from_y} mousedown 1 mousemove ${args.to_x} ${args.to_y} mouseup 1`);
      return { content: [{ type: 'text' as const, text: `Dragged from (${args.from_x},${args.from_y}) to (${args.to_x},${args.to_y})` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Drag failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'open_browser',
  'Open a URL in Chromium on the virtual desktop. Use screenshot after to see it.',
  { url: z.string().describe('URL to open') },
  async (args: { url: string }) => {
    try {
      exec(`chromium --no-sandbox --disable-gpu --no-first-run --disable-default-apps --disable-extensions --window-size=1280,800 "${args.url}" &`);
      await new Promise(r => setTimeout(r, 3000));
      return { content: [{ type: 'text' as const, text: `Opened browser at: ${args.url}` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Browser open failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'screen_info',
  'Get screen resolution and mouse position.',
  {},
  async () => {
    try {
      const size = exec('xdotool getdisplaygeometry');
      const mouse = exec('xdotool getmouselocation');
      return { content: [{ type: 'text' as const, text: `Screen: ${size}\nMouse: ${mouse}` }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Screen info failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'list_windows',
  'List all open windows on the virtual desktop.',
  {},
  async () => {
    try {
      const windows = exec('xdotool search --name "" getwindowname %@ 2>/dev/null || echo "No windows open"');
      return { content: [{ type: 'text' as const, text: windows }] };
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Window list failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

server.tool(
  'clipboard',
  'Read from or write to the clipboard.',
  {
    action: z.enum(['read', 'write']).describe('Read or write clipboard'),
    text: z.string().optional().describe('Text to write (only for write action)'),
  },
  async (args: { action: string; text?: string }) => {
    try {
      if (args.action === 'write' && args.text) {
        fs.writeFileSync('/tmp/clipboard.txt', args.text);
        exec('xclip -selection clipboard < /tmp/clipboard.txt');
        return { content: [{ type: 'text' as const, text: `Wrote to clipboard: "${args.text.slice(0, 100)}"` }] };
      } else {
        const content = exec('xclip -selection clipboard -o 2>/dev/null || echo ""');
        return { content: [{ type: 'text' as const, text: content || '(clipboard empty)' }] };
      }
    } catch (err: unknown) {
      return { content: [{ type: 'text' as const, text: `Clipboard failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('Computer use MCP server error:', err);
  process.exit(1);
});
