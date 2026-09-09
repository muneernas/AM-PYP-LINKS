const { list } = require('@vercel/blob');

const SITE_PATH = 'am-pyp/site.json';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

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

  try {
    const listed = await list({ prefix: SITE_PATH, limit: 1 });
    const blob = (listed.blobs || []).find((b) => b.pathname === SITE_PATH) || listed.blobs?.[0];
    if (!blob?.url) {
      res.status(404).json({ error: 'No published site yet' });
      return;
    }
    const upstream = await fetch(blob.url, { cache: 'no-store' });
    if (!upstream.ok) {
      res.status(502).json({ error: 'Could not read published site' });
      return;
    }
    const site = await upstream.json();
    res.status(200).json(site);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load site' });
  }
};
