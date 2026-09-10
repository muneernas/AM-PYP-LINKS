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
    if (!/ahliyyahmutranpyp\.weebly\.com/i.test(String(u.hostname || ''))) {
      return null;
    }
    let p = u.pathname.replace(/^\//, '').replace(/\.html?$/, '');
    return p || 'home';
  } catch {
    return null;
  }
}

function isWeeblyUrl(value) {
  return /weebly\.com/i.test(String(value || ''));
}

function sanitizeLink(link, pages) {
  if (!link) return null;
  const next = { ...link };
  delete next.imgRemote;
  delete next.hrefRemote;
  delete next.internal;

  let href = String(next.href || '').trim();
  if (!href || /javascript:/i.test(href) || href === '#') return null;

  if (/ahliyyahmutranpyp\.weebly\.com/i.test(href)) {
    const id = weeblyPathToId(href);
    if (!id) return null;
    const exists = (pages || []).some((p) => p.id === id);
    // Keep only remapped internal pages; drop old Weebly chrome/nav leftovers.
    if (!exists) return null;
    if (!next.img && ['home', 'grade-1', 'grade-2', 'grade-3', 'grade-4', 'grade-5', 'pe-videos', 'franccedilais', 'robotics'].includes(id)) {
      return null;
    }
    href = `#/${id}`;
    next.href = href;
    if (isWeeblyUrl(next.label)) {
      const page = (pages || []).find((p) => p.id === id);
      next.label = page?.navLabel || id.replace(/-/g, ' ');
    }
  }

  // Hide any remaining Weebly-hosted destinations from the public tiles.
  if (isWeeblyUrl(href) && !href.startsWith('#/')) return null;
  if (isWeeblyUrl(next.label) && !next.img) return null;

  next.href = href;
  return next;
}

function sanitizeSiteData(data) {
  if (!data || !Array.isArray(data.pages)) return data;
  delete data.sourceLive;
  for (const page of data.pages) {
    if (!Array.isArray(page.units)) continue;
    for (const unit of page.units) {
      unit.links = (unit.links || [])
        .map((link) => sanitizeLink(link, data.pages))
        .filter(Boolean);
    }
    page.links = page.units.flatMap((unit) => unit.links || []);
  }
  return data;
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
    if (!link?.href || /javascript:|^#$/i.test(link.href)) return false;
    if (isWeeblyUrl(link.href) && !link.href.startsWith('#/')) return false;
    if (isChromeLink(link, pageId)) return false;
    if (link.href.endsWith('#') && !link.img) return false;
    return true;
  });
}

const CORE_NAV = [
  'home',
  'grade-1',
  'grade-2',
  'grade-3',
  'grade-4',
  'grade-5',
  'pe-videos',
];

function isJunkNavLabel(label) {
  const text = String(label || '').trim();
  if (!text) return true;
  const letters = text.replace(/[^a-zA-Z\u0600-\u06ff]/g, '');
  return letters.length < 2;
}

function visiblePages() {
  return (site.pages || []).filter((p) => p && !p.hidden);
}

