import { AVATAR_META } from '../../../shared/avatars'
import type { Bot } from '../../../shared/types'

const FILES = import.meta.glob('../assets/avatars/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

const URL_BY_ID: Record<string, string> = {}
for (const [path, url] of Object.entries(FILES)) {
  const id = path.split('/').pop()?.replace('.jpg', '')
  if (id) URL_BY_ID[id] = url
}

export function PresetAvatar({
  id,
  size = 36,
  className = ''
}: {
  id: string
  size?: number
  className?: string
}) {
  const meta = AVATAR_META[id]
  const url = URL_BY_ID[id]
  if (!meta || !url) return null
  return (
    <img
      className={`avatar-img ${className}`}
      src={url}
      width={size}
      height={size}
      alt=""
      draggable={false}
      style={{
        borderRadius: Math.round(size * 0.28),
        background: meta.color
      }}
    />
  )
}

export function BotAvatar({
  bot,
  size = 36,
  className = ''
}: {
  bot?: Bot
  size?: number
  className?: string
}) {
  if (bot?.avatar && AVATAR_META[bot.avatar] && URL_BY_ID[bot.avatar]) {
    return <PresetAvatar id={bot.avatar} size={size} className={className} />
  }
  const color = bot?.color || '#8F8F8F'
  return (
    <span
      className={`avatar-fallback ${className}`}
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${color} 26%, transparent)`,
        fontSize: Math.round(size * 0.48)
      }}
      aria-hidden="true"
    >
      {bot?.emoji || '🤖'}
    </span>
  )
}

export function GroupAvatar({ bots, size = 36 }: { bots: Bot[]; size?: number }) {
  const shown = bots.slice(0, 2)
  if (shown.length === 0) {
    return (
      <span className="avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.42 }}>
        ·
      </span>
    )
  }
  return (
    <span className="group-avatar" style={{ width: size, height: size }} aria-hidden="true">
      {shown.map(bot => (
        <span key={bot.id} className="group-avatar-item">
          <BotAvatar bot={bot} size={Math.round(size * 0.72)} />
        </span>
      ))}
    </span>
  )
}
