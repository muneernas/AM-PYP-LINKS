const PASS_HASH =
  '9e6d2d7ec5959d8e52b57cc4206bd82b6ee14f290f621f1654b9c86009b2078a';
const DRAFT_KEY = 'am-pyp-links-draft';
const AUTH_KEY = 'am-pyp-links-admin';
const PASS_SESSION_KEY = 'am-pyp-links-admin-pass';
const PENDING_DB = 'am-pyp-links-uploads';
const PENDING_STORE = 'files';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ALLOWED_FILE_EXT = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'zip',
  'mp4',
  'mov',
  'txt',
  'csv',
  'odt',
  'ods',
  'odp',
]);

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
  linkFile: document.getElementById('linkFile'),
  typeLink: document.getElementById('typeLink'),
  typeFile: document.getElementById('typeFile'),
  hrefField: document.getElementById('hrefField'),
  fileField: document.getElementById('fileField'),
  fileUploadZone: document.getElementById('fileUploadZone'),
  fileUploadEmpty: document.getElementById('fileUploadEmpty'),
  fileUploadPreview: document.getElementById('fileUploadPreview'),
  fileUploadName: document.getElementById('fileUploadName'),
  fileBadge: document.getElementById('fileBadge'),
  clearFileBtn: document.getElementById('clearFileBtn'),
  existingFileNote: document.getElementById('existingFileNote'),
  uploadZone: document.getElementById('uploadZone'),
  uploadEmpty: document.getElementById('uploadEmpty'),
  uploadPreview: document.getElementById('uploadPreview'),
  uploadPreviewImg: document.getElementById('uploadPreviewImg'),
  uploadFileName: document.getElementById('uploadFileName'),
  clearImgBtn: document.getElementById('clearImgBtn'),
  resourceSubmitBtn: document.getElementById('resourceSubmitBtn'),
  cancelEditBtn: document.getElementById('cancelEditBtn'),
  composerEyebrow: document.getElementById('composerEyebrow'),
  composerHeading: document.getElementById('composerHeading'),
  composerHelp: document.getElementById('composerHelp'),
  editPageId: document.getElementById('editPageId'),
  editUnitIndex: document.getElementById('editUnitIndex'),
  editLinkIndex: document.getElementById('editLinkIndex'),
  statusLine: document.getElementById('statusLine'),
  pageMeta: document.getElementById('pageMeta'),
  saveDraftBtn: document.getElementById('saveDraftBtn'),
  publishBtn: document.getElementById('publishBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  publishMsg: document.getElementById('publishMsg'),
  unitDialog: document.getElementById('unitDialog'),
  unitForm: document.getElementById('unitForm'),
  unitAr: document.getElementById('unitAr'),
  unitEn: document.getElementById('unitEn'),
  unitIdea: document.getElementById('unitIdea'),
  unitCancel: document.getElementById('unitCancel'),
  unitError: document.getElementById('unitError'),
};

let site = null;
let selectedPageId = null;
let dirty = false;
/** @type {Map<string, { path: string, base64: string, mime: string, dataUrl?: string, name: string }>} */
const pendingUploads = new Map();
/** Staged tile image for the next submit */
let stagedUpload = null;
/** Staged resource file for the next submit */
let stagedFile = null;
/** Existing file path kept while editing without replacing the file */
let existingFilePath = null;

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
      if (row?.path && row?.base64) pendingUploads.set(row.path, row);
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

  // Resize large photos so the live site stays snappy.
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

function clearStagedFile() {
  stagedFile = null;
  if (el.linkFile) el.linkFile.value = '';
  if (el.fileUploadPreview) el.fileUploadPreview.hidden = true;
  if (el.fileUploadEmpty) el.fileUploadEmpty.hidden = false;
  if (el.fileUploadZone) el.fileUploadZone.classList.remove('has-file', 'is-dragover');
  if (el.fileUploadName) el.fileUploadName.textContent = 'Ready';
  if (el.fileBadge) el.fileBadge.textContent = 'FILE';
}