function renderNav(activeId) {
  const pages = visiblePages();
  const main = CORE_NAV.filter((id) => pages.some((p) => p.id === id));
  const moreIds = pages
    .map((p) => p.id)
    .filter((id) => id && !CORE_NAV.includes(id));

  moreIds.sort((a, b) => {
    const pageA = pages.find((p) => p.id === a);
    const pageB = pages.find((p) => p.id === b);
    const junkA = isJunkNavLabel(pageA?.navLabel);
    const junkB = isJunkNavLabel(pageB?.navLabel);
    if (junkA !== junkB) return junkA ? 1 : -1;
    const pref = (page) =>
      page &&
      !isJunkNavLabel(page.navLabel) &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(page.id) &&
      !/\d{6,}/.test(page.id)
        ? 0
        : 1;
    const prefDiff = pref(pageA) - pref(pageB);
    if (prefDiff) return prefDiff;
    return String(pageA?.navLabel || a).localeCompare(String(pageB?.navLabel || b), undefined, {
      sensitivity: 'base',
    });
  });

  const linkHtml = (id) => {
    const page = pages.find((p) => p.id === id);
    if (!page) return '';
    const current = id === activeId ? ' aria-current="page"' : '';
    const label = isJunkNavLabel(page.navLabel) ? page.id : page.navLabel || page.id;
    return `<a href="#/${id}"${current}>${escapeHtml(label)}</a>`;
  };

  const activeInMore = moreIds.includes(activeId);

  el.nav.innerHTML = `
    ${main.map(linkHtml).join('')}
    <div class="more${activeInMore ? ' is-open' : ''}">
      <button type="button" class="more-trigger" aria-expanded="${activeInMore ? 'true' : 'false'}">More…</button>
      <div class="more-panel" role="menu">
        ${moreIds.map(linkHtml).join('')}
        <a href="/admin/">Admin</a>
      </div>
    </div>
  `;

  const moreWrap = el.nav.querySelector('.more');
  const moreBtn = el.nav.querySelector('.more-trigger');
  moreBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = moreWrap.classList.toggle('is-open');
    moreBtn.setAttribute('aria-expanded', String(open));
  });
}

function syncNavWithPages() {
  if (!Array.isArray(site.primaryNav)) site.primaryNav = [];
  for (const page of site.pages || []) {
    if (page?.id && !site.primaryNav.includes(page.id)) {
      site.primaryNav.push(page.id);
    }
  }
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

  // Drop old Weebly shutdown notes from audits.
  let auditInfo = link.audit;
  if (migrated && auditInfo?.notes) {
    const notes = auditInfo.notes.filter((n) => !/Hosted on Weebly|weebly\.com/i.test(n));
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
    const notes = auditInfo.notes.filter((n) => !/Hosted on Weebly|weebly\.com/i.test(n));
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
  el.meta.textContent = 'No open issues';
  renderNav('link-audit');
  el.content.innerHTML = `<p class="empty">The link audit is empty. Dead links were removed from the site.</p>`;
}

function renderPage(id) {
  if (id === 'link-audit') {
    renderAuditPage();
    return;
  }

  let page = site.pages.find((p) => p.id === id);
  if (!page && (!id || id === 'home')) {
    page = site.pages.find((p) => p.id === 'home');
  }
  if (!page || page.hidden) {
    document.title = 'Page not found · Ahliyyah & Mutran';
    el.title.textContent = page?.hidden ? 'Page hidden' : 'Page not found';
    el.meta.textContent = page?.hidden
      ? 'This page is hidden from the public site.'
      : `No page named “${id}” in the live site data.`;
    renderNav(id);
    el.content.innerHTML = page?.hidden
      ? `<p class="empty">This page is currently hidden. Unhide it in Admin to show it again.</p>`
      : `<p class="empty">This page is not in the live site yet. Open Admin, then click <strong>Publish</strong>.</p>`;
    return;
  }

  document.title = `${page.navLabel} · Ahliyyah & Mutran`;
  el.title.textContent = page.navLabel;

  const namedUnits = (page.units || []).filter((u) => u.titleAr || u.titleEn);
  el.meta.textContent = namedUnits.length
    ? `${namedUnits.length} unit plans`
    : 'Resource links';

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
  const wantDraft = new URLSearchParams(location.search).get('draft') === '1';
  let loadedFromDraft = false;

  // Public visitors should see live Vercel content. Local drafts only with ?draft=1.
  if (wantDraft) {
    try {
      const draft = localStorage.getItem('am-pyp-links-draft');
      if (draft) {
        site = JSON.parse(draft);
        loadedFromDraft = true;
      }
    } catch {
      loadedFromDraft = false;
    }
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

  site = sanitizeSiteData(site);
  syncNavWithPages();

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
