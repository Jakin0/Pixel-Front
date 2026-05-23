export const createDataURI = (svg: string) => `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;

const shell = (body: string) => createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="steel" x1="8" y1="4" x2="54" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f4f1dc"/>
      <stop offset="0.34" stop-color="#b9b4a0"/>
      <stop offset="0.72" stop-color="#6f746f"/>
      <stop offset="1" stop-color="#303733"/>
    </linearGradient>
    <linearGradient id="dark" x1="12" y1="8" x2="50" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#59615c"/>
      <stop offset="1" stop-color="#171c1c"/>
    </linearGradient>
    <linearGradient id="brass" x1="10" y1="5" x2="52" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff0a6"/>
      <stop offset="0.48" stop-color="#c89d38"/>
      <stop offset="1" stop-color="#5f4419"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d9f7ff"/>
      <stop offset="0.45" stop-color="#67c7e8"/>
      <stop offset="1" stop-color="#16334b"/>
    </linearGradient>
    <filter id="cut" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#050606" flood-opacity="0.85"/>
      <feDropShadow dx="0" dy="0" stdDeviation="0.7" flood-color="#fff7d0" flood-opacity="0.32"/>
    </filter>
  </defs>
  <g filter="url(#cut)" stroke="#070909" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">
    ${body}
  </g>
</svg>`);

export const TANK_SVG = shell(`
  <rect x="6" y="8" width="52" height="10" rx="4" fill="url(#dark)"/>
  <rect x="6" y="46" width="52" height="10" rx="4" fill="url(#dark)"/>
  <rect x="10" y="15" width="38" height="34" rx="7" fill="url(#steel)"/>
  <path d="M15 22h27M15 42h27M17 18l-4 8v12l4 8M43 18l4 8v12l-4 8" fill="none" stroke="#f8edc2" stroke-opacity=".45"/>
  <ellipse cx="29" cy="32" rx="12" ry="10" fill="#d7d2ba"/>
  <rect x="29" y="28" width="29" height="8" rx="3" fill="url(#brass)"/>
  <circle cx="29" cy="32" r="4" fill="#252b29"/>
  <path d="M11 13h44M11 51h44" stroke="#0d1110" stroke-width="4" stroke-dasharray="3 4"/>
`);

export const INFANTRY_SVG = shell(`
  <path d="M14 12l8-5 8 5v10l-8 5-8-5zM34 12l8-5 8 5v10l-8 5-8-5zM24 34l8-5 8 5v12l-8 6-8-6z" fill="url(#steel)"/>
  <circle cx="22" cy="17" r="5" fill="#f2ead2"/>
  <circle cx="42" cy="17" r="5" fill="#f2ead2"/>
  <circle cx="32" cy="40" r="5" fill="#f2ead2"/>
  <path d="M25 17h15M35 40h18M9 40h18" stroke="url(#brass)" stroke-width="4"/>
  <path d="M14 51l36-38" stroke="#fff6c8" stroke-opacity=".35"/>
`);

export const MARINE_SVG = shell(`
  <path d="M32 5c11 8 17 18 17 31 0 14-9 22-17 23-8-1-17-9-17-23C15 23 21 13 32 5z" fill="url(#steel)"/>
  <path d="M18 39c8-5 20-5 28 0M22 48c6-4 14-4 20 0" fill="none" stroke="#7ed6ff" stroke-width="3" stroke-opacity=".7"/>
  <path d="M32 11v39M20 31h24" stroke="#111716" stroke-width="4"/>
  <circle cx="32" cy="23" r="8" fill="url(#glass)"/>
  <path d="M28 18l8 10" stroke="#ffffff" stroke-opacity=".65"/>
  <path d="M15 34l-7 9M49 34l7 9" stroke="url(#brass)" stroke-width="4"/>
`);

export const IFV_SVG = shell(`
  <path d="M8 18l8-8h32l8 8v28l-8 8H16l-8-8z" fill="url(#steel)"/>
  <path d="M13 14h38M13 50h38" stroke="#111" stroke-width="6" stroke-dasharray="5 5"/>
  <rect x="21" y="23" width="22" height="18" rx="4" fill="#d8d0b7"/>
  <rect x="41" y="29" width="16" height="5" rx="2" fill="url(#brass)"/>
  <rect x="15" y="25" width="8" height="14" fill="url(#glass)"/>
  <path d="M25 27h13M25 37h13M11 20l45 24" stroke="#fff4c7" stroke-opacity=".28"/>
`);

export const ARTILLERY_SVG = shell(`
  <rect x="7" y="17" width="30" height="30" rx="5" fill="url(#steel)"/>
  <rect x="26" y="25" width="34" height="10" rx="3" fill="url(#brass)"/>
  <circle cx="24" cy="32" r="10" fill="#d8d0b7"/>
  <circle cx="24" cy="32" r="4" fill="#222928"/>
  <path d="M11 17L5 7M11 47L5 57M35 45l11 12" stroke="#f5e6b6" stroke-width="4"/>
  <path d="M31 20l22 8M31 44l22-8" stroke="#ffffff" stroke-opacity=".28"/>
`);

export const RECON_SVG = shell(`
  <path d="M7 22l8-10h28l12 10v20L43 52H15L7 42z" fill="url(#steel)"/>
  <circle cx="17" cy="17" r="6" fill="url(#dark)"/>
  <circle cx="47" cy="17" r="6" fill="url(#dark)"/>
  <circle cx="17" cy="47" r="6" fill="url(#dark)"/>
  <circle cx="47" cy="47" r="6" fill="url(#dark)"/>
  <path d="M25 20h14l5 8H20z" fill="url(#glass)"/>
  <path d="M16 38h32M51 24l8-3" stroke="url(#brass)" stroke-width="4"/>
  <circle cx="52" cy="32" r="4" fill="#f5eecf"/>
`);