function showStagedFile(entry) {
  stagedFile = entry;
  existingFilePath = null;
  if (el.fileUploadEmpty) el.fileUploadEmpty.hidden = true;
  if (el.fileUploadPreview) el.fileUploadPreview.hidden = false;
  if (el.fileUploadZone) el.fileUploadZone.classList.add('has-file');
  if (el.fileUploadName) el.fileUploadName.textContent = entry.name || entry.path.split('/').pop();
  if (el.fileBadge) {
    const ext = entry.path.split('.').pop() || 'FILE';
    el.fileBadge.textContent = ext.slice(0, 4).toUpperCase();
  }
  if (el.existingFileNote) {
    el.existingFileNote.hidden = true;
    el.existingFileNote.textContent = '';
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function prepareResourceFile(file) {
  if (!file) throw new Error('Please choose a file.');
  const ext = String(file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_FILE_EXT.has(ext)) {
    throw new Error('Supported files: PDF, Word, Excel, PowerPoint, ZIP, video, TXT, CSV.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('File is too large. Please use a file under 4 MB for Vercel publish.');
  }
  const buffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const stamp = Date.now().toString(36);
  const base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'file';
  const path = `assets/files/${base}-${stamp}.${ext}`;
  return {
    path,
    base64,
    mime: file.type || 'application/octet-stream',
    name: file.name,
  };
}

function resourceType() {
  return el.typeFile?.checked ? 'file' : 'link';
}

function syncResourceTypeUi() {
  const isFile = resourceType() === 'file';
  if (el.hrefField) el.hrefField.hidden = isFile;
  if (el.fileField) el.fileField.hidden = !isFile;
  if (el.linkHref) {
    el.linkHref.required = !isFile;
    if (isFile) el.linkHref.removeAttribute('required');
  }
}

function isEditing() {
  return el.editPageId?.value !== '' && el.editLinkIndex?.value !== '';
}

function setComposerMode(mode) {
  const editing = mode === 'edit';
  const composer = document.querySelector('.composer');
  if (composer) composer.classList.toggle('is-editing', editing);
  if (el.composerEyebrow) el.composerEyebrow.textContent = editing ? 'Editing' : 'Quick add';
  if (el.composerHeading) el.composerHeading.textContent = editing ? 'Edit resource' : 'New resource';
  if (el.composerHelp) {
    el.composerHelp.textContent = editing
      ? 'Update the title, destination, or tile picture, then save.'
      : 'Give every resource a title for the tile. Choose a web link or upload a file — clicking the tile opens it.';
  }
  if (el.resourceSubmitBtn) {
    el.resourceSubmitBtn.textContent = editing ? 'Save changes' : 'Add resource';
  }
  if (el.cancelEditBtn) el.cancelEditBtn.hidden = !editing;
}

function resetComposerForm({ keepPage = true } = {}) {
  const pageId = keepPage ? el.linkPage.value || selectedPageId : selectedPageId;
  el.editPageId.value = '';
  el.editUnitIndex.value = '';
  el.editLinkIndex.value = '';
  existingFilePath = null;
  el.linkLabel.value = '';
  el.linkHref.value = '';
  el.linkImg.value = '';
  if (el.typeLink) el.typeLink.checked = true;
  clearStagedUpload();
  clearStagedFile();
  if (el.existingFileNote) {
    el.existingFileNote.hidden = true;
    el.existingFileNote.textContent = '';
  }
  syncResourceTypeUi();
  setComposerMode('add');
  if (pageId) {
    el.linkPage.value = pageId;
    fillUnitSelector(pageId);
  }
}

function startEditLink(pageId, unitIndex, linkIndex) {
  const page = site.pages.find((p) => p.id === pageId);
  if (!page) return;
  const units = ensureUnits(page);
  const link = units[unitIndex]?.links?.[linkIndex];
  if (!link) return;

  selectedPageId = pageId;
  renderPageList();
  el.linkPage.value = pageId;
  fillUnitSelector(pageId);
  el.linkUnit.value = String(unitIndex);

  el.editPageId.value = pageId;
  el.editUnitIndex.value = String(unitIndex);
  el.editLinkIndex.value = String(linkIndex);

  el.linkLabel.value = link.label || '';
  el.linkImg.value = link.img && !String(link.img).startsWith('assets/') ? link.img : '';
  clearStagedUpload();
  clearStagedFile();

  const isFile = String(link.href || '').startsWith('assets/files/');
  if (isFile) {
    el.typeFile.checked = true;
    existingFilePath = link.href;
    if (el.existingFileNote) {
      el.existingFileNote.hidden = false;
      el.existingFileNote.textContent = `Current file: ${link.href.split('/').pop()} — upload a new file only if you want to replace it.`;
    }
    el.linkHref.value = '';
  } else {
    el.typeLink.checked = true;
    existingFilePath = null;
    el.linkHref.value = link.href || '';
    if (el.existingFileNote) {
      el.existingFileNote.hidden = true;
      el.existingFileNote.textContent = '';
    }
  }

  if (link.img && String(link.img).startsWith('assets/')) {
    // Keep existing local image unless a new one is uploaded / URL pasted.
    el.linkImg.dataset.keepLocal = link.img;
  } else if (el.linkImg) {
    delete el.linkImg.dataset.keepLocal;
  }

  syncResourceTypeUi();
  setComposerMode('edit');
  document.querySelector('.composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resolveImgSrc(img) {
  if (!img) return '';
  if (/^(data:|https?:|blob:)/i.test(img)) return img;
  const pending = pendingUploads.get(img);
  if (pending?.dataUrl) return pending.dataUrl;
  if (img.startsWith('assets/')) return `/${img}`;
  return img;
}

function setStatus(msg, state) {
  el.statusLine.textContent = msg;
  el.statusLine.dataset.state = state || (dirty ? 'dirty' : 'ok');
}

function markDirty() {
  dirty = true;
  try {
    if (site) {
      site.generatedAt = new Date().toISOString();
      localStorage.setItem(DRAFT_KEY, JSON.stringify(site));
    }
    setStatus('Draft saved — Publish to update the live site', 'dirty');
  } catch {
    setStatus('Changed, but draft could not be saved in this browser', 'dirty');
  }
}

function clearDirty(msg) {
  dirty = false;
  setStatus(msg || 'Saved', 'ok');
}

function normalizeHref(raw) {
  let href = String(raw || '').trim();
  if (!href) return '';
  if (
    href.startsWith('#/') ||
    href.startsWith('assets/') ||
    href.startsWith('/') ||
    href.startsWith('data:') ||
    href.startsWith('blob:')
  ) {
    return href;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    href = `https://${href}`;
  }
  return href;
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

function weeblyPathToId(href) {
  try {
    const u = new URL(href);
    if (!/ahliyyahmutranpyp\.weebly\.com/i.test(u.hostname || '')) return null;
    return u.pathname.replace(/^\//, '').replace(/\.html?$/, '') || 'home';
  } catch {
    return null;
  }
}

function sanitizeAdminLink(link, pages) {
  if (!link) return null;
  const next = { ...link };
  delete next.imgRemote;
  delete next.hrefRemote;
  delete next.internal;
  let href = String(next.href || '').trim();
  if (!href || href === '#' || /javascript:/i.test(href)) return null;
  if (/ahliyyahmutranpyp\.weebly\.com/i.test(href)) {
    const id = weeblyPathToId(href);
    if (!id || !(pages || []).some((p) => p.id === id)) return null;
    if (
      !next.img &&
      ['home', 'grade-1', 'grade-2', 'grade-3', 'grade-4', 'grade-5', 'pe-videos', 'franccedilais', 'robotics'].includes(id)
    ) {
      return null;
    }
    href = `#/${id}`;
    next.href = href;
    if (/weebly\.com/i.test(next.label || '')) {
      const page = (pages || []).find((p) => p.id === id);
      next.label = page?.navLabel || id.replace(/-/g, ' ');
    }
  }
  if (/weebly\.com/i.test(href) && !href.startsWith('#/')) return null;
  next.href = href;
  return next;
}

function sanitizeSiteData(data) {
  if (!data || !Array.isArray(data.pages)) return data;
  delete data.sourceLive;
  for (const page of data.pages) {
    for (const unit of page.units || []) {
      unit.links = (unit.links || [])
        .map((link) => sanitizeAdminLink(link, data.pages))
        .filter(Boolean);
    }
    syncPageLinks(page);
  }
  return data;
}

async function loadSite() {
  const draft = localStorage.getItem(DRAFT_KEY);
  if (draft) {
    try {
      site = JSON.parse(draft);
      if (!Array.isArray(site.primaryNav)) site.primaryNav = [];
      if (!Array.isArray(site.pages)) site.pages = [];
      clearDirty('Loaded local draft');
      site = sanitizeSiteData(site);
      syncNavWithPages();
      return;
    } catch {
      // fall through
    }
  }

  try {
    const live = await fetch('/api/site', { cache: 'no-store' });
    if (live.ok) {
      site = await live.json();
      if (!Array.isArray(site.primaryNav)) site.primaryNav = [];
      if (!Array.isArray(site.pages)) site.pages = [];
      clearDirty('Loaded live Vercel content');
      site = sanitizeSiteData(site);
      syncNavWithPages();
      return;
    }
  } catch {
    // fall through to bundled JSON
  }

  const res = await fetch('/data/site.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load site.json');
  site = await res.json();
  if (!Array.isArray(site.primaryNav)) site.primaryNav = [];
  if (!Array.isArray(site.pages)) site.pages = [];
  clearDirty('Loaded bundled site data');
  site = sanitizeSiteData(site);
  syncNavWithPages();
}

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(site));
  clearDirty('Draft saved in this browser (site visitors will see it after Publish)');
}

function selectedPage() {
  return site.pages.find((p) => p.id === selectedPageId) || null;
}

function syncNavWithPages() {
  if (!site) return;
  if (!Array.isArray(site.primaryNav)) site.primaryNav = [];
  for (const page of site.pages || []) {
    if (page?.id && !site.primaryNav.includes(page.id)) {
      site.primaryNav.push(page.id);
    }
  }
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
          <span class="page-count">${count} resource${count === 1 ? '' : 's'}</span>
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
  if (String(link.href || '').startsWith('assets/files/')) {
    const ext = (link.href.split('.').pop() || 'FILE').slice(0, 4).toUpperCase();
    return `<span class="link-thumb placeholder" aria-hidden="true">${escapeHtml(ext)}</span>`;
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
    el.pageMeta.textContent = `${units.length} unit${units.length === 1 ? '' : 's'} · ${linkCount} resource${
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
                  .map((link, linkIndex) => {
                    const isFile = String(link.href || '').startsWith('assets/files/');
                    const hrefLabel = isFile
                      ? `File · ${link.href.split('/').pop()}`
                      : link.href;
                    return `
                <div class="link-row">
                  ${thumbFor(link)}
                  <div>
                    <strong>${escapeHtml(link.label || 'Untitled')}</strong>
                    <a href="${escapeHtml(isFile ? `/${link.href}` : link.href)}" target="_blank" rel="noopener">${escapeHtml(
                      hrefLabel
                    )}</a>
                  </div>
                  <div class="link-row-actions">
                    <button type="button" class="btn-edit" data-edit-link="${unitIndex}:${linkIndex}">Edit</button>
                    <button type="button" class="danger" data-delete-link="${unitIndex}:${linkIndex}">Delete</button>
                  </div>
                </div>`;
                  })
                  .join('')}</div>`
              : `<p class="empty-state">No resources in this unit yet. Use <strong>New resource</strong> below to add one.</p>`
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
  syncResourceTypeUi();
  setComposerMode('add');
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
  sessionStorage.setItem(PASS_SESSION_KEY, el.password.value);
  await loadPendingUploads();
  await loadSite();
  showApp();
});

el.logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(PASS_SESSION_KEY);
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
    if (el.linkImg) delete el.linkImg.dataset.keepLocal;
  } catch (err) {
    clearStagedUpload();
    alert(err.message || String(err));
  }
}

async function handleResourceFile(file) {
  if (!file) return;
  try {
    const entry = await prepareResourceFile(file);
    showStagedFile(entry);
  } catch (err) {
    clearStagedFile();
    alert(err.message || String(err));
  }
}

if (el.typeLink && el.typeFile) {
  el.typeLink.addEventListener('change', syncResourceTypeUi);
  el.typeFile.addEventListener('change', syncResourceTypeUi);
}

if (el.linkImgFile) {
  el.linkImgFile.addEventListener('change', () => {
    handleImageFile(el.linkImgFile.files?.[0]);
  });
}

if (el.linkFile) {
  el.linkFile.addEventListener('change', () => {
    handleResourceFile(el.linkFile.files?.[0]);
  });
}

if (el.clearImgBtn) {
  el.clearImgBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearStagedUpload();
    if (el.linkImg) delete el.linkImg.dataset.keepLocal;
  });
}

