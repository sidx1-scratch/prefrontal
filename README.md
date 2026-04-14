# 🧠 Prefrontal — Local AI Chatbot
### 100% Offline · No Ads · No API Keys · Your Data Stays on Your Device

Prefrontal is an open-source, privacy-first chat interface for local AI models. It works with **Ollama** (desktop) and **Llama.cpp** (any platform including Android via Termux). No cloud, no telemetry, no subscriptions.

---

## ⚡ Quick Start

### Prerequisites
- **Node.js** (v18+) — download at [nodejs.org](https://nodejs.org/)
- A running local AI backend (Ollama or Llama.cpp — see below)

### Run the App
```bash
# 1. Open a terminal in the project folder
# 2. Install dependencies (first time only)
npm install

# 3. Start the app
npm start
```
> A local web server starts and the app opens in your browser automatically at `http://localhost:3000`.

**External or LAN Servers:**
If you run the AI backend on a different computer (e.g., a home server or a PC on your local network), ensure your server is bound to `0.0.0.0` (as shown below) and simply enter its LAN IP address in the Settings (e.g., `http://192.168.1.100:11434` for Ollama or `http://192.168.1.100:8080/v1` for Llama.cpp).

---

## 🧠 Setting Up Your AI Backend

You need **one** of the following local runtimes installed and running.

### Option A: Ollama *(Recommended for Desktop — Windows, macOS, Linux)*

**1. Install Ollama**
Download from [ollama.com](https://ollama.com/) and run the installer.

**2. Start the Server**
```bash
ollama serve
```
This starts Ollama on `http://localhost:11434`. Keep this terminal open.

**3. Pull a Model**
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
- Model → type `gemma4:e2b` or click **Refresh** to pick from available models

---

### Option B: Llama.cpp *(Cross-platform: Windows, macOS, Linux, Android)*

Llama.cpp exposes an OpenAI-compatible REST API, making it easy to use with Prefrontal.

#### 🖥️ Desktop (Windows / macOS / Linux)

**Download a pre-built release:**
[github.com/ggerganov/llama.cpp/releases](https://github.com/ggerganov/llama.cpp/releases)

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
Get it from [F-Droid](https://f-droid.org/en/packages/com.termux/) *(not the Play Store version — it's outdated)*.

**2. Install Dependencies**
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

**4. Download a Model**
Use a small GGUF model (2–4 GB recommended for mobile):
```bash
mkdir -p ../models
# Example: download TinyLlama 1.1B Q4 (good for mobile)
wget -P ../models https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
```

**5. Start the Server**
```bash
./bin/llama-server -m ../models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf \
  --port 8080 --host 0.0.0.0 -c 4096
```

**6. Open Prefrontal in Termux's Browser**
In another Termux session (or on the same device's browser):
- Open `http://127.0.0.1:3000` (if running the Node.js server too)
- Or serve directly with `npx serve` inside the project folder

**Configure Prefrontal:**
- Runtime → **Llama.cpp / OpenAI**
- Server URL → `http://127.0.0.1:8080/v1`
- ⚠️ Use `127.0.0.1` instead of `localhost` on Android — they may not resolve the same way

---

## 🎭 Personality Presets

Prefrontal includes **4 built-in personality presets** that change both the system prompt and temperature simultaneously. Switch between them instantly on the welcome screen or in Settings.

| Preset | Temp | Best For |
|--------|------|----------|
| ⚖️ **Balanced** | 0.7 | General tasks, Q&A, learning |
| 🎨 **Creative** | 1.1 | Writing, brainstorming, storytelling |
| 🎯 **Precise** | 0.2 | Facts, summaries, concise answers |
| 💻 **Developer** | 0.3 | Code review, debugging, technical docs |

You can also write your own **Custom** system prompt — just edit the System Prompt box in Settings and the preset selector will switch to Custom automatically.

---

## 🌡️ Temperature Control

Temperature controls how random/creative the AI's outputs are:

| Value | Behaviour |
|-------|-----------|
| `0.0` | Fully deterministic — same input = same output |
| `0.2–0.4` | Precise and focused |
| `0.7` | Balanced (default) |
| `1.0–1.2` | Creative and varied |
| `1.5–2.0` | Wild, experimental, sometimes incoherent |

> **Pro Tip:** Temperature is sent with every message — you don't need to restart anything. Just adjust the slider and save.

---

## 🎨 Features

| Feature | Details |
|---------|---------|
| 💬 **Chat** | Full conversation history with any local AI model |
| 🔄 **Streaming** | Real-time token-by-token generation |
| 🎭 **Personality Presets** | 4 built-in modes with one click |
| 🌡️ **Temperature Control** | Live sent with every request |
| 📚 **Multi-Backend** | Ollama and Llama.cpp (OpenAI-compatible API) over Local or LAN |
| 🌐 **LAN & External** | Connect to dedicated AI servers on your local network |
| 💾 **Multi-Chat** | Unlimited saved local conversations |
| 🔍 **Search** | Instant conversation search |
| 📱 **PWA & Mobile Ready** | Install as an app on iOS/Android; includes safe-area handling |
| 🎨 **Refined UI** | Premium responsive aesthetics across 4 themes (Dark, Midnight, Emerald, Light) |
| 🧑 **Local Profile** | Device identity stored locally (no accounts) |
| 📤 **Export** | Export chats as Markdown, profile as JSON |
| 🔒 **100% Private** | Zero network calls except to your specified models |

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
- Make sure your AI backend (Ollama or Llama.cpp) is **running** before using Prefrontal
- Ollama: run `ollama serve` in a terminal
- Llama.cpp: make sure `llama-server` is running with the correct port
- Check that Settings → **Server URL** matches your backend's address
- On Android, try `http://127.0.0.1` instead of `http://localhost`

### ❌ "Model not found"
- **Ollama**: run `ollama list` to see installed models. Copy the exact name (including tag).
- **Llama.cpp**: the model is whatever `.gguf` file you passed to `llama-server` with `-m`
- Click **Refresh** in Settings to auto-populate the model list

### ❌ Streaming stops or output is garbled
- Lower the **Context Window** setting — your model may be running out of memory
- Try a smaller model (e.g. `gemma4:e2b` instead of `gemma4`)
- Restart the backend server

### ❌ Temperature changes don't seem to have any effect
- Temperature only affects the **next message** — it's not applied retroactively
- Make sure you click **Save Settings** after adjusting the slider
- Some models have built-in minimum temperatures; very low values may behave like 0.0

### ❌ App opens but is blank
- Make sure you ran `npm start` (not `npm run build`)
- Try `npx serve .` as an alternative if `npm start` fails
- Check browser console (`F12`) for errors

---

## 📁 Project Structure

```
prefrontal/
├── index.html        # Main app shell
├── style.css         # All styles (no build step)
├── app.js            # All app logic (vanilla JS)
├── package.json      # npm start / serve config
├── vendor/
│   ├── marked.min.js         # Markdown renderer
│   ├── highlight.min.js      # Syntax highlighter
│   ├── highlight-dark.min.css
│   └── highlight-light.min.css
└── README.md
```

---

## 💡 Tips

- **First run**: A setup wizard will ask for your name and avatar. This is stored only on your device.
- **Model refresh**: When you start Ollama with a new model, click **Refresh** in Settings to see it.
- **Context size**: If a conversation feels "forgetful", increase `num_ctx` in Settings (needs enough RAM).
- **Exporting**: Use the download icon (↓) in the topbar to save the current chat as a Markdown file.
- **Regenerate**: Hover over any AI message and click the ↺ icon to regenerate the response.

---

*Prefrontal by **sidx1** · Built with ⚡ antigravity using Local AI · [github.com/sidx1](https://github.com/sidx1)*
