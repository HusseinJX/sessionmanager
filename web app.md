# Session Manager — Web UI

A browser-based dashboard for Session Manager. Runs separately from the Electron app and connects to its built-in HTTP API server over the network.

## What it does

- Shows all active sessions grouped by project, each project collapsible
- Streams live terminal output per session (last ~20 lines on load, then live via SSE)
- Click ⤢ on any session card to open an expanded full-screen terminal view
- Lets you send commands to any session from the browser (card view or expanded view)
- Highlights sessions that are waiting for input (⚡)
- Works remotely — open it in a browser while Session Manager runs on a VM or another machine

## Ports

| Service | Port |
|---------|------|
| Web UI (Vite dev server) | **5175** |
| Session Manager API server | **7543** |

## How to run (dev)

```bash
cd web
npm install
npm run dev
# → http://localhost:5175
```

On first load, enter:
- **Server URL** — `http://localhost:7543` (or the remote machine's address)
- **Token** — found in Session Manager → Settings → HTTP Server

Config is saved to `localStorage` so you only enter it once.

## How to build and deploy

```bash
cd web
npm run build
# → web/dist/  (static files)
```

Serve `web/dist/` with any static host:

```nginx
# Nginx example
server {
    listen 80;
    root /path/to/sessionmanager/web/dist;
    location / { try_files $uri /index.html; }
}
```

The web app is just a static SPA — no Node.js server required.

## How it connects to Session Manager

Uses the existing HTTP API built into the Electron app (`src/main/http-server.ts`):

| Method | Endpoint | Used for |
|--------|----------|----------|
| `GET` | `/api/status` | Initial session list |
| `GET` | `/api/sessions/:id/logs?lines=20` | Last N log lines on load |
| `POST` | `/api/sessions/:id/command` | Send a command to a session |
| `GET` | `/api/events` (SSE) | Live output, status changes, input-waiting alerts |

Auth is the Bearer token from Settings. For SSE (which can't set headers), it's passed as `?token=` — already supported by the server.

**CORS** is enabled on the server, so cross-origin browser requests work out of the box.

## Project structure

```
web/
├── src/
│   ├── main.tsx              React entry point
│   ├── App.tsx               State, SSE connection, log processing
│   ├── api.ts                Typed wrappers for all API calls
│   ├── types.ts              Shared interfaces (SessionStatus, Project, etc.)
│   ├── index.css             Tailwind directives + scrollbar styling
│   └── components/
│       ├── ConnectionSetup   URL + token form (validates against /api/status)
│       ├── Dashboard         Header, project list, expanded session overlay
│       ├── ProjectGroup      Collapsible section per project
│       ├── SessionCard       Compact log area + command input + expand button
│       └── ExpandedSession   Full-screen modal with larger log view + command input
├── index.html
├── vite.config.ts            port: 5175, strictPort: true
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

## Tech stack

- **React 18** + TypeScript
- **Vite 5** (dev server + build)
- **Tailwind CSS 3**
- **No extra runtime deps** — SSE via native `EventSource`, auth stored in `localStorage`
