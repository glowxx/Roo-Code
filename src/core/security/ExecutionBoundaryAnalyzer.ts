import os from "os"
import type {
	DockerMountInfo,
	ExecutionBoundary,
	ExecutionDomain,
	ExecutionTarget,
	HostImpactAssessment,
	HostImpactRisk,
} from "@roo-code/types"

/**
 * Shell token representation with raw text, unquoted/unescaped value, and quote type.
 */
export interface ShellToken {
	value: string
	raw: string
	quoteType: "none" | "single" | "double"
}

/**
 * Tokenizer capable of parsing POSIX and Windows command strings,
 * respecting nested single/double quotes and backslash escaping.
 */
export class ShellTokenizer {
	public static tokenize(cmd: string): ShellToken[] {
		const tokens: ShellToken[] = []
		let current = ""
		let currentRaw = ""
		let inQuote: "none" | "single" | "double" = "none"
		let tokenQuoteType: "none" | "single" | "double" = "none"
		let escape = false

		for (let idx = 0; idx < cmd.length; idx++) {
			const char = cmd[idx]

			if (escape) {
				current += char
				currentRaw += "\\" + char
				escape = false
				continue
			}

			if (char === "\\") {
				if (inQuote === "single") {
					current += char
					currentRaw += char
				} else {
					escape = true
				}
				continue
			}

			if (inQuote === "none") {
				if (char === "'" || char === '"') {
					inQuote = char === "'" ? "single" : "double"
					if (tokenQuoteType === "none") {
						tokenQuoteType = inQuote
					}
					currentRaw += char
				} else if (/\s/.test(char)) {
					if (currentRaw.length > 0) {
						tokens.push({ value: current, raw: currentRaw, quoteType: tokenQuoteType })
						current = ""
						currentRaw = ""
						tokenQuoteType = "none"
					}
				} else {
					current += char
					currentRaw += char
				}
			} else if (inQuote === "single") {
				if (char === "'") {
					inQuote = "none"
					currentRaw += char
				} else {
					current += char
					currentRaw += char
				}
			} else if (inQuote === "double") {
				if (char === '"') {
					inQuote = "none"
					currentRaw += char
				} else {
					current += char
					currentRaw += char
				}
			}
		}

		if (currentRaw.length > 0) {
			tokens.push({ value: current, raw: currentRaw, quoteType: tokenQuoteType })
		}

		return tokens
	}
}

export interface ExecutionLayer {
	domain: ExecutionDomain
	wrapperCommand: string
	rawTokens: string[]
	targetEntity?: string
	user?: string
	workdir?: string
	isPrivileged?: boolean
	hostNamespaceSharing?: {
		pid?: boolean
		network?: boolean
	}
	bindMounts?: DockerMountInfo[]
	outerRedirections?: string[]
	wslDetails?: {
		distroName?: string
		invokesWindowsBinary: boolean
		accessedHostDrives: string[]
	}
	sshDetails?: {
		remoteHost?: string
		remoteUser?: string
		hostOrUser?: string
		hasReversePortForward: boolean
		hasAgentForwarding: boolean
		hasLocalCommand: boolean
		isLoopbackOrLocal: boolean
	}
}

export interface ExecutionChain {
	rawCommand: string
	layers: ExecutionLayer[]
	leafCommand: string
	leafTokens: string[]
}

export interface TestEnvClassificationContext {
	targetName?: string
	userInstruction?: string
	taskGoal?: string
	workspacePath?: string
}

/**
 * Decomposes command lines into execution boundaries (WSL, Docker, SSH, Subshells)
 * and detects host-escape and host-impact vectors.
 */
export class ExecutionBoundaryAnalyzer {
	/**
	 * Decomposes a wrapped command into an ExecutionChain representing layers of execution.
	 */
	public static decomposeCommand(command: string): ExecutionChain {
		const layers: ExecutionLayer[] = []
		let currentTokens = ShellTokenizer.tokenize(command.trim())
		let currentRaw = command.trim()

		while (currentTokens.length > 0) {
			const unwrapped = this.tryUnwrapLayer(currentTokens, currentRaw)
			if (!unwrapped) {
				break
			}

			layers.push(unwrapped.layer)
			currentTokens = unwrapped.nextTokens
			currentRaw = unwrapped.nextRaw
		}

		return {
			rawCommand: command,
			layers,
			leafCommand: currentRaw,
			leafTokens: currentTokens.map((t) => t.value),
		}
	}

