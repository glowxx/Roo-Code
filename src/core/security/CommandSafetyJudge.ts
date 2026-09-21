import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"
import { GoogleGenAI } from "@google/genai"
import type {
	CommandSafetyConfig,
	CommandSafetyRiskLevel,
	SafetyEvaluationResult,
	ExtensionState,
} from "@roo-code/types"
import { resolveProviderApiKey } from "@roo-code/types"
import { buildSafetyPrompt } from "./safetyPromptTemplate"

export const SAFETY_EVALUATION_FALLBACK_RESULT: SafetyEvaluationResult = {
	isSafe: false,
	riskLevel: "critical",
	reason: "Command safety evaluation failed (timeout or network error). Auto-execution blocked defensively.",
}

export interface EvaluateSafetyOptions {
	command: string
	cwd?: string
	recentCommands?: string[]
	config?: CommandSafetyConfig
	state?: Partial<ExtensionState> | null
}

export interface CallProviderParams {
	provider: string
	modelId: string
	apiKey: string
	systemPrompt: string
	userPrompt: string
	state?: Partial<ExtensionState> | null
	signal: AbortSignal
}

export interface CommandSafetyJudgeOptions {
	timeoutMs?: number
	callProviderOverride?: (params: CallProviderParams) => Promise<string>
}

/**
 * CommandSafetyJudge evaluates commands for potential security risks using an LLM.
 */
export class CommandSafetyJudge {
	private readonly timeoutMs: number
	private readonly callProviderOverride?: (params: CallProviderParams) => Promise<string>

	constructor(options?: CommandSafetyJudgeOptions) {
		this.timeoutMs = options?.timeoutMs ?? 5000
		this.callProviderOverride = options?.callProviderOverride
	}

	/**
	 * Parses and validates LLM response text into a SafetyEvaluationResult.
	 * Handles raw JSON, Markdown code fences (```json ... ```), or mixed text.
	 */
	public parseSafetyResponse(rawResponse: string): SafetyEvaluationResult {
		if (!rawResponse || typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
			return SAFETY_EVALUATION_FALLBACK_RESULT
		}

		const trimmed = rawResponse.trim()
		let parsedObject: any = null

		// Attempt 1: Direct JSON parse
		try {
			parsedObject = JSON.parse(trimmed)
		} catch {
			// Attempt 2: Extract from Markdown codeblock ```json ... ``` or ``` ... ```
			const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
			if (codeBlockMatch && codeBlockMatch[1]) {
				try {
					parsedObject = JSON.parse(codeBlockMatch[1].trim())
				} catch {
					// Fall through to regex extraction
				}
			}

			// Attempt 3: Outermost JSON object { ... }
			if (!parsedObject) {
				const firstBrace = trimmed.indexOf("{")
				const lastBrace = trimmed.lastIndexOf("}")
				if (firstBrace !== -1 && lastBrace > firstBrace) {
					const candidate = trimmed.substring(firstBrace, lastBrace + 1)
					try {
						parsedObject = JSON.parse(candidate)
					} catch {
						// Parsing failed
					}
				}
			}
		}

		if (!parsedObject || typeof parsedObject !== "object" || Array.isArray(parsedObject)) {
			return SAFETY_EVALUATION_FALLBACK_RESULT
		}

		// Validate isSafe (boolean)
		if (typeof parsedObject.isSafe !== "boolean") {
			return SAFETY_EVALUATION_FALLBACK_RESULT
		}

		// Validate riskLevel ("safe" | "low" | "medium" | "high" | "critical")
		const validRiskLevels: CommandSafetyRiskLevel[] = ["safe", "low", "medium", "high", "critical"]
		const riskLevel =
			typeof parsedObject.riskLevel === "string" ? parsedObject.riskLevel.toLowerCase().trim() : ""
		if (!validRiskLevels.includes(riskLevel as CommandSafetyRiskLevel)) {
			return SAFETY_EVALUATION_FALLBACK_RESULT
		}

		// Validate reason (string)
		if (typeof parsedObject.reason !== "string" || parsedObject.reason.trim().length === 0) {
			return SAFETY_EVALUATION_FALLBACK_RESULT
		}

		return {
			isSafe: parsedObject.isSafe,
			riskLevel: riskLevel as CommandSafetyRiskLevel,
			reason: parsedObject.reason.trim(),
		}
	}

