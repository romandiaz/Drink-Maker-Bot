// Flat 2D side-profile glass illustrations — placeholders until real photography lands.
// viewBox is 120×160 (3:4 portrait) so these sit in the same footprint as the future photos.
// The outline uses non-scaling-stroke so lines stay 1px regardless of render size.

const COUPE = (fill) => `
<svg viewBox="0 0 120 160" class="glass" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path class="glass-liquid" d="M24 36 L96 36 Q96 76 60 76 Q24 76 24 36 Z" fill="${fill}"/>
  <path class="glass-outline" d="M22 34 L98 34 Q98 78 60 78 Q22 78 22 34 M60 78 L60 140 M40 142 L80 142"/>
</svg>
`;

const ROCKS = (fill) => `
<svg viewBox="0 0 120 160" class="glass" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path class="glass-liquid" d="M28 80 L92 80 L89 143 Q89 147 85 147 L35 147 Q31 147 31 143 Z" fill="${fill}"/>
  <path class="glass-outline" d="M26 36 L94 36 L91 144 Q91 149 86 149 L34 149 Q29 149 29 144 Z"/>
</svg>
`;

const HIGHBALL = (fill) => `
<svg viewBox="0 0 120 160" class="glass" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path class="glass-liquid" d="M36 46 L84 46 L83 152 Q83 154 80 154 L40 154 Q37 154 37 152 Z" fill="${fill}"/>
  <path class="glass-outline" d="M34 26 L86 26 L85 153 Q85 156 82 156 L38 156 Q35 156 35 153 Z"/>
</svg>
`;

const MARGARITA = (fill) => `
<svg viewBox="0 0 120 160" class="glass" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path class="glass-liquid" d="M18 34 L102 34 L60 96 Z" fill="${fill}"/>
  <path class="glass-outline" d="M14 32 L106 32 L60 100 Z M60 100 L60 140 M40 142 L80 142"/>
</svg>
`;

// A squat shot glass — narrower than ROCKS, centered low in the viewBox.
const SHOT = (fill) => `
<svg viewBox="0 0 120 160" class="glass" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <path class="glass-liquid" d="M44 80 L76 80 L75 138 Q75 140 73 140 L47 140 Q45 140 45 138 Z" fill="${fill}"/>
  <path class="glass-outline" d="M43 58 L77 58 L76 139 Q76 142 73 142 L47 142 Q44 142 44 139 Z"/>
</svg>
`;

const TEMPLATES = {
  coupe: COUPE,
  rocks: ROCKS,
  highball: HIGHBALL,
  margarita: MARGARITA,
  shot: SHOT,
};

// Build a glass illustration for a drink. `width` is the rendered CSS width in px;
// height follows the 3:4 aspect ratio via .glass-wrap.
export function glass(drink, { width = 60 } = {}) {
  const template = TEMPLATES[drink.glassType];
  if (!template) throw new Error(`Unknown glass type: ${drink.glassType}`);

  const wrap = document.createElement("span");
  wrap.className = "glass-wrap";
  wrap.style.width = `${width}px`;

  if (drink.photo) {
    const img = document.createElement("img");
    img.src = drink.photo;
    img.className = "glass";
    img.style.objectFit = "cover";
    // We generated a realistic photo, add a little rounding
    img.style.borderRadius = "8px";
    // Blend the #000000 image background into the UI surfaces
    img.style.mixBlendMode = "lighten";
    // Scale the image up so the glass fills more of the frame.
    // Since the background blends out, the image can safely overflow its box visually.
    img.style.transform = "scale(1.35)";

    img.onerror = () => {
      // Fallback to SVG if the photo doesn't exist
      wrap.innerHTML = template(drink.color);
    };

    wrap.appendChild(img);
  } else {
    wrap.innerHTML = template(drink.color);
  }

  return wrap;
}
