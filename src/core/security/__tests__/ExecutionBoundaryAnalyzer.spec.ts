import { describe, it, expect } from "vitest"
import {
	ExecutionBoundaryAnalyzer,
	HostImpactDetector,
	ShellTokenizer,
} from "../ExecutionBoundaryAnalyzer"

describe("ExecutionBoundaryAnalyzer", () => {
	describe("ShellTokenizer", () => {
		it("splits simple space-separated tokens", () => {
			const tokens = ShellTokenizer.tokenize("wsl -d Ubuntu ls -la")
			expect(tokens.map((t) => t.value)).toEqual(["wsl", "-d", "Ubuntu", "ls", "-la"])
		})

		it("preserves double and single quotes content", () => {
			const tokens = ShellTokenizer.tokenize('bash -lc "systemctl restart my-service && ls"')
			expect(tokens.length).toBe(3)
			expect(tokens[0].value).toBe("bash")
			expect(tokens[1].value).toBe("-lc")
			expect(tokens[2].value).toBe("systemctl restart my-service && ls")
			expect(tokens[2].quoteType).toBe("double")
		})

		it("handles escaped characters inside unquoted tokens", () => {
			const tokens = ShellTokenizer.tokenize("cat file\\ name.txt")
			expect(tokens.length).toBe(2)
			expect(tokens[1].value).toBe("file name.txt")
		})
	})

	describe("WSL Command Decomposition", () => {
		it("unwraps WSL with distro and bash -lc wrapper", () => {
			const cmd =
				'wsl.exe -d GuildScout-Test -- bash -lc "systemctl restart velune-headless && systemctl status velune-headless"'
			const chain = ExecutionBoundaryAnalyzer.decomposeCommand(cmd)

			expect(chain.layers.length).toBe(2)
			expect(chain.layers[0].domain).toBe("wsl")
			expect(chain.layers[0].targetEntity).toBe("GuildScout-Test")
			expect(chain.layers[1].domain).toBe("subshell")
			expect(chain.leafCommand).toBe(
				"systemctl restart velune-headless && systemctl status velune-headless"
			)
		})

		it("correctly identifies safe WSL command without host impact", () => {
			const boundary = ExecutionBoundaryAnalyzer.analyze(
				'wsl.exe -d GuildScout-Test -- bash -lc "systemctl status velune-headless --no-pager"',
				{
					targetName: "GuildScout-Test",
					userInstruction: "Perform Linux validation in GuildScout-Test",
					taskGoal: "Test signed Linux candidate in GuildScout-Test",
				}
			)

			expect(boundary.target.type).toBe("wsl")
			expect(boundary.target.name).toBe("GuildScout-Test")
			expect(boundary.target.classification).toBe("test-environment")
			expect(boundary.innerCommand).toBe("systemctl status velune-headless --no-pager")
			expect(boundary.hostImpact.isHostEscape).toBe(false)
			expect(boundary.hostImpact.highestRisk).toBe("none")
		})

		it("detects host filesystem impact via /mnt/c in WSL", () => {
			const boundary = ExecutionBoundaryAnalyzer.analyze(
				'wsl.exe -d GuildScout-Test -- bash -lc "rm -rf /mnt/c/Users/Kamil/Documents"'
			)

			expect(boundary.target.type).toBe("wsl")
			expect(boundary.hostImpact.isHostEscape).toBe(true)
			expect(boundary.hostImpact.highestRisk).toBe("critical")
			expect(boundary.hostImpact.affectedHostPaths.length).toBeGreaterThan(0)
			expect(boundary.hostImpact.affectedHostPaths[0]).toContain("C:\\Users\\Kamil\\Documents")
		})

		it("detects host escape via Windows binary invocation inside WSL", () => {
			const boundary = ExecutionBoundaryAnalyzer.analyze(
				'wsl.exe -d GuildScout-Test -- powershell.exe -Command "Remove-Item C:\\test"'
			)

			expect(boundary.hostImpact.isHostEscape).toBe(true)
			expect(boundary.hostImpact.hostEscapingBinaries).toContain("powershell.exe")
		})

		it("detects destructive WSL management commands (wsl --unregister)", () => {
			const boundary = ExecutionBoundaryAnalyzer.analyze("wsl.exe --unregister Ubuntu")

			expect(boundary.target.type).toBe("wsl")
			expect(boundary.hostImpact.isHostEscape).toBe(true)
			expect(boundary.hostImpact.highestRisk).toBe("critical")
			expect(boundary.hostImpact.reasons.some((r) => r.includes("--unregister"))).toBe(true)
		})
	})

	describe("Docker Command Decomposition", () => {
		it("unwraps docker exec inside test container", () => {
			const boundary = ExecutionBoundaryAnalyzer.analyze(
				"docker exec -it test-container npm test",
				{
					targetName: "test-container",
					userInstruction: "Run unit tests inside test-container",
				}
			)

			expect(boundary.target.type).toBe("docker")
			expect(boundary.target.name).toBe("test-container")
			expect(boundary.target.classification).toBe("test-environment")
			expect(boundary.innerCommand).toBe("npm test")
			expect(boundary.hostImpact.isHostEscape).toBe(false)
		})

		it("detects critical risk on docker run with --privileged and root volume mount", () => {
			const boundary = ExecutionBoundaryAnalyzer.analyze(
				"docker run --privileged -v /:/host alpine rm -rf /host/boot"
			)

			expect(boundary.target.type).toBe("docker")
			expect(boundary.hostImpact.isHostEscape).toBe(true)
			expect(boundary.hostImpact.highestRisk).toBe("critical")
			expect(boundary.hostImpact.reasons.some((r) => r.includes("--privileged"))).toBe(true)
		})

		it("detects critical risk on docker socket mount", () => {
			const boundary = ExecutionBoundaryAnalyzer.analyze(
				"docker run -v /var/run/docker.sock:/var/run/docker.sock alpine sh"
			)

			expect(boundary.hostImpact.isHostEscape).toBe(true)
			expect(boundary.hostImpact.highestRisk).toBe("critical")
			expect(boundary.hostImpact.reasons.some((r) => r.includes("Docker socket"))).toBe(true)
		})
	})

	describe("SSH Command Decomposition", () => {
		it("unwraps SSH remote commands", () => {
			const boundary = ExecutionBoundaryAnalyzer.analyze(
				'ssh dev@test-server "systemctl restart my-service"'
			)

			expect(boundary.target.type).toBe("ssh")
			expect(boundary.target.name).toBe("dev@test-server")
			expect(boundary.innerCommand).toBe("systemctl restart my-service")
		})

		it("flags SSH reverse port forwarding", () => {
			const boundary = ExecutionBoundaryAnalyzer.analyze(
				"ssh -R 8080:localhost:80 user@remote-server"
			)

			expect(boundary.hostImpact.highestRisk).toBe("high")
			expect(boundary.hostImpact.reasons.some((r) => r.includes("reverse tunnel"))).toBe(true)
		})
	})

	describe("Environment Classification", () => {
		it("disqualifies targets containing production keywords", () => {
			const classification = ExecutionBoundaryAnalyzer.classifyEnvironment("production-cluster")
			expect(classification).toBe("production")
		})

		it("classifies environment explicitly mentioned in user task as test-environment", () => {
			const classification = ExecutionBoundaryAnalyzer.classifyEnvironment("GuildScout-Test", {
				targetName: "GuildScout-Test",
				userInstruction: "Uruchom testy candidate build w GuildScout-Test",
			})
			expect(classification).toBe("test-environment")
		})
	})
})
