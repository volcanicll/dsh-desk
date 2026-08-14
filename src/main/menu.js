/**
 * Native application menu. Standard roles keep copy/paste/zoom working inside
 * the web UI; "Restart dsh" recycles the backend server without relaunching
 * the app.
 */
import { Menu, app } from 'electron'

export function buildMenu({ restart }) {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Restart dsh Server',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => restart(),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
