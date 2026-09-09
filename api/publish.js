const { put } = require('@vercel/blob');
const { createHash } = require('crypto');

const SITE_PATH = 'am-pyp/site.json';
// Same hash as admin login for password PYP@2026 (override with ADMIN_PASSWORD_HASH on Vercel).
const DEFAULT_PASS_HASH =
  '9e6d2d7ec5959d8e52b57cc4206bd82b6ee14f290f621f1654b9c86009b2078a';

function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      resolve(req.body);
      return;
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 4.5 * 1024 * 1024) {
        reject(new Error('Publish payload is too large (max ~4.5 MB on Vercel). Use smaller files.'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function rewritePath(site, fromPath, toUrl) {
  for (const page of site.pages || []) {
    for (const unit of page.units || []) {
      for (const link of unit.links || []) {
        if (link.href === fromPath) link.href = toUrl;
        if (link.img === fromPath) link.img = toUrl;
      }
    }
    for (const link of page.links || []) {
      if (link.href === fromPath) link.href = toUrl;
      if (link.img === fromPath) link.img = toUrl;
    }
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(503).json({
      error:
        'Vercel Blob is not connected yet. In the Vercel project: Storage → Create Blob store → connect it to this project.',
    });
    return;
  }

  try {
    const body = await readBody(req);
    const password = String(body.password || '');
    const expected = process.env.ADMIN_PASSWORD_HASH || DEFAULT_PASS_HASH;
    if (!password || sha256(password) !== expected) {
      res.status(401).json({ error: 'Wrong admin password.' });
      return;
    }

    const site = body.site;
    if (!site || !Array.isArray(site.pages)) {
      res.status(400).json({ error: 'Missing site data.' });
      return;
    }

    const files = Array.isArray(body.files) ? body.files : [];
    for (const file of files) {
      if (!file?.path || !file?.base64) continue;
      const safePath = String(file.path).replace(/^\/+/, '');
      if (!safePath.startsWith('assets/')) {
        throw new Error(`Refusing to publish unexpected path: ${safePath}`);
      }
      const buffer = Buffer.from(file.base64, 'base64');
      if (buffer.length > 4 * 1024 * 1024) {
        throw new Error(`File too large for Publish: ${safePath}. Keep each file under 4 MB.`);
      }
      const blob = await put(`am-pyp/${safePath}`, buffer, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: file.mime || 'application/octet-stream',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      rewritePath(site, safePath, blob.url);
    }

    site.generatedAt = new Date().toISOString();
    site.hostedOn = 'vercel';

    await put(SITE_PATH, JSON.stringify(site, null, 2), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    res.status(200).json({ ok: true, site });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Publish failed' });
  }
};
