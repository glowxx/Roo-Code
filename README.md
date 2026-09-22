[English] | [Polski (Polish Version)](README.pl.md)

# Roo Code Desktop

<p align="center">
  <strong>Autonomous AI Developer in an Independent Native Desktop Environment</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11%20x64%20(Standalone)-0078D6.svg?logo=windows&logoColor=white" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-Desktop-47848F.svg?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D%2020-68a063.svg?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/pnpm-%3E%3D%209-orange.svg?logo=pnpm&logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript">
</p>

---

## 🌟 Overview

**Roo Code Desktop** is an autonomous, standalone desktop application for software engineers on Windows. Engineered with **Electron** and powered by `@roo-code/vscode-shim`, Roo Code Desktop runs completely independently **without requiring VS Code or any external IDE host**.

Roo Code Desktop operates directly on your local workspace: it analyzes repository architecture, plans and implements multi-file changes, executes terminal commands under autonomous safety supervision, inspects diffs, diagnoses compiler and linter errors, and collaborates with cutting-edge reasoning models—all from a single, high-performance desktop interface.

---

## ⚡ Key Architectural Highlights

### 1. 🛡️ Autonomous AI Command Safety Guardrail
- **Pre-execution Verification via Audit Model**: Before any terminal command executes, it passes through an intelligent safety evaluation engine powered by a dedicated audit model.
- **Fail-Closed Architecture**: Security is designed with defensive default behavior. If an evaluation times out, hits a network glitch, or encounters malformed output, the system fails closed—automatically blocking unattended execution and requiring explicit manual user confirmation.
- **Deterministic Local Fast-Path**: Routine and non-destructive operations (such as `git diff`, `git status`, `ls`, `dir`, `echo`, `cat`, `node`, `pnpm test`, `jest`) bypass the audit model via zero-latency regex matching, keeping interactive agent workflows fast and responsive.
- **Transparent Risk Classification**: Commands evaluated by the safety judge receive a structured risk level (`safe`, `low`, `medium`, `high`, `critical`) along with an plain-text explanation of potential risks (e.g. irreversible deletions, remote script execution, or privilege escalation).

### 2. 🧠 Dynamic Context Window & Precision Metrics
- **200k – 1M+ Token Support**: Dynamic context resolution supports next-generation large-context models, including `gpt-6-astra` via xKiro (1M tokens), Google Gemini 1.5/2.0/2.5 Pro (1M–2M tokens), OpenAI o-series / GPT-5 (200k tokens), and Claude 3.7 Sonnet (200k tokens).
- **Elimination of Rigid Fallbacks**: Eradicates legacy hardcoded 128k fallbacks. Context limits are dynamically queried from live provider endpoints and inferred through robust model identifier patterns.
- **Persistent Metadata Across Cold Starts**: Model capabilities, context limits, and token budgets are cached in local persistent storage, eliminating latency and preventing metric mismatches after application restarts.
- **Precision Token Accounting**: Accurate real-time tracking of input tokens, cache read/write tokens, output tokens, and financial cost estimations throughout long-running tasks.

### 3. 🎛️ Interactive Reasoning Effort Control
- **Dedicated Toolbar Control**: A dedicated thinking effort selector is integrated directly into the chat toolbar, providing immediate access without digging through complex settings menus.
- **Granular Effort Tiers**: Seamlessly switch between `none`, `minimal`, `low`, `medium`, `high`, and `xhigh` effort levels to balance deep chain-of-thought analysis against response speed and token costs.
- **Automatic Clamping & Provider Fallback**: If a selected model or provider only supports a subset of reasoning budgets, the runtime automatically clamps the request to valid parameters. If the active model lacks reasoning support altogether, the system cleanly bypasses reasoning flags without generating API errors.

### 4. 🖥️ Independent Desktop Shell
- **Zero VS Code Runtime Overhead**: Completely decoupled from VS Code's extension host and process tree, running as a lean, self-contained desktop application.
- **Integrated Project Workspace Switcher**: Switch between active project repositories effortlessly. Switching projects automatically resets agent state, clears active terminals, terminates orphaned background child processes, and restarts MCP servers.
- **In-Tab Modal Settings & Optimized Tabs**: Settings and configuration panels open directly within tabbed modal overlays, preserving your active conversation context.
- **Performance-Tuned Interface**: Features virtualized message lists (Virtuoso), streaming token rendering without cascading re-renders, and a robust `CrashBoundary` protection layer preventing whiteout or blank screen states.

---

## 🏗️ Monorepo Architecture Overview

The codebase is organized as a clean, modular pnpm monorepo:

