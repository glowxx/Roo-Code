# Security Policy

At Roo Code, security is a foundational requirement. Because Roo Code orchestrates autonomous AI workflows that interact with the host operating system, filesystem, developer tools, and external AI model APIs, our security model is engineered with strict defense-in-depth principles.

---

## Supported Versions

We actively provide security patches and updates for the following versions:

| Version       | Release Target                       | Supported              | Security Patch Policy                                           |
| :------------ | :----------------------------------- | :--------------------- | :-------------------------------------------------------------- |
| **`3.3.x`**   | Desktop / Extension (Current)        | :white_check_mark: Yes | Actively supported with all security fixes and feature patches. |
| **`3.2.x`**   | Desktop / Extension (Previous Minor) | :white_check_mark: Yes | Critical security vulnerability patches only.                   |
| **`< 3.2.0`** | Legacy Releases                      | :x: No                 | Unsupported. Please upgrade to the latest release.              |

---

## Core Security Architecture & Guardrails

Roo Code enforces automated, deterministic guardrails to prevent unintended host modification, credential leakage, or malicious prompt exploitation.

### 1. Autonomous AI Command Safety Guardrail

When an AI agent requests terminal command execution, Roo Code applies a multi-layered, fail-closed verification pipeline before any process is spawned:

- **Fail-Closed Architecture:** Security checks evaluate deterministically. If path resolution fails, command parsing is ambiguous, or an error occurs during policy validation, the request defaults to an immediate denial (`fail-closed`). An unverified command is never permitted to execute.
- **Terminal Command Auditing Model:** Every command undergoes static tokenization and semantic analysis. Commands that inspect or manipulate files (such as `cat`, `less`, `more`, `head`, `tail`, `grep`, `type`, `Get-Content`, `Select-String`, PowerShell streams, or shell redirections like `>`, `>>`, `<`) are dynamically audited against access control policies and `.rooignore` rules before invocation.
- **Local Fast-Path Validation:** Guardrails are validated locally in-process without relying on external network round-trips. Malicious or forbidden commands are halted at the boundary before any terminal subprocess is created.
- **Explicit User Approvals & Execution Timeouts:** Unless explicitly configured by the user for trusted autonomy, terminal commands require human-in-the-loop approval. Roo Code also enforces configurable command timeouts and allowlists to prevent runaway commands or indefinite hangs.

### 2. Zero API Key Leakage & Credential Safety

Protecting sensitive credentials, API keys, and environment variables is paramount:

- **Atomic `SecretStorage` with `.bak` Redundancy:** Secrets are stored through an atomic write protocol (`.tmp.<timestamp>` staging followed by atomic filesystem rename). Before any modification, the current validated, non-empty secret state is preserved in a `.bak` backup file, ensuring resilience against power failure, sudden termination, or filesystem corruption. Restrictive file permissions (`0600` on POSIX systems) ensure only the host user can access stored secrets.
- **In-Memory Isolation:** API keys, tokens, and sensitive credentials reside in memory within the privileged backend/extension host process. They are never transmitted to the frontend webview UI layer, DOM, or browser contexts.
- **Strict `.rooignore` Protection:** Roo Code enforces `.rooignore` patterns (using standard `.gitignore` syntax) across all AI tools (`read_file`, `write_to_file`, `search_replace`, `execute_command`, `apply_diff`, codebase indexing). Sensitive files—such as `.env`, private keys (`id_rsa`, `id_ed25519`), certificates (`.pem`, `.pfx`), token stores, and credentials databases—are blocked from being read, edited, or included in LLM context prompts. Filesystem symlinks are resolved using `realpath` to prevent symlink traversal escapes.
- **Sanitized Logging & Diagnostics:** Diagnostic logs (including `startup-debug.log`, runtime logs, and console traces) automatically redact API keys, Bearer tokens, authorization headers, and confidential state before persisting to disk or terminal output.

---

## Reporting a Vulnerability

We value the security community and appreciate responsible disclosure. If you discover a vulnerability or security issue in Roo Code, please report it immediately:

- **Email:** [security@roocode.com](mailto:security@roocode.com)
- **Encryption:** If you need to send sensitive material, please request our PGP public key via email.

### What to Include in Your Report

To help us triage and resolve the issue quickly, please provide:

1. A clear description of the vulnerability and its potential impact.
2. Step-by-step instructions to reproduce the issue or a minimal Proof of Concept (PoC).
3. Affected components (e.g., Desktop app, VS Code extension, CLI, specific package).
4. Operating system, architecture, and Roo Code version.
5. Relevant (sanitized) logs, stack traces, or terminal outputs.

### Response SLA & Disclosure Timeline

- **Initial Acknowledgement:** Within **48 hours** of receiving your report.
- **Triage & Assessment:** Within **7 business days**, confirming severity and scope.
- **Resolution & Mitigation:** We aim to release a patch or mitigation within **30 days** of triage confirmation.
- **Responsible Disclosure:** We ask that you maintain confidentiality and allow our team reasonable time to remediate the vulnerability before publicly disclosing details. We will gladly credit security researchers in our release notes and advisories upon resolution.

Thank you for helping keep Roo Code and our user community safe!
