# 🧠 Prefrontal — Local AI Chatbot

![Node.js](https://img.shields.io/badge/Node.js-v18%2B-brightgreen?logo=node.js)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-blue)
![License](https://img.shields.io/badge/license-GPLv3-green)
![Offline](https://img.shields.io/badge/100%25-Offline-success)

**100% Offline · No Ads · No API Keys Required · Your Data Stays on Your Device**

Prefrontal is an open-source, privacy-first chat interface for local AI models. It works with **Ollama** (desktop), **Llama.cpp** (any platform, including Android via Termux), and optionally **OpenRouter** if you'd rather skip local setup entirely. No cloud dependency, no telemetry, no subscriptions.

🔗 **[Live demo](https://prefrontal-five.vercel.app/)** — see what the UI looks like before installing.

> [!NOTE]
> The hosted live demo only supports the OpenRouter runtime (it can't reach a local Ollama or Llama.cpp server from the web). It also stores your API key in a browser cookie, so opening the demo in a private/incognito window will prompt you to set one up again. Run Prefrontal locally if you want the full privacy picture — see [Privacy & Data](#-privacy--data).

---

## Table of Contents

- [Requirements](#-requirements)
- [Quick Start](#-quick-start)
- [Installation Options](#-installation-options)
- [Setting Up Your AI Backend](#-setting-up-your-ai-backend)
- [Personality Presets](#-personality-presets)
- [Temperature Control](#️-temperature-control)
- [Features](#-features)
- [Keyboard Shortcuts](#️-keyboard-shortcuts)
- [Privacy & Data](#-privacy--data)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✅ Requirements

- **Node.js v18+** and **npm** — to run the Prefrontal server itself
- **Git** — to clone the repo
- One AI backend, set up below:
  - An [OpenRouter](https://openrouter.ai) account (free, no install), **or**
  - [Ollama](https://ollama.com) installed locally, **or**
  - A [Llama.cpp](https://github.com/ggml-org/llama.cpp) server you've built or downloaded

---

## ⚡ Quick Start

Pick whichever backend matches your needs — cloud convenience or fully offline privacy. (Want Llama.cpp or Android instead? Jump to [Setting Up Your AI Backend](#-setting-up-your-ai-backend).)

### 🌐 Easiest: OpenRouter *(no local AI install needed)*

OpenRouter gives you free access to powerful cloud models — no GPU, no Ollama, nothing extra to install. The fastest way to get running.

**1. Get a free API key**
Sign up at [openrouter.ai](https://openrouter.ai) and copy your API key from the dashboard.

**2. Install and run Prefrontal**
```bash
git clone https://github.com/sidx1-scratch/prefrontal
cd prefrontal
npm install && npm start
```

**3. Configure and go**
Open `http://localhost:3000`, go to Settings, and set:
- Runtime → **OpenRouter**
- API Key → paste your key
- Model → pick any free model (e.g. `mistralai/mistral-7b-instruct:free`)

Done — no GPU or model download required.

---

### 🖥️ Fully Offline: Ollama *(no API key, your data never leaves your machine)*

**1. Install Ollama and pull a model**
```bash
# Download Ollama from https://ollama.com, then:
ollama serve &
ollama pull gemma3:4b
```

**2. Install and run Prefrontal**
```bash
git clone https://github.com/sidx1-scratch/prefrontal
cd prefrontal
npm install && npm start
```

**3. Configure and go**
Open `http://localhost:3000`, go to Settings, and set:
- Runtime → **Ollama**
- Server URL → `http://localhost:11434`
- Model → `gemma3:4b`

---

## 📦 Installation Options

### Option 1: Clone & Run *(quickest to get started)*

No authentication needed — just clone and go. Best if you want to poke around the source or just try it out.

```bash
git clone https://github.com/sidx1-scratch/prefrontal
cd prefrontal
npm install
npm start
```

A local web server starts and the app opens automatically at `http://localhost:3000`.

### Option 2: Install via GitHub Packages

More setup upfront, but once installed you can run Prefrontal from anywhere on your machine without keeping the source folder around.

**1. Authenticate with GitHub Packages**
```bash
npm login --scope=@sidx1-scratch --auth-type=legacy --registry=https://npm.pkg.github.com
```
Use your GitHub username and a [Personal Access Token](https://github.com/settings/tokens) as the password.

**2. Install globally**
```bash
npm install -g @sidx1-scratch/prefrontal
```

**3. Run from anywhere**
```bash
npm explore @sidx1-scratch/prefrontal -- npm start
```

> [!TIP]
> To update later, just run `npm install -g @sidx1-scratch/prefrontal` again.

---

## 🧠 Setting Up Your AI Backend

You need **one** of the following backends. Pick whichever suits your setup.

### Option A: OpenRouter *(easiest — no local install, free models available)*

OpenRouter is an API that routes to dozens of AI models, many of which are free to use. No GPU or model download required — just an API key.

**1. Create a free account**
Sign up at [openrouter.ai](https://openrouter.ai) and grab your API key from [openrouter.ai/keys](https://openrouter.ai/keys).

**2. Configure Prefrontal**
- Runtime → **OpenRouter**
- API Key → paste your key
- Model → enter any model ID from [openrouter.ai/models](https://openrouter.ai/models)

**Recommended free models to start with:**

| Model | ID |
|---|---|
| Mistral 7B Instruct | `mistralai/mistral-7b-instruct:free` |
| Llama 3.2 3B | `meta-llama/llama-3.2-3b-instruct:free` |
| Gemma 4 31B | `google/gemma-4-31b-it:free` |

> [!NOTE]
> Free model IDs and rate limits change as providers rotate promotions. If one of the IDs above 404s, check the current list at [openrouter.ai/models?q=free](https://openrouter.ai/models?q=free).

---

### Option B: Ollama *(best for fully offline use — Windows, macOS, Linux)*

**1. Install Ollama**
Download from [ollama.com](https://ollama.com) and run the installer.

**2. Start the server**
```bash
ollama serve
```
This starts Ollama on `http://localhost:11434`. Keep this terminal open.

**3. Pull a model**
```bash
# Recommended — small, fast, great quality:
ollama pull gemma3:4b

# More capable (needs more RAM):
ollama pull gemma3:12b
ollama pull llama3.2
ollama pull mistral
```

**4. Configure Prefrontal**
- Open Settings (⚙️ icon or `Ctrl+,`)
- Runtime → **Ollama**
- Server URL → `http://localhost:11434`
- Model → type `gemma3:4b` or click **Refresh** to pick from installed models

---

### Option C: Llama.cpp *(cross-platform — Windows, macOS, Linux, Android)*

Llama.cpp exposes an OpenAI-compatible REST API.

#### 🖥️ Desktop (Windows / macOS / Linux)

**Download a pre-built release:**
[github.com/ggml-org/llama.cpp/releases](https://github.com/ggml-org/llama.cpp/releases)

**Or build from source:**
```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DGGML_BLAS=ON   # optional: swap in a GPU flag, e.g. -DGGML_CUDA=ON
cmake --build build --config Release
```

**Start the server** (run from the `llama.cpp` folder):
```bash
# Option 1: auto-download a model from Hugging Face by name
./build/bin/llama-server -hf ggml-org/gemma-3-4b-it-GGUF --port 8080 --host 0.0.0.0 -c 8192

# Option 2: point -m at a .gguf file you already have
./build/bin/llama-server -m models/your_model.gguf --port 8080 --host 0.0.0.0 -c 8192
```

**Configure Prefrontal:**
- Runtime → **Llama.cpp / OpenAI**
- Server URL → `http://localhost:8080/v1`
- Model → the model name/filename you started the server with (e.g. `gemma-3-4b-it-GGUF` or `gemma-2-2b.gguf`)

---

#### 📱 Android / Mobile *(via Termux)*

**1. Install Termux**
Get it from [F-Droid](https://f-droid.org/en/packages/com.termux/) — not the Play Store version, which is outdated.

**2. Install dependencies**
```bash
pkg update && pkg upgrade
pkg install clang git cmake make python3 libcurl
```

**3. Build Llama.cpp**
```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build
cmake --build build --config Release -j4
```

**4. Start the server** (auto-downloads a small model on first run)
```bash
./build/bin/llama-server -hf ggml-org/gemma-3-1b-it-GGUF \
  --port 8080 --host 0.0.0.0 -c 4096
```

> [!TIP]
> Prefer to manage the file yourself instead of auto-downloading? Grab any compact GGUF model — something in the 1–4B parameter range, quantized to Q4, fits comfortably on most phones — and pass it with `-m path/to/model.gguf` instead of `-hf`.

**5. Open Prefrontal**
In a second Termux session, start the Node.js server:
```bash
cd prefrontal && npm start
```
Then open `http://127.0.0.1:3000` in your Android browser.

**Configure Prefrontal:**
- Runtime → **Llama.cpp / OpenAI**
- Server URL → `http://127.0.0.1:8080/v1`
- ⚠️ Use `127.0.0.1` instead of `localhost` on Android — they may not resolve the same way

---

### External or LAN Servers

If your AI backend runs on a different machine (home server, another PC), bind it to `0.0.0.0` and enter its LAN IP in Settings — e.g. `http://192.168.1.100:11434` for Ollama or `http://192.168.1.100:8080/v1` for Llama.cpp.

---

## 🎭 Personality Presets

Prefrontal includes **4 built-in personality presets** that change the system prompt and temperature simultaneously. Switch between them on the welcome screen or in Settings.

| Preset | Temp | Best For |
|---|---|---|
| ⚖️ Balanced | 0.7 | General tasks, Q&A, learning |
| 🎨 Creative | 1.1 | Writing, brainstorming, storytelling |
| 🎯 Precise | 0.2 | Facts, summaries, concise answers |
| 💻 Developer | 0.3 | Code review, debugging, technical docs |

You can also write a fully **custom** system prompt — edit the System Prompt box in Settings, and the preset selector switches to "Custom" automatically.

---

## 🌡️ Temperature Control

Temperature controls how random or creative the AI's outputs are.

| Value | Behavior |
|---|---|
| `0.0` | Fully deterministic — same input produces the same output |
| `0.2–0.4` | Precise and focused |
| `0.7` | Balanced (default) |
| `1.0–1.2` | Creative and varied |
| `1.5–2.0` | Wild, experimental, sometimes incoherent |

> [!TIP]
> Temperature is sent with every message — just adjust the slider, save, and it applies to the next generation. No restart needed.

---

## 🎨 Features

| Feature | Details |
|---|---|
| 💬 Chat | Full conversation history with any local AI model |
| 🔄 Streaming | Real-time, token-by-token generation |
| 🎭 Personality Presets | 4 built-in modes with one click |
| 🌡️ Temperature Control | Live-sent with every request |
| 📚 Multi-Backend | OpenRouter (cloud), Ollama, and Llama.cpp over local or LAN |
| 🌐 LAN & External | Connect to dedicated AI servers on your network |
| 💾 Multi-Chat | Unlimited saved local conversations |
| 🔍 Search | Instant conversation search |
| 📱 PWA & Mobile Ready | Install as an app on iOS/Android; safe-area aware |
| 🎨 Refined UI | 4 themes: Dark, Midnight, Emerald, Light |
| 🧑 Local Profile | Device identity stored locally — no accounts |
| 📤 Export | Export chats as Markdown, profile as JSON |
| 🔒 100% Private | Zero network calls except to your own model server |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + N` | New conversation |
| `Ctrl + ,` | Open Settings |
| `Enter` | Send message *(configurable)* |
| `Shift + Enter` | New line in input |
| `Escape` | Close modal |

---

## 🔐 Privacy & Data

Running Prefrontal locally (Ollama or Llama.cpp), no chat data or API keys leave your machine — the app makes network calls only to the model server you configured, which is also on your machine or LAN.

If you use the **OpenRouter** runtime instead, your messages are sent to OpenRouter's API to be routed to whichever model you picked, so at that point you're trusting OpenRouter and the model provider with your prompts — the same as using any other cloud AI service.

> [!WARNING]
> The hosted [live demo](https://prefrontal-five.vercel.app/) is a special case: it only works with OpenRouter, and it stores your API key in a browser cookie rather than anywhere on a device you control. Treat it as a way to preview the UI, not as your daily driver — for real use, run Prefrontal locally.

---

## 🔧 Troubleshooting

### ❌ "Cannot connect to server"
- Make sure your AI backend is **running** before opening Prefrontal.
- Ollama: run `ollama serve` in a terminal.
- Llama.cpp: confirm `llama-server` is running with the correct port.
- Verify Settings → **Server URL** matches your backend exactly (including `/v1` for Llama.cpp).
- On Android, use `http://127.0.0.1` — `localhost` may not resolve correctly.

### ❌ "Model not found"
- **Ollama**: run `ollama list` to see installed models; copy the exact name including its tag.
- **Llama.cpp**: the model name is the `.gguf` filename (or `-hf` repo name) you passed to `llama-server`.
- Click **Refresh** in Settings to auto-populate the model list.

### ❌ Streaming stops or output is garbled
- Lower the **Context Window** setting — the model may be running out of memory.
- Try a smaller model (e.g. `gemma3:4b` instead of `gemma3:12b`).
- Restart the backend server and try again.

### ❌ Temperature changes have no effect
- Temperature applies to the **next message** only — not retroactively.
- Make sure you click **Save Settings** after adjusting the slider.
- Some models enforce a minimum temperature internally; very low values may behave like `0.0`.

### ❌ App opens but is blank
- Confirm you ran `npm start`, not `npm run build`.
- Try `npx serve .` as an alternative server.
- Open the browser console (`F12`) and check for errors.

---

## 🤝 Contributing

Issues and PRs are welcome at [github.com/sidx1-scratch/prefrontal](https://github.com/sidx1-scratch/prefrontal). If you spot a bug or have a feature idea, open an issue before submitting a large PR so the approach can be discussed first.

---

## 📄 License

Prefrontal is released under the [GNU GPLv3](https://www.gnu.org/licenses/gpl-3.0.html) license.
