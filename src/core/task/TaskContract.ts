import type { CanonicalConstraint, ClineMessage } from "@roo-code/types"

export interface TaskAuthorization {
	explicitConstraints: string[]
	scopedWriteAllows: string[]
	supplementalWriteAllows: string[]
	scopedWriteDenies: string[]
	canonicalConstraints: CanonicalConstraint[]
}

export interface TaskDecision {
	ask: string
	answer: string
}

/** A deterministic projection of the original task and the persisted UI conversation. */
export interface TaskContract {
	originalGoal: string
	currentGoal: string
	latestUserInstruction: string
	latestSubstantiveInstruction: string
	amendments: string[]
	decisions: TaskDecision[]
	completionCriteria: string[]
	authorization?: TaskAuthorization
}

const continuation = /^(?:continue|ok|proceed|go|yes|tak|dalej|idź dalej|kontynuuj)\.?$/i
const explicitAmendment =
	/(?<![\p{L}\p{N}])(?:now|instead|only|except|change|modify|fix|implement|do not|don't|no longer|however|but|teraz|jednak|zamiast|tylko|wyłącznie|oprócz|nie ruszaj|nie zmieniaj|nie modyfikuj|możesz|napraw|popraw|zmień|ale)(?![\p{L}\p{N}])/iu

function criteriaFrom(text: string): string[] {
	return text.split("\n").flatMap((line) => {
		const match = line.trim().match(/^(?:[-*•]|\d+[.)])\s+(.+)$/)
		return match?.[1] ? [match[1].trim()] : []
	})
}

export function buildTaskContract(originalGoal: string, messages: ClineMessage[], authorization?: TaskAuthorization): TaskContract {
	const amendments: string[] = []
	const decisions: TaskDecision[] = []
	let latestUserInstruction = originalGoal
	let latestSubstantiveInstruction = originalGoal
	let pendingAsk: ClineMessage | undefined
	let currentGoal = originalGoal

	for (const message of messages) {
		if (message.type === "ask" && !message.partial) {
			pendingAsk = message
			continue
		}
		if (message.type !== "say" || message.say !== "user_feedback" || !message.text?.trim()) continue

		const answer = message.text.trim()
		latestUserInstruction = answer
		const isDecision = pendingAsk?.ask === "followup" || pendingAsk?.ask === "tool" || pendingAsk?.ask === "command"
		if (isDecision) decisions.push({ ask: pendingAsk?.text || "", answer })

		if (answer.length > 12 && explicitAmendment.test(answer) && !continuation.test(answer)) {
			amendments.push(answer)
			latestSubstantiveInstruction = answer
		} else if (!isDecision && !continuation.test(answer) && answer.length > 25) {
			// A substantive message after completion starts a new effective task in this chat.
			if (pendingAsk?.ask === "completion_result" || pendingAsk?.ask === "resume_completed_task") {
				currentGoal = answer
			} else {
				amendments.push(answer)
			}
			latestSubstantiveInstruction = answer
		}
		pendingAsk = undefined
	}

	if (amendments.length) currentGoal += `\nTask amendments:\n${amendments.map((item) => `- ${item}`).join("\n")}`
	const completionCriteria = [...new Set([...criteriaFrom(originalGoal), ...amendments.flatMap(criteriaFrom)])].slice(
		0,
		15,
	)
	return {
		originalGoal,
		currentGoal,
		latestUserInstruction,
		latestSubstantiveInstruction,
		amendments,
		decisions,
		completionCriteria,
		authorization,
	}
}
