// Flat 2D side-profile glass illustrations — placeholders until real photography lands.
// viewBox is 120×160 (3:4 portrait) so these sit in the same footprint as the future photos.
// The outline uses non-scaling-stroke so lines stay 1px regardless of render size.

import { ingredientColor } from "../ingredients.js";

const PATHS = {
  coupe: {
    liquid: "M24 36 L96 36 Q96 76 60 76 Q24 76 24 36 Z",
    outline: "M22 34 L98 34 Q98 78 60 78 Q22 78 22 34 M60 78 L60 140 M40 142 L80 142",
  },
  rocks: {
    liquid: "M28 80 L92 80 L89 143 Q89 147 85 147 L35 147 Q31 147 31 143 Z",
    outline: "M26 36 L94 36 L91 144 Q91 149 86 149 L34 149 Q29 149 29 144 Z",
  },
  highball: {
    liquid: "M36 46 L84 46 L83 152 Q83 154 80 154 L40 154 Q37 154 37 152 Z",
    outline: "M34 26 L86 26 L85 153 Q85 156 82 156 L38 156 Q35 156 35 153 Z",
  },
  margarita: {
    liquid: "M18 34 L102 34 L60 96 Z",
    outline: "M14 32 L106 32 L60 100 Z M60 100 L60 140 M40 142 L80 142",
  },
  // A squat shot glass — narrower than rocks, centered low in the viewBox.
  shot: {
    liquid: "M44 80 L76 80 L75 138 Q75 140 73 140 L47 140 Q45 140 45 138 Z",
    outline: "M43 58 L77 58 L76 139 Q76 142 73 142 L47 142 Q44 142 44 139 Z",
  },
};

// Approximate "filled to the brim" volumes per glass type, in oz. Used by
// layeredGlass to map total recipe volume to a visual fill height — a 2oz
// pour in a rocks glass should look noticeably less full than a 5oz pour.
// These are display-only; nothing physical is enforced from these numbers.
const GLASS_FULL_OZ = {
  coupe: 5,
  rocks: 8,
  highball: 11,
  margarita: 6,
  shot: 1.5,
};

// Full-interior paths for layeredGlass — these span the whole inside of the
// glass shape, top to bottom, so the gradient's transparent "empty" region
// can sit naturally above the colored bands. The single-color renderer keeps
// PATHS[*].liquid (which deliberately sits at the bottom of the glass to
// suggest realistic headspace) so existing screens aren't visually disturbed.
const INTERIOR_PATHS = {
  coupe: PATHS.coupe.liquid, // already fills the full bowl
  rocks: "M28 38 L92 38 L89 144 Q89 148 85 148 L35 148 Q31 148 31 144 Z",
  highball: "M36 28 L84 28 L83 153 Q83 155 80 155 L40 155 Q37 155 37 153 Z",
  margarita: PATHS.margarita.liquid, // already fills the full bowl
  shot: "M45 60 L75 60 L74 139 Q74 141 72 141 L48 141 Q46 141 46 139 Z",
};

function svgString(inner) {
  return `<svg viewBox="0 0 120 160" class="glass" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${inner}</svg>`;
}

function singleFillSvg(p, fill) {
  return svgString(
    `<path class="glass-liquid" d="${p.liquid}" fill="${fill}"/><path class="glass-outline" d="${p.outline}"/>`
  );
}

function layeredFillSvg(p, defs, fill) {
  return svgString(
    `<defs>${defs}</defs><path class="glass-liquid" d="${p.liquid}" fill="${fill}"/><path class="glass-outline" d="${p.outline}"/>`
  );
}

const TEMPLATES = {
  coupe: (fill) => singleFillSvg(PATHS.coupe, fill),
  rocks: (fill) => singleFillSvg(PATHS.rocks, fill),
  highball: (fill) => singleFillSvg(PATHS.highball, fill),
  margarita: (fill) => singleFillSvg(PATHS.margarita, fill),
  shot: (fill) => singleFillSvg(PATHS.shot, fill),
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

// Render the glass with proportional, ingredient-colored bands. Used by the
// build-your-own screen so the user can see — at a glance — how their recipe
// fills the glass and which ingredients dominate.
//
// Implementation: a vertical SVG <linearGradient> with back-to-back stops at
// the same offset to produce hard band edges. The empty portion of the glass
// (when total volume < glass capacity) is rendered transparent at the top, so
// the visible liquid level scales with totalOz / GLASS_FULL_OZ. Bands are
// stacked recipe-order-from-the-bottom: ingredients[0] sits at the base of
// the liquid, the most recently added ingredient floats at the top — the same
// mental model as building a drink by hand.
export function layeredGlass(drink, { width = 60 } = {}) {
  const outlinePath = PATHS[drink.glassType];
  const interiorPath = INTERIOR_PATHS[drink.glassType];
  if (!outlinePath || !interiorPath) {
    throw new Error(`Unknown glass type: ${drink.glassType}`);
  }
  const p = { liquid: interiorPath, outline: outlinePath.outline };

  const wrap = document.createElement("span");
  wrap.className = "glass-wrap";
  wrap.style.width = `${width}px`;

  const layers = (drink.ingredients || []).filter(
    (i) => i.name && i.volumeOz > 0
  );

  if (layers.length === 0) {
    // Empty glass — outline only, no fill. Keeps the silhouette visible while
    // the user is still picking ingredients.
    wrap.innerHTML = singleFillSvg(p, "transparent");
    return wrap;
  }

  const totalOz = layers.reduce((s, i) => s + i.volumeOz, 0);
  const maxOz = GLASS_FULL_OZ[drink.glassType] ?? 6;
  const fillFraction = Math.min(1, totalOz / maxOz);
  const emptyPct = (1 - fillFraction) * 100;

  // gradientUnits defaults to objectBoundingBox, so 0%→100% maps to the top→
  // bottom of the glass-liquid path's bounding box.
  const gradientId = `gl-${Math.random().toString(36).slice(2, 9)}`;
  let stops = `<stop offset="0%" stop-color="transparent"/>`;
  if (emptyPct > 0) {
    stops += `<stop offset="${emptyPct.toFixed(2)}%" stop-color="transparent"/>`;
  }

  // Iterate top-to-bottom: most recently added first, so ingredients[0] (the
  // base spirit, typically) ends up at the bottom.
  let cum = 0;
  const topToBottom = [...layers].reverse();
  for (const ing of topToBottom) {
    const startPct = emptyPct + (cum / totalOz) * fillFraction * 100;
    cum += ing.volumeOz;
    const endPct = emptyPct + (cum / totalOz) * fillFraction * 100;
    const color = ingredientColor(ing.name);
    stops += `<stop offset="${startPct.toFixed(2)}%" stop-color="${color}"/>`;
    stops += `<stop offset="${endPct.toFixed(2)}%" stop-color="${color}"/>`;
  }

  const defs = `<linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>`;
  wrap.innerHTML = layeredFillSvg(p, defs, `url(#${gradientId})`);
  return wrap;
}
