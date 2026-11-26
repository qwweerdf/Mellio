// API Key 只用系统安全存储加解密，密文可以落盘，明文只存在于主进程内存。

import { safeStorage } from 'electron'

const PREFIX = 'enc:'

export function encryptKey(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用，无法保存 API Key')
  }
  return PREFIX + safeStorage.encryptString(plain).toString('base64')
}

export function decryptKey(stored?: string): string | undefined {
  if (!stored || !stored.startsWith(PREFIX)) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'))
  } catch {
    return undefined
  }
}
