const PASS_HASH =
  '9e6d2d7ec5959d8e52b57cc4206bd82b6ee14f290f621f1654b9c86009b2078a';
const REPO = { owner: 'muneernas', name: 'AM-PYP-LINKS', branch: 'master' };
const DRAFT_KEY = 'am-pyp-links-draft';
const AUTH_KEY = 'am-pyp-links-admin';
const TOKEN_KEY = 'am-pyp-links-gh-token';
const PENDING_DB = 'am-pyp-links-uploads';
const PENDING_STORE = 'files';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

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
  linkImgFile: document.getElementById('linkImgFile'),
  uploadZone: document.getElementById('uploadZone'),
  uploadEmpty: document.getElementById('uploadEmpty'),
  uploadPreview: document.getElementById('uploadPreview'),
  uploadPreviewImg: document.getElementById('uploadPreviewImg'),
  uploadFileName: document.getElementById('uploadFileName'),
  clearImgBtn: document.getElementById('clearImgBtn'),
  statusLine: document.getElementById('statusLine'),
  pageMeta: document.getElementById('pageMeta'),
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
/** @type {Map<string, { base64: string, mime: string, dataUrl: string, name: string }>} */
const pendingUploads = new Map();
/** Staged file for the next "Add link" submit */
let stagedUpload = null;

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

function openPendingDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PENDING_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB unavailable'));
  });
}

