const PASS_HASH =
  '9e6d2d7ec5959d8e52b57cc4206bd82b6ee14f290f621f1654b9c86009b2078a';
const REPO = { owner: 'muneernas', name: 'AM-PYP-LINKS', branch: 'master' };
const DRAFT_KEY = 'am-pyp-links-draft';
const AUTH_KEY = 'am-pyp-links-admin';
const TOKEN_KEY = 'am-pyp-links-gh-token';

const el = {
  loginView: document.getElementById('loginView'),
  appView: document.getElementById('appView'),
  loginForm: document.getElementById('loginForm'),
  password: document.getElementById('password'),
  loginError: document.getElementById('loginError'),
  pageList: document.getElementById('pageList'),
  pageHeading: document.getElementById('pageHeading'),
  unitsHost: document.getElementById('unitsHost'),
  addUnitBtn: document.getElementById('addUnitBtn'),
  addPageBtn: document.getElementById('addPageBtn'),
  addLinkForm: document.getElementById('addLinkForm'),
  linkPage: document.getElementById('linkPage'),
  linkUnit: document.getElementById('linkUnit'),
  linkLabel: document.getElementById('linkLabel'),
  linkHref: document.getElementById('linkHref'),
  linkImg: document.getElementById('linkImg'),
  statusLine: document.getElementById('statusLine'),
  saveDraftBtn: document.getElementById('saveDraftBtn'),
  publishBtn: document.getElementById('publishBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  ghToken: document.getElementById('ghToken'),
  publishMsg: document.getElementById('publishMsg'),
  unitDialog: document.getElementById('unitDialog'),
  unitForm: document.getElementById('unitForm'),
  unitAr: document.getElementById('unitAr'),
  unitEn: document.getElementById('unitEn'),
  unitIdea: document.getElementById('unitIdea'),
  unitCancel: document.getElementById('unitCancel'),
};

let site = null;
let selectedPageId = null;
let dirty = false;

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(text) {
  return String(text || 'page')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || `page-${Date.now()}`;
}

function markDirty() {
  dirty = true;
  el.statusLine.textContent = 'Unsaved changes';
}

function clearDirty(msg) {
  dirty = false;
  el.statusLine.textContent = msg || 'Saved';
}

function ensureUnits(page) {
  if (!Array.isArray(page.units) || !page.units.length) {
    page.units = [
      {
        id: 'resources',
        titleAr: '',
        titleEn: '',
        centralIdea: '',
        title: '',
        links: Array.isArray(page.links) ? page.links : [],
      },
    ];
  }
  return page.units;
}

function syncPageLinks(page) {
  page.links = (page.units || []).flatMap((u) => u.links || []);
  page.headings = (page.units || [])
    .filter((u) => u.titleEn || u.titleAr)
    .map((u) => u.titleEn || u.titleAr);
}

async function loadSite() {
  const draft = localStorage.getItem(DRAFT_KEY);
  if (draft) {
    try {
      site = JSON.parse(draft);
      clearDirty('Loaded local draft');
      return;
    } catch {
      // fall through
    }
  }
  const res = await fetch('../data/site.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load site.json');
  site = await res.json();
  clearDirty('Loaded live site data');
}

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(site));
  clearDirty('Draft saved in this browser (site visitors will see it after Publish)');
}

function selectedPage() {
  return site.pages.find((p) => p.id === selectedPageId) || null;
}

function renderPageList() {
  el.pageList.innerHTML = site.pages
    .map(
      (p) => `
      <li>
        <button type="button" data-page="${escapeHtml(p.id)}" class="${
          p.id === selectedPageId ? 'active' : ''
        }">${escapeHtml(p.navLabel || p.id)}</button>
      </li>`
    )
    .join('');
}

function fillLinkSelectors() {
  el.linkPage.innerHTML = site.pages
    .map(
      (p) =>
        `<option value="${escapeHtml(p.id)}" ${
          p.id === selectedPageId ? 'selected' : ''
        }>${escapeHtml(p.navLabel || p.id)}</option>`
    )
    .join('');
  fillUnitSelector(el.linkPage.value);
}

