import './YuiSyncMark.css'

export default function YuiSyncMark({
  animated = false,
  className = '',
  decorative = false,
  inverted = false,
  orbit = false,
  title = 'YuiSync',
}) {
  const accessibilityProps = decorative
    ? { 'aria-hidden': true }
    : { 'aria-label': title, role: 'img' }

  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={`yuisync-mark ${inverted ? 'yuisync-mark--inverted' : ''} ${animated ? 'yuisync-mark--animated' : ''} ${orbit ? 'yuisync-mark--orbit' : ''} ${className}`.trim()}
      {...accessibilityProps}
    >
      {orbit && (
        <ellipse
          className="yuisync-mark__orbit"
          cx="32"
          cy="34"
          rx="29"
          ry="12"
          transform="rotate(-17 32 34)"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      )}

      <circle className="yuisync-mark__disc" cx="32" cy="32" r="25" fill="currentColor" />
      <path
        className="yuisync-mark__arc yuisync-mark__arc--left"
        d="M5 39c5 5 10 7.5 16 9"
        fill="none"
        stroke="var(--yuisync-mark-cut)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        className="yuisync-mark__arc yuisync-mark__arc--right"
        d="M43 47c7-2.5 12-6 16-11"
        fill="none"
        stroke="var(--yuisync-mark-cut)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        className="yuisync-mark__glyph"
        d="M15.5 13h7.5c1.5 0 2.7.7 3.5 2l5.5 8.5 6-8.5c.8-1.3 2-2 3.5-2h7c2.4 0 3.7 2.8 2.1 4.5L37 33v14a5 5 0 0 1-10 0V33L13.2 17.5c-1.5-1.7-.3-4.5 2.3-4.5Z"
        fill="var(--yuisync-mark-cut)"
      />
    </svg>
  )
}