	/**
	 * Builds a full ExecutionBoundary object ready for safety evaluation.
	 */
	public static analyze(
		command: string,
		context?: TestEnvClassificationContext
	): ExecutionBoundary {
		const chain = this.decomposeCommand(command)
		const hostImpact = HostImpactDetector.evaluateHostImpact(chain)

		let target: ExecutionTarget = {
			type: "local",
			classification: "development",
		}

		let outerCommand: string | undefined

		if (chain.layers.length > 0) {
			outerCommand = chain.layers.map((l) => l.wrapperCommand).join(" -> ")
			const primaryLayer = chain.layers[0]

			if (primaryLayer.domain === "wsl") {
				const distroName = primaryLayer.targetEntity || "default"
				target = {
					type: "wsl",
					name: distroName,
					classification: this.classifyEnvironment(distroName, context),
				}
			} else if (
				primaryLayer.domain === "docker_exec" ||
				primaryLayer.domain === "docker_run" ||
				primaryLayer.domain === "compose_exec"
			) {
				const containerOrImage = primaryLayer.targetEntity || "container"
				target = {
					type: "docker",
					name: containerOrImage,
					classification: this.classifyEnvironment(containerOrImage, context),
				}
			} else if (primaryLayer.domain === "ssh") {
				const hostOrUser = primaryLayer.targetEntity || "remote"
				target = {
					type: "ssh",
					name: hostOrUser,
					classification: this.classifyEnvironment(hostOrUser, context),
				}
			}
		}

		return {
			host: {
				os: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
				shell: process.env.SHELL || (process.platform === "win32" ? "powershell" : "bash"),
			},
			target,
			outerCommand,
			innerCommand: chain.leafCommand,
			hostImpact,
		}
	}

	/**
	 * Classifies an environment using task context, instructions, and name.
	 */
	public static classifyEnvironment(
		envName: string,
		context?: TestEnvClassificationContext
	): ExecutionTarget["classification"] {
		if (!envName) return "unknown"
		const clean = envName.toLowerCase().trim()

		// Disqualification: explicit production keywords
		if (
			(clean.includes("prod") || clean.includes("production") || clean.includes("live") || clean.includes("master")) &&
			!clean.includes("test")
		) {
			return "production"
		}

		const combinedTaskText = `${context?.userInstruction || ""} ${context?.taskGoal || ""}`.toLowerCase()

		// Verified test environment if mentioned in task instruction/goal
		if (combinedTaskText.includes(clean)) {
			return "test-environment"
		}

		// Also check standard test naming conventions
		if (clean.includes("test") || clean.includes("sandbox") || clean.includes("qa") || clean.includes("staging")) {
			return "test-environment"
		}

		return "development"
	}

	private static tryUnwrapLayer(
		tokens: ShellToken[],
		rawCommand: string
	): { layer: ExecutionLayer; nextTokens: ShellToken[]; nextRaw: string } | null {
		if (tokens.length === 0) return null

		const firstWord = tokens[0].value.toLowerCase().replace(/\\/g, "/")
		const baseName = firstWord.split("/").pop() || ""

		// 1. WSL Wrapper
		if (baseName === "wsl" || baseName === "wsl.exe") {
			return this.unwrapWsl(tokens, rawCommand)
		}

		// 2. Docker Wrapper
		if (baseName === "docker" || baseName === "docker.exe") {
			return this.unwrapDocker(tokens, rawCommand)
		}
		if (baseName === "docker-compose" || baseName === "docker-compose.exe") {
			return this.unwrapDockerCompose(tokens, rawCommand, 1)
		}

		// 3. SSH Wrapper
		if (baseName === "ssh" || baseName === "ssh.exe") {
			return this.unwrapSsh(tokens, rawCommand)
		}

		// 4. PowerShell Wrapper
		if (
			baseName === "powershell" ||
			baseName === "powershell.exe" ||
			baseName === "pwsh" ||
			baseName === "pwsh.exe"
		) {
			return this.unwrapPowerShell(tokens, rawCommand)
		}

		// 5. CMD Wrapper
		if (baseName === "cmd" || baseName === "cmd.exe") {
			return this.unwrapCmd(tokens, rawCommand)
		}

		// 6. POSIX Shell Wrapper (bash, sh, zsh)
		if (["bash", "sh", "zsh", "dash"].includes(baseName)) {
			return this.unwrapShell(tokens, rawCommand)
		}

		return null
	}