function fillUnitSelector(pageId) {
  const page = site.pages.find((p) => p.id === pageId);
  if (!page) {
    el.linkUnit.innerHTML = '';
    return;
  }
  const units = ensureUnits(page);
  el.linkUnit.innerHTML = units
    .map((u, idx) => {
      const label = u.titleEn || u.titleAr || u.title || `Section ${idx + 1}`;
      return `<option value="${idx}">${escapeHtml(label)}</option>`;
    })
    .join('');
}

function renderUnits() {
  const page = selectedPage();
  if (!page) {
    el.pageHeading.textContent = 'Select a page';
    el.unitsHost.innerHTML = '';
    el.addUnitBtn.hidden = true;
    return;
  }

  el.pageHeading.textContent = page.navLabel || page.id;
  el.addUnitBtn.hidden = false;
  const units = ensureUnits(page);

  el.unitsHost.innerHTML = units
    .map((unit, unitIndex) => {
      const title = [unit.titleAr, unit.titleEn].filter(Boolean).join(' · ') || 'Resources';
      const links = unit.links || [];
      return `
        <article class="unit-card" data-unit="${unitIndex}">
          <div class="panel-head">
            <div>
              <h3>${escapeHtml(title)}</h3>
              ${
                unit.centralIdea
                  ? `<p class="idea"><strong>Central Idea:</strong> ${escapeHtml(
                      unit.centralIdea
                    )}</p>`
                  : ''
              }
            </div>
            <button type="button" class="danger" data-delete-unit="${unitIndex}">Delete unit</button>
          </div>
          ${
            links.length
              ? links
                  .map(
                    (link, linkIndex) => `
                <div class="link-row">
                  <div>
                    <strong>${escapeHtml(link.label || 'Untitled')}</strong>
                    <a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(
                      link.href
                    )}</a>
                  </div>
                  <button type="button" class="danger" data-delete-link="${unitIndex}:${linkIndex}">Delete</button>
                </div>`
                  )
                  .join('')
              : `<p class="help">No links in this unit yet.</p>`
          }
        </article>`;
    })
    .join('');
}

function renderAll() {
  if (!selectedPageId && site.pages[0]) selectedPageId = site.pages[0].id;
  renderPageList();
  fillLinkSelectors();
  renderUnits();
}

function showApp() {
  el.loginView.hidden = true;
  el.loginView.style.display = 'none';
  el.appView.hidden = false;
  el.appView.style.display = '';
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) el.ghToken.value = token;
  renderAll();
}

el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  el.loginError.hidden = true;
  const hash = await sha256(el.password.value);
  if (hash !== PASS_HASH) {
    el.loginError.hidden = false;
    return;
  }
  sessionStorage.setItem(AUTH_KEY, '1');
  await loadSite();
  showApp();
});

el.logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  location.reload();
});

el.pageList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-page]');
  if (!btn) return;
  selectedPageId = btn.dataset.page;
  renderAll();
});

el.linkPage.addEventListener('change', () => {
  fillUnitSelector(el.linkPage.value);
});

el.addLinkForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const page = site.pages.find((p) => p.id === el.linkPage.value);
  if (!page) return;
  const units = ensureUnits(page);
  const unitIndex = Number(el.linkUnit.value);
  const unit = units[unitIndex];
  if (!unit) return;
  if (!Array.isArray(unit.links)) unit.links = [];
  unit.links.push({
    href: el.linkHref.value.trim(),
    label: el.linkLabel.value.trim(),
    img: el.linkImg.value.trim() || null,
    internal: /ahliyyahmutranpyp\.weebly\.com/i.test(el.linkHref.value),
  });
  syncPageLinks(page);
  selectedPageId = page.id;
  markDirty();
  el.linkLabel.value = '';
  el.linkHref.value = '';
  el.linkImg.value = '';
  renderAll();
});

el.addUnitBtn.addEventListener('click', () => {
  el.unitAr.value = '';
  el.unitEn.value = '';
  el.unitIdea.value = '';
  el.unitDialog.showModal();
});

el.unitCancel.addEventListener('click', () => el.unitDialog.close());

