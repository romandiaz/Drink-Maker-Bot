// Shared inline SVG strings. Kept as raw source so callers can assign directly
// to `innerHTML` — there's no build step to import .svg files.

export const CHEVRON_LEFT_SVG = `
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

export const SEARCH_SVG = `
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
    <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
`;

export const CLOSE_SVG = `
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M4 4L12 12 M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
`;

export const CHECK_SVG = `
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M3 8.5L6.5 12L13 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
