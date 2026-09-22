# Contributing to Roo Code Desktop

Thank you for your interest in contributing to **Roo Code Desktop**! We welcome community contributions, bug reports, feature requests, and code improvements.

---

## 🛠️ Development Setup

### Prerequisites

- **Operating System**: Windows 10/11 x64 (macOS and Linux also supported for core packages)
- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0`
- **Git**

### Getting Started

1. **Fork and clone the repository:**

   ```bash
   git clone https://github.com/RooCodeInc/Roo-Code.git
   cd Roo-Code
   ```

2. **Install all monorepo dependencies:**

   ```bash
   pnpm install
   ```

3. **Build foundational packages:**

   ```bash
   pnpm build
   ```

4. **Launch the desktop application:**
   - **On Windows**: Run `run.bat` and select `[1]` (or `[3]` for Development Mode with live reloads).
   - **Via pnpm**: `pnpm desktop` (or `pnpm desktop:web` for browser dev).

---

## 🏗️ Project Architecture

Roo Code is structured as a pnpm monorepo:

- **`apps/desktop/`**: Electron application (main process, preload scripts, native windows, IPC bridges, NSIS installer configuration).
- **`src/`**: Core agent engine, task execution loop, API providers, tool execution system, and Command Safety Judge.
- **`webview-ui/`**: Webview interface built with React 18, Vite, and Tailwind CSS.
- **`packages/types/`**: Shared TypeScript definitions, model configuration schemas, and Zod validators.
- **`packages/vscode-shim/`**: Standalone VS Code API emulation layer allowing the core engine to operate outside VS Code.

---

## 🧪 Testing & Quality Checks

Before submitting changes, ensure that all tests, type checks, and lint rules pass:

```bash
# Type check all packages in monorepo
pnpm turbo check-types

# Run unit tests across packages
pnpm test

# Run linting checks
pnpm lint

# Run code formatting
pnpm format
```

### Architectural Guidelines

- **Settings View Pattern**: When working on `SettingsView`, inputs must bind to the local `cachedState`, NOT the live `useExtensionState()`. The `cachedState` acts as a buffer for user edits, isolating them from the `ContextProxy` source-of-truth until the user explicitly clicks "Save". Wiring inputs directly to the live state causes race conditions.
- **File System & Shell Security**: Ensure all file operations respect `.rooignore` and all terminal commands are routed through the fail-closed Command Safety Guardrail.

---

## 📝 Commit Message Guidelines (Conventional Commits)

We enforce the [Conventional Commits](https://www.conventionalcommits.org/) specification for atomic, structured git history:

```
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

### Allowed Types:
- `feat`: A new user-facing feature or enhancement.
- `fix`: A bug fix.
- `docs`: Documentation-only changes (README, guides, comments).
- `refactor`: A code change that neither fixes a bug nor adds a feature.
- `perf`: A code change that improves performance.
- `test`: Adding missing tests or correcting existing tests.
- `chore`: Changes to build process, dependency updates, or tooling.

### Examples:
- `feat(desktop): add reasoning effort control to chat toolbar`
- `fix(security): resolve command safety guardrail bypass on windows paths`
- `docs: update main readme to english and add contributing guide`

---

## 🚀 Submitting a Pull Request

1. **Branch Naming**:
   - `feature/your-feature-name`
   - `fix/issue-description`
   - `docs/doc-update-name`
2. **Atomic Commits**: Keep commits focused and logically grouped.
3. **PR Description**: Detail the problem solved, proposed solution, and include before/after screenshots or terminal logs for UI/behavioral changes.
4. **Link Issues**: Reference related issues using GitHub keywords (e.g., `Fixes #123`).

---

## 🔒 Security Vulnerabilities

If you discover a security vulnerability, please do **NOT** file a public issue. Instead, follow the responsible disclosure process outlined in [SECURITY.md](SECURITY.md) or email `security@roocode.com`.

---

## 📜 License

By contributing to Roo Code, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