el.unitForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const page = selectedPage();
  if (!page) return;
  const titleEn = el.unitEn.value.trim();
  const titleAr = el.unitAr.value.trim();
  const centralIdea = el.unitIdea.value.trim();
  ensureUnits(page).push({
    id: slugify(titleEn || titleAr),
    titleAr,
    titleEn,
    centralIdea,
    title: [titleAr, titleEn].filter(Boolean).join(' · '),
    links: [],
  });
  syncPageLinks(page);
  markDirty();
  el.unitDialog.close();
  renderAll();
});

el.unitsHost.addEventListener('click', (e) => {
  const delLink = e.target.closest('[data-delete-link]');
  const delUnit = e.target.closest('[data-delete-unit]');
  const page = selectedPage();
  if (!page) return;

  if (delLink) {
    const [u, l] = delLink.dataset.deleteLink.split(':').map(Number);
    page.units[u]?.links?.splice(l, 1);
    syncPageLinks(page);
    markDirty();
    renderAll();
    return;
  }

  if (delUnit) {
    const u = Number(delUnit.dataset.deleteUnit);
    if (!confirm('Delete this unit and all its links?')) return;
    page.units.splice(u, 1);
    if (!page.units.length) ensureUnits(page);
    syncPageLinks(page);
    markDirty();
    renderAll();
  }
});

el.addPageBtn.addEventListener('click', () => {
  const navLabel = prompt('New page name (e.g. Grade 6)');
  if (!navLabel) return;
  const id = slugify(navLabel);
  if (site.pages.some((p) => p.id === id)) {
    alert('A page with that id already exists.');
    return;
  }
  site.pages.push({
    id,
    path: `/${id}.html`,
    title: `${navLabel} - Ahliyyah & Mutran`,
    navLabel,
    units: [
      {
        id: 'resources',
        titleAr: '',
        titleEn: '',
        centralIdea: '',
        title: '',
        links: [],
      },
    ],
    links: [],
    headings: [],
  });
  if (!site.primaryNav.includes(id) && /grade|home|pe|robot|franc/i.test(id)) {
    site.primaryNav.push(id);
  }
  selectedPageId = id;
  markDirty();
  renderAll();
});

el.saveDraftBtn.addEventListener('click', () => {
  site.generatedAt = new Date().toISOString();
  saveDraft();
});

el.ghToken.addEventListener('change', () => {
  const token = el.ghToken.value.trim();
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
});

async function publishToGitHub() {
  const token = el.ghToken.value.trim() || sessionStorage.getItem(TOKEN_KEY) || '';
  if (!token) {
    el.publishMsg.hidden = false;
    el.publishMsg.textContent =
      'Add a GitHub token above first (Contents: Read and write on this repo).';
    return;
  }

  el.publishBtn.disabled = true;
  el.publishMsg.hidden = false;
  el.publishMsg.textContent = 'Publishing…';

  try {
    site.generatedAt = new Date().toISOString();
    saveDraft();

    const path = 'data/site.json';
    const metaRes = await fetch(
      `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${path}?ref=${REPO.branch}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
        },
      }
    );
    if (!metaRes.ok) {
      throw new Error(`Could not read site.json (${metaRes.status}). Check token permissions.`);
    }
    const meta = await metaRes.json();
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(site, null, 2))));

    const putRes = await fetch(
      `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Update site content from admin',
          content,
          sha: meta.sha,
          branch: REPO.branch,
        }),
      }
    );

    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || `Publish failed (${putRes.status})`);
    }

    clearDirty('Published — GitHub Pages will update in about a minute');
    el.publishMsg.textContent =
      'Published successfully. Live site usually updates within 1–2 minutes.';
  } catch (err) {
    el.publishMsg.textContent = err.message || String(err);
  } finally {
    el.publishBtn.disabled = false;
  }
}

el.publishBtn.addEventListener('click', publishToGitHub);

async function boot() {
  if (sessionStorage.getItem(AUTH_KEY) === '1') {
    await loadSite();
    showApp();
  }
}

boot().catch((err) => {
  el.loginError.hidden = false;
  el.loginError.textContent = err.message || String(err);
});