export const HQ_SVG = shell(`
  <path d="M32 4l26 18-10 32H16L6 22z" fill="url(#steel)"/>
  <path d="M32 10l18 13-7 23H21l-7-23z" fill="#292f2d"/>
  <circle cx="32" cy="32" r="12" fill="url(#brass)"/>
  <path d="M32 18l4 9h10l-8 6 3 10-9-6-9 6 3-10-8-6h10z" fill="#fff4bd" stroke="none"/>
  <path d="M14 51h36M32 10v12M20 24h24" stroke="#fff6d0" stroke-opacity=".38"/>
`);

export const FACTORY_SVG = shell(`
  <rect x="5" y="25" width="54" height="31" rx="4" fill="url(#steel)"/>
  <path d="M5 25l10-15 10 15 10-15 10 15 8-12v12" fill="#7f8073"/>
  <rect x="44" y="6" width="8" height="19" rx="2" fill="url(#dark)"/>
  <rect x="12" y="33" width="10" height="10" fill="url(#glass)"/>
  <rect x="28" y="33" width="10" height="10" fill="url(#glass)"/>
  <rect x="44" y="33" width="8" height="23" fill="#242b2a"/>
  <path d="M10 50h30M49 6c8 2 9 8 4 12" stroke="#e9dcc0" stroke-opacity=".45"/>
`);

export const SUPPLY_TRUCK_SVG = shell(`
  <rect x="7" y="16" width="31" height="32" rx="5" fill="url(#steel)"/>
  <rect x="36" y="20" width="19" height="26" rx="4" fill="#c4b99b"/>
  <rect x="42" y="25" width="8" height="12" rx="2" fill="url(#glass)"/>
  <circle cx="16" cy="16" r="6" fill="url(#dark)"/>
  <circle cx="45" cy="16" r="6" fill="url(#dark)"/>
  <circle cx="16" cy="48" r="6" fill="url(#dark)"/>
  <circle cx="45" cy="48" r="6" fill="url(#dark)"/>
  <path d="M15 32h15M22 25v14" stroke="url(#brass)" stroke-width="5"/>
  <path d="M10 21h24M10 43h24" stroke="#fff7cb" stroke-opacity=".28"/>
`);

export const ENGINEER_SVG = shell(`
  <circle cx="25" cy="34" r="15" fill="url(#steel)"/>
  <path d="M35 24l16-16 5 5-16 16M40 30l13 13-7 7-13-13" fill="url(#brass)"/>
  <path d="M18 23h14l4 8H14z" fill="#f4b247"/>
  <circle cx="25" cy="35" r="6" fill="#f5edd1"/>
  <path d="M11 53l41-41M13 45l8 8M42 16l8 8" stroke="#fff4c2" stroke-opacity=".35"/>
`);

export const ROCKET_SVG = shell(`
  <circle cx="19" cy="45" r="9" fill="url(#steel)"/>
  <path d="M21 43l20-13" stroke="#f7ead0" stroke-width="5"/>
  <path d="M31 17l24-8-8 24z" fill="url(#brass)"/>
  <path d="M34 20l10 10" stroke="#121716" stroke-width="4"/>
  <rect x="8" y="15" width="13" height="16" rx="3" fill="url(#dark)"/>
  <path d="M10 16l10 14M48 10l7-7M51 16l9-1" stroke="#fff2bd" stroke-opacity=".42"/>
`);

export const AA_SVG = shell(`
  <rect x="8" y="41" width="48" height="13" rx="5" fill="url(#steel)"/>
  <circle cx="18" cy="54" r="6" fill="url(#dark)"/>
  <circle cx="46" cy="54" r="6" fill="url(#dark)"/>
  <rect x="24" y="18" width="7" height="27" rx="2" fill="url(#brass)" transform="rotate(-18 27 31)"/>
  <rect x="37" y="16" width="7" height="29" rx="2" fill="url(#brass)" transform="rotate(-18 40 30)"/>
  <path d="M13 34l19-22 19 22" fill="none" stroke="#dff8ff" stroke-width="4"/>
  <path d="M32 12v24M22 24h20" stroke="#091010" stroke-opacity=".8"/>
`);

export const BUNKER_SVG = shell(`
  <path d="M7 54l7-30 18-15 18 15 7 30z" fill="url(#steel)"/>
  <path d="M14 35h36v10H14z" fill="#111615"/>
  <path d="M16 27h32M21 20h22M10 54h44" stroke="#fff4c9" stroke-opacity=".36"/>
  <path d="M17 44h30" stroke="url(#brass)" stroke-width="3"/>
  <circle cx="32" cy="29" r="4" fill="#252b29"/>
`);

export const FOB_SVG = shell(`
  <path d="M7 55l25-48 25 48z" fill="url(#steel)"/>
  <path d="M18 43h28M23 33h18M32 14v36" stroke="#121716" stroke-width="4"/>
  <circle cx="32" cy="28" r="7" fill="url(#brass)"/>
  <path d="M17 54l30-30M47 54L17 24" stroke="#fff3be" stroke-opacity=".32"/>
  <path d="M24 55h16" stroke="#f5e6b6" stroke-width="5"/>
`);
