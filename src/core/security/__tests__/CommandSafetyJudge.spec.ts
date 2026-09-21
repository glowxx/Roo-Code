import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"
import { GoogleGenAI } from "@google/genai"
import type { CommandSafetyConfig, ExtensionState } from "@roo-code/types"
import { CommandSafetyJudge, SAFETY_EVALUATION_FALLBACK_RESULT } from "../CommandSafetyJudge"
import {
	DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE,
	buildSafetyPrompt,
} from "../safetyPromptTemplate"

// Mock OpenAI
const mockOpenAiCreate = vi.fn()
vi.mock("openai", () => {
	const MockOpenAI = vi.fn(() => ({
		chat: {
			completions: {
				create: mockOpenAiCreate,
			},
		},
	}))
	return { default: MockOpenAI }
})

// Mock Anthropic
const mockAnthropicCreate = vi.fn()
vi.mock("@anthropic-ai/sdk", () => {
	const MockAnthropic = vi.fn(() => ({
		messages: {
			create: mockAnthropicCreate,
		},
	}))
	return { Anthropic: MockAnthropic }
})

// Mock GoogleGenAI
const mockGeminiGenerateContent = vi.fn()
vi.mock("@google/genai", () => {
	const MockGoogleGenAI = vi.fn(() => ({
		models: {
			generateContent: mockGeminiGenerateContent,
		},
	}))
	return { GoogleGenAI: MockGoogleGenAI }
})

describe("safetyPromptTemplate", () => {
	it("DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE contains required security scopes", () => {
		expect(DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE).toContain("operating system security auditor")
		expect(DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE).toContain("File system destruction")
		expect(DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE).toContain("Credential exfiltration")
		expect(DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE).toContain("Unauthorized network traffic")
		expect(DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE).toContain("Privilege escalation")
		expect(DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE).toContain("System manipulation & resource exhaustion")
		expect(DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE).toContain('"isSafe"')
		expect(DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE).toContain('"riskLevel"')
		expect(DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE).toContain('"reason"')
	})

	it("buildSafetyPrompt builds prompt with default template", () => {
		const prompt = buildSafetyPrompt({
			command: "npm test",
			cwd: "/workspace/my-project",
			recentCommands: ["git status", "pnpm install"],
		})

		expect(prompt.systemPrompt).toBe(DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE)
		expect(prompt.userPrompt).toContain("Command to inspect:\n```\nnpm test\n```")
		expect(prompt.userPrompt).toContain("Working directory:\n```\n/workspace/my-project\n```")
		expect(prompt.userPrompt).toContain("Recent commands in session:\n1. git status\n2. pnpm install")
	})

	it("buildSafetyPrompt supports custom template and placeholder substitutions", () => {
		const customTemplate = "Audit command: {{command}} in {{cwd}}. History: {{recentCommands}}."
		const prompt = buildSafetyPrompt({
			command: "rm -rf /tmp/foo",
			cwd: "/workspace",
			recentCommands: ["ls -la"],
			customTemplate,
		})

		expect(prompt.systemPrompt).toBe("Audit command: rm -rf /tmp/foo in /workspace. History: ls -la.")
		expect(prompt.userPrompt).toContain("rm -rf /tmp/foo")
	})

	it("buildSafetyPrompt handles empty cwd and recentCommands", () => {
		const prompt = buildSafetyPrompt({
			command: "ls -la",
		})

		expect(prompt.userPrompt).toContain("Command to inspect:\n```\nls -la\n```")
		expect(prompt.userPrompt).not.toContain("Working directory:")
		expect(prompt.userPrompt).not.toContain("Recent commands in session:")
	})
})