	// --- WSL Unwrapper ---
	private static unwrapWsl(
		tokens: ShellToken[],
		rawCommand: string
	): { layer: ExecutionLayer; nextTokens: ShellToken[]; nextRaw: string } | null {
		let distro: string | undefined
		let user: string | undefined
		let workdir: string | undefined
		let i = 1

		while (i < tokens.length) {
			const val = tokens[i].value
			if (val === "--") {
				i++
				break
			}
			if (val === "-d" || val === "--distribution") {
				distro = tokens[i + 1]?.value
				i += 2
			} else if (val === "-u" || val === "--user") {
				user = tokens[i + 1]?.value
				i += 2
			} else if (val === "--cd") {
				workdir = tokens[i + 1]?.value
				i += 2
			} else if (val === "--unregister") {
				distro = tokens[i + 1]?.value
				i += 2
				break
			} else if (val.startsWith("-")) {
				i++
			} else {
				break
			}
		}

		const nextTokens = tokens.slice(i)
		const nextRaw = nextTokens.map((t) => (t.quoteType !== "none" ? t.value : t.raw)).join(" ")

		const layer: ExecutionLayer = {
			domain: "wsl",
			wrapperCommand: tokens.slice(0, i).map((t) => t.raw).join(" "),
			rawTokens: tokens.slice(0, i).map((t) => t.raw),
			targetEntity: distro || "default",
			user,
			workdir,
			outerRedirections: this.extractRedirections(tokens.slice(0, i)),
			wslDetails: {
				distroName: distro,
				invokesWindowsBinary: false,
				accessedHostDrives: [],
			},
		}

		return { layer, nextTokens, nextRaw }
	}

	// --- Docker Unwrapper ---
	private static unwrapDocker(
		tokens: ShellToken[],
		rawCommand: string
	): { layer: ExecutionLayer; nextTokens: ShellToken[]; nextRaw: string } | null {
		if (tokens.length < 2) return null
		const sub = tokens[1].value.toLowerCase()

		if (sub === "compose") {
			return this.unwrapDockerCompose(tokens, rawCommand, 2)
		}

		if (sub === "exec") {
			return this.unwrapDockerExec(tokens, rawCommand)
		}

		if (sub === "run") {
			return this.unwrapDockerRun(tokens, rawCommand)
		}

		return null
	}

	private static unwrapDockerExec(
		tokens: ShellToken[],
		rawCommand: string
	): { layer: ExecutionLayer; nextTokens: ShellToken[]; nextRaw: string } | null {
		let container: string | undefined
		let user: string | undefined
		let workdir: string | undefined
		let isPrivileged = false
		let i = 2

		while (i < tokens.length) {
			const val = tokens[i].value
			if (val === "-u" || val === "--user") {
				user = tokens[i + 1]?.value
				i += 2
			} else if (val === "-w" || val === "--workdir") {
				workdir = tokens[i + 1]?.value
				i += 2
			} else if (val === "--privileged") {
				isPrivileged = true
				i++
			} else if (val === "-i" || val === "-t" || val === "-it" || val === "-d") {
				i++
			} else if (val.startsWith("-e")) {
				i += val === "-e" ? 2 : 1
			} else if (val.startsWith("-")) {
				i++
			} else {
				container = val
				i++
				break
			}
		}

		if (!container || i >= tokens.length) return null

		const nextTokens = tokens.slice(i)
		const nextRaw = nextTokens.map((t) => t.raw).join(" ")

		const layer: ExecutionLayer = {
			domain: "docker_exec",
			wrapperCommand: tokens.slice(0, i).map((t) => t.raw).join(" "),
			rawTokens: tokens.slice(0, i).map((t) => t.raw),
			targetEntity: container,
			user,
			workdir,
			isPrivileged,
			outerRedirections: this.extractRedirections(tokens.slice(0, i)),
		}

		return { layer, nextTokens, nextRaw }
	}

