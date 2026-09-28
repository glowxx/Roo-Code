import { createRequire } from "module"
import path from "path"
import http from "http"
import { performance } from "perf_hooks"

const require = createRequire(path.resolve("apps/desktop/package.json"))
const WebSocket = require("ws")

async function checkHealth(port = 4500) {
	return new Promise((resolve) => {
		const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 1500 }, (res) => {
			let data = ""
			res.on("data", (c) => (data += c))
			res.on("end", () => {
				try {
					const json = JSON.parse(data)
					resolve(json.status === "ok")
				} catch {
					resolve(false)
				}
			})
		})
		req.on("error", () => resolve(false))
		req.on("timeout", () => {
			req.destroy()
			resolve(false)
		})
	})
}

async function runBenchmark(port = 4500, iterations = 200) {
	const isHealthy = await checkHealth(port)
	if (!isHealthy) {
		console.log(JSON.stringify({ status: "UNAVAILABLE", reason: `Server not responding on port ${port}` }))
		process.exit(0)
	}

	const wsUrl = `ws://127.0.0.1:${port}/ws`
	const ws = new WebSocket(wsUrl)

	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("WebSocket connect timeout")), 3000)
		ws.on("open", () => {
			clearTimeout(timeout)
			resolve()
		})
		ws.on("error", reject)
	})

	// Wait 200ms to clear initial burst messages
	await new Promise((r) => setTimeout(r, 200))

	// 1. Measure Small RPC Latency
	const latencies = []
	for (let i = 0; i < iterations; i++) {
		const t0 = performance.now()
		await new Promise((resolve) => {
			const handler = (raw) => {
				try {
					const msg = JSON.parse(raw.toString())
					if (msg.type === "terminalLogs" || msg.type === "workspaceInfo" || msg.type === "diffsUpdated") {
						ws.off("message", handler)
						resolve()
					}
				} catch {}
			}
			ws.on("message", handler)
			ws.send(JSON.stringify({ type: "getTerminalLogs" }))
		})
		const rtt = performance.now() - t0
		latencies.push(rtt)
	}

	latencies.sort((a, b) => a - b)
	const sum = latencies.reduce((acc, v) => acc + v, 0)
	const avg = sum / latencies.length
	const median = latencies[Math.floor(latencies.length * 0.5)]
	const p95 = latencies[Math.floor(latencies.length * 0.95)]
	const p99 = latencies[Math.floor(latencies.length * 0.99)]
	const min = latencies[0]
	const max = latencies[latencies.length - 1]

	// 2. Measure Streaming Throughput (sending large messages to test serialization + transport)
	// We send 64KB, 512KB, and 1MB payloads wrapped in webviewMessage
	const testPayloadSizes = [64 * 1024, 512 * 1024, 1024 * 1024]
	const throughputResults = {}

	for (const size of testPayloadSizes) {
		const sizeLabel = `${size / 1024}KB`
		const dummyData = "X".repeat(size)
		const msg = JSON.stringify({ type: "webviewMessage", message: { action: "benchmark", data: dummyData } })
		const byteLen = Buffer.byteLength(msg)

		const runs = 5
		const times = []
		for (let r = 0; r < runs; r++) {
			const t0 = performance.now()
			await new Promise((resolve) => {
				ws.send(msg, () => {
					times.push(performance.now() - t0)
					resolve()
				})
			})
		}
		const avgTimeMs = times.reduce((a, b) => a + b, 0) / times.length
		const seconds = avgTimeMs / 1000
		const throughputMBps = (byteLen / (1024 * 1024)) / seconds
		throughputResults[sizeLabel] = {
			avgTimeMs: Number(avgTimeMs.toFixed(3)),
			throughputMBps: Number(throughputMBps.toFixed(2)),
		}
	}

	ws.close()

	const report = {
		status: "SUCCESS",
		transport: "WebSocket (127.0.0.1:4500)",
		rpcIterations: iterations,
		latencyMs: {
			avg: Number(avg.toFixed(3)),
			median: Number(median.toFixed(3)),
			p95: Number(p95.toFixed(3)),
			p99: Number(p99.toFixed(3)),
			min: Number(min.toFixed(3)),
			max: Number(max.toFixed(3)),
		},
		streamingThroughput: throughputResults,
	}

	console.log(JSON.stringify(report, null, 2))
}

runBenchmark().catch((err) => {
	console.log(JSON.stringify({ status: "ERROR", error: err.message }))
	process.exit(1)
})
