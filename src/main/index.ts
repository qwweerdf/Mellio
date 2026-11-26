import { app, BrowserWindow, clipboard, ipcMain, nativeTheme, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BotInput, ProviderInput, RunEvent, SendInput } from '../../shared/types'
import * as repo from './repo'
import { decryptKey, encryptKey } from './secrets'
import { listModels, testConnection } from './llm'
import { cancelRun, respond } from './orchestrator'

let win: BrowserWindow | null = null

function createWindow(): void {
  const devIcon = app.isPackaged ? undefined : join(app.getAppPath(), 'build/icon.png')
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    show: false,
    icon: devIcon && existsSync(devIcon) ? devIcon : undefined,
    backgroundColor: '#0f0f0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', event => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  const on = (channel: string, handler: (args: unknown) => unknown): void => {
    ipcMain.handle(channel, (event, args) => {
      if (!win || event.sender !== win.webContents) throw new Error('非法调用')
      return handler(args)
    })
  }

  on('state:get', () => ({
    providers: repo.listProviders(),
    bots: repo.listBots(),
    conversations: repo.listConversations()
  }))
  on('messages:list', args => repo.listMessages(String(args)))
  on('clipboard:write', args => {
    clipboard.writeText(String(args))
    return true
  })
  on('bot:save', args => repo.saveBot(args as BotInput))
  on('bot:remove', args => repo.removeBot(String(args)))
  on('bot:openChat', args => repo.openBotChat(String(args)))
  on('provider:remove', args => repo.removeProvider(String(args)))
  on('run:cancel', args => cancelRun(String(args)))

  on('provider:save', args => {
    const input = args as ProviderInput
    const keyEnc = input.apiKey ? encryptKey(input.apiKey) : undefined
    return repo.saveProvider(input, keyEnc)
  })

  on('provider:test', async args => {
    const provider = repo.getProvider(String(args))
    if (!provider) throw new Error('服务商不存在')
    return testConnection(provider, decryptKey(provider.keyEnc))
  })

  on('provider:fetchModels', async args => {
    const provider = repo.getProvider(String(args))
    if (!provider) throw new Error('服务商不存在')
    const models = await listModels(provider, decryptKey(provider.keyEnc))
    repo.setProviderModels(provider.id, models)
    return models
  })

  on('group:create', args => {
    const { title, botIds } = args as { title: string; botIds: string[] }
    return repo.createGroup(title, botIds)
  })

  on('group:setMembers', args => {
    const { conversationId, botIds } = args as { conversationId: string; botIds: string[] }
    repo.setGroupMembers(conversationId, botIds)
    return true
  })

  on('conversation:setReplyMode', args => {
    const { conversationId, mode } = args as { conversationId: string; mode: 'all' | 'mention' }
    repo.setReplyMode(conversationId, mode)
    return true
  })

  on('run:send', args =>
    respond(args as SendInput, {
      emit: (event: RunEvent) => win?.webContents.send('run:event', event),
      resolveKey: (providerId: string) => {
        const provider = repo.getProvider(providerId)
        return decryptKey(provider?.keyEnc)
      }
    })
  )
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  if (process.platform === 'darwin' && !app.isPackaged) {
    const devIcon = join(app.getAppPath(), 'build/icon.png')
    if (existsSync(devIcon)) app.dock?.setIcon(devIcon)
  }
  // MELLIO_DATA_DIR 便于用独立数据目录做 UI 验收
  repo.initRepo(process.env.MELLIO_DATA_DIR || app.getPath('userData'))

  // 打包后启用严格 CSP；开发时留给 Vite HMR
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"
          ]
        }
      })
    })
  }

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => repo.closeRepo())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
