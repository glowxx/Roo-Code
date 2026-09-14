import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("__desktopAPI", {
	isElectron: true,
	platform: process.platform,
	selectFolder: () => ipcRenderer.invoke("desktop:select-folder"),
	sendToExtension: (message: unknown) => ipcRenderer.send("desktop:message-to-extension", message),
	onExtensionMessage: (callback: (message: unknown) => void) => {
		const listener = (_event: unknown, message: unknown) => callback(message)
		ipcRenderer.on("desktop:message-from-extension", listener)
		return () => ipcRenderer.removeListener("desktop:message-from-extension", listener)
	},
})
