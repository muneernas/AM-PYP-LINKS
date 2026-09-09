const LABEL_OVERRIDES = [
  { test: /qubitsedu\.com/i, label: 'Qubits' },
  { test: /forms\.cloud\.microsoft/i, label: 'Food Survey' },
  { test: /forms\.gle/i, label: 'Survey' },
  { test: /digital-citizenship/i, label: 'Digital Citizenship' },
  { test: /search-engines/i, label: 'Safe Search Engines' },
  { test: /typing\.html/i, label: 'Learn to Type' },
  { test: /kidsa-z\.com/i, label: 'Raz-Kids' },
  { test: /brainpop\.com/i, label: 'BrainPOP Sortify' },
  { test: /abcya\.com.*find_the_tech/i, label: 'Find the Technology' },
  { test: /abcya\.com\/snowman/i, label: 'Make a Snowman' },
  { test: /make_a_face/i, label: 'Make a Face' },
  { test: /make_a_pumpkin/i, label: 'Make a Pumpkin' },
  { test: /kahoot\.it/i, label: 'Kahoot!' },
  { test: /mathletics|vagxg14-400x400/i, label: 'Mathletics' },
  { test: /scratch\.mit\.edu/i, label: 'Scratch' },
  { test: /toddleapp\.com/i, label: 'Toddle' },
  { test: /office\.com/i, label: 'Microsoft Office' },
  { test: /nearpod\.com/i, label: 'Nearpod' },
  { test: /edu-nation\.net/i, label: 'Edu-Nation' },
  { test: /3d printing in manufacturing|3d-printing/i, label: '3D Printing' },
  { test: /assessment/i, label: 'Assessment' },
  { test: /wordwall\.net/i, label: 'Wordwall' },
  { test: /mybib/i, label: 'MyBib' },
  { test: /national.?geographic/i, label: 'National Geographic' },
];

const el = {
  nav: document.getElementById('primaryNav'),
  title: document.getElementById('pageTitle'),
  meta: document.getElementById('pageMeta'),
  content: document.getElementById('content'),
  stamp: document.getElementById('stamp'),
  menuToggle: document.getElementById('menuToggle'),
};

