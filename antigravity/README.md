# 🤖 Prefrontal — Setup Guide
## Local AI Chatbot · 100% Offline · No Ads

A generic, offline-first interface for local AI models. Works on Windows, Mac, Linux, and even Android (via Llama.cpp).

---

## ⚡ Quick Start (Node.js)

### Step 1 — Install Node.js
Download and install Node.js from [nodejs.org](https://nodejs.org/).

### Step 2 — Run the App
Open a terminal in the project folder and run:
```bash
npm start
```
> This starts a local web server (using `serve`) which opens the app in your browser automatically.

---

## 🧠 Setting Up Your AI Backend

You need at least one local AI runtime running for the chatbot to work.

### Option A: Ollama (Recommended for Desktop)
1. **Download**: [ollama.com](https://ollama.com/)
2. **Start Server**: Open a terminal and run `ollama serve`.
3. **Pull a Model**: Run `ollama pull gemma4` (or any other model).
4. **App Config**: In Prefrontal Settings, ensure the Runtime is set to **Ollama** and Server URL is `http://localhost:11434`.

### Option B: Llama.cpp (Recommended for Mobile/Android/CLI)

#### 📱 Android / Mobile Setup (via Termux)
1. **Install Termux**: Get it from [F-Droid](https://f-droid.org/en/packages/com.termux/).
2. **Setup Dependencies**: Open Termux and run:
   ```bash
   pkg update && pkg upgrade
   pkg install clang wget git cmake make
   ```
3. **Build Llama.cpp**:
   ```bash
   git clone https://github.com/ggerganov/llama.cpp
   cd llama.cpp
   mkdir build && cd build
   cmake .. && make -j4
   ```
4. **Get a Model (.gguf)**: Use `wget` to download a small GGUF model (like Gemma 2B or TinyLlama) into the `models/` folder.
5. **Start Server**: 
   ```bash
   ./bin/llama-server -m models/your_model.gguf --port 8080 --host 0.0.0.0
   ```
6. **App Config**: In Prefrontal Settings, switch Runtime to **Llama.cpp / OpenAI** and Server URL to `http://localhost:8080/v1`.

---

## 🎨 Features

| Feature | Details |
|---|---|
| 💬 **Chat** | Full conversation history with any local AI model |
| 🔄 **Streaming** | Real-time generation (SSE & NDJSON support) |
| 📚 **Multi-Backend** | Seamlessly switch between Ollama and Llama.cpp |
| 📚 **Multi-Chat** | Unlimited saved local conversations |
| 🔍 **Search** | Instantly find previous conversations |
| 🌡️ **Temperature** | Fine-tune creativity (0–2) |
| 🔒 **100% Private** | No API keys, no internet, zero data tracking |

---

## 🔧 Troubleshooting

**"Cannot connect to server"**
- Ensure your backend (Ollama/Llama.cpp) is running.
- If using Llama.cpp, make sure the `--port` matches your Settings.
- On Android/Termux, check if you need to use `http://127.0.0.1` instead of `localhost`.

**"Model not found"**
- **Ollama**: Run `ollama list` to see your models and copy the exact name to Settings.
- **Llama.cpp**: The model is defined by the file you loaded when starting the server.

---

*Prefrontal by sidx1 · Built with ️antigravity using Local AI*
