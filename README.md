# 🧠 Prefrontal — Local AI Chatbot

![Node.js](https://img.shields.io/badge/Node.js-v18%2B-brightgreen?logo=node.js)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)
![Offline](https://img.shields.io/badge/100%25-Offline-success)

### 100% Offline · No Ads · No API Keys · Your Data Stays on Your Device

Prefrontal is an open-source, privacy-first chat interface for local AI models. It works with **Ollama** (desktop) and **Llama.cpp** (any platform including Android via Termux). No cloud, no telemetry, no subscriptions.

---

## ⚡ Quick Start

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
ollama pull gemma4:e2b
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
- Model → `gemma4:e2b`

> For Android, LAN servers, Llama.cpp, and other options — see the full setup guide below.

---

## 📦 Installation Options

### Option 1: Install via GitHub Packages *(Recommended)*

More setup upfront, but once installed you can run Prefrontal from anywhere on your machine without keeping the source folder around.

**1. Authenticate with GitHub Packages**
```bash
npm login --scope=@sidx1-scratch --auth-type=legacy --registry=https://npm.pkg.github.com
```
Use your GitHub username and a Personal Access Token from [github.com/settings/tokens](https://github.com/settings/tokens) as the password.

**2. Install globally**
```bash
npm install -g @sidx1-scratch/prefrontal
```

**3. Run from anywhere**
```bash
npm explore @sidx1-scratch/prefrontal -- npm start
```

> To update later: `npm install -g @sidx1-scratch/prefrontal` again.

### Option 2: Clone & Run *(Quickest to get started)*

No authentication needed — just clone and go. Best if you want to poke around the source or just try it out.

```bash
git clone https://github.com/sidx1-scratch/prefrontal
cd prefrontal
npm install
npm start
```

A local web server starts and the app opens automatically at `http://localhost:3000`.

---

## 🧠 Setting Up Your AI Backend

You need **one** of the following backends. Pick whichever suits your setup.

### Option A: OpenRouter *(Easiest — no local install, free models available)*

OpenRouter is an API that routes to dozens of AI models, many of which are completely free. No GPU or model download required — just an API key.

**1. Create a free account**
Sign up at [openrouter.ai](https://openrouter.ai) and grab your API key from [openrouter.ai/keys](https://openrouter.ai/keys).

**2. Configure Prefrontal**
- Runtime → **OpenRouter**
- API Key → paste your key
- Model → enter any model ID from [openrouter.ai/models](https://openrouter.ai/models)

**Recommended free models to start with:**

| Model | ID |
|-------|----|
| Mistral 7B Instruct | `mistralai/mistral-7b-instruct:free` |
| Llama 3.1 8B | `meta-llama/llama-3.1-8b-instruct:free` |
| Gemma 3 4B | `google/gemma-3-4b-it:free` |

> Free models may have rate limits. Check [openrouter.ai/models?q=free](https://openrouter.ai/models?q=free) for the current free tier.

---

### Option B: Ollama *(Best for fully offline use — Windows, macOS, Linux)*

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
ollama pull gemma4:e2b

# More capable (needs more RAM):
ollama pull gemma4
ollama pull llama3.2
ollama pull mistral
```

**4. Configure Prefrontal**
- Open Settings (⚙️ icon or `Ctrl+,`)
- Runtime → **Ollama**
- Server URL → `http://localhost:11434`
- Model → type `gemma4:e2b` or click **Refresh** to pick from installed models

---

### Option C: Llama.cpp *(Cross-platform: Windows, macOS, Linux, Android)*

Llama.cpp exposes an OpenAI-compatible REST API.

#### 🖥️ Desktop (Windows / macOS / Linux)

**Download a pre-built release:**
[https://github.com/ggml-org/llama.cpp/releases](https://github.com/ggml-org/llama.cpp/releases)

Or build from source:
```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
mkdir build && cd build
cmake .. -DLLAMA_BLAS=ON   # optional: add GPU flags
cmake --build . --config Release
```

**Start the server:**
```bash
./llama-server -m models/your_model.gguf --port 8080 --host 0.0.0.0 -c 8192
```

**Configure Prefrontal:**
- Runtime → **Llama.cpp / OpenAI**
- Server URL → `http://localhost:8080/v1`
- Model → enter the exact filename of your `.gguf` model (e.g. `gemma-2-2b.gguf`)

---

#### 📱 Android / Mobile *(via Termux)*

**1. Install Termux**
Get it from [F-Droid](https://f-droid.org/en/packages/com.termux/) — not the Play Store version, which is outdated.

**2. Install dependencies**
```bash
pkg update && pkg upgrade
pkg install clang wget git cmake make python3
```

**3. Build Llama.cpp**
```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j4
```

**4. Download a model**
Use a small GGUF model (2–4 GB recommended for mobile):
```bash
mkdir -p ../models
# Example: TinyLlama 1.1B Q4 — good balance of size and quality for mobile
wget -P ../models https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
```

**5. Start the server**
```bash
./bin/llama-server -m ../models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf \
  --port 8080 --host 0.0.0.0 -c 4096
```

**6. Open Prefrontal**
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

**External or LAN Servers:**
If your AI backend runs on a different machine (home server, another PC), bind it to `0.0.0.0` and enter its LAN IP in Settings — e.g. `http://192.168.1.100:11434` for Ollama or `http://192.168.1.100:8080/v1` for Llama.cpp.

---

## 🎭 Personality Presets

Prefrontal includes **4 built-in personality presets** that change the system prompt and temperature simultaneously. Switch between them on the welcome screen or in Settings.

| Preset | Temp | Best For |
|--------|------|----------|
| ⚖️ **Balanced** | 0.7 | General tasks, Q&A, learning |
| 🎨 **Creative** | 1.1 | Writing, brainstorming, storytelling |
| 🎯 **Precise** | 0.2 | Facts, summaries, concise answers |
| 💻 **Developer** | 0.3 | Code review, debugging, technical docs |

You can also write a fully **Custom** system prompt — edit the System Prompt box in Settings and the preset selector switches to Custom automatically.

---

## 🌡️ Temperature Control

Temperature controls how random or creative the AI's outputs are.

| Value | Behaviour |
|-------|-----------|
| `0.0` | Fully deterministic — same input = same output |
| `0.2–0.4` | Precise and focused |
| `0.7` | Balanced (default) |
| `1.0–1.2` | Creative and varied |
| `1.5–2.0` | Wild, experimental, sometimes incoherent |

> **Pro Tip:** Temperature is sent with every message — just adjust the slider, save, and it applies to the next generation. No restart needed.

---

## 🎨 Features

| Feature | Details |
|---------|---------|
| 💬 **Chat** | Full conversation history with any local AI model |
| 🔄 **Streaming** | Real-time token-by-token generation |
| 🎭 **Personality Presets** | 4 built-in modes with one click |
| 🌡️ **Temperature Control** | Live-sent with every request |
| 📚 **Multi-Backend** | OpenRouter (cloud), Ollama, and Llama.cpp over local or LAN |
| 🌐 **LAN & External** | Connect to dedicated AI servers on your network |
| 💾 **Multi-Chat** | Unlimited saved local conversations |
| 🔍 **Search** | Instant conversation search |
| 📱 **PWA & Mobile Ready** | Install as an app on iOS/Android; safe-area aware |
| 🎨 **Refined UI** | 4 themes: Dark, Midnight, Emerald, Light |
| 🧑 **Local Profile** | Device identity stored locally — no accounts |
| 📤 **Export** | Export chats as Markdown, profile as JSON |
| 🔒 **100% Private** | Zero network calls except to your own model server |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + N` | New conversation |
| `Ctrl + ,` | Open Settings |
| `Enter` | Send message *(configurable)* |
| `Shift + Enter` | New line in input |
| `Escape` | Close modal |

---

## 🔧 Troubleshooting

### ❌ "Cannot connect to server"
- Make sure your AI backend is **running** before opening Prefrontal
- Ollama: run `ollama serve` in a terminal
- Llama.cpp: confirm `llama-server` is running with the correct port
- Verify Settings → **Server URL** matches your backend exactly (including `/v1` for Llama.cpp)
- On Android, use `http://127.0.0.1` — `localhost` may not resolve correctly

### ❌ "Model not found"
- **Ollama**: run `ollama list` to see installed models; copy the exact name including tag
- **Llama.cpp**: the model name is the `.gguf` filename you passed to `llama-server` with `-m`
- Click **Refresh** in Settings to auto-populate the model list

### ❌ Streaming stops or output is garbled
- Lower the **Context Window** setting — the model may be running out of memory
- Try a smaller model (e.g. `gemma4:e2b` instead of `gemma4`)
- Restart the backend server and try again

### ❌ Temperature changes have no effect
- Temperature applies to the **next message** only — not retroactively
- Make sure you click **Save Settings** after adjusting the slider
- Some models enforce a minimum temperature internally; very low values may behave like `0.0`

### ❌ App opens but is blank
- Confirm you ran `npm start`, not `npm run build`
- Try `npx serve .` as an alternative server
- Open the browser console (`F12`) and check for errors

---

## 🤝 Contributing

Issues and PRs welcome at [github.com/sidx1-scratch/prefrontal](https://github.com/sidx1-scratch/prefrontal).