let site = null;
let audit = null;

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pageIdFromHash() {
  const raw = (location.hash || '#/home').replace(/^#\/?/, '');
  return raw.split('/')[0] || 'home';
}

function weeblyPathToId(href) {
  try {
    const u = new URL(href, location.href);
    if (!String(u.hostname || '').includes('ahliyyahmutranpyp.weebly.com')) {
      // also treat our internal hash pages
      return null;
    }
    let p = u.pathname.replace(/^\//, '').replace(/\.html?$/, '');
    return p || 'home';
  } catch {
    return null;
  }
}

function niceLabel(link) {
  let label = decodeEntities(link.label || '').trim();
  // Respect editor-set titles on the public tiles.
  if (label && label.length > 1 && !/^\d+$/.test(label)) {
    const junk = /^(whatsapp image|download|editor|published|picture|image|untitled)$/i.test(
      label
    );
    if (!junk) return label;
  }

  const hay = `${link.href} ${link.img || ''} ${link.imgRemote || ''} ${link.label || ''}`;
  for (const rule of LABEL_OVERRIDES) {
    if (rule.test.test(hay) && rule.label) return rule.label;
  }

  if (String(link.href || '').startsWith('assets/files/')) {
    const file = link.href.split('/').pop() || 'Download';
    return file.replace(/-[a-z0-9]+\./i, '.').replace(/[-_]/g, ' ');
  }

  if (/padlet\.com/i.test(link.href)) {
    try {
      const parts = new URL(link.href).pathname.split('/').filter(Boolean);
      return parts[parts.length - 1].replace(/-/g, ' ') || 'Padlet';
    } catch {
      return 'Padlet';
    }
  }

  try {
    return new URL(link.href).hostname.replace(/^www\./, '');
  } catch {
    return 'Resource';
  }
}

function isChromeLink(link, currentPageId) {
  const id = weeblyPathToId(link.href);
  if (!id) return false;
  if (id === 'home' && /logo/i.test(link.img || link.imgRemote || '')) return true;
  if (site.primaryNav.includes(id) && !link.img) return true;
  if (id === currentPageId && !link.img) return true;
  return false;
}

function filterLinks(links, pageId) {
  return (links || []).filter((link) => {
    if (/javascript:|^#$/i.test(link.href)) return false;
    if (isChromeLink(link, pageId)) return false;
    if (link.href.endsWith('#') && !link.img) return false;
    return true;
  });
}

function renderNav(activeId) {
  const moreFixed = ['franccedilais', 'robotics'];
  const main = (site.primaryNav || []).filter((id) => !moreFixed.includes(id));
  const inMainOrMore = new Set([...main, ...moreFixed]);
  // Pages created in admin (or migrated extras) that never got into primaryNav.
  const orphans = (site.pages || [])
    .map((p) => p.id)
    .filter((id) => id && !inMainOrMore.has(id));
  const more = [...moreFixed, ...orphans];

  const linkHtml = (id) => {
    const page = site.pages.find((p) => p.id === id);
    if (!page) return '';
    const current = id === activeId ? ' aria-current="page"' : '';
    return `<a href="#/${id}"${current}>${escapeHtml(page.navLabel || page.id)}</a>`;
  };

  const auditCurrent = activeId === 'link-audit' ? ' aria-current="page"' : '';

  el.nav.innerHTML = `
    ${main.map(linkHtml).join('')}
    <div class="more">
      <a href="#/${more[0] || 'home'}" class="more-trigger">More…</a>
      <div class="more-panel">
        ${more.map(linkHtml).join('')}
        <a href="#/link-audit"${auditCurrent}>Link audit</a>
        <a href="/admin/">Admin</a>
      </div>
    </div>
  `;
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/embed\/([\w-]{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function vimeoId(url) {
  try {
    const m = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function tileHtml(link) {
  const label = niceLabel(link);
  const internalId = weeblyPathToId(link.href);
  const migrated =
    internalId && site.pages.some((p) => p.id === internalId);
  const href = migrated ? `#/${internalId}` : link.href;
  const external = !href.startsWith('#/');
  const isLocalFile = href.startsWith('assets/files/');
  const yt = youtubeId(link.href);
  const vim = vimeoId(link.href);
  const isVideo = link.kind === 'video' || yt || vim;

  let actionTag = !external ? 'Page' : isLocalFile ? 'Download' : 'Open';
  if (isVideo) actionTag = 'Watch';

  const thumb =
    link.img ||
    (yt ? `https://img.youtube.com/vi/${yt}/hqdefault.jpg` : null);

  const media = thumb
    ? `<div class="tile-media"><img src="${escapeHtml(thumb)}" alt="" loading="lazy" /></div>`
    : `<div class="tile-media"><div class="tile-fallback">${escapeHtml(
        isVideo
          ? '▶'
          : isLocalFile
            ? (link.href.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()
            : label.slice(0, 2).toUpperCase()
      )}</div></div>`;

  // If the Weebly page was migrated, don't scare people with Weebly-shutdown notes.
  let auditInfo = link.audit;
  if (migrated && auditInfo?.notes) {
    const notes = auditInfo.notes.filter((n) => !/Hosted on Weebly/i.test(n));
    if (!notes.length) auditInfo = null;
    else {
      const level = notes.some((n) =>
        /missing|dead|DNS|timeout|SSL|unreachable/i.test(n)
      )
        ? 'critical'
        : notes.some((n) => /HTTP|insecure|restricted/i.test(n))
          ? 'warning'
          : 'info';
      auditInfo = { ...auditInfo, notes, note: notes.join(' '), level };
    }
  }
  if (isLocalFile && auditInfo?.notes) {
    const notes = auditInfo.notes.filter((n) => !/Hosted on Weebly/i.test(n));
    if (!notes.length) auditInfo = null;
    else auditInfo = { ...auditInfo, notes, note: notes.join(' ') };
  }

  const noteHtml =
    auditInfo && auditInfo.level && auditInfo.level !== 'ok' && auditInfo.note
      ? `<span class="tile-note ${escapeHtml(auditInfo.level)}">${escapeHtml(
          auditInfo.note
        )}</span>`
      : '';

  const levelClass =
    auditInfo && auditInfo.level && auditInfo.level !== 'ok'
      ? ` has-${auditInfo.level}`
      : '';

  const displayLabel =
    isVideo && (/^YouTube video$/i.test(label) || /^Vimeo video$/i.test(label))
      ? yt
        ? 'NetFit / PE video (YouTube)'
        : 'PE video (Vimeo)'
      : label;

  return `
    <a class="tile${levelClass}${isVideo ? ' tile-video' : ''}" href="${escapeHtml(href)}" ${
      external ? 'target="_blank" rel="noopener noreferrer"' : ''
    }${isLocalFile ? ' download' : ''}>
      ${media}
      <div class="tile-label">
        <span class="tile-title">${escapeHtml(displayLabel)}</span>
        <span class="tile-tag">${actionTag}</span>
        ${noteHtml}
      </div>
    </a>`;
}

function unitSectionHtml(unit, pageId) {
  const links = filterLinks(unit.links, pageId);
  if (!links.length && !unit.title) return '';

  const hasTitle = Boolean(unit.titleAr || unit.titleEn || unit.title);
  const head = hasTitle
    ? `<header class="unit-head">
        ${unit.titleAr ? `<p class="unit-ar" lang="ar" dir="rtl">${escapeHtml(unit.titleAr)}</p>` : ''}
        ${unit.titleEn ? `<h2 class="unit-en">${escapeHtml(unit.titleEn)}</h2>` : unit.title ? `<h2 class="unit-en">${escapeHtml(unit.title)}</h2>` : ''}
        ${
          unit.centralIdea
            ? `<p class="unit-idea"><span>Central Idea:</span> ${escapeHtml(unit.centralIdea)}</p>`
            : ''
        }
      </header>`
    : '';

  if (!links.length) {
    return `<section class="unit">${head}</section>`;
  }

  return `
    <section class="unit">
      ${head}
      <div class="tile-grid">
        ${links.map(tileHtml).join('')}
      </div>
    </section>`;
}

function renderAuditPage() {
  document.title = 'Link audit · Ahliyyah & Mutran';
  el.title.textContent = 'Link audit';
  renderNav('link-audit');

  if (!audit) {
    el.meta.textContent = 'Run npm run audit-links to generate the management report.';
    el.content.innerHTML = `<p class="empty">No audit data yet. From the project folder run <code>npm run audit-links</code>, then refresh.</p>`;
    return;
  }

  const s = audit.summary;
  el.meta.textContent = `Checked ${new Date(s.checkedAt).toLocaleString()} · for management review`;

  const groups = [
    ['critical', 'Dead links — fix or replace'],
    ['warning', 'Needs attention'],
    ['info', 'Other notes'],
  ];

  el.content.innerHTML = `
    <div class="audit-summary">
      <div class="audit-stat"><strong>${s.total}</strong><span>Total unique links</span></div>
      <div class="audit-stat"><strong>${s.critical}</strong><span>Critical</span></div>
      <div class="audit-stat"><strong>${s.warning}</strong><span>Warning</span></div>
      <div class="audit-stat"><strong>${s.info}</strong><span>Info</span></div>
      <div class="audit-stat"><strong>${s.ok}</strong><span>OK</span></div>
    </div>
    ${groups
      .map(([level, heading]) => {
        const items = (audit.issues || []).filter((i) => i.level === level);
        if (!items.length) return '';
        return `
          <section class="unit">
            <header class="unit-head">
              <h2 class="unit-en">${escapeHtml(heading)} <span class="audit-badge ${level}">${
                items.length
              }</span></h2>
            </header>
            <div class="audit-list">
              ${items
                .map(
                  (item) => `
                <article class="audit-item">
                  <h3>${escapeHtml(item.label || item.href)} <span class="audit-badge ${level}">${level}</span></h3>
                  <a href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                    item.href
                  )}</a>
                  <p><strong>Pages:</strong> ${escapeHtml((item.pages || []).join(', ') || '—')}</p>
                  <p>${escapeHtml((item.notes || []).join(' '))}</p>
                </article>`
                )
                .join('')}
            </div>
          </section>`;
      })
      .join('')}
  `;
}

function renderPage(id) {
  if (id === 'link-audit') {
    renderAuditPage();
    return;
  }

  const page = site.pages.find((p) => p.id === id) || site.pages.find((p) => p.id === 'home');
  if (!page) {
    el.content.innerHTML = `<p class="empty">Page not found.</p>`;
    return;
  }

  document.title = `${page.navLabel} · Ahliyyah & Mutran`;
  el.title.textContent = page.navLabel;

  const namedUnits = (page.units || []).filter((u) => u.titleAr || u.titleEn);
  el.meta.textContent = namedUnits.length
    ? `${namedUnits.length} unit plans`
    : 'Resource links from the Weebly site';

  renderNav(page.id);

  const units = page.units && page.units.length
    ? page.units
    : [{ id: 'resources', title: '', links: page.links || [] }];

  const html = units.map((u) => unitSectionHtml(u, page.id)).join('');
  el.content.innerHTML = html || `<p class="empty">No resource links found on this page yet.</p>`;
}

function route() {
  document.body.classList.remove('nav-open');
  el.menuToggle?.setAttribute('aria-expanded', 'false');
  renderPage(pageIdFromHash());
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function boot() {
  let loadedFromDraft = false;
  try {
    const draft = localStorage.getItem('am-pyp-links-draft');
    if (draft) {
      site = JSON.parse(draft);
      loadedFromDraft = true;
    }
  } catch {
    loadedFromDraft = false;
  }

  if (!site) {
    try {
      const live = await fetch('api/site', { cache: 'no-store' });
      if (live.ok) site = await live.json();
    } catch {
      // fall through
    }
  }

  if (!site) {
    const res = await fetch('data/site.json');
    if (!res.ok) throw new Error('Could not load data/site.json');
    site = await res.json();
  }

  try {
    const auditRes = await fetch('data/link-audit.json');
    if (auditRes.ok) audit = await auditRes.json();
  } catch {
    audit = null;
  }

  el.stamp.textContent = loadedFromDraft
    ? `local draft ${new Date(site.generatedAt || Date.now()).toLocaleString()}`
    : `synced ${new Date(site.generatedAt || Date.now()).toLocaleString()}`;
  el.menuToggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    el.menuToggle.setAttribute('aria-expanded', String(open));
  });
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = '#/home';
  else route();
}

boot().catch((err) => {
  el.content.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
});
