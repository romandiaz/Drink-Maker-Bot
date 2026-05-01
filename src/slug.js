// Used by both the admin ingredient picker (client) and the drinks store (server)
// so a user-typed ingredient or drink name produces the same kind of lowercase-
// hyphenated ID as the hand-authored references in SEED_DRINKS.

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
