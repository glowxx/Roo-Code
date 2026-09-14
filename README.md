# Roo Code

> Autonomous AI Developer Platform — Standalone Desktop GUI & CLI

Roo Code gives you an autonomous AI developer directly on your machine, working seamlessly across your codebase. Built as a high-performance standalone application with both a full-featured Desktop GUI and an interactive Command-Line Interface (CLI).

---

## Key Features

- **Autonomous Agent Loop**: Reads project structure, plans execution steps, creates/edits files, runs terminal commands, analyzes compiler and linter outputs, and iterates to resolve tasks.
- **Standalone Desktop Application**:
  - **Agent Chat**: Full interactive conversational interface with model selection, prompt engineering, and checkpoint controls.
  - **Changes & Diffs Inspector**: Real-time line-by-line diff inspector highlighting additions and removals made by the agent across all modified workspace files.
  - **Terminal & Execution Stream**: Live logging of background commands and tools executed by the agent with timestamps, status badges, and logs.
  - **Workspace File Explorer**: Workspace tree navigator with integrated syntax file preview.
- **Interactive CLI**: Run the agent directly in your terminal, with rich TUI formatting or non-interactive stream output (`--print`).
- **Versatile Modes**: Code, Architect, Ask, Debug, and Custom Modes with tailored system prompts and tool access.
- **Model Context Protocol (MCP)**: Native support for external MCP servers (databases, browser automation, developer tools).
- **Multi-Model Provider Support**: Anthropic (Claude 3.5 Sonnet, Claude Opus), OpenAI (GPT-4o, o1, o3), Google Gemini, DeepSeek, OpenRouter, AWS Bedrock, GCP Vertex AI, and local LLMs (Ollama, LM Studio).

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 10+

### Installation & Build

```bash
# Install dependencies across all packages
pnpm install

# Build the complete platform (core engine, desktop app, webview, and CLI)
pnpm build
```

---

## Running Roo Code

### 1. Desktop GUI Application

Launch the desktop GUI in your current workspace:

```bash
# Launch native Electron desktop window
pnpm desktop

# Or launch as Web Desktop (accessible via browser)
pnpm desktop:web
```

Or using the CLI tool:

```bash
# Open desktop in a specific workspace
roo desktop --workspace /path/to/project

# Launch web desktop mode
roo desktop --web --port 4500
```

### 2. Command-Line Interface (CLI)

```bash
# Start an interactive CLI session
pnpm cli

# Or run directly if linked
roo "Refactor database migrations to add a users index"

# Non-interactive / print mode
roo --print "Analyze package.json and list outdated dependencies"
```

---

## Monorepo Architecture

```
├── apps/
│   ├── desktop/         # Standalone Desktop Application (Electron + Web GUI Server)
│   ├── cli/             # Interactive & Non-interactive Terminal Agent
│   └── docs/            # Documentation website
├── packages/
│   ├── core/            # Core agent logic, LLM providers, tool execution
│   ├── vscode-shim/     # Standalone runtime layer for engine decoupling
│   ├── types/           # Shared TypeScript definitions & contracts
│   ├── ipc/             # Inter-process communication library
│   ├── build/           # Build and bundling utilities
│   ├── config-eslint/   # Shared ESLint configuration
│   └── config-typescript/# Shared TypeScript configuration
├── src/                 # Roo Code autonomous engine & provider core
└── webview-ui/          # Modern React 18 + Vite + Tailwind UI
```

---

## Security & Privacy

Roo Code runs locally on your machine. API calls are sent directly from your environment to your chosen model providers (Anthropic, OpenAI, Google, etc.) or local inference engines (Ollama). No telemetry or code is sent to proprietary intermediate servers.

---

## License

Apache 2.0 © Roo Code Contributors
