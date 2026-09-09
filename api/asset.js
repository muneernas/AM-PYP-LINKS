const { get } = require('@vercel/blob');
const { Readable } = require('node:stream');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(404).json({ error: 'Blob not configured' });
    return;
  }

  const rawPath = String(req.query.path || '');
  const pathname = decodeURIComponent(rawPath).replace(/^\/+/, '');
  if (!pathname.startsWith('am-pyp/assets/')) {
    res.status(400).json({ error: 'Invalid asset path' });
    return;
  }

  try {
    const result = await get(pathname, {
      access: 'private',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    if (!result?.stream) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    res.setHeader('Content-Type', result.blob?.contentType || result.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    Readable.fromWeb(result.stream).pipe(res);
  } catch (err) {
    const message = err.message || 'Failed to load asset';
    if (/not found|404|does not exist/i.test(message)) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    res.status(500).json({ error: message });
  }
};
