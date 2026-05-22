export const createDataURI = (svg: string) => `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;

export const TANK_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="1.5">
    <rect x="4" y="4" width="24" height="6" fill="#aaa" rx="1" />
    <rect x="4" y="22" width="24" height="6" fill="#aaa" rx="1" />
    <rect x="6" y="8" width="20" height="16" fill="#ccc" rx="2" />
    <circle cx="16" cy="16" r="6" fill="#fff" />
    <rect x="16" y="14" width="14" height="4" fill="#fff" />
  </g>
</svg>`);

export const INFANTRY_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="1.5">
    <!-- Top Left -->
    <circle cx="10" cy="8" r="4" fill="#fff" />
    <path d="M10 8 L18 8" stroke-width="2" />
    <!-- Bottom Left -->
    <circle cx="10" cy="24" r="4" fill="#fff" />
    <path d="M10 24 L18 24" stroke-width="2" />
    <!-- Right Leader -->
    <circle cx="20" cy="16" r="4" fill="#fff" />
    <path d="M20 16 L28 16" stroke-width="2" />
  </g>
</svg>`);

export const MARINE_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="1.5">
    <path d="M16 4 C21 7 24 12 24 18 C24 25 20 29 16 29 C12 29 8 25 8 18 C8 12 11 7 16 4 Z" fill="#dfefff" />
    <path d="M10 16 L22 16" stroke-width="2" />
    <path d="M16 8 L16 25" stroke-width="2" />
    <circle cx="16" cy="12" r="3.5" fill="#fff" />
    <path d="M7 23 C11 20 21 20 25 23" fill="none" stroke="#5dade2" stroke-width="2" />
  </g>
</svg>`);

export const IFV_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="1.5">
    <!-- 3 wheels per side -->
    <rect x="6" y="4" width="5" height="4" fill="#666" rx="1" />
    <rect x="13" y="4" width="5" height="4" fill="#666" rx="1" />
    <rect x="20" y="4" width="5" height="4" fill="#666" rx="1" />
    <rect x="6" y="24" width="5" height="4" fill="#666" rx="1" />
    <rect x="13" y="24" width="5" height="4" fill="#666" rx="1" />
    <rect x="20" y="24" width="5" height="4" fill="#666" rx="1" />
    <!-- Chassis -->
    <polygon points="4,8 26,10 26,22 4,24" fill="#ccc" />
    <rect x="15" y="13" width="6" height="6" fill="#fff" rx="1" />
    <rect x="21" y="15" width="6" height="2" fill="#fff" />
  </g>
</svg>`);

export const ARTILLERY_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="1.5">
    <rect x="4" y="6" width="14" height="20" fill="#aaa" rx="2" />
    <!-- Huge Barrel -->
    <rect x="12" y="13" width="20" height="6" fill="#fff" rx="1" />
    <!-- Supports -->
    <path d="M4 6 L2 2 M4 26 L2 30" stroke="#ccc" stroke-width="2" />
  </g>
</svg>`);

export const RECON_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="1.5">
    <!-- Wheels -->
    <rect x="6" y="4" width="4" height="4" fill="#555" />
    <rect x="20" y="4" width="4" height="4" fill="#555" />
    <rect x="6" y="24" width="4" height="4" fill="#555" />
    <rect x="20" y="24" width="4" height="4" fill="#555" />
    <!-- Body -->
    <path d="M4 8 L 24 8 C 26 12 26 20 24 24 L 4 24 Z" fill="#cfcfcf" />
    <!-- Windshield -->
    <rect x="16" y="10" width="3" height="12" fill="#8bf" />
  </g>
</svg>`);

export const HQ_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="2">
    <!-- Star base -->
    <polygon points="16,2 30,12 24,28 8,28 2,12" fill="#bbb" />
    <circle cx="16" cy="16" r="6" fill="#fff" />
    <!-- Inner star -->
    <polygon points="16,10 18,14 22,14 19,17 20,21 16,19 12,21 13,17 10,14 14,14" fill="#ffcc00" stroke="none" />
  </g>
</svg>`);

export const FACTORY_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="1.5">
    <rect x="2" y="10" width="28" height="20" fill="#ccc" rx="1" />
    <polygon points="2,10 8,2 14,10" fill="#999" />
    <polygon points="14,10 20,2 26,10" fill="#999" />
    <rect x="4" y="14" width="6" height="6" fill="#8bf" />
    <rect x="14" y="14" width="6" height="6" fill="#8bf" />
    <rect x="22" y="2" width="4" height="8" fill="#777" />
  </g>
</svg>`);

export const SUPPLY_TRUCK_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="1.5">
    <!-- Wheels -->
    <rect x="8" y="4" width="6" height="4" fill="#666" rx="1" />
    <rect x="20" y="4" width="6" height="4" fill="#666" rx="1" />
    <rect x="8" y="24" width="6" height="4" fill="#666" rx="1" />
    <rect x="20" y="24" width="6" height="4" fill="#666" rx="1" />
    <!-- Cab -->
    <rect x="20" y="8" width="8" height="16" fill="#aaa" rx="2" />
    <rect x="22" y="10" width="4" height="12" fill="#8bf" />
    <!-- Cargo/Supply Box -->
    <rect x="4" y="7" width="14" height="18" fill="#ddd" rx="1" />
    <text x="11" y="19" font-family="sans-serif" font-weight="bold" font-size="10" stroke="none" fill="#000" text-anchor="middle">S</text>
  </g>
</svg>`);

export const ENGINEER_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="1.5">
    <circle cx="12" cy="16" r="6" fill="#fff" />
    <rect x="18" y="14" width="8" height="4" fill="#666" rx="1" />
    <circle cx="16" cy="9" r="4" fill="#ffb142" />
  </g>
</svg>`);

export const ROCKET_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="1.5">
    <circle cx="10" cy="22" r="4" fill="#fff" />
    <path d="M10 22 L18 18" stroke-width="2" />
    <rect x="13" y="10" width="16" height="5" fill="#ddd" rx="1" transform="rotate(-18 21 12)" />
    <polygon points="28,5 30,11 24,9" fill="#ffcc00" />
    <rect x="5" y="7" width="6" height="8" fill="#aaa" rx="1" />
  </g>
</svg>`);

export const AA_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="1.5">
    <rect x="5" y="20" width="22" height="7" fill="#aaa" rx="2" />
    <circle cx="11" cy="27" r="3" fill="#555" />
    <circle cx="22" cy="27" r="3" fill="#555" />
    <rect x="13" y="12" width="5" height="12" fill="#ddd" rx="1" transform="rotate(-18 15 18)" />
    <rect x="19" y="11" width="5" height="13" fill="#ddd" rx="1" transform="rotate(-18 21 17)" />
    <path d="M8 16 L16 6 L24 16" fill="none" stroke="#fff" stroke-width="2" />
  </g>
</svg>`);

export const BUNKER_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="2">
    <path d="M4 27 L7 11 L16 5 L25 11 L28 27 Z" fill="#bbb" />
    <rect x="8" y="18" width="16" height="5" fill="#222" rx="1" />
    <path d="M7 14 L25 14" stroke="#eee" />
    <path d="M10 10 L22 10" stroke="#eee" />
  </g>
</svg>`);

export const FOB_SVG = createDataURI(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g stroke="#000" stroke-width="2">
    <polygon points="4,28 16,4 28,28" fill="#ddd" />
    <path d="M 8 20 L 24 20" stroke="#000" stroke-width="2" />
    <circle cx="16" cy="14" r="3" fill="#ff4757" stroke="none" />
  </g>
</svg>`);
