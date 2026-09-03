/**
 * Crawl the live Weebly site and write structured site data for AM-PYP-LINKS.
 * Grade pages are split into PYP unit sections (H2 + Central Idea + links).
 *
 * Usage: node scripts/scrape-live-weebly.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ORIGIN = 'https://ahliyyahmutranpyp.weebly.com';
const SEED = [
  '/',
  '/grade-1.html',
  '/grade-2.html',
  '/grade-3.html',
  '/grade-4.html',
  '/grade-5.html',
  '/pe-videos.html',
  '/franccedilais.html',
  '/robotics.html',
  '/search-engines.html',
  '/typing.html',
  '/kg-1--2.html',
  '/word-wall.html',
  '/vr-videos.html',
  '/canva-grade-5.html',
];

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; AM-PYP-LINKS-migrator/1.0)',
          Accept: 'text/html',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).href;
          res.resume();
          return resolve(fetchText(next));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    );
    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('timeout')));
  });
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&egrave;/g, 'è')
    .replace(/&eacute;/g, 'é')
    .replace(/&agrave;/g, 'à')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    )
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' '));
}

function absolute(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function guessLabel(href, imgAlt, imgSrc, anchorText) {
  const text = stripTags(anchorText || '');
  if (text && text.length < 80 && !/^picture$/i.test(text)) return text;
  if (imgAlt && imgAlt !== 'Picture') return imgAlt;
  try {
    const u = new URL(href);
    if (u.hostname.includes('padlet')) {
      const parts = u.pathname.split('/').filter(Boolean);
      return (parts[parts.length - 1] || 'Padlet').replace(/-/g, ' ');
    }
    const host = u.hostname.replace(/^www\./, '');
    const known = {
      'qubitsedu.com': 'Qubits',
      'kahoot.it': 'Kahoot!',
      'scratch.mit.edu': 'Scratch',
      'nearpod.com': 'Nearpod',
      'toddleapp.com': 'Toddle',
      'office.com': 'Microsoft Office',
      'kidsa-z.com': 'Raz-Kids',
      'mathletics.com': 'Mathletics',
      'abcya.com': 'ABCya',
      'brainpop.com': 'BrainPOP',
      'edu-nation.net': 'Edu-Nation',
      'forms.gle': 'Google Form',
      'forms.cloud.microsoft': 'Microsoft Form',
      'canva.com': 'Canva',
      'wordwall.net': 'Wordwall',
      'mybib.com': 'MyBib',
      'nationalgeographic.com': 'National Geographic',
    };
    for (const [k, v] of Object.entries(known)) {
      if (host.includes(k) || href.includes(k)) return v;
    }
    if (/abcya\.com\/snowman/i.test(href)) return 'Make a Snowman';
    if (/make_a_face/i.test(href)) return 'Make a Face';
    if (/make_a_pumpkin/i.test(href)) return 'Make a Pumpkin';
    if (imgSrc) {
      const file = imgSrc.split('/').pop().split('?')[0];
      return file.replace(/[_-]+/g, ' ').replace(/\.(png|jpe?g|gif|webp|svg)$/i, '');
    }
    return host;
  } catch {
    return href;
  }
}

function extractLinksFromHtml(html, pageUrl) {
  const links = [];
  const seen = new Set();
  const re = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = absolute(m[2], pageUrl);
    if (!href) continue;
    if (
      /javascript:|#weebly|cdn-cgi|facebook|twitter|instagram|weebly\.com\/(app|signup|login)/i.test(
        href
      )
    )
      continue;

    const inner = m[4] || '';
    const img = inner.match(/<img\b[^>]*>/i);
    let imgSrc = null;
    let imgAlt = null;
    if (img) {
      imgSrc = (img[0].match(/\bsrc=["']([^"']+)["']/i) || [])[1] || null;
      imgAlt = (img[0].match(/\balt=["']([^"']*)["']/i) || [])[1] || null;
      if (imgSrc) imgSrc = absolute(imgSrc, pageUrl);
    }

    const label = guessLabel(href, imgAlt, imgSrc, inner);
    const key = href + '|' + (imgSrc || '') + '|' + label;
    if (seen.has(key)) continue;
    seen.add(key);

    const isInternal =
      href.includes('ahliyyahmutranpyp.weebly.com') || href.startsWith(ORIGIN);

    links.push({
      href,
      label,
      img: imgSrc,
      internal: isInternal,
    });
  }
  return links;
}

function parseUnitHeading(h2InnerHtml) {
  // Prefer br-separated structure: Arabic / English / Central Idea
  const parts = h2InnerHtml
    .split(/<br\s*\/?>/i)
    .map((p) => stripTags(p))
    .filter(Boolean);

  let titleAr = '';
  let titleEn = '';
  let centralIdea = '';

  if (parts.length >= 2) {
    titleAr = parts[0];
    // English line may include "Central Idea" if font tags collapsed oddly
    const enLine = parts[1];
    const ideaFromParts = parts.slice(2).join(' ');
    const ideaMatch = (ideaFromParts || enLine).match(/Central Idea\s*:?\s*(.*)$/i);
    if (ideaMatch) {
      centralIdea = ideaMatch[1].trim();
      titleEn = enLine.replace(/Central Idea\s*:?\s*.*$/i, '').trim() || enLine;
      if (/^Central Idea/i.test(enLine) && parts[1]) {
        // unusual ordering
        titleEn = parts.find((p) => /[A-Za-z]/.test(p) && !/^Central Idea/i.test(p)) || '';
      }
    } else {
      titleEn = enLine;
      centralIdea = ideaFromParts.replace(/^Central Idea\s*:?\s*/i, '').trim();
    }
  } else {
    const full = stripTags(h2InnerHtml);
    const ideaMatch = full.match(/Central Idea\s*:?\s*(.*)$/i);
    if (ideaMatch) centralIdea = ideaMatch[1].trim();
    const before = full.replace(/Central Idea\s*:?\s*.*$/i, '').trim();
    // Split Arabic vs English roughly
    const enMatch = before.match(
      /(How we express ourselves|How we organize ourselves|Where we are in place and time|How the world works|Sharing the planet|Who we are)(.*)?$/i
    );
    if (enMatch) {
      titleEn = enMatch[1].trim();
      titleAr = before.replace(enMatch[0], '').trim();
    } else {
      titleEn = before;
    }
  }

  // Clean titleEn if it still embeds central idea
  titleEn = titleEn.replace(/Central Idea\s*:?\s*.*$/i, '').trim();
  centralIdea = centralIdea.replace(/^Central Idea\s*:?\s*/i, '').trim();

  return {
    titleAr,
    titleEn,
    centralIdea,
    title: [titleAr, titleEn].filter(Boolean).join(' · ') || 'Unit',
  };
}

