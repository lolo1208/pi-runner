import type { ManufacturerCountryCode } from '../../../shared/openrouter'

const star = '0,-1 .2245,-.309 .9511,-.309 .3633,.118 .5878,.809 0,.382 -.5878,.809 -.3633,.118 -.9511,-.309 -.2245,-.309'

/** 使用本地矢量国旗，确保 Windows 无国旗表情字体时也能显示。 */
export function CountryFlag({ code }: { code: ManufacturerCountryCode }): React.JSX.Element {
  return <svg className="manufacturer-country-flag" viewBox="0 0 30 20" width="21" height="14" aria-hidden="true">
    <rect width="30" height="20" fill="white" />
    {code === 'US' && <>
      {Array.from({ length: 7 }, (_, i) => <rect key={i} y={i * 40 / 13} width="30" height={20 / 13} fill="#b22234" />)}
      <rect width="12" height={140 / 13} fill="#3c3b6e" />
      {Array.from({ length: 9 }, (_, row) => Array.from({ length: row % 2 ? 5 : 6 }, (_, col) => <polygon key={`${row}:${col}`} points={star} fill="white" transform={`translate(${row % 2 ? 2 + col * 2 : 1 + col * 2},${.6 + row * 1.2}) scale(.48)`} />))}
    </>}
    {code === 'CN' && <>
      <rect width="30" height="20" fill="#de2910" />
      <polygon points={star} fill="#ffde00" transform="translate(5,5) scale(3)" />
      {[[10, 2, 23], [12, 4, 45], [12, 7, 70], [10, 9, 20]].map(([x, y, rotation]) => <polygon key={y} points={star} fill="#ffde00" transform={`translate(${x},${y}) rotate(${rotation})`} />)}
    </>}
    {code === 'FR' && <><rect width="10" height="20" fill="#000091" /><rect x="20" width="10" height="20" fill="#e1000f" /></>}
    {code === 'DE' && <><rect width="30" height="20" fill="#ffce00" /><rect width="30" height="13.333" fill="#dd0000" /><rect width="30" height="6.667" fill="#000" /></>}
    {code === 'SA' && <><rect width="30" height="20" fill="#006c35" /><text x="15" y="10" fill="white" fontSize="5" textAnchor="middle" direction="rtl">لا إله إلا الله</text><path d="M7 13.5h16m-16 0 2 1" fill="none" stroke="white" strokeWidth=".8" /></>}
    {code === 'CA' && <>
      <path fill="#d80621" d="M0 0h7.5v20H0zm22.5 0H30v20h-7.5z" />
      <path fill="#d80621" d="m15 3 1.2 2.7 1.4-.7-.6 4 2.5-1.7.5 1.8 2-.3-1.4 2.7.8 1-5.4 1.1.3 3.4h-1.6l.3-3.4-5.4-1.1.8-1L8 8.8l2 .3.5-1.8L13 9l-.6-4 1.4.7z" />
    </>}
    {code === 'IL' && <>
      <path fill="#0038b8" d="M0 3h30v3H0zm0 11h30v3H0z" />
      <path d="m15 6 3.46 6h-6.92zm0 8-3.46-6h6.92z" fill="none" stroke="#0038b8" strokeWidth=".65" />
    </>}
    {code === 'AE' && <><rect x="7.5" width="22.5" height="6.667" fill="#009a49" /><rect x="7.5" y="13.333" width="22.5" height="6.667" fill="#000" /><rect width="7.5" height="20" fill="#ef3340" /></>}
    {code === 'JP' && <circle cx="15" cy="10" r="6" fill="#bc002d" />}
    {code === 'PL' && <rect y="10" width="30" height="10" fill="#dc143c" />}
    {code === 'KR' && <>
      <g transform="rotate(33.69 15 10)">
        <circle cx="15" cy="10" r="5" fill="#cd2e3a" />
        <path d="M10 10a5 5 0 0 0 10 0a2.5 2.5 0 0 0-5 0a2.5 2.5 0 0 1-5 0" fill="#0047a0" />
      </g>
      {[
        { x: 5, y: 4, angle: -56.31, broken: [] },
        { x: 25, y: 16, angle: -56.31, broken: [0, 1, 2] },
        { x: 25, y: 4, angle: 56.31, broken: [0, 2] },
        { x: 5, y: 16, angle: 56.31, broken: [1] },
      ].map(({ x, y, angle, broken }) => <g key={`${x}:${y}`} transform={`translate(${x},${y}) rotate(${angle})`}>
        {[0, 1, 2].map(i => broken.includes(i)
          ? <path key={i} d={`M-2.5 ${i * 1.2 - 1.6}h2.1v.8h-2.1zm2.9 0h2.1v.8H.4z`} fill="#000" />
          : <rect key={i} x="-2.5" y={i * 1.2 - 1.6} width="5" height=".8" fill="#000" />)}
      </g>)}
    </>}
  </svg>
}
