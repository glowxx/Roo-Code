# Roo Code

<p align="center">
  <strong>Autonomous AI Developer Platform — Standalone Desktop GUI & Interactive CLI</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/Platform-Windows%20|%20macOS%20|%20Linux-brightgreen.svg" alt="Platform">
  <img src="https://img.shields.io/badge/Node.js-20+-68a063.svg" alt="Node.js">
  <img src="https://img.shields.io/badge/AI_Models-xKiro%20|%20Claude%203.7%20|%20DeepSeek%20V3/R1%20|%20GPT--4o%20|%20Gemini%202.5-purple.svg" alt="AI Models">
</p>

---

**Roo Code** gives you an autonomous AI software engineer directly on your machine. Working directly with your local workspace, Roo Code reads file structures, executes complex coding tasks, runs terminal commands, inspects compiler and linter diagnostics, and iterates autonomously until tasks are complete.

Built as a high-performance standalone monorepo with both a native **Desktop GUI (Electron & Web)** and an interactive **Command-Line Interface (CLI)**.

---

## ⚡ Key Highlights & Features

- 🤖 **Autonomous Coding Loop**: Reads and modifies files, executes terminal commands, inspects outputs and linter errors, and self-corrects autonomously.
- ⚡ **1-Click AI Model Switcher**: Effortlessly switch models directly from the chat toolbar and top header:
  - **xKiro API**: High-speed, affordable access to **DeepSeek V3**, **DeepSeek R1 (Thinking)**, **Claude 3.7 Sonnet**, **GPT-4o**, **Gemini 2.5 Pro**, and **Qwen 2.5 Coder**.
  - **Direct Providers**: Anthropic, OpenAI, Google Gemini, DeepSeek, OpenRouter, AWS Bedrock, GCP Vertex AI.
  - **Local Privacy**: Full support for local models via **Ollama** and **LM Studio**.
- 🖥️ **Standalone Desktop GUI Application**:
  - **Agent Chat**: Conversational coding workspace with real-time token streaming, image attachments, reasoning blocks, and task queueing.
  - **1-Click Quick Launcher (`run.bat`)**: Instant Windows launcher menu for Native Desktop, Web Desktop, Development, and Installer builds.
  - **Real-Time Diffs Inspector**: Line-by-line visual diffs showing exact additions and deletions before and during agent actions.
  - **Terminal & Tool Logs**: Live output stream of all shell commands, MCP tool calls, and background processes executed by the agent.
  - **Universal Files Explorer**: Full workspace navigation with debounced search and support for all extensions — including rich syntax highlighting and interactive previews for images (`PNG`, `JPEG`, `WEBP`, `SVG`, `GIF`, `ICO`).
- 🎨 **Anti-Glare Theme Support**: Eye-friendly dark theme and soft anti-glare light theme (`#f1f3f6`), eliminating eye strain without harsh pure-white backgrounds.
- 🧩 **Streamlined Modes & Custom Personas**: Clean default **"Główny"** mode with the ability to create customized agent personas featuring 40+ Lucide icons and tailored toolsets.
- 🔌 **Model Context Protocol (MCP)**: Native integration with external MCP servers for database access, web browsing, and external developer tools.
- 🛡️ **Local & Private**: Roo Code operates directly on your local machine. API requests are routed straight to your selected provider or local engine without telemetry or code logging.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js**: `v20.0.0` or newer
- **pnpm**: `v10.0.0` or newer

### Installation

```bash
# Clone the repository
git clone https://github.com/RooCodeInc/Roo-Code.git
cd Roo-Code

# Install dependencies across all monorepo packages
pnpm install

# Build all packages (types, core, desktop, webview, and CLI)
pnpm build
```

---

## 💻 Running the Application

### Option A: Windows 1-Click Launcher (Recommended for Windows)

Simply double-click `run.bat` or run:

```cmd
run.bat
```

The interactive launcher provides 5 convenient options:
1. **[1] Native Electron Desktop Application** *(Recommended)*
2. **[2] Web Desktop** *(Runs local server on port 4500 and opens in your browser)*
3. **[3] Development Mode** *(Live reloads, hot module replacement, and verbose logging)*
4. **[4] Build Windows Installer (`.exe`)**
5. **[5] Exit**

---

### Option B: Cross-Platform NPM Commands

#### 1. Native Desktop GUI (Electron)
```bash
pnpm desktop
```

#### 2. Web Desktop GUI (Browser-accessible)
```bash
pnpm desktop:web
```

#### 3. Command-Line Interface (CLI)
```bash
# Interactive terminal session
pnpm cli

# Or run non-interactive prompt directly
roo "Refactor API routes to handle errors gracefully"

# Stream output only
roo --print "Audit package.json dependencies"
```

---

## 🤖 Supported AI Providers & Models

| Provider | Recommended Models | Description |
| :--- | :--- | :--- |
| **xKiro** | `DeepSeek V3`, `DeepSeek R1`, `Claude 3.7 Sonnet`, `GPT-4o`, `Gemini 2.5 Pro` | Cost-effective, high-throughput gateway with free starter token bonus. |
| **Anthropic** | `Claude 3.7 Sonnet`, `Claude 3.5 Sonnet`, `Claude 3.5 Haiku` | Industry-leading coding and reasoning models. |
| **OpenAI** | `GPT-4o`, `GPT-4o Mini`, `o3-mini` | Flagship OpenAI reasoning and coding architectures. |
| **Google Gemini**| `Gemini 2.5 Pro`, `Gemini 2.5 Flash`, `Gemini 2.0 Flash` | High-speed, large context window (1M+ tokens). |
| **DeepSeek** | `DeepSeek-V3`, `DeepSeek-R1` | State-of-the-art open weights coding and reasoning. |
| **OpenRouter** | 200+ models from multiple providers | Unified multi-provider aggregation layer. |
| **Ollama / LM Studio** | `Llama 3.1`, `Qwen 2.5 Coder`, `DeepSeek R1 8B` | 100% offline, local machine inference. |

---

## 🏗️ Monorepo Structure

```
Roo-Code/
├── apps/
│   ├── desktop/         # Standalone Desktop Application (Electron & Web server)
│   ├── cli/             # Interactive & Non-interactive Terminal Agent
│   └── docs/            # Documentation portal
├── packages/
│   ├── core/            # Autonomous agent engine, tools, prompts & tasks
│   ├── vscode-shim/     # Standalone runtime layer decoupling from VS Code
│   ├── types/           # Shared TypeScript contracts & provider definitions
│   ├── ipc/             # Inter-process communication bridge
│   ├── build/           # Shared build scripts & bundling utilities
│   ├── config-eslint/   # Shared ESLint configuration
│   └── config-typescript/# Shared TypeScript configuration
├── src/                 # Roo Code autonomous engine & provider implementations
├── webview-ui/          # Modern React 18 + Vite + Tailwind CSS interface
└── run.bat              # Windows 1-click launcher
```

---

## 🛡️ Security & Privacy

Roo Code executes locally on your hardware. Your API keys are stored securely on your machine, and communications occur strictly between your computer and your configured model provider endpoints. No intermediate servers track, store, or intercept your workspace code.

---

## 📜 License

[Apache 2.0](LICENSE) © Roo Code Contributors
