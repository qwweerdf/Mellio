// 品牌标记：一颗酸橙色的方块，里面是三条对话线。
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0" y="0" width="24" height="24" rx="7" fill="var(--accent)" />
      <rect x="5" y="6.1" width="14" height="3.1" rx="1.55" fill="var(--accent-ink)" />
      <rect x="5" y="10.45" width="9.4" height="3.1" rx="1.55" fill="var(--accent-ink)" opacity="0.72" />
      <rect x="5" y="14.8" width="5.8" height="3.1" rx="1.55" fill="var(--accent-ink)" opacity="0.46" />
    </svg>
  )
}
