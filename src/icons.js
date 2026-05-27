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

export const PLUS_SVG = `
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M8 3.5V12.5 M3.5 8H12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
`;


// Lucide-style bell. Header notifications button + a small unread dot
// applied via CSS when the indicator is showing.
export const BELL_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
  </svg>
`;

// Lucide "settings" cog — eight rounded teeth around a central circle. Reads
// as a gear at small sizes (14–16px) far better than the prior sun/rays glyph.
export const COG_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
      fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/>
  </svg>
`;

// Lucide "home" — pitched roof + door cutout. Used in the admin header to
// return straight to idle, bypassing the tab/screen stack.
export const HOME_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3 9.5L12 3l9 6.5V20a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"
      fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

// Top-down view of a glass on the platform. Used in the header next to the
// READY pill as a glass-presence indicator: the ring is always visible
// (the sensor is always watching), the inner dot fades in when glass-watch
// detects a glass. Both elements use currentColor so the parent class can
// shift them between "watching, none yet" and "I see your glass."
export const GLASS_TOPDOWN_SVG = `
  <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false" class="glass-icon">
    <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.2"/>
    <path d="" fill="currentColor" class="glass-icon__pie"/>
    <circle cx="7" cy="7" r="2.2" fill="currentColor" class="glass-icon__center"/>
  </svg>
`;

// Five-pip die — the "Surprise me" entry pill on the category screen.
export const DICE_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="3" y="3" width="18" height="18" rx="4.5" fill="none" stroke="currentColor" stroke-width="1.7"/>
    <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
    <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="8.5" cy="15.5" r="1.5" fill="currentColor"/>
    <circle cx="15.5" cy="15.5" r="1.5" fill="currentColor"/>
  </svg>
`;

// Lucide "power" — vertical stem inside an open arc. Used by the admin
// header's restart button.
export const POWER_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 3v9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M18.36 6.64a9 9 0 1 1-12.72 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

// Lucide "history" clock-with-arrow. Used in the admin header alongside notifications.
export const HISTORY_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3 3v5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M12 7v5l4 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