	private static unwrapDockerRun(
		tokens: ShellToken[],
		rawCommand: string
	): { layer: ExecutionLayer; nextTokens: ShellToken[]; nextRaw: string } | null {
		let image: string | undefined
		let isPrivileged = false
		const bindMounts: DockerMountInfo[] = []
		const hostNamespaceSharing = { pid: false, net: false, ipc: false }
		let i = 2

		while (i < tokens.length) {
			const val = tokens[i].value
			if (val === "--privileged") {
				isPrivileged = true
				i++
			} else if (val === "-v" || val === "--volume") {
				const mountArg = tokens[i + 1]?.value || ""
				bindMounts.push(this.parseDockerMount(mountArg))
				i += 2
			} else if (val.startsWith("--mount=")) {
				bindMounts.push(this.parseMountFlag(val))
				i++
			} else if (val === "--mount") {
				bindMounts.push(this.parseMountFlag(tokens[i + 1]?.value || ""))
				i += 2
			} else if (val === "--pid=host" || (val === "--pid" && tokens[i + 1]?.value === "host")) {
				hostNamespaceSharing.pid = true
				i += val === "--pid" ? 2 : 1
			} else if (
				val === "--net=host" ||
				val === "--network=host" ||
				(val === "--net" && tokens[i + 1]?.value === "host")
			) {
				hostNamespaceSharing.net = true
				i += val === "--net" ? 2 : 1
			} else if (val === "--ipc=host" || (val === "--ipc" && tokens[i + 1]?.value === "host")) {
				hostNamespaceSharing.ipc = true
				i += val === "--ipc" ? 2 : 1
			} else if (val.startsWith("-")) {
				if (["-u", "-w", "-e", "--name", "--entrypoint"].includes(val)) {
					i += 2
				} else {
					i++
				}
			} else {
				image = val
				i++
				break
			}
		}

		if (!image || i >= tokens.length) return null

		const nextTokens = tokens.slice(i)
		const nextRaw = nextTokens.map((t) => t.raw).join(" ")

		const layer: ExecutionLayer = {
			domain: "docker_run",
			wrapperCommand: tokens.slice(0, i).map((t) => t.raw).join(" "),
			rawTokens: tokens.slice(0, i).map((t) => t.raw),
			targetEntity: image,
			isPrivileged,
			bindMounts,
			hostNamespaceSharing,
			outerRedirections: this.extractRedirections(tokens.slice(0, i)),
		}

		return { layer, nextTokens, nextRaw }
	}

	private static unwrapDockerCompose(
		tokens: ShellToken[],
		rawCommand: string,
		subOffset: number
	): { layer: ExecutionLayer; nextTokens: ShellToken[]; nextRaw: string } | null {
		if (tokens[subOffset]?.value.toLowerCase() !== "exec") return null
		let service: string | undefined
		let isPrivileged = false
		let i = subOffset + 1

		while (i < tokens.length) {
			const val = tokens[i].value
			if (val === "--privileged") {
				isPrivileged = true
				i++
			} else if (val.startsWith("-")) {
				if (["-u", "-w", "-e", "--index"].includes(val)) {
					i += 2
				} else {
					i++
				}
			} else {
				service = val
				i++
				break
			}
		}

		if (!service || i >= tokens.length) return null

		const nextTokens = tokens.slice(i)
		const nextRaw = nextTokens.map((t) => t.raw).join(" ")

		const layer: ExecutionLayer = {
			domain: "compose_exec",
			wrapperCommand: tokens.slice(0, i).map((t) => t.raw).join(" "),
			rawTokens: tokens.slice(0, i).map((t) => t.raw),
			targetEntity: service,
			isPrivileged,
			outerRedirections: this.extractRedirections(tokens.slice(0, i)),
		}

		return { layer, nextTokens, nextRaw }
	}

