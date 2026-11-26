// 预设头像元数据。图片在 src/renderer/assets/avatars/<id>.jpg。
// id 会写进数据库，改名时需要迁移。

export const AVATAR_IDS = [
  'golden-retriever',
  'sheep-3',
  'fox-broad-forehead-right',
  'corgi-3',
  'baby-hippopotamus',
  'cream-gray-raccoon',
  'peach-eared-white-bunny',
  'sea-otter-3',
  'hamster-alert-round-eyes-left',
  'fox-round-face-left',
  'dog-single-side-patch-left',
  'giraffe-gentle-smile',
  'squirrel-happy-small-mouth-right',
  'deer-2',
  'dog-forehead-emphasis-left'
] as const

export type AvatarId = (typeof AVATAR_IDS)[number]

export interface AvatarMeta {
  id: AvatarId
  label: string
  emoji: string
  /** 底色，仅用于加载中和旧数据兜底 */
  color: string
}

export const AVATARS: AvatarMeta[] = [
  { id: 'golden-retriever', label: '金毛', emoji: '🐕', color: '#1F3B2B' },
  { id: 'sheep-3', label: '绵羊', emoji: '🐑', color: '#5B7CFA' },
  { id: 'fox-broad-forehead-right', label: '赤狐', emoji: '🦊', color: '#5B7CFA' },
  { id: 'corgi-3', label: '柯基', emoji: '🐕', color: '#1F6B6B' },
  { id: 'baby-hippopotamus', label: '河马', emoji: '🦛', color: '#7FE3B0' },
  { id: 'cream-gray-raccoon', label: '浣熊', emoji: '🦝', color: '#2E332F' },
  { id: 'peach-eared-white-bunny', label: '白兔', emoji: '🐰', color: '#5B7CFA' },
  { id: 'sea-otter-3', label: '水獭', emoji: '🦦', color: '#1E4E8C' },
  { id: 'hamster-alert-round-eyes-left', label: '仓鼠', emoji: '🐹', color: '#3F6FD8' },
  { id: 'fox-round-face-left', label: '小狐狸', emoji: '🦊', color: '#2B2F2C' },
  { id: 'dog-single-side-patch-left', label: '花斑狗', emoji: '🐶', color: '#2B2F2C' },
  { id: 'giraffe-gentle-smile', label: '长颈鹿', emoji: '🦒', color: '#10236B' },
  { id: 'squirrel-happy-small-mouth-right', label: '松鼠', emoji: '🐿️', color: '#F3EDE2' },
  { id: 'deer-2', label: '小鹿', emoji: '🦌', color: '#2E4A32' },
  { id: 'dog-forehead-emphasis-left', label: '小狗', emoji: '🐶', color: '#D8F58A' }
]

export const AVATAR_META: Record<string, AvatarMeta> = Object.fromEntries(
  AVATARS.map(avatar => [avatar.id, avatar])
)