function looksLikeUnitHeading(meta, rawInner) {
  const blob = `${meta.titleAr} ${meta.titleEn} ${meta.centralIdea} ${stripTags(rawInner)}`;
  if (/Central Idea/i.test(blob)) return true;
  if (
    /How we express ourselves|How we organize ourselves|Where we are in place and time|How the world works|Sharing the planet|Who we are/i.test(
      blob
    )
  )
    return true;
  // Arabic-only unit titles on nested pages
  if (/[\u0600-\u06FF]/.test(meta.titleAr || meta.titleEn) && (meta.titleAr || meta.titleEn).length > 3)
    return true;
  return false;
}

function extractUnits(html, pageUrl) {
  const contentMatch =
    html.match(
      /<div[^>]+id=["']wsite-content["'][^>]*>([\s\S]*?)<div[^>]+class=["'][^"']*wsite-footer/i
    ) ||
    html.match(/<div[^>]+id=["']wsite-content["'][^>]*>([\s\S]*?)$/i);

  const content = contentMatch ? contentMatch[1] : html;
  const h2re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  const matches = [...content.matchAll(h2re)];

  const unitMatches = matches.filter((m) =>
    looksLikeUnitHeading(parseUnitHeading(m[1]), m[1])
  );

  if (!unitMatches.length) {
    return [
      {
        id: 'resources',
        titleAr: '',
        titleEn: '',
        centralIdea: '',
        title: '',
        links: extractLinksFromHtml(content, pageUrl),
      },
    ];
  }

  const units = [];

  // Content before first real unit heading
  const before = content.slice(0, unitMatches[0].index);
  const introLinks = extractLinksFromHtml(before, pageUrl);
  if (introLinks.length) {
    units.push({
      id: 'intro',
      titleAr: '',
      titleEn: '',
      centralIdea: '',
      title: '',
      links: introLinks,
    });
  }

  for (let i = 0; i < unitMatches.length; i++) {
    const start = unitMatches[i].index + unitMatches[i][0].length;
    const end =
      i + 1 < unitMatches.length ? unitMatches[i + 1].index : content.length;
    const chunk = content.slice(start, end);
    const meta = parseUnitHeading(unitMatches[i][1]);
    const id =
      (meta.titleEn || meta.titleAr || `unit-${i + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9\u0600-\u06ff]+/gi, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || `unit-${i + 1}`;

    units.push({
      id,
      titleAr: meta.titleAr,
      titleEn: meta.titleEn,
      centralIdea: meta.centralIdea,
      title: meta.title,
      links: extractLinksFromHtml(chunk, pageUrl),
    });
  }

  return units;
}

function pageIdFromUrl(url) {
  const u = new URL(url);
  let p = u.pathname.replace(/^\//, '').replace(/\.html?$/, '');
  return p || 'home';
}

function navLabel(id) {
  const map = {
    home: 'Home',
    'grade-1': 'Grade 1',
    'grade-2': 'Grade 2',
    'grade-3': 'Grade 3',
    'grade-4': 'Grade 4',
    'grade-5': 'Grade 5',
    'pe-videos': 'PE Videos',
    franccedilais: 'Français',
    robotics: 'Robotics',
    'search-engines': 'Safe Search Engines',
    typing: 'Learn to Type',
  };
  return map[id] || id.replace(/-/g, ' ');
}

function applyImageMap(pages) {
  const mapFile = path.join(__dirname, '..', 'data', 'image-map.json');
  if (!fs.existsSync(mapFile)) return pages;
  const { map } = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  for (const page of pages) {
    for (const unit of page.units || []) {
      for (const link of unit.links) {
        if (link.img && map[link.img]) {
          link.imgRemote = link.img;
          link.img = map[link.img];
        }
      }
    }
    // flat links convenience
    for (const link of page.links || []) {
      if (link.img && map[link.img]) {
        link.imgRemote = link.imgRemote || link.img;
        link.img = map[link.img];
      }
    }
  }
  return pages;
}

async function main() {
  const queue = [...SEED];
  const visited = new Set();
  const pages = [];

  while (queue.length) {
    const pathPart = queue.shift();
    const url = pathPart.startsWith('http') ? pathPart : ORIGIN + pathPart;
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      process.stdout.write(`fetch ${url}\n`);
      const html = await fetchText(url);
      const id = pageIdFromUrl(url);
      const units = extractUnits(html, url);
      const links = units.flatMap((u) => u.links);
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      pages.push({
        id,
        path: new URL(url).pathname,
        title: titleMatch ? stripTags(titleMatch[1]) : url,
        navLabel: navLabel(id),
        units,
        links,
        headings: units
          .filter((u) => u.title)
          .map((u) => u.title),
      });

      for (const l of links) {
        if (!l.internal) continue;
        const u = new URL(l.href);
        if (u.hostname !== 'ahliyyahmutranpyp.weebly.com') continue;
        if (!u.pathname.endsWith('.html') && u.pathname !== '/') continue;
        const next = u.pathname === '/' ? '/' : u.pathname;
        const full = ORIGIN + (next === '/' ? '/' : next);
        if (!visited.has(full)) queue.push(next);
      }
    } catch (err) {
      process.stdout.write(`skip ${url}: ${err.message}\n`);
    }
  }

  applyImageMap(pages);

  const data = {
    siteName: 'AM-PYP-LINKS',
    brand: 'Ahliyyah & Mutran',
    sourceLive: ORIGIN,
    generatedAt: new Date().toISOString(),
    primaryNav: [
      'home',
      'grade-1',
      'grade-2',
      'grade-3',
      'grade-4',
      'grade-5',
      'pe-videos',
      'franccedilais',
      'robotics',
    ],
    pages,
  };

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'site.json'), JSON.stringify(data, null, 2));

  console.log(`\nWrote ${pages.length} pages`);
  for (const p of pages) {
    console.log(
      `  ${p.id}: ${p.units.length} units, ${p.links.length} links`
    );
    for (const u of p.units.filter((x) => x.title)) {
      console.log(
        `    - ${u.titleEn || u.titleAr} (${u.links.length})`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
