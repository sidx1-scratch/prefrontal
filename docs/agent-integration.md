# Prefrontal Agent Integration

This page documents how the Prefrontal web client connects to the
[Prefrontal Agent](https://github.com/sidx1-scratch/prefrontal-agent) —
a local, security-conscious coding agent that runs commands inside a
Podman sandbox and keeps filesystem access scoped to an approved
workspace.

The integration is **zero-dependency**: `server.js` adds a relay built
only on Node's built-in `http`/`crypto`, and `agent.js` is plain vanilla
JS. No new packages, no build step — the project's contribution rule
stays intact.

## Architecture

```
Browser (agent.js panel)          Local Agent (prefrontal-agent)
        │  HTTPS/HTTP + SSE              │  outbound authenticated stream
        ▼                                ▼  (SSE + POST, no inbound ports)
   Prefrontal backend (server.js) ◄──────┘
```

- The agent **never opens a port**. It dials out to this server and holds
  one authenticated SSE stream (`/api/agent/agent-stream`), then POSTs
  events back (`/api/agent/events`). No port forwarding, public IP,
  router config, or inbound firewall rules.
- The browser panel subscribes to a second stream (`/api/agent/stream`)
  keyed to the same session and sends tool commands
  (`/api/agent/command`).
- The backend relays both directions. Session state is **in memory** — a
  server restart clears it and the agent re-pairs.

## Quick start

1. **Run Prefrontal** (this repo): `npm start` → open `http://localhost:3000`.
2. **Install the agent** (separate repo):
   ```bash
   git clone https://github.com/sidx1-scratch/prefrontal-agent
   cd prefrontal-agent
   node cli/index.js          # or: npm start / prefrontal-agent
   ```
3. **Select a workspace** in the agent REPL:
   ```
   prefrontal> workspace /home/you/projects/my-app
   ```
4. **Build the sandbox image** (once): `prefrontal-agent sandbox build`
   (requires Podman: https://podman.io/docs/installation).
5. **Pair**: in the web UI, open the **Agent** panel (robot icon in the
   top bar) → **Pair new agent** → copy the token → in the agent REPL:
   ```
   prefrontal> pair <token>
   ```
6. **Send commands** from the panel, e.g. `run npm test`,
   `write src/app.js`⏎`content`, `list src`. Output streams live.
   Permission prompts (e.g. `network`) appear in the panel — Allow/Deny.

## Relay endpoints (`/api/agent/*`)

| Endpoint | Who | Purpose |
|---|---|---|
| `POST /pair` | browser | create a single-use pairing token (5 min TTL) |
| `POST /pair/confirm` | agent | exchange token for `{ sessionId, token }` |
| `GET /pair/status?token=` | browser | pairing poll: waiting / paired / expired |
| `GET /agent-stream?session=` | agent | outbound authenticated SSE (receives commands) |
| `GET /stream?session=` | browser | UI SSE (receives streamed events) |
| `POST /command` | browser | send a tool command (queued while agent offline) |
| `POST /events` | agent | report events, broadcast to every UI stream |
| `POST /permission-response` | browser | answer an agent permission prompt |
| `POST /revoke` | either | delete the session, close all its streams |
| `GET /session` | browser | session state (reconnect validation) |

All endpoints except `pair`/`pair/status` require
`Authorization: Bearer <session-token>`. Events are JSON `data:` frames
over Server-Sent Events; the protocol is documented in the
[agent repo's PROTOCOL.md](https://github.com/sidx1-scratch/prefrontal-agent/blob/main/docs/PROTOCOL.md).

## Security notes

- Pairing tokens are single-use, expire after 5 minutes, and are never
  logged.
- Commands execute inside a disposable Podman container; the host shell
  is never used for agent commands.
- Filesystem operations are confined to the agent's approved workspace
  (path-traversal and symlink escapes rejected).
- Permission scopes default to `ask` for `fs.delete`, `network`, and
  `destructive`; with nobody to ask, the agent denies.
- The user can always revoke a session from the panel.

See the agent repo's `docs/SECURITY.md` for the full threat model.

## What's intentionally NOT included

- **LLM task loop**: the agent currently executes tool commands
  (`run`, `read`, `write`, …) directly. A future milestone adds a
  natural-language task layer that maps an AI's intent to these tools.
- **WebSocket transport**: SSE + POST keeps everything dependency-free;
  a WebSocket transport can replace it behind the same relay interface.
- **File browser / workspace picker in the UI**: commands cover file
  operations; a graphical picker is future work.

## Development

```bash
npm run test:agent     # tests/agent-relay-smoke.js — full relay loop
npm test               # existing suite (package contents, proxy, CI)
```