describe("CommandSafetyJudge - Response Parsing", () => {
	const judge = new CommandSafetyJudge()

	it("parses safe response (isSafe: true, riskLevel: 'safe')", () => {
		const raw = JSON.stringify({
			isSafe: true,
			riskLevel: "safe",
			reason: "The command 'npm test' is a standard test runner and safe to execute.",
		})

		const result = judge.parseSafetyResponse(raw)
		expect(result).toEqual({
			isSafe: true,
			riskLevel: "safe",
			reason: "The command 'npm test' is a standard test runner and safe to execute.",
		})
	})

	it("parses suspicious/dangerous response (isSafe: false, riskLevel: 'critical')", () => {
		const raw = JSON.stringify({
			isSafe: false,
			riskLevel: "critical",
			reason: "Destructive file system deletion: rm -rf / will delete all files on the system.",
		})

		const result = judge.parseSafetyResponse(raw)
		expect(result).toEqual({
			isSafe: false,
			riskLevel: "critical",
			reason: "Destructive file system deletion: rm -rf / will delete all files on the system.",
		})
	})

	it("normalizes case-insensitive risk levels", () => {
		const rawLow = JSON.stringify({
			isSafe: true,
			riskLevel: "LOW",
			reason: "Touches git configuration without major risk",
		})
		expect(judge.parseSafetyResponse(rawLow).riskLevel).toBe("low")

		const rawMedium = JSON.stringify({
			isSafe: false,
			riskLevel: "Medium",
			reason: "Modifies local firewall rules",
		})
		expect(judge.parseSafetyResponse(rawMedium).riskLevel).toBe("medium")

		const rawHigh = JSON.stringify({
			isSafe: false,
			riskLevel: "HIGH",
			reason: "Downloads and executes script from remote url",
		})
		expect(judge.parseSafetyResponse(rawHigh).riskLevel).toBe("high")
	})

	it("extracts JSON resiliently from markdown codeblock (```json { ... } ```)", () => {
		const raw = "```json\n{\n  \"isSafe\": true,\n  \"riskLevel\": \"safe\",\n  \"reason\": \"Safe build command\"\n}\n```"
		const result = judge.parseSafetyResponse(raw)

		expect(result).toEqual({
			isSafe: true,
			riskLevel: "safe",
			reason: "Safe build command",
		})
	})

	it("extracts JSON from codeblocks without json language tag (``` { ... } ```)", () => {
		const raw = "```\n{\n  \"isSafe\": false,\n  \"riskLevel\": \"critical\",\n  \"reason\": \"Partition deletion\"\n}\n```"
		const result = judge.parseSafetyResponse(raw)

		expect(result).toEqual({
			isSafe: false,
			riskLevel: "critical",
			reason: "Partition deletion",
		})
	})

	it("extracts JSON surrounded by explanatory text outside the codeblock", () => {
		const raw = `Here is my security analysis of the command:
\`\`\`json
{
  "isSafe": false,
  "riskLevel": "high",
  "reason": "Suspicious curl piped to bash"
}
\`\`\`
Please confirm before running.`

		const result = judge.parseSafetyResponse(raw)
		expect(result).toEqual({
			isSafe: false,
			riskLevel: "high",
			reason: "Suspicious curl piped to bash",
		})
	})

	it("extracts raw JSON embedded in mixed text without codeblocks", () => {
		const raw = `Based on the audit: {"isSafe": true, "riskLevel": "safe", "reason": "Directory listing"} is the result.`
		const result = judge.parseSafetyResponse(raw)

		expect(result).toEqual({
			isSafe: true,
			riskLevel: "safe",
			reason: "Directory listing",
		})
	})

	describe("malformed JSON fallback (isSafe: false)", () => {
		it("returns fallback on empty or whitespace response", () => {
			const res1 = judge.parseSafetyResponse("")
			expect(res1.isSafe).toBe(false)
			expect(res1.riskLevel).toBe("critical")
			expect(res1.reason).toContain("Command safety verification failed:")

			const res2 = judge.parseSafetyResponse("   ")
			expect(res2.isSafe).toBe(false)
			expect(res2.riskLevel).toBe("critical")

			const res3 = judge.parseSafetyResponse(null as any)
			expect(res3.isSafe).toBe(false)
			expect(res3.riskLevel).toBe("critical")
		})

		it("returns fallback on non-JSON plain text", () => {
			const raw = "I think this command looks safe to run."
			const res = judge.parseSafetyResponse(raw)
			expect(res.isSafe).toBe(false)
			expect(res.riskLevel).toBe("critical")
			expect(res.reason).toContain("Command safety verification failed:")
		})

		it("returns fallback on broken syntax JSON", () => {
			const raw = '{"isSafe": true, "riskLevel": "safe", "reason":'
			const res = judge.parseSafetyResponse(raw)
			expect(res.isSafe).toBe(false)
			expect(res.riskLevel).toBe("critical")
			expect(res.reason).toContain("Command safety verification failed:")
		})

		it("returns fallback when isSafe is missing or non-boolean", () => {
			const noIsSafe = JSON.stringify({ riskLevel: "safe", reason: "ok" })
			const res1 = judge.parseSafetyResponse(noIsSafe)
			expect(res1.isSafe).toBe(false)
			expect(res1.riskLevel).toBe("critical")
			expect(res1.reason).toContain("Missing or non-boolean 'isSafe'")

			const stringIsSafe = JSON.stringify({ isSafe: "true", riskLevel: "safe", reason: "ok" })
			const res2 = judge.parseSafetyResponse(stringIsSafe)
			expect(res2.isSafe).toBe(false)
			expect(res2.riskLevel).toBe("critical")
			expect(res2.reason).toContain("Missing or non-boolean 'isSafe'")
		})

		it("returns fallback when riskLevel is invalid", () => {
			const invalidRisk = JSON.stringify({ isSafe: true, riskLevel: "harmless", reason: "ok" })
			const res1 = judge.parseSafetyResponse(invalidRisk)
			expect(res1.isSafe).toBe(false)
			expect(res1.riskLevel).toBe("critical")
			expect(res1.reason).toContain("Invalid 'riskLevel'")

			const missingRisk = JSON.stringify({ isSafe: true, reason: "ok" })
			const res2 = judge.parseSafetyResponse(missingRisk)
			expect(res2.isSafe).toBe(false)
			expect(res2.riskLevel).toBe("critical")
			expect(res2.reason).toContain("Invalid 'riskLevel'")
		})

		it("returns fallback when reason is missing or empty", () => {
			const emptyReason = JSON.stringify({ isSafe: true, riskLevel: "safe", reason: "" })
			const res1 = judge.parseSafetyResponse(emptyReason)
			expect(res1.isSafe).toBe(false)
			expect(res1.riskLevel).toBe("critical")
			expect(res1.reason).toContain("Missing or empty 'reason'")

			const whitespaceReason = JSON.stringify({ isSafe: true, riskLevel: "safe", reason: "   " })
			const res2 = judge.parseSafetyResponse(whitespaceReason)
			expect(res2.isSafe).toBe(false)
			expect(res2.riskLevel).toBe("critical")

			const missingReason = JSON.stringify({ isSafe: true, riskLevel: "safe" })
			const res3 = judge.parseSafetyResponse(missingReason)
			expect(res3.isSafe).toBe(false)
			expect(res3.riskLevel).toBe("critical")
		})

		it("returns fallback when root is JSON array", () => {
			const rawArray = JSON.stringify([{ isSafe: true, riskLevel: "safe", reason: "ok" }])
			const res = judge.parseSafetyResponse(rawArray)
			expect(res.isSafe).toBe(false)
			expect(res.riskLevel).toBe("critical")
			expect(res.reason).toContain("Command safety verification failed:")
		})
	})
})