async function persistPendingUpload(entry) {
  pendingUploads.set(entry.path, entry);
  const db = await openPendingDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, 'readwrite');
    tx.objectStore(PENDING_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function removePendingUpload(path) {
  pendingUploads.delete(path);
  const db = await openPendingDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, 'readwrite');
    tx.objectStore(PENDING_STORE).delete(path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadPendingUploads() {
  pendingUploads.clear();
  try {
    const db = await openPendingDb();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(PENDING_STORE, 'readonly');
      const req = tx.objectStore(PENDING_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    for (const row of rows) {
      if (row?.path && row?.base64 && row?.dataUrl) pendingUploads.set(row.path, row);
    }
  } catch {
    // Draft still works without pending image previews.
  }
}

function extForMime(mime, fallbackName = '') {
  if (/png/i.test(mime)) return 'png';
  if (/webp/i.test(mime)) return 'webp';
  if (/gif/i.test(mime)) return 'gif';
  if (/jpe?g/i.test(mime)) return 'jpg';
  const fromName = String(fallbackName).split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(fromName)) {
    return fromName === 'jpeg' ? 'jpg' : fromName;
  }
  return 'jpg';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

async function prepareImageUpload(file) {
  if (!file || !/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
    throw new Error('Please choose a PNG, JPG, WebP, or GIF image.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large. Please use a file under 4 MB.');
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  let mime = file.type || 'image/jpeg';
  let dataUrl = originalDataUrl;

  // Resize large photos so GitHub Pages stays snappy.
  if (!/gif$/i.test(mime)) {
    const img = await loadImage(originalDataUrl);
    const maxEdge = 1400;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    if (scale < 0.999) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (/png$/i.test(mime)) {
        dataUrl = canvas.toDataURL('image/png');
        mime = 'image/png';
      } else {
        dataUrl = canvas.toDataURL('image/jpeg', 0.86);
        mime = 'image/jpeg';
      }
    }
  }

  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error('Could not prepare image upload.');
  const ext = extForMime(mime, file.name);
  const stamp = Date.now().toString(36);
  const base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'image';
  const path = `assets/images/${base}-${stamp}.${ext}`;
  return {
    path,
    base64,
    mime,
    dataUrl,
    name: file.name,
  };
}

function clearStagedUpload() {
  stagedUpload = null;
  if (el.linkImgFile) el.linkImgFile.value = '';
  if (el.uploadPreview) el.uploadPreview.hidden = true;
  if (el.uploadEmpty) el.uploadEmpty.hidden = false;
  if (el.uploadZone) el.uploadZone.classList.remove('has-file', 'is-dragover');
  if (el.uploadPreviewImg) el.uploadPreviewImg.removeAttribute('src');
  if (el.uploadFileName) el.uploadFileName.textContent = 'Ready';
}

function showStagedUpload(entry) {
  stagedUpload = entry;
  if (el.uploadEmpty) el.uploadEmpty.hidden = true;
  if (el.uploadPreview) el.uploadPreview.hidden = false;
  if (el.uploadZone) el.uploadZone.classList.add('has-file');
  if (el.uploadPreviewImg) el.uploadPreviewImg.src = entry.dataUrl;
  if (el.uploadFileName) el.uploadFileName.textContent = entry.name || entry.path.split('/').pop();
  if (el.linkImg) el.linkImg.value = '';
}

function resolveImgSrc(img) {
  if (!img) return '';
  if (/^(data:|https?:|blob:)/i.test(img)) return img;
  const pending = pendingUploads.get(img);
  if (pending?.dataUrl) return pending.dataUrl;
  if (img.startsWith('assets/')) return `../${img}`;
  return img;
}

function setStatus(msg, state) {
  el.statusLine.textContent = msg;
  el.statusLine.dataset.state = state || (dirty ? 'dirty' : 'ok');
}

function markDirty() {
  dirty = true;
  setStatus('Unsaved changes', 'dirty');
}

function clearDirty(msg) {
  dirty = false;
  setStatus(msg || 'Saved', 'ok');
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

function pageLinkCount(page) {
  return (page.units || []).reduce((n, u) => n + ((u.links && u.links.length) || 0), 0)
    || (page.links || []).length;
}

function renderPageList() {
  el.pageList.innerHTML = site.pages
    .map((p) => {
      const count = pageLinkCount(p);
      return `
      <li>
        <button type="button" data-page="${escapeHtml(p.id)}" class="${
          p.id === selectedPageId ? 'active' : ''
        }">
          <span class="page-name">${escapeHtml(p.navLabel || p.id)}</span>
          <span class="page-count">${count} link${count === 1 ? '' : 's'}</span>
        </button>
      </li>`;
    })
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

function thumbFor(link) {
  if (link.img) {
    return `<img class="link-thumb" src="${escapeHtml(resolveImgSrc(link.img))}" alt="" loading="lazy" />`;
  }
  const initial = String(link.label || 'L').trim().charAt(0).toUpperCase() || 'L';
  return `<span class="link-thumb placeholder" aria-hidden="true">${escapeHtml(initial)}</span>`;
}

function renderUnits() {
  const page = selectedPage();
  if (!page) {
    el.pageHeading.textContent = 'Select a page';
    if (el.pageMeta) el.pageMeta.textContent = '';
    el.unitsHost.innerHTML = `
      <div class="empty-state">
        <strong>Nothing selected</strong>
        Pick a page from the left to manage its units and links.
      </div>`;
    el.addUnitBtn.hidden = true;
    return;
  }

  el.pageHeading.textContent = page.navLabel || page.id;
  const units = ensureUnits(page);
  const linkCount = pageLinkCount(page);
  if (el.pageMeta) {
    el.pageMeta.textContent = `${units.length} unit${units.length === 1 ? '' : 's'} · ${linkCount} link${
      linkCount === 1 ? '' : 's'
    }`;
  }
  el.addUnitBtn.hidden = false;

  el.unitsHost.innerHTML = units
    .map((unit, unitIndex) => {
      const title = [unit.titleAr, unit.titleEn].filter(Boolean).join(' · ') || 'Resources';
      const links = unit.links || [];
      return `
        <article class="unit-card" data-unit="${unitIndex}">
          <div class="unit-head">
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
              ? `<div class="link-list">${links
                  .map(
                    (link, linkIndex) => `
                <div class="link-row">
                  ${thumbFor(link)}
                  <div>
                    <strong>${escapeHtml(link.label || 'Untitled')}</strong>
                    <a href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(
                      link.href
                    )}</a>
                  </div>
                  <button type="button" class="danger" data-delete-link="${unitIndex}:${linkIndex}">Delete</button>
                </div>`
                  )
                  .join('')}</div>`
              : `<p class="empty-state">No links in this unit yet. Use <strong>New link</strong> below to add one.</p>`
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
  await loadPendingUploads();
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

async function handleImageFile(file) {
  if (!file) return;
  try {
    const entry = await prepareImageUpload(file);
    showStagedUpload(entry);
  } catch (err) {
    clearStagedUpload();
    alert(err.message || String(err));
  }
}

if (el.linkImgFile) {
  el.linkImgFile.addEventListener('change', () => {
    handleImageFile(el.linkImgFile.files?.[0]);
  });
}

if (el.clearImgBtn) {
  el.clearImgBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearStagedUpload();
  });
}

if (el.uploadZone) {
  ['dragenter', 'dragover'].forEach((type) => {
    el.uploadZone.addEventListener(type, (e) => {
      e.preventDefault();
      el.uploadZone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    el.uploadZone.addEventListener(type, (e) => {
      e.preventDefault();
      el.uploadZone.classList.remove('is-dragover');
    });
  });
  el.uploadZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleImageFile(file);
  });
}

if (el.linkImg) {
  el.linkImg.addEventListener('input', () => {
    if (el.linkImg.value.trim()) clearStagedUpload();
  });
}

el.addLinkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const page = site.pages.find((p) => p.id === el.linkPage.value);
  if (!page) return;
  const units = ensureUnits(page);
  const unitIndex = Number(el.linkUnit.value);
  const unit = units[unitIndex];
  if (!unit) return;
  if (!Array.isArray(unit.links)) unit.links = [];

  let img = el.linkImg.value.trim() || null;
  if (stagedUpload) {
    await persistPendingUpload(stagedUpload);
    img = stagedUpload.path;
  }

  unit.links.push({
    href: el.linkHref.value.trim(),
    label: el.linkLabel.value.trim(),
    img,
    internal: /ahliyyahmutranpyp\.weebly\.com/i.test(el.linkHref.value),
  });
  syncPageLinks(page);
  selectedPageId = page.id;
  markDirty();
  el.linkLabel.value = '';
  el.linkHref.value = '';
  el.linkImg.value = '';
  clearStagedUpload();
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

async function githubPutFile(token, path, base64Content, message) {
  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${path}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  let sha;
  const metaRes = await fetch(`${url}?ref=${REPO.branch}`, { headers });
  if (metaRes.ok) {
    const meta = await metaRes.json();
    sha = meta.sha;
  } else if (metaRes.status !== 404) {
    throw new Error(`Could not check ${path} (${metaRes.status}).`);
  }

  const putRes = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message,
      content: base64Content,
      branch: REPO.branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(err.message || `Upload failed for ${path} (${putRes.status})`);
  }
}

async function publishPendingImages(token) {
  const entries = [...pendingUploads.values()];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    el.publishMsg.textContent = `Uploading image ${i + 1} of ${entries.length}…`;
    await githubPutFile(
      token,
      entry.path,
      entry.base64,
      `Add image ${entry.path.split('/').pop()} from admin`
    );
    await removePendingUpload(entry.path);
  }
}

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

    if (pendingUploads.size) {
      await publishPendingImages(token);
    }

    el.publishMsg.textContent = 'Updating site content…';
    const path = 'data/site.json';
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
    };
    const metaRes = await fetch(
      `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${path}?ref=${REPO.branch}`,
      { headers }
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
          ...headers,
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
    await loadPendingUploads();
    await loadSite();
    showApp();
  }
}

boot().catch((err) => {
  el.loginError.hidden = false;
  el.loginError.textContent = err.message || String(err);
});
