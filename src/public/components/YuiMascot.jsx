import { useId } from 'react'
import './YuiMascot.css'

export default function YuiMascot({
  animated = false,
  className = '',
  decorative = false,
  inverted = false,
  monochrome = false,
  title = 'YuiSync',
}) {
  const id = useId().replace(/:/g, '')
  const navyGradientId = `yui-navy-${id}`
  const cyanGradientId = `yui-cyan-${id}`
  const accessibilityProps = decorative
    ? { 'aria-hidden': true }
    : { 'aria-label': title, role: 'img' }

  return (
    <svg
      viewBox="180 180 1074 1074"
      xmlns="http://www.w3.org/2000/svg"
      className={`yui-mascot ${animated ? 'yui-mascot--animated' : ''} ${inverted ? 'yui-mascot--inverted' : ''} ${monochrome ? 'yui-mascot--monochrome' : ''} ${className}`.trim()}
      {...accessibilityProps}
    >
      <defs>
        <linearGradient id={navyGradientId} x1="360" y1="260" x2="1040" y2="1240" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--yui-mascot-navy-light)" />
          <stop offset="1" stopColor="var(--yui-mascot-navy)" />
        </linearGradient>
        <linearGradient id={cyanGradientId} x1="470" y1="390" x2="920" y2="1090" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--yui-mascot-cyan-light)" />
          <stop offset="1" stopColor="var(--yui-mascot-cyan)" />
        </linearGradient>
      </defs>

      <g className="yui-mascot__float">
        <path
          className="yui-mascot__fold yui-mascot__fold--left"
          d="M579 306C525 247 432 247 362 276 274 313 221 403 216 515c-6 140 38 306 98 424 18 35 12 87-9 122-32 54-54 117-53 193h508c-18-62-63-111-128-150-52-30-105-54-152-92-83-67-133-158-149-245-17-92 3-182 54-256 40-57 95-94 148-133 37-28 58-49 46-72Z"
          fill={`url(#${navyGradientId})`}
        />
        <path
          className="yui-mascot__fold yui-mascot__fold--right"
          d="M811 306c33-48 97-61 157-53 121 15 221 105 263 236 37 115 56 269 29 423-20 116-42 233-44 342H745c7-62 43-120 97-160 40-30 83-51 122-78 87-59 142-153 158-243 17-97-13-197-74-269-53-62-112-93-169-114-46-17-83-46-68-84Z"
          fill={`url(#${navyGradientId})`}
        />
        <path
          className="yui-mascot__base"
          d="M450 940c160 70 380 70 550-10l216 324H252l198-314Z"
          fill={`url(#${navyGradientId})`}
        />
        <path
          className="yui-mascot__face"
          d="M585 310C615 310 635 370 691 370c57 0 79-60 109-60 30 0 117 74 176 120 84 64 136 161 150 259 15 106-19 199-83 279-69 85-178 132-297 134-121 2-228-34-307-104-77-68-116-155-124-257 4-111 46-216 95-286 60-50 115-77 140-110 10-15 20-35 35-35Z"
          fill={`url(#${cyanGradientId})`}
        />
        <g className="yui-mascot__eyes" fill={`url(#${navyGradientId})`}>
          <rect x="525" y="677" width="69" height="121" rx="34.5" />
          <rect x="839" y="677" width="72" height="121" rx="36" />
        </g>
      </g>
    </svg>
  )
}