describe("CommandSafetyJudge - evaluate method", () => {
	const validConfig: CommandSafetyConfig = {
		enabled: true,
		provider: "openai",
		modelId: "gpt-4o-mini",
		apiKey: "test-openai-key",
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("evaluates safe command successfully via callProviderOverride", async () => {
		const judge = new CommandSafetyJudge({
			callProviderOverride: async () =>
				JSON.stringify({
					isSafe: true,
					riskLevel: "safe",
					reason: "Read-only git command",
				}),
		})

		const result = await judge.evaluate({
			command: "git status",
			cwd: "/repo",
			config: validConfig,
		})

		expect(result).toEqual({
			isSafe: true,
			riskLevel: "safe",
			reason: "Read-only git command",
		})
	})

	it("evaluates dangerous command successfully via callProviderOverride", async () => {
		const judge = new CommandSafetyJudge({
			callProviderOverride: async () =>
				JSON.stringify({
					isSafe: false,
					riskLevel: "critical",
					reason: "Indiscriminate deletion",
				}),
		})

		const result = await judge.evaluate({
			command: "rm -rf *",
			cwd: "/repo",
			config: validConfig,
		})

		expect(result).toEqual({
			isSafe: false,
			riskLevel: "critical",
			reason: "Indiscriminate deletion",
		})
	})

	it("returns fallback result when network error occurs", async () => {
		const judge = new CommandSafetyJudge({
			callProviderOverride: async () => {
				throw new Error("Network connection refused: ECONNREFUSED")
			},
		})

		const result = await judge.evaluate({
			command: "npm install",
			cwd: "/repo",
			config: validConfig,
		})

		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
		expect(result.reason).toContain("Network connection refused: ECONNREFUSED")
		expect(result.reason).toContain("Command safety verification failed:")
	})

	it("returns fail-closed on network errors (DNS, connection refusal)", async () => {
		const judgeDns = new CommandSafetyJudge({
			callProviderOverride: async () => {
				throw new Error("getaddrinfo ENOTFOUND api.openai.com")
			},
		})

		const resultDns = await judgeDns.evaluate({
			command: "npm test",
			cwd: "/repo",
			config: validConfig,
		})

		expect(resultDns.isSafe).toBe(false)
		expect(resultDns.riskLevel).toBe("critical")
		expect(resultDns.reason).toContain("getaddrinfo ENOTFOUND api.openai.com")
		expect(resultDns.reason).toContain("Command safety verification failed:")
	})

	it("returns fallback result when provider returns malformed JSON", async () => {
		const judge = new CommandSafetyJudge({
			callProviderOverride: async () => "Not valid JSON response from LLM",
		})

		const result = await judge.evaluate({
			command: "ls -la",
			cwd: "/repo",
			config: validConfig,
		})

		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
		expect(result.reason).toContain("Command safety verification failed:")
		expect(result.reason).toContain("Invalid or malformed JSON")
	})

	it("returns fail-closed on empty response from provider", async () => {
		const judge = new CommandSafetyJudge({
			callProviderOverride: async () => "",
		})

		const result = await judge.evaluate({
			command: "ls -la",
			config: validConfig,
		})

		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
		expect(result.reason).toContain("Empty or whitespace response")
	})

	it("returns fail-closed on HTTP 401 Unauthorized", async () => {
		const judge = new CommandSafetyJudge({
			callProviderOverride: async () => {
				const error: any = new Error("Incorrect API key provided")
				error.status = 401
				throw error
			},
		})

		const result = await judge.evaluate({
			command: "rm -rf tmp",
			config: validConfig,
		})

		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
		expect(result.reason).toContain("401")
		expect(result.reason).toContain("Incorrect API key provided")
	})

	it("returns fail-closed on HTTP 403 Forbidden", async () => {
		const judge = new CommandSafetyJudge({
			callProviderOverride: async () => {
				const error: any = new Error("Access denied")
				error.status = 403
				throw error
			},
		})

		const result = await judge.evaluate({
			command: "rm -rf tmp",
			config: validConfig,
		})

		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
		expect(result.reason).toContain("403")
		expect(result.reason).toContain("Access denied")
	})

	it("returns fail-closed on HTTP 429 Rate Limit Exceeded", async () => {
		const judge = new CommandSafetyJudge({
			callProviderOverride: async () => {
				const error: any = new Error("Rate limit reached")
				error.status = 429
				throw error
			},
		})

		const result = await judge.evaluate({
			command: "echo test",
			config: validConfig,
		})

		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
		expect(result.reason).toContain("429")
		expect(result.reason).toContain("Rate limit reached")
	})

	it("returns fail-closed on HTTP 500 Internal Server Error", async () => {
		const judge = new CommandSafetyJudge({
			callProviderOverride: async () => {
				const error: any = new Error("Internal Server Error")
				error.status = 500
				throw error
			},
		})

		const result = await judge.evaluate({
			command: "echo test",
			config: validConfig,
		})

		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
		expect(result.reason).toContain("500")
		expect(result.reason).toContain("Internal Server Error")
	})

	it("returns fallback result on API timeout (>5s)", async () => {
		// Use a short timeout of 50ms to simulate the timeout behavior
		const judge = new CommandSafetyJudge({
			timeoutMs: 50,
			callProviderOverride: async ({ signal }) => {
				return new Promise<string>((resolve, reject) => {
					const timer = setTimeout(() => {
						resolve(JSON.stringify({ isSafe: true, riskLevel: "safe", reason: "ok" }))
					}, 200)

					signal.addEventListener("abort", () => {
						clearTimeout(timer)
						reject(new Error("Aborted by timeout"))
					})
				})
			},
		})

		const result = await judge.evaluate({
			command: "sleep 10",
			cwd: "/repo",
			config: validConfig,
		})

		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
		expect(result.reason).toContain("Command safety evaluation timed out after 50ms")
	})

	it("uses default 5000ms timeout with fake timers", async () => {
		vi.useFakeTimers()

		const judge = new CommandSafetyJudge({
			callProviderOverride: ({ signal }) => {
				return new Promise<string>((resolve, reject) => {
					signal.addEventListener("abort", () => {
						reject(new Error("Aborted"))
					})
				})
			},
		})

		const evalPromise = judge.evaluate({
			command: "long running command",
			config: validConfig,
		})

		// Advance past 5000ms timeout
		await vi.advanceTimersByTimeAsync(5001)

		const result = await evalPromise
		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
		expect(result.reason).toContain("Command safety evaluation timed out after 5000ms")
	})

	it("returns fallback result when config is missing", async () => {
		const judge = new CommandSafetyJudge()
		const result = await judge.evaluate({
			command: "git status",
		})

		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
		expect(result.reason).toContain("Command safety configuration is missing")
	})

	it("returns fallback result when provider or modelId is missing", async () => {
		const judge = new CommandSafetyJudge()
		const result = await judge.evaluate({
			command: "git status",
			config: { enabled: true, provider: "", modelId: "" },
		})

		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
		expect(result.reason).toContain("Model configuration missing (provider or modelId)")
	})

	it("returns fallback result when apiKey is missing for non-local provider", async () => {
		const judge = new CommandSafetyJudge()
		const result = await judge.evaluate({
			command: "git status",
			config: { enabled: true, provider: "openai", modelId: "gpt-4o" },
		})

		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
		expect(result.reason).toContain("API key missing for provider 'openai'")
	})

	it("resolves apiKey from state.apiConfiguration fallback", async () => {
		let capturedApiKey = ""
		const judge = new CommandSafetyJudge({
			callProviderOverride: async (params) => {
				capturedApiKey = params.apiKey
				return JSON.stringify({ isSafe: true, riskLevel: "safe", reason: "ok" })
			},
		})

		const state: Partial<ExtensionState> = {
			apiConfiguration: {
				apiProvider: "openai",
				openAiApiKey: "inherited-key-12345",
			},
		}

		const result = await judge.evaluate({
			command: "git status",
			config: { enabled: true, provider: "openai", modelId: "gpt-4o" },
			state,
		})

		expect(capturedApiKey).toBe("inherited-key-12345")
		expect(result.isSafe).toBe(true)
	})
})

describe("CommandSafetyJudge - Provider Dispatching", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("dispatches to OpenAI with temperature 0.0", async () => {
		mockOpenAiCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							isSafe: true,
							riskLevel: "safe",
							reason: "Harmless build",
						}),
					},
				},
			],
		})

		const judge = new CommandSafetyJudge()
		const result = await judge.evaluate({
			command: "pnpm build",
			config: {
				enabled: true,
				provider: "openai",
				modelId: "gpt-4o",
				apiKey: "sk-openai-test",
			},
		})

		expect(mockOpenAiCreate).toHaveBeenCalledTimes(1)
		const createCall = mockOpenAiCreate.mock.calls[0][0]
		expect(createCall.model).toBe("gpt-4o")
		expect(createCall.temperature).toBe(0.0)
		expect(createCall.messages[0].role).toBe("system")
		expect(createCall.messages[1].role).toBe("user")
		expect(result.isSafe).toBe(true)
	})

	it("dispatches to OpenAI reasoning models (o1/o3) with developer role and without temperature", async () => {
		mockOpenAiCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							isSafe: true,
							riskLevel: "safe",
							reason: "Safe test command",
						}),
					},
				},
			],
		})

		const judge = new CommandSafetyJudge()
		await judge.evaluate({
			command: "pnpm test",
			config: {
				enabled: true,
				provider: "openai",
				modelId: "o3-mini",
				apiKey: "sk-openai-test",
			},
		})

		expect(mockOpenAiCreate).toHaveBeenCalledTimes(1)
		const createCall = mockOpenAiCreate.mock.calls[0][0]
		expect(createCall.model).toBe("o3-mini")
		expect(createCall.temperature).toBeUndefined()
		expect(createCall.messages[0].role).toBe("developer")
	})

	it("dispatches to Anthropic messages API with temperature 0.0", async () => {
		mockAnthropicCreate.mockResolvedValueOnce({
			content: [
				{
					type: "text",
					text: JSON.stringify({
						isSafe: true,
						riskLevel: "safe",
						reason: "Safe cargo check",
					}),
				},
			],
		})

		const judge = new CommandSafetyJudge()
		const result = await judge.evaluate({
			command: "cargo check",
			config: {
				enabled: true,
				provider: "anthropic",
				modelId: "claude-3-5-sonnet-20241022",
				apiKey: "sk-ant-test",
			},
		})

		expect(mockAnthropicCreate).toHaveBeenCalledTimes(1)
		const anthropicCall = mockAnthropicCreate.mock.calls[0][0]
		expect(anthropicCall.model).toBe("claude-3-5-sonnet-20241022")
		expect(anthropicCall.temperature).toBe(0.0)
		expect(anthropicCall.system).toContain("operating system security auditor")
		expect(anthropicCall.messages[0].content).toContain("cargo check")
		expect(result.isSafe).toBe(true)
	})

	it("dispatches to Gemini with systemInstruction and temperature 0.0", async () => {
		mockGeminiGenerateContent.mockResolvedValueOnce({
			text: JSON.stringify({
				isSafe: false,
				riskLevel: "critical",
				reason: "Attempt to dump Windows SAM registry hive",
			}),
		})

		const judge = new CommandSafetyJudge()
		const result = await judge.evaluate({
			command: "reg save HKLM\\SAM C:\\sam.hive",
			config: {
				enabled: true,
				provider: "gemini",
				modelId: "gemini-2.0-flash",
				apiKey: "test-gemini-key",
			},
		})

		expect(mockGeminiGenerateContent).toHaveBeenCalledTimes(1)
		const [geminiCall] = mockGeminiGenerateContent.mock.calls[0]
		expect(geminiCall.model).toBe("gemini-2.0-flash")
		expect(geminiCall.config.temperature).toBe(0.0)
		expect(geminiCall.config.systemInstruction).toContain("operating system security auditor")
		expect(result.isSafe).toBe(false)
		expect(result.riskLevel).toBe("critical")
	})

	it("dispatches to OpenRouter with custom headers", async () => {
		mockOpenAiCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							isSafe: true,
							riskLevel: "safe",
							reason: "Safe git log",
						}),
					},
				},
			],
		})

		const judge = new CommandSafetyJudge()
		const result = await judge.evaluate({
			command: "git log -n 5",
			config: {
				enabled: true,
				provider: "openrouter",
				modelId: "anthropic/claude-3.5-sonnet",
				apiKey: "sk-or-test",
			},
		})

		expect(mockOpenAiCreate).toHaveBeenCalledTimes(1)
		expect(result.isSafe).toBe(true)
	})
})
