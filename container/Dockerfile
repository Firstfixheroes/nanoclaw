# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation

FROM node:22-slim

# Install system dependencies for Chromium + virtual desktop (computer use)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    xvfb \
    xdotool \
    scrot \
    imagemagick \
    xclip \
    fluxbox \
    x11vnc \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser and claude-code globally
RUN npm install -g agent-browser @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Bake skills into the image so they persist across host filesystem resets.
# The host (container-runner.ts) syncs from container/skills/ at runtime,
# but this baked copy is the source of truth that survives any host wipe.
COPY skills /opt/nanoclaw-skills
RUN chmod -R a+rX /opt/nanoclaw-skills

# Create workspace directories and X11 tmp dir for Xvfb (non-root)
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# Set up virtual display for computer use
ENV DISPLAY=:99
ENV SCREEN_WIDTH=1280
ENV SCREEN_HEIGHT=800
ENV SCREEN_DEPTH=24

# Create entrypoint script
# Starts Xvfb virtual display + fluxbox WM, then runs the agent.
# Container input (prompt, group info) is passed via stdin JSON.
# Credentials are injected by the host's credential proxy — never passed here.
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
RUN printf '#!/bin/bash\nset -e\n\n# Start virtual display\nXvfb :99 -screen 0 ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH} -ac +extension GLX +render -noreset &\nXVFB_PID=$!\nsleep 0.5\n\n# Start VNC server on the virtual display (port 5900, no password, localhost only)\nx11vnc -display :99 -nopw -listen 0.0.0.0 -rfbport 5900 -shared -forever -bg 2>/dev/null\n\n# Start minimal window manager\nfluxbox &>/dev/null &\nsleep 0.3\n\n# Restore baked skills\nmkdir -p /home/node/.claude/skills\nfor skill in /opt/nanoclaw-skills/*/; do\n  name=$(basename "$skill")\n  if [ ! -d "/home/node/.claude/skills/$name" ]; then\n    cp -r "$skill" "/home/node/.claude/skills/$name"\n  fi\ndone\n\ncd /app && npx tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\ncat > /tmp/input.json\nnode /tmp/dist/index.js < /tmp/input.json\n\n# Cleanup\nkill $XVFB_PID 2>/dev/null || true\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace && chmod 777 /home/node

# Switch to non-root user (required for --dangerously-skip-permissions)
USER node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
