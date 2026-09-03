/**
 * Audit every resource URL in data/site.json.
 * Writes data/link-audit.json and annotates site.json links with management notes.
 *
 * Usage: node scripts/audit-links.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const SITE_JSON = path.join(ROOT, 'data', 'site.json');
const OUT_JSON = path.join(ROOT, 'data', 'link-audit.json');
const CONCURRENCY = 10;
const TIMEOUT_MS = 15000;

function request(method, urlString, redirects = 0) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      return resolve({ ok: false, status: 0, error: 'invalid-url', finalUrl: urlString });
    }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method,
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; AM-PYP-LINKS-audit/1.0; +school-migration)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        res.resume();

        if ([301, 302, 303, 307, 308].includes(status) && location && redirects < 5) {
          const next = new URL(location, url).href;
          return resolve(request(method, next, redirects + 1));
        }

        resolve({
          ok: status >= 200 && status < 400,
          status,
          finalUrl: url.href,
          redirected: redirects > 0,
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, error: 'timeout', finalUrl: urlString });
    });
    req.on('error', (err) => {
      resolve({
        ok: false,
        status: 0,
        error: err.code || err.message,
        finalUrl: urlString,
      });
    });
    req.end();
  });
}

async function checkUrl(url) {
  let result = await request('HEAD', url);
  // Some hosts block HEAD
  if (
    !result.ok &&
    (result.status === 405 ||
      result.status === 403 ||
      result.status === 400 ||
      result.status === 0)
  ) {
    const getResult = await request('GET', url);
    // Prefer GET details if HEAD was inconclusive
    if (getResult.ok || getResult.status || getResult.error) result = getResult;
  }
  return result;
}

function heuristicNotes(url, check) {
  const notes = [];
  const severity = []; // critical | warning | info

  const lower = url.toLowerCase();

  // Migrated Weebly pages / already-mirrored local files should not warn here.
  // Remaining live Weebly upload URLs still matter until mirrored.
  if (/ahliyyahmutranpyp\.weebly\.com\/uploads\//i.test(url)) {
    notes.push(
      'Still hosted on Weebly uploads — download/mirror before Weebly unpublished (~27 Sep 2026).'
    );
    severity.push('warning');
  } else if (
    /ahliyyahmutranpyp\.weebly\.com/i.test(url) &&
    !/\/uploads\//i.test(url)
  ) {
    // Page links are migrated into AM-PYP-LINKS; no management warning needed.
  }

  // Broken checks only — keep dead Padlets / dead sites visible for management.
  if (check.error === 'timeout') {
    notes.push('Did not respond in time (timeout). May be blocked, down, or very slow.');
    severity.push('critical');
  } else if (check.error === 'ENOTFOUND' || check.error === 'EAI_AGAIN') {
    notes.push('Domain not found (DNS). Link is likely dead or mistyped.');
    severity.push('critical');
  } else if (check.error === 'ECONNREFUSED' || check.error === 'ECONNRESET') {
    notes.push('Connection failed. Site may be down or blocking access.');
    severity.push('critical');
  } else if (check.error === 'CERT_HAS_EXPIRED' || /CERT_/i.test(check.error || '')) {
    notes.push('SSL certificate problem. Browsers will show a security warning.');
    severity.push('critical');
  } else if (check.status === 404 || check.status === 410) {
    if (/padlet\.com/i.test(lower)) {
      notes.push(`Dead Padlet (HTTP ${check.status}). Board missing, removed, or private — replace or remove.`);
    } else {
      notes.push(`Dead link (HTTP ${check.status}). Page missing — replace or remove.`);
    }
    severity.push('critical');
  } else if (check.status === 401 || check.status === 403) {
    if (/padlet\.com/i.test(lower)) {
      notes.push(
        `Padlet access blocked (HTTP ${check.status}). Board may be private/expired — open and confirm sharing.`
      );
      severity.push('warning');
    } else {
      notes.push(
        `Access restricted (HTTP ${check.status}). Resource may be private or removed.`
      );
      severity.push('warning');
    }
  } else if (check.status >= 500) {
    notes.push(`Server error (HTTP ${check.status}) when checked. May be temporarily down.`);
    severity.push('warning');
  } else if (!check.ok && check.status === 0) {
    notes.push(`Could not reach link (${check.error || 'unknown error'}).`);
    severity.push('critical');
  } else if (!check.ok && check.status) {
    notes.push(`Unusual response (HTTP ${check.status}). Manual check recommended.`);
    severity.push('warning');
  }

  if (check.finalUrl && /parking|godaddy|sedo|domain.*(sale|expired)/i.test(check.finalUrl)) {
    notes.push('Redirects to a domain parking page — likely outdated/dead.');
    severity.push('critical');
  }

  const level = severity.includes('critical')
    ? 'critical'
    : severity.includes('warning')
      ? 'warning'
      : notes.length
        ? 'info'
        : 'ok';

  return {
    level,
    notes: [...new Set(notes)],
    status: check.status || 0,
    error: check.error || null,
    finalUrl: check.finalUrl || url,
    ok: !!check.ok,
  };
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

function collectLinks(site) {
  const byUrl = new Map();
  for (const page of site.pages) {
    const units = page.units || [{ id: 'resources', links: page.links || [] }];
    for (const unit of units) {
      for (const link of unit.links || []) {
        if (!link.href || !/^https?:/i.test(link.href)) continue;
        if (!byUrl.has(link.href)) {
          byUrl.set(link.href, {
            href: link.href,
            label: link.label,
            pages: [],
            units: [],
          });
        }
        const entry = byUrl.get(link.href);
        if (!entry.pages.includes(page.id)) entry.pages.push(page.id);
        if (unit.titleEn || unit.titleAr) {
          const uname = unit.titleEn || unit.titleAr;
          if (!entry.units.includes(uname)) entry.units.push(uname);
        }
      }
    }
  }
  return [...byUrl.values()];
}

function annotateSite(site, auditByUrl) {
  for (const page of site.pages) {
    const buckets = [];
    if (page.units) for (const u of page.units) buckets.push(...(u.links || []));
    buckets.push(...(page.links || []));
    for (const link of buckets) {
      // Drop previous audit annotations, then re-apply fresh results.
      delete link.audit;
      const audit = auditByUrl.get(link.href);
      if (!audit) continue;
      // Local mirrored files don't need Weebly warnings.
      if (
        String(link.href).startsWith('assets/') ||
        String(link.href).startsWith('assets\\')
      ) {
        continue;
      }
      link.audit = {
        level: audit.level,
        status: audit.status,
        note: audit.notes.join(' '),
        notes: audit.notes,
        checkedAt: audit.checkedAt,
      };
    }
  }
}

async function main() {
  const site = JSON.parse(fs.readFileSync(SITE_JSON, 'utf8'));
  const links = collectLinks(site);
  console.log(`Auditing ${links.length} unique URLs…`);

  const checkedAt = new Date().toISOString();
  const results = await mapPool(links, CONCURRENCY, async (item, idx) => {
    process.stdout.write(`[${idx + 1}/${links.length}] ${item.href}\n`);
    const check = await checkUrl(item.href);
    const judged = heuristicNotes(item.href, check);
    return {
      ...item,
      ...judged,
      checkedAt,
    };
  });

  const auditByUrl = new Map(results.map((r) => [r.href, r]));
  annotateSite(site, auditByUrl);

  const summary = {
    checkedAt,
    total: results.length,
    critical: results.filter((r) => r.level === 'critical').length,
    warning: results.filter((r) => r.level === 'warning').length,
    info: results.filter((r) => r.level === 'info').length,
    ok: results.filter((r) => r.level === 'ok').length,
  };

  const report = {
    summary,
    // management-friendly ordered list
    issues: results
      .filter((r) => r.level !== 'ok')
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return order[a.level] - order[b.level] || a.href.localeCompare(b.href);
      }),
    all: results,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  site.linkAuditSummary = summary;
  site.linkAuditedAt = checkedAt;
  fs.writeFileSync(SITE_JSON, JSON.stringify(site, null, 2));

  // Markdown report for management
  const md = [];
  md.push('# AM-PYP-LINKS — Link audit for management');
  md.push('');
  md.push(`Checked: ${checkedAt}`);
  md.push('');
  md.push('## Summary');
  md.push('');
  md.push(`- Total unique links: **${summary.total}**`);
  md.push(`- Broken / unreachable: **${summary.critical}**`);
  md.push(`- Needs attention: **${summary.warning}**`);
  md.push(`- FYI / verify access: **${summary.info}**`);
  md.push(`- OK (no issues flagged): **${summary.ok}**`);
  md.push('');
  md.push('## Critical — fix or replace');
  md.push('');
  for (const r of report.issues.filter((i) => i.level === 'critical')) {
    md.push(`### ${r.label || r.href}`);
    md.push(`- URL: ${r.href}`);
    md.push(`- Found on: ${r.pages.join(', ')}`);
    md.push(`- Notes: ${r.notes.join(' ')}`);
    md.push('');
  }
  md.push('## Warning — review soon');
  md.push('');
  for (const r of report.issues.filter((i) => i.level === 'warning')) {
    md.push(`### ${r.label || r.href}`);
    md.push(`- URL: ${r.href}`);
    md.push(`- Found on: ${r.pages.join(', ')}`);
    md.push(`- Notes: ${r.notes.join(' ')}`);
    md.push('');
  }
  md.push('## Info');
  md.push('');
  const infoItems = report.issues.filter((i) => i.level === 'info');
  if (!infoItems.length) {
    md.push('_None_');
  } else {
    for (const r of infoItems) {
      md.push(`- **${r.label || r.href}** — ${r.notes.join(' ')} (${r.pages.join(', ')})`);
    }
  }
  md.push('');

  fs.writeFileSync(path.join(ROOT, 'data', 'LINK-AUDIT-REPORT.md'), md.join('\n'));

  console.log('\nSummary:', summary);
  console.log(`Wrote ${OUT_JSON}`);
  console.log('Wrote data/LINK-AUDIT-REPORT.md');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
