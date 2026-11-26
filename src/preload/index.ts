import { contextBridge, ipcRenderer } from 'electron'
import type { MellioApi, RunEvent } from '../../shared/types'

const api: MellioApi = {
  platform: process.platform,
  copyText: text => ipcRenderer.invoke('clipboard:write', text),
  getState: () => ipcRenderer.invoke('state:get'),
  listMessages: conversationId => ipcRenderer.invoke('messages:list', conversationId),
  saveBot: input => ipcRenderer.invoke('bot:save', input),
  removeBot: id => ipcRenderer.invoke('bot:remove', id),
  saveProvider: input => ipcRenderer.invoke('provider:save', input),
  removeProvider: id => ipcRenderer.invoke('provider:remove', id),
  testProvider: id => ipcRenderer.invoke('provider:test', id),
  fetchModels: id => ipcRenderer.invoke('provider:fetchModels', id),
  openBotChat: botId => ipcRenderer.invoke('bot:openChat', botId),
  createGroup: (title, botIds) => ipcRenderer.invoke('group:create', { title, botIds }),
  setGroupMembers: (conversationId, botIds) =>
    ipcRenderer.invoke('group:setMembers', { conversationId, botIds }),
  setReplyMode: (conversationId, mode) =>
    ipcRenderer.invoke('conversation:setReplyMode', { conversationId, mode }),
  send: input => ipcRenderer.invoke('run:send', input),
  cancel: runId => ipcRenderer.invoke('run:cancel', runId),
  onRunEvent: cb => {
    const listener = (_event: unknown, event: RunEvent): void => cb(event)
    ipcRenderer.on('run:event', listener)
    return () => {
      ipcRenderer.removeListener('run:event', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
