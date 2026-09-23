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

	describe("Boundary Context & Incident Regressions", () => {
		it("analyzes the Velune WSL security regression test command with rich boundary context", () => {
			const veluneCmd =
				'wsl.exe -d GuildScout-Test -- /bin/bash -c "cd /home/guildscout/srv/velune; fixture=$(mktemp /tmp/velune-test.XXXXXX); cp tests/fixtures/valid_license.key ${fixture}; VELUNE_NATIVE_TEST_ADDON=${fixture} node tests/linux_native_security.test.js; echo NATIVE_RC=$?; rm -f ${fixture}"'

			const boundary = ExecutionBoundaryAnalyzer.analyze(veluneCmd, {
				targetName: "GuildScout-Test",
				userInstruction: "Run linux native security tests in GuildScout-Test",
				taskGoal: "Validate Velune license security",
			})

			expect(boundary.target.type).toBe("wsl")
			expect(boundary.target.name).toBe("GuildScout-Test")
			expect(boundary.target.classification).toBe("test-environment")
			expect(boundary.targetEnvironment).toBe("WSL guest")
			expect(boundary.wrapper).toBe("wsl.exe")
			expect(boundary.innerShell).toBe("/bin/bash")
			expect(boundary.guestWorkingDirectory).toBe("/home/guildscout/srv/velune")
			expect(boundary.hostFilesystemAccess).toBe(false)
			expect(boundary.hostProcessEscape).toBe(false)
			expect(boundary.destructiveScope).toBe("scoped_test_fixture")
			expect(boundary.operationSummary?.length).toBeGreaterThan(2)
			expect(boundary.operationSummary?.some((s) => s.includes("temporary test fixture"))).toBe(true)
			expect(boundary.operationSummary?.some((s) => s.includes("Clean up temporary test fixture"))).toBe(true)
			expect(boundary.hostImpact.isHostEscape).toBe(false)
			expect(boundary.hostImpact.highestRisk).toBe("none")
		})

		it("detects destructive host filesystem deletion via /mnt/c as critical host escape", () => {
			const destructiveCmd =
				'wsl.exe -d GuildScout-Test -- /bin/bash -c "rm -rf /mnt/c/Windows/System32"'

			const boundary = ExecutionBoundaryAnalyzer.analyze(destructiveCmd)

			expect(boundary.target.type).toBe("wsl")
			expect(boundary.hostFilesystemAccess).toBe(true)
			expect(boundary.hostImpact.isHostEscape).toBe(true)
			expect(boundary.hostImpact.highestRisk).toBe("critical")
			expect(boundary.destructiveScope).toBe("host_system")
		})

		it("detects host process escape when Windows binary powershell.exe is invoked inside WSL", () => {
			const escapeCmd =
				'wsl.exe -d GuildScout-Test -- /bin/bash -c "powershell.exe -NoProfile -Command \'Stop-Service WinDefend\'"'

			const boundary = ExecutionBoundaryAnalyzer.analyze(escapeCmd)

			expect(boundary.target.type).toBe("wsl")
			expect(boundary.hostProcessEscape).toBe(true)
			expect(boundary.hostImpact.isHostEscape).toBe(true)
			expect(boundary.hostImpact.highestRisk).toBe("high")
			expect(boundary.hostImpact.hostEscapingBinaries).toContain("powershell.exe")
		})

		it("classifies standalone /tmp deletion as scoped_test_fixture", () => {
			const tmpCleanupCmd = 'wsl.exe -d GuildScout-Test -- rm -rf /tmp/velune-test.123456'

			const boundary = ExecutionBoundaryAnalyzer.analyze(tmpCleanupCmd)

			expect(boundary.target.type).toBe("wsl")
			expect(boundary.hostFilesystemAccess).toBe(false)
			expect(boundary.hostProcessEscape).toBe(false)
			expect(boundary.destructiveScope).toBe("scoped_test_fixture")
		})

		it("classifies docker exec unit test command as scoped container without destruction", () => {
			const dockerCmd = "docker exec -i test-runner npm test"

			const boundary = ExecutionBoundaryAnalyzer.analyze(dockerCmd, {
				targetName: "test-runner",
				userInstruction: "Run npm test in container",
			})

			expect(boundary.target.type).toBe("docker")
			expect(boundary.targetEnvironment).toBe("Docker container")
			expect(boundary.destructiveScope).toBe("none")
			expect(boundary.hostFilesystemAccess).toBe(false)
			expect(boundary.hostProcessEscape).toBe(false)
		})

		it("detects destructive command targeting production SSH target as host_system", () => {
			const sshCmd = 'ssh prod-server "rm -rf /var/data"'

			const boundary = ExecutionBoundaryAnalyzer.analyze(sshCmd)

			expect(boundary.target.type).toBe("ssh")
			expect(boundary.targetEnvironment).toBe("SSH remote")
			expect(boundary.target.classification).toBe("production")
			expect(boundary.destructiveScope).toBe("host_system")
		})
	})
})

