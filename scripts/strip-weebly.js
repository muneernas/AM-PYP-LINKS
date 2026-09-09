/**
 * Strip Weebly URLs from the bundled site.json fallback.
 * Live Vercel Blob content is cleaned in the browser / on next Publish.
 */
const fs = require('fs');
const path = require('path');

const SITE_PATH = path.join(__dirname, '..', 'data', 'site.json');
const CORE = new Set([
  'home',
  'grade-1',
  'grade-2',
  'grade-3',
  'grade-4',
  'grade-5',
  'pe-videos',
  'franccedilais',
  'robotics',
]);

function weeblyPathToId(href) {
  try {
    const u = new URL(href);
    if (!/ahliyyahmutranpyp\.weebly\.com/i.test(u.hostname || '')) return null;
    return u.pathname.replace(/^\//, '').replace(/\.html?$/, '') || 'home';
  } catch {
    return null;
  }
}

function cleanLink(link, pages) {
  if (!link) return null;
  const next = { ...link };
  delete next.imgRemote;
  delete next.hrefRemote;
  delete next.internal;

  let href = String(next.href || '').trim();
  if (!href || href === '#' || /javascript:/i.test(href)) return null;

  if (/ahliyyahmutranpyp\.weebly\.com/i.test(href)) {
    const id = weeblyPathToId(href);
    if (!id || !pages.some((p) => p.id === id)) return null;
    if (!next.img && CORE.has(id)) return null;
    href = `#/${id}`;
    next.href = href;
    if (/weebly\.com/i.test(next.label || '')) {
      const page = pages.find((p) => p.id === id);
      next.label = page?.navLabel || id.replace(/-/g, ' ');
    }
  }

  if (/weebly\.com/i.test(href) && !href.startsWith('#/')) return null;
  next.href = href;
  return next;
}

const site = JSON.parse(fs.readFileSync(SITE_PATH, 'utf8'));
delete site.sourceLive;
let removed = 0;
for (const page of site.pages || []) {
  for (const unit of page.units || []) {
    const before = (unit.links || []).length;
    unit.links = (unit.links || [])
      .map((link) => cleanLink(link, site.pages))
      .filter(Boolean);
    removed += before - unit.links.length;
  }
  page.links = (page.units || []).flatMap((u) => u.links || []);
}
site.generatedAt = new Date().toISOString();
fs.writeFileSync(SITE_PATH, JSON.stringify(site, null, 2));
console.log(`Cleaned site.json — removed ${removed} Weebly links/fields`);