	// --- SSH Unwrapper ---
	private static unwrapSsh(
		tokens: ShellToken[],
		rawCommand: string
	): { layer: ExecutionLayer; nextTokens: ShellToken[]; nextRaw: string } | null {
		let targetHost: string | undefined
		let remoteUser: string | undefined
		let hasReversePortForward = false
		let hasAgentForwarding = false
		let hasLocalCommand = false
		let i = 1

		while (i < tokens.length) {
			const val = tokens[i].value
			if (val === "-A") {
				hasAgentForwarding = true
				i++
			} else if (val === "-R") {
				hasReversePortForward = true
				i += 2
			} else if (val === "-o") {
				const opt = tokens[i + 1]?.value.toLowerCase() || ""
				if (opt.includes("localcommand") || opt.includes("proxycommand")) {
					hasLocalCommand = true
				}
				i += 2
			} else if (["-p", "-i", "-l", "-c", "-F", "-b", "-J", "-L", "-D"].includes(val)) {
				if (val === "-l") remoteUser = tokens[i + 1]?.value
				i += 2
			} else if (val.startsWith("-")) {
				i++
			} else {
				targetHost = val
				i++
				break
			}
		}

		if (!targetHost) return null

		if (targetHost.includes("@") && !remoteUser) {
			const parts = targetHost.split("@")
			remoteUser = parts[0]
			targetHost = parts[1]
		}

		const isLoopbackOrLocal = ["localhost", "127.0.0.1", "::1"].includes(targetHost)

		const nextTokens = tokens.slice(i)
		const nextRaw =
			nextTokens.length === 1 && nextTokens[0].quoteType !== "none"
				? nextTokens[0].value
				: nextTokens.map((t) => (t.quoteType !== "none" ? t.value : t.raw)).join(" ")

		const layer: ExecutionLayer = {
			domain: "ssh",
			wrapperCommand: tokens.slice(0, i).map((t) => t.raw).join(" "),
			rawTokens: tokens.slice(0, i).map((t) => t.raw),
			targetEntity: `${remoteUser ? remoteUser + "@" : ""}${targetHost}`,
			outerRedirections: this.extractRedirections(tokens.slice(0, i)),
			sshDetails: {
				remoteHost: targetHost,
				remoteUser,
				isLoopbackOrLocal,
				hasReversePortForward,
				hasAgentForwarding,
				hasLocalCommand,
			},
		}

		return { layer, nextTokens, nextRaw }
	}

	// --- PowerShell Unwrapper ---
	private static unwrapPowerShell(
		tokens: ShellToken[],
		rawCommand: string
	): { layer: ExecutionLayer; nextTokens: ShellToken[]; nextRaw: string } | null {
		let i = 1
		let commandPayload: string | undefined

		while (i < tokens.length) {
			const val = tokens[i].value.toLowerCase()
			if (val === "-c" || val === "-command" || val === "/c" || val === "/command") {
				commandPayload = tokens.slice(i + 1).map((t) => t.value).join(" ")
				break
			} else if (
				val === "-enc" ||
				val === "-encodedcommand" ||
				val === "/enc" ||
				val === "/encodedcommand"
			) {
				const b64 = tokens[i + 1]?.value || ""
				try {
					commandPayload = Buffer.from(b64, "base64").toString("utf16le")
				} catch {
					commandPayload = "<malformed-base64>"
				}
				break
			} else if (val.startsWith("-")) {
				if (["-executionpolicy", "-ep", "-file", "-f"].includes(val)) {
					i += 2
				} else {
					i++
				}
			} else {
				commandPayload = tokens.slice(i).map((t) => t.value).join(" ")
				break
			}
		}

		if (!commandPayload) return null

		const nextTokens = ShellTokenizer.tokenize(commandPayload)
		const layer: ExecutionLayer = {
			domain: "subshell",
			wrapperCommand: tokens.slice(0, i).map((t) => t.raw).join(" "),
			rawTokens: tokens.slice(0, i).map((t) => t.raw),
			outerRedirections: [],
		}

		return { layer, nextTokens, nextRaw: commandPayload }
	}

	// --- CMD Unwrapper ---
	private static unwrapCmd(
		tokens: ShellToken[],
		rawCommand: string
	): { layer: ExecutionLayer; nextTokens: ShellToken[]; nextRaw: string } | null {
		let i = 1
		let commandPayload: string | undefined

		while (i < tokens.length) {
			const val = tokens[i].value.toLowerCase()
			if (val === "/c" || val === "/k") {
				commandPayload = tokens.slice(i + 1).map((t) => t.value).join(" ")
				break
			}
			i++
		}

		if (!commandPayload) return null

		const nextTokens = ShellTokenizer.tokenize(commandPayload)
		const layer: ExecutionLayer = {
			domain: "subshell",
			wrapperCommand: tokens.slice(0, i).map((t) => t.raw).join(" "),
			rawTokens: tokens.slice(0, i).map((t) => t.raw),
			outerRedirections: [],
		}

		return { layer, nextTokens, nextRaw: commandPayload }
	}

