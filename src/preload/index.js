/**
 * Minimal, safe preload bridge. The dsh UI itself is loaded unmodified and
 * needs no Node access; this only exposes the pieces the error page uses.
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktopAPI', {
  restart: () => ipcRenderer.invoke('runtime:restart'),
  version: () => ipcRenderer.invoke('app:version'),
  platform: process.platform,
})
