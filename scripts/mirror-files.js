/**
 * Download Weebly /uploads/ files (pdf, docx, xlsx, mp4, zip, ...) into assets/files/
 * and rewrite hrefs in data/site.json to local paths.
 *
 * Usage: node scripts/mirror-files.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SITE_JSON = path.join(ROOT, 'data', 'site.json');
const OUT_DIR = path.join(ROOT, 'assets', 'files');
const CONCURRENCY = 4;

function decodeHref(url) {
  // Fix scrape artifacts like &#1583; inside URLs
  let u = String(url)
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
  try {
    // encode non-ascii path segments properly for fetch
    const parsed = new URL(u);
    parsed.pathname = parsed.pathname
      .split('/')
      .map((seg) => {
        try {
          return encodeURIComponent(decodeURIComponent(seg));
        } catch {
          return encodeURIComponent(seg);
        }
      })
      .join('/');
    return parsed.href;
  } catch {
    return u;
  }
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AM-PYP-LINKS-files/1.0)',
          Accept: '*/*',
          Referer: 'https://ahliyyahmutranpyp.weebly.com/',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).href;
          res.resume();
          return resolve(fetchBuffer(next));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: res.headers['content-type'] || '',
          })
        );
      }
    );
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
  });
}

function localName(url) {
  const clean = decodeHref(url).split('?')[0];
  let base = 'file';
  try {
    base = decodeURIComponent(path.basename(new URL(clean).pathname));
  } catch {
    base = path.basename(clean);
  }
  base = base.replace(/[<>:"|?*\u0000-\u001f]+/g, '_').replace(/\s+/g, '_');
  if (!base || base === '/' || base === '.') base = 'file';
  const hash = crypto.createHash('sha1').update(clean).digest('hex').slice(0, 10);
  const extMatch = base.match(/(\.[a-z0-9]{1,8})$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  const stem = base.replace(/(\.[a-z0-9]{1,8})$/i, '').slice(0, 80) || 'file';
  return `${stem}-${hash}${ext}`;
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

function collectUploadUrls(site) {
  const urls = new Set();
  for (const page of site.pages) {
    const buckets = [];
    if (page.units) for (const u of page.units) buckets.push(...(u.links || []));
    buckets.push(...(page.links || []));
    for (const link of buckets) {
      const href = link.hrefRemote || link.href;
      if (
        href &&
        /ahliyyahmutranpyp\.weebly\.com\/uploads\//i.test(href)
      ) {
        urls.add(href);
      }
    }
  }
  return [...urls];
}

function rewriteLinks(site, map) {
  for (const page of site.pages) {
    const buckets = [];
    if (page.units) for (const u of page.units) buckets.push(...(u.links || []));
    buckets.push(...(page.links || []));
    for (const link of buckets) {
      const remote = /ahliyyahmutranpyp\.weebly\.com\/uploads\//i.test(link.href)
        ? link.href
        : link.hrefRemote;
      if (remote && map[remote]) {
        link.hrefRemote = remote;
        link.href = map[remote];
        link.internal = false;
        if (link.audit) {
          // Clear Weebly-hosting warning once mirrored
          const notes = (link.audit.notes || []).filter(
            (n) => !/Hosted on Weebly/i.test(n)
          );
          link.audit.notes = notes;
          link.audit.note = notes.join(' ');
          if (!notes.length) {
            link.audit.level = 'ok';
          }
        }
      }
    }
  }
}

async function main() {
  const site = JSON.parse(fs.readFileSync(SITE_JSON, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const list = collectUploadUrls(site);
  console.log(`Mirroring ${list.length} Weebly upload files -> assets/files/`);

  const map = {};
  let ok = 0;
  let fail = 0;
  const failures = [];

  await mapPool(list, CONCURRENCY, async (url) => {
    const fetchUrl = decodeHref(url);
    try {
      const { buffer } = await fetchBuffer(fetchUrl);
      const name = localName(url);
      const dest = path.join(OUT_DIR, name);
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, buffer);
      map[url] = `assets/files/${name}`;
      ok += 1;
      console.log(`  ok  ${name} (${Math.round(buffer.length / 1024)} KB)`);
    } catch (err) {
      fail += 1;
      failures.push({ url, error: err.message, fetchUrl });
      console.log(`  FAIL ${url} (${err.message})`);
    }
  });

  rewriteLinks(site, map);
  site.filesMirroredAt = new Date().toISOString();
  site.filesMirrorSummary = { ok, fail, total: list.length };
  fs.writeFileSync(SITE_JSON, JSON.stringify(site, null, 2));
  fs.writeFileSync(
    path.join(ROOT, 'data', 'file-map.json'),
    JSON.stringify({ mirroredAt: site.filesMirroredAt, ok, fail, map, failures }, null, 2)
  );

  console.log(`\nDone. ${ok} saved, ${fail} failed.`);
  if (failures.length) {
    console.log('Failed downloads:');
    for (const f of failures) console.log(' -', f.url, f.error);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