	// --- POSIX Shell Unwrapper (bash -c) ---
	private static unwrapShell(
		tokens: ShellToken[],
		rawCommand: string
	): { layer: ExecutionLayer; nextTokens: ShellToken[]; nextRaw: string } | null {
		let i = 1
		let commandPayload: string | undefined

		while (i < tokens.length) {
			const val = tokens[i].value
			if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(val)) {
				commandPayload = tokens[i + 1]?.value
				break
			}
			i++
		}

		if (!commandPayload) return null

		const nextTokens = ShellTokenizer.tokenize(commandPayload)
		const layer: ExecutionLayer = {
			domain: "subshell",
			wrapperCommand: tokens.slice(0, i + 1).map((t) => t.raw).join(" "),
			rawTokens: tokens.slice(0, i + 1).map((t) => t.raw),
			outerRedirections: [],
		}

		return { layer, nextTokens, nextRaw: commandPayload }
	}

	private static parseDockerMount(mountArg: string): DockerMountInfo {
		const parts = mountArg.split(":")
		const src = parts[0] || ""
		const target = parts[1] || ""
		const opts = parts[2] || ""
		const isReadOnly = opts.split(",").includes("ro")

		const normSrc = src.replace(/\\/g, "/").toLowerCase()
		const isHostRootOrSystem =
			normSrc === "/" ||
			normSrc === "/root" ||
			normSrc === "/etc" ||
			normSrc === "/var" ||
			normSrc === "c:" ||
			normSrc === "c:/" ||
			normSrc === "/mnt/c"

		const isDockerSocket =
			normSrc === "/var/run/docker.sock" ||
			normSrc.includes("docker.sock") ||
			normSrc.includes("docker_engine")

		return { source: src, target, isReadOnly, isHostRootOrSystem, isDockerSocket }
	}

	private static parseMountFlag(mountStr: string): DockerMountInfo {
		const parts = mountStr.split(",")
		let source = ""
		let target = ""
		let isReadOnly = false

		for (const part of parts) {
			const [k, v] = part.split("=")
			if (k === "source" || k === "src") source = v
			if (k === "target" || k === "dst") target = v
			if (k === "readonly" || part === "readonly") isReadOnly = true
		}

		return this.parseDockerMount(`${source}:${target}${isReadOnly ? ":ro" : ""}`)
	}

	private static extractRedirections(tokens: ShellToken[]): string[] {
		return tokens.filter((t) => /^[12]?>>?$/.test(t.value)).map((t) => t.value)
	}
}

/**
 * Inspects execution chains to detect host boundary escapes and host filesystem risks.
 */