	public static parseSafetyResponse(rawResponse: string): SafetyEvaluationResult {
		return new CommandSafetyJudge().parseSafetyResponse(rawResponse)
	}

	public static async evaluate(options: EvaluateSafetyOptions): Promise<SafetyEvaluationResult> {
		return new CommandSafetyJudge().evaluate(options)
	}

	/**
	 * Evaluates a command using the configured LLM safety judge.
	 */
	public async evaluate({
		command,
		cwd,
		recentCommands,
		config,
		state,
	}: EvaluateSafetyOptions): Promise<SafetyEvaluationResult> {
		try {
			const effectiveConfig = config || state?.commandSafetyConfig
			if (!effectiveConfig) {
				return SAFETY_EVALUATION_FALLBACK_RESULT
			}

			const provider = effectiveConfig.provider?.toLowerCase().trim()
			const modelId = effectiveConfig.modelId?.trim()

			if (!provider || !modelId) {
				return SAFETY_EVALUATION_FALLBACK_RESULT
			}

			const apiKey =
				effectiveConfig.apiKey?.trim() || resolveProviderApiKey(provider, state?.apiConfiguration)

			const isLocalProvider = provider === "ollama" || provider === "lmstudio"
			if (!apiKey && !isLocalProvider) {
				return SAFETY_EVALUATION_FALLBACK_RESULT
			}

			const { systemPrompt, userPrompt } = buildSafetyPrompt({
				command,
				cwd,
				recentCommands,
				customTemplate: effectiveConfig.customPromptTemplate,
			})

			const abortController = new AbortController()
			let timeoutId: ReturnType<typeof setTimeout> | undefined

			const timeoutPromise = new Promise<never>((_, reject) => {
				timeoutId = setTimeout(() => {
					abortController.abort(new Error("Command safety evaluation timed out after 5000ms"))
					reject(new Error("Command safety evaluation timed out after 5000ms"))
				}, this.timeoutMs)
			})

			let rawResponse: string
			try {
				const callParams: CallProviderParams = {
					provider,
					modelId,
					apiKey: apiKey || "",
					systemPrompt,
					userPrompt,
					state,
					signal: abortController.signal,
				}

				const providerCall = this.callProviderOverride
					? this.callProviderOverride(callParams)
					: this.callProvider(callParams)

				rawResponse = await Promise.race([providerCall, timeoutPromise])
			} finally {
				if (timeoutId !== undefined) {
					clearTimeout(timeoutId)
				}
			}

			return this.parseSafetyResponse(rawResponse)
		} catch (error) {
			return SAFETY_EVALUATION_FALLBACK_RESULT
		}
	}

	/**
	 * Dispatches request to the appropriate LLM provider client.
	 */
	protected async callProvider({
		provider,
		modelId,
		apiKey,
		systemPrompt,
		userPrompt,
		state,
		signal,
	}: CallProviderParams): Promise<string> {
		switch (provider) {
			case "anthropic":
				return this.callAnthropic({ modelId, apiKey, systemPrompt, userPrompt, state, signal })

			case "gemini":
				return this.callGemini({ modelId, apiKey, systemPrompt, userPrompt, signal })

			default:
				// Handles OpenAI, OpenRouter, xkiro, and other OpenAI-compatible endpoints
				return this.callOpenAiCompatible({
					provider,
					modelId,
					apiKey,
					systemPrompt,
					userPrompt,
					state,
					signal,
				})
		}
	}

