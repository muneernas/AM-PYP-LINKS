/**
 * Download every image referenced in data/site.json into assets/images/
 * and rewrite img paths to local relative URLs.
 *
 * Usage: node scripts/mirror-images.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SITE_JSON = path.join(ROOT, 'data', 'site.json');
const OUT_DIR = path.join(ROOT, 'assets', 'images');
const CONCURRENCY = 8;

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AM-PYP-LINKS-mirror/1.0)',
          Accept: 'image/*,*/*',
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
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

function extFrom(url, contentType) {
  const clean = url.split('?')[0];
  const m = clean.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i);
  if (m) return '.' + m[1].toLowerCase().replace('jpeg', 'jpg');
  if (/webp/i.test(contentType)) return '.webp';
  if (/png/i.test(contentType)) return '.png';
  if (/gif/i.test(contentType)) return '.gif';
  if (/svg/i.test(contentType)) return '.svg';
  if (/jpe?g/i.test(contentType)) return '.jpg';
  return '.bin';
}

function localName(url, contentType) {
  const clean = url.split('?')[0];
  const base = path.basename(clean).replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase();
  const hash = crypto.createHash('sha1').update(url.split('?')[0]).digest('hex').slice(0, 10);
  let stem = base.replace(/\.[a-z0-9]+$/i, '') || 'image';
  stem = stem.slice(0, 60);
  const ext = extFrom(url, contentType);
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

async function main() {
  const site = JSON.parse(fs.readFileSync(SITE_JSON, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const urls = new Set();
  for (const page of site.pages) {
    const buckets = [];
    if (Array.isArray(page.units)) {
      for (const unit of page.units) buckets.push(...(unit.links || []));
    }
    buckets.push(...(page.links || []));
    for (const link of buckets) {
      const remote = link.imgRemote || link.img;
      if (remote && /^https?:\/\//i.test(remote)) urls.add(remote);
      else if (link.img && /^https?:\/\//i.test(link.img)) urls.add(link.img);
    }
  }
  // brand logo used in index.html
  urls.add(
    'https://ahliyyahmutranpyp.weebly.com/uploads/6/6/4/6/66469863/published/logo.png?1697825544'
  );

  const list = [...urls];
  const map = {};
  let ok = 0;
  let fail = 0;

  console.log(`Mirroring ${list.length} images -> assets/images/`);

  await mapPool(list, CONCURRENCY, async (url) => {
    try {
      const { buffer, contentType } = await fetchBuffer(url);
      const name = localName(url, contentType);
      const dest = path.join(OUT_DIR, name);
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, buffer);
      map[url] = `assets/images/${name}`;
      ok += 1;
      process.stdout.write(`  ok  ${name}\n`);
    } catch (err) {
      fail += 1;
      process.stdout.write(`  FAIL ${url} (${err.message})\n`);
    }
  });

  for (const page of site.pages) {
    const buckets = [];
    if (Array.isArray(page.units)) {
      for (const unit of page.units) buckets.push(...(unit.links || []));
    }
    buckets.push(...(page.links || []));
    for (const link of buckets) {
      const remote = /^https?:\/\//i.test(link.img)
        ? link.img
        : link.imgRemote;
      if (remote && map[remote]) {
        link.imgRemote = remote;
        link.img = map[remote];
      }
    }
  }

  site.imagesMirroredAt = new Date().toISOString();
  site.imageMapCount = ok;
  fs.writeFileSync(SITE_JSON, JSON.stringify(site, null, 2));

  const manifest = {
    mirroredAt: site.imagesMirroredAt,
    ok,
    fail,
    map,
  };
  fs.writeFileSync(
    path.join(ROOT, 'data', 'image-map.json'),
    JSON.stringify(manifest, null, 2)
  );

  // copy logo to a stable path for index.html
  const logoRemote =
    'https://ahliyyahmutranpyp.weebly.com/uploads/6/6/4/6/66469863/published/logo.png?1697825544';
  if (map[logoRemote]) {
    const src = path.join(ROOT, map[logoRemote]);
    const logoDest = path.join(ROOT, 'assets', 'logo.png');
    fs.copyFileSync(src, logoDest);
  }

  console.log(`\nDone. ${ok} saved, ${fail} failed.`);
  console.log('Updated data/site.json and data/image-map.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