if (el.clearFileBtn) {
  el.clearFileBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearStagedFile();
  });
}

if (el.cancelEditBtn) {
  el.cancelEditBtn.addEventListener('click', () => resetComposerForm());
}

function bindDropZone(zone, onFile) {
  if (!zone) return;
  ['dragenter', 'dragover'].forEach((type) => {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.remove('is-dragover');
    });
  });
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}

bindDropZone(el.uploadZone, handleImageFile);
bindDropZone(el.fileUploadZone, handleResourceFile);

if (el.linkImg) {
  el.linkImg.addEventListener('input', () => {
    if (el.linkImg.value.trim()) {
      clearStagedUpload();
      delete el.linkImg.dataset.keepLocal;
    }
  });
}

el.addLinkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!site) {
    alert('Site data is still loading. Try again in a moment.');
    return;
  }

  const page = site.pages.find((p) => p.id === el.linkPage.value);
  if (!page) {
    alert('Please choose a page.');
    return;
  }
  const units = ensureUnits(page);
  const unitIndex = Number(el.linkUnit.value);
  const unit = units[unitIndex];
  if (!unit) {
    alert('Please choose a unit. You can add one with “+ Add unit”.');
    return;
  }
  if (!Array.isArray(unit.links)) unit.links = [];

  const title = el.linkLabel.value.trim();
  if (!title) {
    el.linkLabel.focus();
    alert('Please enter a title for the tile.');
    return;
  }

  let href = '';
  const type = resourceType();
  if (type === 'file') {
    if (stagedFile) {
      try {
        await persistPendingUpload(stagedFile);
      } catch (err) {
        alert(err.message || 'Could not store the uploaded file in this browser.');
        return;
      }
      href = stagedFile.path;
    } else if (existingFilePath) {
      href = existingFilePath;
    } else {
      alert('Please upload a file for this resource.');
      return;
    }
  } else {
    href = normalizeHref(el.linkHref.value);
    if (!href) {
      el.linkHref.focus();
      alert('Please enter a URL for this resource.');
      return;
    }
    el.linkHref.value = href;
  }

  let img = el.linkImg.value.trim() || null;
  if (img && !/^assets\//i.test(img) && !/^(data:|https?:|blob:)/i.test(img)) {
    img = normalizeHref(img);
  }
  if (stagedUpload) {
    try {
      await persistPendingUpload(stagedUpload);
    } catch (err) {
      alert(err.message || 'Could not store the uploaded picture in this browser.');
      return;
    }
    img = stagedUpload.path;
  } else if (!img && el.linkImg?.dataset?.keepLocal) {
    img = el.linkImg.dataset.keepLocal;
  }

  const payload = {
    href,
    label: title,
    img,
    internal: false,
  };

  try {
    if (isEditing()) {
      const editPage = site.pages.find((p) => p.id === el.editPageId.value) || page;
      const editUnits = ensureUnits(editPage);
      const eu = Number(el.editUnitIndex.value);
      const elIdx = Number(el.editLinkIndex.value);
      const previous = editUnits[eu]?.links?.[elIdx];
      if (!previous) {
        alert('Could not find that resource to edit.');
        return;
      }

      if (editPage.id !== page.id || eu !== unitIndex) {
        editUnits[eu].links.splice(elIdx, 1);
        syncPageLinks(editPage);
        unit.links.push({ ...previous, ...payload });
      } else {
        editUnits[eu].links[elIdx] = { ...previous, ...payload };
      }
      syncPageLinks(page);
      if (editPage.id !== page.id) syncPageLinks(editPage);
    } else {
      unit.links.push(payload);
      syncPageLinks(page);
    }

    selectedPageId = page.id;
    markDirty();
    resetComposerForm();
    renderAll();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Could not save that resource.');
  }
});