```
Roo-Code/
├── apps/
│   └── desktop/             # Electron shell, native windows, IPC bridges, and NSIS packaging scripts
├── packages/
│   ├── types/               # Shared TypeScript types, model configuration schemas, and Zod validators
│   └── vscode-shim/         # Standalone VS Code API emulation layer (workspace, SecretStorage, terminal)
├── src/                     # Core agent engine, task execution loop, API providers, and Command Safety Judge
├── webview-ui/              # User interface built with React 18, Vite, and Tailwind CSS
├── run.bat                  # Interactive Windows development and application launcher
└── build_win_installer.bat  # Automated script for building Windows NSIS installer packages
```

- **`apps/desktop/`**: Manages the Electron main process, preload security contexts, native window lifecycles, and desktop-specific IPC communications.
- **`src/`**: Houses the agentic core—task planning, prompt generation, tool execution engines (file read/write, bash execution, browser automation), provider gateways, and the Command Safety Judge.
- **`webview-ui/`**: The modern React front-end, handling chat interactions, diff inspection, MCP management, file exploration, and visual theme systems.
- **`packages/types/`**: Single source of truth for interfaces, shared schemas, provider configurations, and runtime validators.
- **`packages/vscode-shim/`**: Re-implements VS Code's extension host APIs natively in Node.js, allowing the core engine to operate seamlessly outside VS Code.

---

## 🚀 Quick Start & Installation

### Option 1: Standalone Windows Installer

1. Locate or download the latest standalone Windows installer:
   ```
   release/Roo Code Setup 1.0.0.exe
   ```
   *(or `apps/desktop/release/Roo-Code-Setup-*.exe`)*
2. Run the installer. It will set up Roo Code Desktop, configure file associations, and create Desktop and Start Menu shortcuts.
3. Launch **Roo Code** and begin coding.

---

### Option 2: Build from Source

#### Prerequisites
- **Operating System**: Windows 10 / Windows 11 x64
- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0`
- **Git**

#### 1. Clone and Install Dependencies
```powershell
# Clone the repository
git clone https://github.com/RooCodeInc/Roo-Code.git
cd Roo-Code

# Install monorepo dependencies
pnpm install
```

#### 2. Build Core Packages
```powershell
# Build internal packages (@roo-code/build, @roo-code/types, @roo-code/vscode-shim, webview-ui)
pnpm build
```

#### 3. Run in Development Mode
The easiest way to launch on Windows is using the interactive batch launcher:
```cmd
run.bat
```
Select from the menu:
- **`[1] Native Electron Desktop Application (Recommended)`** — Builds and launches the native Electron desktop application.
- **`[3] Development Mode`** — Launches with live reloads, hot module replacement, and verbose console output.

Or launch directly from your terminal:
```powershell
pnpm desktop
```

#### 4. Compile Windows Installer
To build a production-ready NSIS standalone executable:
```cmd
build_win_installer.bat
```
*(or choose option `[4]` in `run.bat`)*

The generated installer will be located in:
```
release/Roo Code Setup 1.0.0.exe
apps/desktop/release/Roo-Code-Setup-*.exe
```

---

## ⚙️ Configuration & Providers

Roo Code Desktop supports all leading commercial, open-source, and local AI providers:

| Provider | Supported Models & Capabilities | Context Window |
| :--- | :--- | :--- |
| **xKiro** | `gpt-6-astra`, `claude-3-7-sonnet`, `deepseek-v3`, `deepseek-r1`, `gpt-4o`, `gemini-2.5-pro` (Dynamic `/models` discovery & auto-promotion) | Up to **1,000,000+** tokens |
| **OpenAI** | `gpt-5`, `gpt-4o`, `o1`, `o3-mini`, `gpt-4o-mini` with configurable reasoning effort & verbosity | Up to **200,000** tokens |
| **Anthropic** | `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-5-haiku`, `claude-3-opus` with Extended Thinking & Prompt Caching | **200,000** tokens |
| **OpenRouter** | Broad ecosystem of proprietary and open-source models with reasoning effort routing and live cost metrics | Model-dependent |
| **Local / Offline** | **Ollama** & **LM Studio** for private, offline local LLM workflows without external API calls | Hardware-dependent |

### Setting Up API Keys
1. Open Roo Code Desktop.
2. Click the **Settings** icon (gear) in the bottom-left or top-right toolbar.
3. Select your desired provider from the **API Provider** dropdown.
4. Paste your API key and configure model-specific preferences (such as reasoning effort or custom base URLs).
5. Click **Save** to persist your encrypted credentials into local storage.

---

## 📜 License & Community

- **License**: Distributed under the Apache 2.0 License. See [LICENSE](LICENSE) for full legal text.
- **Contributing**: We welcome community contributions! Please review our [CONTRIBUTING.md](CONTRIBUTING.md) guide before submitting pull requests.
- **Security Policy**: To report security vulnerabilities responsibly, please review [SECURITY.md](SECURITY.md).
