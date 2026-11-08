# lornAI - Roblox Studio Agent

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

**lornAI - Roblox Studio Agent** is a browser extension and local bridge that turns ChatGPT, Claude, DeepSeek, Gemini, Kimi, GLM, Qwen, Arena or Meta AI into a Roblox Studio AI assistant.
Control Roblox Studio with AI directly from your browser — read/edit scripts, execute Luau, inspect game trees, and generate assets, all from a normal AI chat. No API key, no terminal, no coding needed.

> 🌐 **Website: [lorn.lol](https://lorn.lol)** — The intelligent multi-agent platform by Frail.

Supported AI providers: **DeepSeek** (chat.deepseek.com), **ChatGPT** (chatgpt.com), **Claude** (claude.ai), **Google Gemini** (gemini.google.com), **Kimi** (kimi.ai), **GLM** (chat.z.ai), **Qwen** (chat.qwen.ai), **Arena** (arena.ai) and **Meta AI** (meta.ai).

> 💬 **Community: [Telegram (t.me/logmade)](https://t.me/logmade)** — Get help, share feedback, and follow updates.

## How it works

```
AI chat (ChatGPT / Claude / DeepSeek / Gemini / Kimi / GLM / Qwen / Arena / Meta AI) -> lornAI Extension -> Bridge (your PC) -> Roblox Studio
```

The extension runs inside the chat page. When you type a request, it sends commands to the Bridge running on your PC, which drives Roblox Studio through the built-in MCP server.

## Setup

### 1. Download the zip and install the extension

Download the latest code from the repository. The folder contains both the **Bridge** and the **`lornai-extension`** folder.

To load the extension:

- Go to `edge://extensions` (Edge) or `chrome://extensions` (Chrome)
- Enable **Developer mode** (top right toggle)
- Click **Load unpacked**
- Select the `lornai-extension` folder

### 2. Start Roblox Studio and enable MCP

Open Studio and load a Place, then enable MCP (first time only):

- Click **Assistant AI** in the top bar
- Click **...** (top right of the Assistant panel)
- Click **Manage MCP Servers**
- Click **Enable Studio as MCP Server**

### 3. Run the Bridge

- **Windows:** double-click `start.bat`.
- **macOS:** double-click `MacOS_Start.command`. On macOS, if you get a security warning on the first run, click **Done**, then go to **System Settings > Privacy & Security**, scroll to the bottom, and click **Open Anyway**.

A small terminal window opens, indicating the Bridge is running.

### 4. Start a session

Go to https://chat.deepseek.com (or https://chatgpt.com, https://claude.ai, https://gemini.google.com, etc.) and open a new chat. The lornAI bar appears above the input box. Click **Start session** and type what you want to build.

## What the AI can do

- Read and edit scripts
- Run Luau code directly in Studio
- Inspect the game tree and instances
- Generate meshes, materials, and models
- Browse and insert from the Creator Store
- Control play-testing
- **Remember your project across sessions** — persistent project memory saved inside your place