	private async callAnthropic({
		modelId,
		apiKey,
		systemPrompt,
		userPrompt,
		state,
		signal,
	}: {
		modelId: string
		apiKey: string
		systemPrompt: string
		userPrompt: string
		state?: Partial<ExtensionState> | null
		signal: AbortSignal
	}): Promise<string> {
		const client = new Anthropic({
			apiKey,
			baseURL: state?.apiConfiguration?.anthropicBaseUrl || undefined,
		})

		const response = await client.messages.create(
			{
				model: modelId,
				max_tokens: 1024,
				system: systemPrompt,
				messages: [{ role: "user", content: userPrompt }],
				temperature: 0.0,
			},
			{
				signal,
			}
		)

		const textContent = response.content.find((block) => block.type === "text")
		return textContent?.type === "text" ? textContent.text : ""
	}

	private async callGemini({
		modelId,
		apiKey,
		systemPrompt,
		userPrompt,
		signal,
	}: {
		modelId: string
		apiKey: string
		systemPrompt: string
		userPrompt: string
		signal: AbortSignal
	}): Promise<string> {
		const client = new GoogleGenAI({ apiKey })

		const abortPromise = new Promise<never>((_, reject) => {
			if (signal.aborted) {
				reject(signal.reason || new Error("Aborted"))
			} else {
				signal.addEventListener(
					"abort",
					() => reject(signal.reason || new Error("Aborted")),
					{ once: true }
				)
			}
		})

		const generatePromise = client.models.generateContent({
			model: modelId,
			contents: [
				{
					role: "user",
					parts: [{ text: userPrompt }],
				},
			],
			config: {
				systemInstruction: systemPrompt,
				temperature: 0.0,
			},
		})

		const response = await Promise.race([generatePromise, abortPromise])
		return response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || ""
	}

	private async callOpenAiCompatible({
		provider,
		modelId,
		apiKey,
		systemPrompt,
		userPrompt,
		state,
		signal,
	}: {
		provider: string
		modelId: string
		apiKey: string
		systemPrompt: string
		userPrompt: string
		state?: Partial<ExtensionState> | null
		signal: AbortSignal
	}): Promise<string> {
		let baseURL: string | undefined
		const defaultHeaders: Record<string, string> = {}

		if (provider === "openrouter") {
			baseURL = state?.apiConfiguration?.openRouterBaseUrl || "https://openrouter.ai/api/v1"
			defaultHeaders["HTTP-Referer"] = "https://github.com/RooCodeInc/Roo-Code"
			defaultHeaders["X-Title"] = "Roo Code"
		} else if (provider === "xkiro") {
			baseURL =
				(state?.apiConfiguration as any)?.xkiroBaseUrl ||
				state?.apiConfiguration?.openAiBaseUrl ||
				"https://api.xkiro.com/v1"
		} else if (provider === "openai") {
			baseURL = state?.apiConfiguration?.openAiBaseUrl || "https://api.openai.com/v1"
		} else if (provider === "ollama") {
			baseURL = state?.apiConfiguration?.ollamaBaseUrl || "http://localhost:11434/v1"
		} else if (provider === "lmstudio") {
			baseURL = state?.apiConfiguration?.lmStudioBaseUrl || "http://localhost:1234/v1"
		} else {
			baseURL = state?.apiConfiguration?.openAiBaseUrl || undefined
		}

		if (state?.apiConfiguration?.openAiHeaders) {
			Object.assign(defaultHeaders, state.apiConfiguration.openAiHeaders)
		}

		const client = new OpenAI({
			apiKey: apiKey || "noop",
			baseURL,
			defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
		})

		const isReasoningModel =
			modelId.toLowerCase().startsWith("o1") || modelId.toLowerCase().startsWith("o3")

		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = isReasoningModel
			? [
					{ role: "developer", content: systemPrompt },
					{ role: "user", content: userPrompt },
				]
			: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				]

		const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
			model: modelId,
			messages,
			...(isReasoningModel ? {} : { temperature: 0.0 }),
		}

		const completion = await client.chat.completions.create(requestParams, { signal })
		return completion.choices?.[0]?.message?.content || ""
	}
}
