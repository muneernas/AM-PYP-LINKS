/**
 * Remove every link listed in link-audit.json from site.json,
 * except Quick Draw (qd). Then empty the audit report.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE_PATH = path.join(ROOT, 'data', 'site.json');
const AUDIT_PATH = path.join(ROOT, 'data', 'link-audit.json');
const REPORT_PATH = path.join(ROOT, 'data', 'LINK-AUDIT-REPORT.md');

const KEEP = /quickdraw\.withgoogle\.com/i;

const site = JSON.parse(fs.readFileSync(SITE_PATH, 'utf8'));
const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));

const removeHrefs = new Set(
  (audit.issues || [])
    .map((i) => String(i.href || '').trim())
    .filter((href) => href && !KEEP.test(href))
);

let removed = 0;
for (const page of site.pages || []) {
  for (const unit of page.units || []) {
    const before = (unit.links || []).length;
    unit.links = (unit.links || []).filter((link) => {
      const href = String(link.href || '').trim();
      if (removeHrefs.has(href)) {
        removed += 1;
        return false;
      }
      // Drop audit badges from remaining tiles.
      if (link.audit) delete link.audit;
      return true;
    });
    if ((unit.links || []).length !== before) {
      // ok
    }
  }
  page.links = (page.units || []).flatMap((u) => u.links || []);
}

delete site.linkAuditSummary;
delete site.linkAuditedAt;
site.generatedAt = new Date().toISOString();

fs.writeFileSync(SITE_PATH, JSON.stringify(site, null, 2));

const emptyAudit = {
  summary: {
    checkedAt: new Date().toISOString(),
    total: 0,
    critical: 0,
    warning: 0,
    info: 0,
    ok: 0,
  },
  issues: [],
};
fs.writeFileSync(AUDIT_PATH, JSON.stringify(emptyAudit, null, 2));
fs.writeFileSync(
  REPORT_PATH,
  '# Link audit\n\nNo open issues. Audit cleared.\n'
);

console.log(`Removed ${removed} audited dead/warning links from site.json`);
console.log('Kept Quick Draw (qd). Emptied link-audit.json.');