el.addUnitBtn.addEventListener('click', () => {
  if (!selectedPage()) {
    alert('Select a page first, then add a unit.');
    return;
  }
  el.unitAr.value = '';
  el.unitEn.value = '';
  el.unitIdea.value = '';
  if (el.unitError) el.unitError.hidden = true;
  el.unitDialog.showModal();
  el.unitEn.focus();
});

el.unitCancel.addEventListener('click', (e) => {
  e.preventDefault();
  el.unitDialog.close();
});

el.unitForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const page = selectedPage();
  if (!page) {
    alert('Select a page first, then add a unit.');
    return;
  }
  const titleEn = el.unitEn.value.trim();
  const titleAr = el.unitAr.value.trim();
  const centralIdea = el.unitIdea.value.trim();
  if (!titleEn && !titleAr) {
    if (el.unitError) el.unitError.hidden = false;
    el.unitEn.focus();
    return;
  }
  if (el.unitError) el.unitError.hidden = true;

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
  el.linkPage.value = page.id;
  fillUnitSelector(page.id);
  el.linkUnit.value = String(ensureUnits(page).length - 1);
});

el.unitsHost.addEventListener('click', (e) => {
  const editLink = e.target.closest('[data-edit-link]');
  const delLink = e.target.closest('[data-delete-link]');
  const delUnit = e.target.closest('[data-delete-unit]');
  const page = selectedPage();
  if (!page) return;

  if (editLink) {
    const [u, l] = editLink.dataset.editLink.split(':').map(Number);
    startEditLink(page.id, u, l);
    return;
  }

  if (delLink) {
    const [u, l] = delLink.dataset.deleteLink.split(':').map(Number);
    page.units[u]?.links?.splice(l, 1);
    syncPageLinks(page);
    markDirty();
    if (isEditing() && Number(el.editUnitIndex.value) === u && Number(el.editLinkIndex.value) === l) {
      resetComposerForm();
    }
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
    resetComposerForm();
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
  if (!site.primaryNav.includes(id)) {
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

async function publishToVercel() {
  let password = sessionStorage.getItem(PASS_SESSION_KEY) || '';
  if (!password) {
    password = window.prompt('Enter the admin password to publish') || '';
  }
  if (!password) {
    el.publishMsg.hidden = false;
    el.publishMsg.textContent = 'Password required to publish.';
    return;
  }

  el.publishBtn.disabled = true;
  el.publishMsg.hidden = false;
  el.publishMsg.textContent = 'Publishing to Vercel…';

  try {
    site.generatedAt = new Date().toISOString();
    syncNavWithPages();
    saveDraft();

    const files = [...pendingUploads.values()].map((entry) => ({
      path: entry.path,
      base64: entry.base64,
      mime: entry.mime || 'application/octet-stream',
    }));

    if (files.length) {
      el.publishMsg.textContent = `Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`;
    }

    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, site, files }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Publish failed (${res.status})`);
    }

    if (data.site) site = data.site;
    for (const entry of [...pendingUploads.keys()]) {
      await removePendingUpload(entry);
    }
    saveDraft();
    sessionStorage.setItem(PASS_SESSION_KEY, password);
    clearDirty('Published on Vercel');
    el.publishMsg.textContent =
      'Published. Visitors will see the update right away (refresh if needed).';
    renderAll();
  } catch (err) {
    el.publishMsg.textContent = err.message || String(err);
  } finally {
    el.publishBtn.disabled = false;
  }
}

el.publishBtn.addEventListener('click', publishToVercel);

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
