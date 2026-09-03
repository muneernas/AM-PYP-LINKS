/**
 * Extract Padlet (and labeled) links from a Weebly website-site-*-data.csv dump.
 * Usage: node scripts/extract-from-weebly.js [path-to-csv-or-export-folder]
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_EXPORT =
  'C:/Users/MuneerNassraween/Downloads/weebly-export-inspect';

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    )
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findSiteCsvs(input) {
  const st = fs.statSync(input);
  if (st.isFile()) return [input];
  return fs
    .readdirSync(input)
    .filter((f) => f.startsWith('website-site-') && f.endsWith('-data.csv'))
    .map((f) => path.join(input, f))
    .sort(
      (a, b) => fs.statSync(b).size - fs.statSync(a).size
    );
}

function parsePages(text) {
  const pages = new Map();
  const m = text.match(/^pages\s*\r?\n([\s\S]*?)(?=\r?\nproperties\b)/m);
  if (!m) return pages;
  for (const row of m[1].split(/\r?\n/)) {
    const r = row.trim();
    if (!r || r.startsWith('id,')) continue;
    const match = r.match(/^(\d+),(.*)$/);
    if (!match) continue;
    let title = match[2].trim();
    if (title.startsWith('"') && title.endsWith('"')) title = title.slice(1, -1);
    pages.set(match[1], decodeEntities(title));
  }
  return pages;
}

function guessCategory(label, url) {
  const t = `${label} ${url}`.toLowerCase();
  if (/\bkg\b|kindergarten/.test(t)) return 'KG';
  if (/grade\s*1|\b1[abc]\b|صف.?أول/.test(t)) return 'Grade 1';
  if (
    /grade\s*2|\b2[a-f]\b|صف.?ثاني|organize2|how\s*we\s*express|howweexpress|howweexpree|whoweare|feel today|how-do-you-feel|padlet 2d/.test(
      t
    )
  )
    return 'Grade 2';
  if (/grade\s*3|\b3[abc]+\b|صف.?ثالث/.test(t)) return 'Grade 3';
  if (
    /grade\s*4|\b4[a-f]\b|رابع|mutran|ahliyyah|express[abc]|sustainable|prototype|testing-the-product|testing-the-prototype/.test(
      t
    )
  )
    return 'Grade 4';
  if (/grade\s*5|\b5[abc]\b|خامس|five[abc]/.test(t)) return 'Grade 5';
  if (/grade\s*6|\bgr6\b|سادس|pyp_bsa6/.test(t)) return 'Grade 6';
  if (/pyp_bsa7/.test(t)) return 'Grade 7';
  if (/pyp_bsa5/.test(t)) return 'Grade 5';
  if (/pyp_bsa1/.test(t)) return 'Grade 1';
  if (/diversity|world|energy|padlet\.com\/asgschool\/world/.test(t))
    return 'Shared / Units';
  return 'Other';
}

function titleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    let slug = parts[parts.length - 1] || parts.join(' ');
    // Drop trailing padlet id tokens like -og89cgzuy9qj84ns
    slug = slug.replace(/-[a-z0-9]{10,}$/i, '');
    const cleaned = decodeEntities(slug.replace(/[-_]+/g, ' ')).trim();
    // If still a short meaningless hash, use owner / id
    if (/^[a-z0-9]{6,14}$/i.test(cleaned) && !/[aeiou]{2}|grade|padlet|who|how|express/i.test(cleaned) && parts.length >= 2) {
      return `${parts[0]} / ${cleaned}`;
    }
    return cleaned || url;
  } catch {
    return url;
  }
}

function extractFromCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const siteId = path.basename(filePath).replace(/^website-site-/, '').replace(/-data\.csv$/, '');
  const pages = parsePages(text);
  const links = new Map(); // url -> {url, label, sources}

  const add = (url, label, source) => {
    if (!url || !/^https?:\/\/(?:www\.)?padlet\.com\//i.test(url)) return;
    if (/^https?:\/\/(?:www\.)?padlet\.com\/?$/i.test(url)) return;
    url = url.replace(/[),.;]+$/, '');
    const cleanLabel = decodeEntities(label || '') || titleFromUrl(url);
    const prev = links.get(url);
    if (!prev) {
      links.set(url, {
        url,
        label: cleanLabel,
        category: guessCategory(cleanLabel, url),
        sources: [source],
      });
    } else {
      if (cleanLabel && cleanLabel.length > prev.label.length && cleanLabel !== url) {
        prev.label = cleanLabel;
        prev.category = guessCategory(cleanLabel, url);
      }
      if (!prev.sources.includes(source)) prev.sources.push(source);
    }
  };

  // Pattern: button url property then nearby title property
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const urlMatch = line.match(/^\d+,(https:\/\/(?:www\.)?padlet\.com\/\S+)$/i);
    if (urlMatch) {
      let label = '';
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const lm = lines[j].match(/^\d+,"?(.*?)"?$/);
        if (!lm) continue;
        const candidate = decodeEntities(lm[1]);
        if (
          candidate &&
          !/^https?:/i.test(candidate) &&
          !/^\d+px$/.test(candidate) &&
          !/^(normal|bold|Picture|true|false)$/i.test(candidate) &&
          candidate.length < 120
        ) {
          label = candidate;
          break;
        }
      }
      add(urlMatch[1], label, siteId);
      continue;
    }

    // HTML anchors
    const re =
      /<a[^>]+href=["'](https?:\/\/(?:www\.)?padlet\.com\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(line))) {
      add(m[1], m[2], siteId);
    }

    // bare padlet urls in html/text
    const bare = line.match(/https?:\/\/(?:www\.)?padlet\.com\/[^\s"'<>]+/gi) || [];
    for (const u of bare) add(u, '', siteId);
  }

  return {
    siteId,
    pageTitles: [...pages.values()],
    links: [...links.values()],
  };
}

function main() {
  const input = process.argv[2] || DEFAULT_EXPORT;
  const csvs = findSiteCsvs(input);
  const byUrl = new Map();
  const siteSummaries = [];

  for (const csv of csvs) {
    const extracted = extractFromCsv(csv);
    siteSummaries.push({
      siteId: extracted.siteId,
      pageCount: extracted.pageTitles.length,
      linkCount: extracted.links.length,
      pages: extracted.pageTitles,
    });
    for (const link of extracted.links) {
      const prev = byUrl.get(link.url);
      if (!prev) byUrl.set(link.url, link);
      else {
        if (link.label.length > prev.label.length) prev.label = link.label;
        prev.category = guessCategory(prev.label, prev.url);
        prev.sources = [...new Set([...prev.sources, ...link.sources])];
      }
    }
  }

  const links = [...byUrl.values()].sort((a, b) => {
    const cat = a.category.localeCompare(b.category);
    if (cat) return cat;
    return a.label.localeCompare(b.label, 'en', { sensitivity: 'base' });
  });

  const categories = [...new Set(links.map((l) => l.category))];
  const data = {
    siteName: 'AM-PYP-LINKS',
    generatedAt: new Date().toISOString(),
    source: input,
    totalLinks: links.length,
    categories,
    sites: siteSummaries.filter((s) => s.linkCount > 0 || s.pageCount > 5),
    links,
  };

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'links.json');
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
  console.log(`Wrote ${links.length} links -> ${outFile}`);
  for (const c of categories) {
    console.log(`  ${c}: ${links.filter((l) => l.category === c).length}`);
  }
}

main();
