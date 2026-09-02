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
   ./setup.sh                 # links command globally and pre-pulls sandbox image
   ```
3. **Run the agent**:
   ```bash
   prefrontal-agent background # runs continuously in the background
   # or run the interactive REPL: prefrontal-agent
   ```
4. **Select a workspace** (optional or in REPL):
   ```
   prefrontal-agent workspace /home/you/projects/my-app
   ```
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
| `POST /model-state` | browser | report the UI's current runtime/model for the session |
| `GET /model-state` | agent | read the model the UI selected for this session |
| `POST /llm` | agent | proxy a chat-completion to OpenRouter (key stays server-side) |
| `POST /auto-pair` | agent | auto-pair with a shared localhost secret (no token) |
| `POST /ask-response` | browser | answer the planner's `ask_user` multiple-choice question |

All endpoints except `pair`/`pair/status` require
`Authorization: Bearer <session-token>`. Events are JSON `data:` frames
over Server-Sent Events; the protocol is documented in the
[agent repo's PROTOCOL.md](https://github.com/sidx1-scratch/prefrontal-agent/blob/main/docs/PROTOCOL.md).

## Auto-connect (no pairing token)

On the same machine, pairing is automatic: this server writes a random
secret to `~/.prefrontal-agent/shared-secret` (mode 0600) at startup, and
the agent reads it and calls `POST /api/agent/auto-pair` in the background
when it starts. Auto-pair is **localhost-only** (remote clients are denied
and must use the manual token), and the agent skips it with
`PREFRONTAL_NO_AUTO_PAIR=1`. The manual `pair <token>` flow still works as
an alternative and for remote setups.

## Interactive questions (`ask_user`)

The agent's `task` loop can pause and ask you a question with selectable
options. The agent emits an `ask-request` event (`{ requestId, question,
options }`); the web panel or chat renders it as a list you can click or
navigate with ↑/↓ + Enter, and the choice is returned via
`POST /api/agent/ask-response` so the model resumes. In the chatbox this is
fully inline — the options appear right in the reply and your pick feeds
back automatically.

## Security notes

- Pairing tokens are single-use, expire after 5 minutes, and are never
  logged. Auto-pair uses a shared localhost-only secret file (mode 0600).
- Commands execute inside a disposable Podman container; the host shell
  is never used for agent commands.
- Filesystem operations are confined to the agent's approved workspace
  (path-traversal and symlink escapes rejected).
- Permission scopes default to `ask` for `fs.delete`, `network`, and
  `destructive`; with nobody to ask, the agent denies.
- The user can always revoke a session from the panel.

See the agent repo's `docs/SECURITY.md` for the full threat model.

## Tasks (built-in LLM planner)

The agent includes a `task` loop (`llm/planner.js`): point it at any
OpenAI-compatible model and send natural-language goals that it turns into
tool calls (`run`, `read`, `write`, …). Progress streams through the normal
relay (`message`/`output` events), and every tool call still goes through
the same permission gate — so the web panel can run
`task scaffold a Flask app` and watch it work, answering permission
prompts inline. Configure with `llm set-model` / `set-url` / `set-key`.

By default, when the agent is paired, `task` uses the model currently
selected in the Prefrontal UI: the browser reports it via
`POST /api/agent/model-state`, the agent reads it with
`GET /api/agent/model-state`, and the chat-completion is proxied by the
backend (`POST /api/agent/llm`) so the OpenRouter key stays in `.env` and
never reaches the agent. OpenRouter is the only supported runtime for this
path so far; Ollama support is planned later. Use `llm set-mode local` on
the agent to fall back to a local URL/key/model instead.

## Chat delegation (`/agent …`)

You can drive the paired agent straight from the **chatbox**. Type
`/agent <your request>` in the main chat input and hit send — instead of a
normal model reply, the chat hands the request to the agent's `task` loop
as if you had run `task <your request>` in its panel:

```
/agent create a static blog project in /tmp/blog and publish it to GitHub
```

The agent plans, creates files, and runs commands (git init/commit/push,
npm publish, … depending on what your prompt asks), and the progress
streams back into the chat as an assistant message. Permission prompts
(e.g. `network` for a push) appear inline in the reply with **Allow / Deny**
buttons, mirroring the Agent panel. Use **Stop** to cancel.

Requires a paired agent (open the **Agent** panel and pair first). The
agent interprets "publish" from your prompt — the UI doesn't assume what
it means.

## What's intentionally NOT included

- **WebSocket transport**: SSE + POST keeps everything dependency-free;
  a WebSocket transport can replace it behind the same relay interface.
- **File browser / workspace picker in the UI**: commands cover file
  operations; a graphical picker is future work.

## Development

```bash
npm run test:agent     # tests/agent-relay-smoke.js — full relay loop
npm test               # existing suite (package contents, proxy, CI)
```