export class HostImpactDetector {
	public static evaluateHostImpact(chain: ExecutionChain): HostImpactAssessment {
		const reasons: string[] = []
		const affectedHostPaths: string[] = []
		const hostEscapingBinaries: string[] = []
		let highestRisk: HostImpactRisk = "none"

		const setRisk = (risk: HostImpactRisk, reason: string) => {
			const riskOrder: Record<HostImpactRisk, number> = {
				none: 0,
				low: 1,
				medium: 2,
				high: 3,
				critical: 4,
			}
			if (riskOrder[risk] > riskOrder[highestRisk]) {
				highestRisk = risk
			}
			reasons.push(reason)
		}

		// 1. Inspect Docker Layers for Escapes
		for (const layer of chain.layers) {
			if (layer.domain === "docker_run") {
				if (layer.isPrivileged) {
					setRisk(
						"critical",
						"Docker container requested --privileged: complete host device access and escape vector"
					)
				}

				if (layer.hostNamespaceSharing?.pid) {
					setRisk(
						"critical",
						"Docker container shares host PID namespace (--pid=host): can monitor and terminate host processes"
					)
				}

				if (layer.bindMounts) {
					for (const mount of layer.bindMounts) {
						if (mount.isDockerSocket) {
							setRisk(
								"critical",
								`Docker socket mounted into container (${mount.source}): grants full root takeover of Docker host daemon`
							)
						}
						if (mount.isHostRootOrSystem) {
							if (mount.isReadOnly) {
								setRisk(
									"high",
									`Sensitive host system path mounted read-only (${mount.source}): exposes host secrets and keys`
								)
							} else {
								setRisk(
									"critical",
									`Host root/system filesystem mounted read-write (${mount.source}): container can overwrite host OS`
								)
							}
							affectedHostPaths.push(mount.source)
						}
					}
				}
			}

			// 2. Inspect SSH Layers for Tunneling / Agent Hijacking
			if (layer.domain === "ssh" && layer.sshDetails) {
				if (layer.sshDetails.hasReversePortForward) {
					setRisk(
						"high",
						"SSH command opens reverse tunnel (-R): exposes internal host ports to remote server"
					)
				}
				if (layer.sshDetails.hasAgentForwarding) {
					setRisk(
						"medium",
						"SSH agent forwarding enabled (-A): susceptible to credential theft if remote host is compromised"
					)
				}
				if (layer.sshDetails.hasLocalCommand) {
					setRisk(
						"critical",
						"SSH command specifies LocalCommand/ProxyCommand: arbitrary command execution on local workstation"
					)
				}
				if (layer.sshDetails.isLoopbackOrLocal) {
					setRisk("medium", "SSH connection targets local machine (localhost/127.0.0.1)")
				}
			}

			// 3. Inspect WSL Boundary
			if (layer.domain === "wsl") {
				if (
					layer.rawTokens.some((t: string) => t.toLowerCase() === "--unregister") ||
					layer.wrapperCommand.includes("--unregister")
				) {
					setRisk(
						"critical",
						"WSL distribution management command (--unregister): destructive removal of distro"
					)
				}

				// Check inner layers following WSL (e.g. wsl wrapping powershell.exe or cmd.exe)
				const wslIndex = chain.layers.indexOf(layer)
				const innerLayers = chain.layers.slice(wslIndex + 1)
				for (const innerLayer of innerLayers) {
					if (
						/\.(exe|bat|cmd|ps1|vbs)$/i.test(innerLayer.wrapperCommand) ||
						/\b(powershell|cmd|explorer)\b/i.test(innerLayer.wrapperCommand)
					) {
						hostEscapingBinaries.push(innerLayer.wrapperCommand)
						setRisk(
							"high",
							`WSL invokes Windows host executable/shell (${innerLayer.wrapperCommand}): breaks Linux isolation and executes on Windows host`
						)
					}
				}

				// Check leaf command tokens & entire leaf text
				for (const token of chain.leafTokens) {
					// Check Windows Interop Executable execution
					if (/\.(exe|bat|cmd|ps1|vbs)$/i.test(token)) {
						hostEscapingBinaries.push(token)
						setRisk(
							"high",
							`WSL invokes Windows host executable (${token}): breaks Linux isolation and executes on Windows host`
						)
					}

					// Check Windows drive access (/mnt/c, /mnt/d)
					const mntMatch = token.match(/\/mnt\/([a-zA-Z])(\/.*)?/)
					if (mntMatch) {
						const driveLetter = mntMatch[1].toUpperCase()
						const fullPath = `${driveLetter}:${mntMatch[2] ? mntMatch[2].replace(/\//g, "\\") : "\\"}`
						affectedHostPaths.push(fullPath)

						if (/(\b|^)(rm|del|rmdir|format|mkfs)(\b|$)/i.test(chain.leafCommand)) {
							setRisk(
								"critical",
								`Destructive command inside WSL targeting Windows host drive (${fullPath})`
							)
						} else {
							setRisk(
								"medium",
								`WSL command accesses Windows host filesystem (${fullPath})`
							)
						}
					}
				}

				// Also check if leaf command has powershell.exe or cmd.exe in text
				if (/\b(powershell\.exe|cmd\.exe|explorer\.exe)\b/i.test(chain.leafCommand)) {
					hostEscapingBinaries.push("powershell.exe")
					setRisk(
						"high",
						"WSL command invokes Windows host shell/executable: breaks Linux isolation"
					)
				}
			}
		}

		// 4. Outer Redirection Host Write
		for (const layer of chain.layers) {
			if (layer.outerRedirections && layer.outerRedirections.length > 0) {
				setRisk(
					"medium",
					`Command contains outer shell redirection (${layer.outerRedirections.join(", ")}): writes to host filesystem`
				)
			}
		}

		const isHostEscape = (highestRisk as HostImpactRisk) === "critical" || (highestRisk as HostImpactRisk) === "high"

		return {
			isHostEscape,
			highestRisk,
			reasons,
			affectedHostPaths,
			hostEscapingBinaries,
			escapesBoundary: isHostEscape || (highestRisk as HostImpactRisk) === "medium",
		}
	}
}
