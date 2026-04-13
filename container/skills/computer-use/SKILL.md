# Computer Use

You have a virtual desktop (1280x800) with full mouse and keyboard control. Use the `mcp__computer__*` tools to interact with it like a human would.

## Available Tools

| Tool | What it does |
|------|-------------|
| `screenshot` | See what's on screen (returns image) |
| `click` | Click at x,y coordinates |
| `double_click` | Double-click at x,y |
| `type_text` | Type text via keyboard |
| `press_key` | Press keys like Return, Tab, ctrl+a, ctrl+c |
| `scroll` | Scroll up/down |
| `drag` | Click and drag between points |
| `open_browser` | Open a URL in Chromium |
| `screen_info` | Get screen size and mouse position |
| `list_windows` | Show open windows |
| `clipboard` | Read/write clipboard |

## How to Use

1. **Always screenshot first** to see the current state
2. Identify what you need to click/type based on the screenshot
3. Perform actions (click, type, etc.)
4. Screenshot again to verify the result

## Sending Screenshots to the User

When you take a screenshot, the user CANNOT see it — only you can. To deliver the screenshot to the user on WhatsApp, you MUST call `mcp__nanoclaw__send_message` with:
- `text`: a caption describing what's on screen
- `imageBase64`: the base64 PNG data returned by the `screenshot` tool

Do this every time the user asks to see the screen or when you want to show them something.

## Tips

- The screen is 1280x800 pixels. Coordinates start at (0,0) top-left.
- Use `open_browser` to open web pages. The browser appears on the virtual screen.
- For forms: click the field first, then type_text, then press_key Tab or Return.
- For key combos: use press_key with format like "ctrl+a", "ctrl+v", "alt+Tab".
- If a page needs to load, wait a moment then screenshot again.
- You can run multiple browser windows, terminals, or any GUI application.
