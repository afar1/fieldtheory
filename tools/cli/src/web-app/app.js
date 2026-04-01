const PAGE_SIZE = 40;
const SEARCH_DEBOUNCE_MS = 220;
const LOAD_MORE_THRESHOLD_PX = 720;

function createFeedState(filters) {
  return {
    items: [],
    total: 0,
    limit: PAGE_SIZE,
    offset: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    sort: 'desc',
    requestToken: 0,
    filters: { ...filters },
  };
}

const state = {
  tab: 'bookmarks',
  theme: 'light',
  searchFocused: false,
  searchSelectionStart: null,
  searchSelectionEnd: null,
  feeds: {
    bookmarks: createFeedState({
      query: '',
      category: '',
      domain: '',
    }),
    theories: createFeedState({
      query: '',
      confidence: '',
      repo: '',
    }),
  },
  expandedMenuKey: '',
  openInspectors: new Set(),
  currentActionId: '',
  currentActionKind: '',
  currentAction: null,
  actionPoller: null,
  lastToastTimeout: null,
  pull: {
    startY: 0,
    active: false,
    ready: false,
  },
};

const root = document.getElementById('app');
let searchTimer = null;
let mediaThemeQuery = null;

function getStoredTheme() {
  const stored = window.localStorage.getItem('ft-timeline-theme');
  return stored === 'dark' || stored === 'light' ? stored : null;
}

function resolveTheme(preference = getStoredTheme()) {
  if (preference === 'dark' || preference === 'light') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
}

function setThemePreference(theme) {
  window.localStorage.setItem('ft-timeline-theme', theme);
  applyTheme(theme);
  render();
}

function toggleTheme() {
  setThemePreference(state.theme === 'dark' ? 'light' : 'dark');
}

function activeFeed() {
  return state.feeds[state.tab];
}

function activeFilters() {
  return activeFeed().filters;
}

function currentItems() {
  return activeFeed().items;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(value, max = 180) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Request failed: ${response.status}`);
  }
  return json;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  if (state.lastToastTimeout) {
    clearTimeout(state.lastToastTimeout);
  }
  state.lastToastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2600);
}

function setSearchValueSilently(value) {
  const input = document.getElementById('search-input');
  if (input && input.value !== value) {
    input.value = value;
  }
}

function rememberSearchSelection(input) {
  state.searchSelectionStart = input.selectionStart;
  state.searchSelectionEnd = input.selectionEnd;
}

function restoreSearchFocus() {
  if (!state.searchFocused) return;
  const input = document.getElementById('search-input');
  if (!input) return;
  requestAnimationFrame(() => {
    input.focus();
    if (state.searchSelectionStart != null && state.searchSelectionEnd != null) {
      try {
        input.setSelectionRange(state.searchSelectionStart, state.searchSelectionEnd);
      } catch {
        // no-op for unsupported input states
      }
    }
  });
}

function countBy(items, getter) {
  const counts = new Map();
  for (const item of items) {
    const key = getter(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function bookmarkFilterChips() {
  const categoryChips = countBy(state.feeds.bookmarks.items, (item) => item.primaryCategory).slice(0, 6).map(([value]) => ({
    key: `category:${value}`,
    label: value,
    active: state.feeds.bookmarks.filters.category === value,
    kind: 'category',
    value,
  }));
  const domainChips = countBy(state.feeds.bookmarks.items, (item) => item.primaryDomain).slice(0, 6).map(([value]) => ({
    key: `domain:${value}`,
    label: value,
    active: state.feeds.bookmarks.filters.domain === value,
    kind: 'domain',
    value,
  }));
  return [...categoryChips, ...domainChips];
}

function theoryFilterChips() {
  const confidenceChips = countBy(state.feeds.theories.items, (item) => item.confidence).slice(0, 4).map(([value]) => ({
    key: `confidence:${value}`,
    label: value,
    active: state.feeds.theories.filters.confidence === value,
    kind: 'confidence',
    value,
  }));
  const repoChips = countBy(state.feeds.theories.items, (item) => item.transcriptMeta?.repoName || '').slice(0, 5).map(([value]) => ({
    key: `repo:${value}`,
    label: value,
    active: state.feeds.theories.filters.repo === value,
    kind: 'repo',
    value,
  }));
  return [...confidenceChips, ...repoChips];
}

function buildQueryString(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') search.set(key, value);
  });
  return search.toString();
}

function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function loadFeed(tab, { append = false } = {}) {
  const feed = state.feeds[tab];
  const requestToken = ++feed.requestToken;
  const nextOffset = append ? feed.items.length : 0;

  if (append) {
    feed.loadingMore = true;
  } else {
    feed.loading = true;
  }

  render();

  try {
    const search = buildQueryString({
      ...feed.filters,
      limit: String(feed.limit),
      offset: String(nextOffset),
      sort: feed.sort,
    });
    const page = await fetchJson(`/api/${tab}${search ? `?${search}` : ''}`);
    if (requestToken !== feed.requestToken) return;

    feed.items = append ? dedupeById([...feed.items, ...page.items]) : page.items;
    feed.total = Number(page.total || 0);
    feed.offset = Number(page.offset || 0);
    feed.limit = Number(page.limit || feed.limit || PAGE_SIZE);
    feed.hasMore = Boolean(page.hasMore);
    feed.sort = page.sort === 'asc' ? 'asc' : 'desc';
  } finally {
    if (requestToken === feed.requestToken) {
      feed.loading = false;
      feed.loadingMore = false;
    }
  }
}

async function reloadActiveFeed() {
  await loadFeed(state.tab);
  render();
}

async function loadMoreActiveFeed() {
  const feed = activeFeed();
  if (feed.loading || feed.loadingMore || !feed.hasMore) return;
  await loadFeed(state.tab, { append: true });
  render();
}

async function refreshAll() {
  await Promise.all([
    loadFeed('bookmarks'),
    loadFeed('theories'),
  ]);
  render();
}

function externalLink(url, label) {
  return `<a class="meta-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function localFileLink(filePath, label) {
  return `<a class="viewer-link" href="/view?path=${encodeURIComponent(filePath)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function displayHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Link';
  }
}

function inspectorPayload(item) {
  return escapeHtml(JSON.stringify(item, null, 2));
}

function theoryAvatarLabel(item) {
  if (item.displayId.startsWith('FT-')) return item.displayId.replace('FT-', '');
  return item.displayId;
}

function renderBookmarkCard(item) {
  const key = `bookmark:${item.id}`;
  const menuExpanded = state.expandedMenuKey === key;
  const inspectorOpen = state.openInspectors.has(key);
  const avatarStyle = item.authorProfileImageUrl
    ? `style="background-image:url('${escapeHtml(item.authorProfileImageUrl)}'); color:transparent;"`
    : '';
  const avatarText = item.authorHandle ? item.authorHandle.charAt(0).toUpperCase() : 'B';
  const tags = [
    item.primaryCategory ? `<span class="meta-pill warm">${escapeHtml(item.primaryCategory)}</span>` : '',
    item.primaryDomain ? `<span class="meta-pill">${escapeHtml(item.primaryDomain)}</span>` : '',
    item.postedAt ? `<span class="meta-pill">${escapeHtml(item.postedAt.slice(0, 10))}</span>` : '',
  ].join('');
  const stateLinks = [
    item.state?.issueUrl ? `<a class="state-pill" href="${escapeHtml(item.state.issueUrl)}" target="_blank" rel="noreferrer"><strong>Issue</strong> Open GitHub issue</a>` : '',
    item.state?.debateTranscriptPath ? `<a class="state-pill" href="/view?path=${encodeURIComponent(item.state.debateTranscriptPath)}" target="_blank" rel="noreferrer"><strong>Debate</strong> Transcript</a>` : '',
    item.state?.debateConsensusPath ? `<a class="state-pill" href="/view?path=${encodeURIComponent(item.state.debateConsensusPath)}" target="_blank" rel="noreferrer"><strong>Conclusion</strong> Council close</a>` : '',
  ].join('');
  const links = (item.links || []).slice(0, 4).map((url) => externalLink(url, displayHost(url))).join('');
  const footerLinks = [
    externalLink(item.url, 'Open on X'),
    `<button class="meta-link" data-inspect="${escapeHtml(key)}">Inspect</button>`,
  ].join('');
  const identityName = item.authorName || item.authorHandle || 'Bookmark';
  const identityHandle = item.authorHandle ? `@${item.authorHandle}` : 'x-bookmark';
  const identityMeta = [identityHandle, item.postedAt ? item.postedAt.slice(0, 10) : ''].filter(Boolean).join(' · ');

  return `
    <article class="card">
      <div class="card-head">
        <div class="avatar" ${avatarStyle}>${escapeHtml(avatarText)}</div>
        <div class="card-head-main">
          <div class="identity-line">
            <span class="identity-name">${escapeHtml(identityName)}</span>
            <span class="identity-handle">${escapeHtml(identityMeta)}</span>
          </div>
        </div>
      </div>
      <div class="card-copy">${escapeHtml(truncate(item.text, 360))}</div>
      ${tags ? `<div class="meta-stack">${tags}</div>` : ''}
      ${links ? `<div class="link-strip">${links}</div>` : ''}
      ${stateLinks ? `<div class="state-links">${stateLinks}</div>` : ''}
      <div class="card-footer">
        <div class="footer-links">${footerLinks}</div>
        <div class="path-menu desktop-hover ${menuExpanded ? 'expanded' : ''}">
          <button class="path-action issue" data-run="bookmark:issue:${escapeHtml(item.id)}">Issue</button>
          <button class="path-action debate" data-run="bookmark:debate:${escapeHtml(item.id)}">Debate</button>
          <a class="path-action viewer" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open</a>
          <button class="path-trigger" data-menu="${escapeHtml(key)}" aria-expanded="${String(menuExpanded)}">+</button>
        </div>
      </div>
      <div class="inspector ${inspectorOpen ? 'open' : ''}">
        <pre>${inspectorPayload(item)}</pre>
      </div>
    </article>
  `;
}

function renderTheoryCard(item) {
  const key = `theory:${item.id}`;
  const menuExpanded = state.expandedMenuKey === key;
  const inspectorOpen = state.openInspectors.has(key);
  const primaryHref = item.transcriptPath || item.digestPath;
  const primaryLabel = item.transcriptPath
    ? 'Transcript'
    : item.sourceMessageId
      ? 'Source'
      : 'Digest';
  const footerLinks = [
    item.sourceMessageId && item.digestPath && item.digestPath !== primaryHref ? localFileLink(item.digestPath, 'Email') : '',
    primaryHref ? localFileLink(primaryHref, primaryLabel) : '',
    `<button class="meta-link" data-inspect="${escapeHtml(key)}">Inspect</button>`,
  ].filter(Boolean).join('');
  const bookmarkLinks = (item.transcriptMeta?.bookmarkUrls || []).slice(0, 4).map((url) => externalLink(url, 'Bookmark')).join('');
  const tagList = [
    item.displayId ? `<span class="meta-pill warm">${escapeHtml(item.displayId)}</span>` : '',
    item.transcriptMeta?.repoName ? `<span class="meta-pill">${escapeHtml(item.transcriptMeta.repoName)}</span>` : '',
    item.confidence ? `<span class="meta-pill">${escapeHtml(item.confidence)}</span>` : '',
    item.transcriptMeta?.type ? `<span class="meta-pill">${escapeHtml(item.transcriptMeta.type)}</span>` : '',
    item.modelSignature ? `<span class="meta-pill">${escapeHtml(item.modelSignature)}</span>` : '',
    item.date ? `<span class="meta-pill">${escapeHtml(item.date)}</span>` : '',
  ].join('');
  const stateLinks = [
    item.state?.issueUrl ? `<a class="state-pill" href="${escapeHtml(item.state.issueUrl)}" target="_blank" rel="noreferrer"><strong>Issue</strong> ${escapeHtml(item.state.issueState === 'closed' ? 'Closed issue' : item.state.issueSource === 'existing' ? 'Existing issue' : 'Open GitHub issue')}</a>` : '',
    item.state?.prUrl ? `<a class="state-pill" href="${escapeHtml(item.state.prUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(item.state.prState === 'merged' ? 'Merged' : 'PR')}</strong> ${escapeHtml(item.state.prState === 'merged' ? 'Merged pull request' : 'Linked pull request')}</a>` : '',
    item.state?.debateTranscriptPath ? `<a class="state-pill" href="/view?path=${encodeURIComponent(item.state.debateTranscriptPath)}" target="_blank" rel="noreferrer"><strong>Debate</strong> Transcript</a>` : '',
    item.state?.debateConsensusPath ? `<a class="state-pill" href="/view?path=${encodeURIComponent(item.state.debateConsensusPath)}" target="_blank" rel="noreferrer"><strong>Conclusion</strong> Council close</a>` : '',
  ].join('');

  return `
    <article class="card">
      <div class="card-head">
        <div class="avatar theory-avatar">${escapeHtml(theoryAvatarLabel(item))}</div>
        <div class="card-head-main">
          <div class="section-kicker">${escapeHtml(item.displayId)}${item.transcriptMeta?.repoName ? ` · ${escapeHtml(item.transcriptMeta.repoName)}` : ''}</div>
          <div class="card-title">${escapeHtml(item.title)}</div>
          <div class="card-subtitle">${escapeHtml(item.sectionTitle || 'Field Theory finding')}</div>
        </div>
      </div>
      <div class="card-copy">${escapeHtml(truncate(item.whatWeFound, 320))}</div>
      ${tagList ? `<div class="meta-stack">${tagList}</div>` : ''}
      ${bookmarkLinks ? `<div class="link-strip">${bookmarkLinks}</div>` : ''}
      ${stateLinks ? `<div class="state-links">${stateLinks}</div>` : ''}
      <div class="card-footer">
        <div class="footer-links">${footerLinks}</div>
        <div class="path-menu desktop-hover ${menuExpanded ? 'expanded' : ''}">
          <button class="path-action issue" data-run="theory:issue:${escapeHtml(item.id)}">Issue</button>
          <button class="path-action debate" data-run="theory:debate:${escapeHtml(item.id)}">Debate</button>
          <a class="path-action viewer" href="/view?path=${encodeURIComponent(primaryHref)}" target="_blank" rel="noreferrer">${escapeHtml(primaryLabel)}</a>
          <button class="path-trigger" data-menu="${escapeHtml(key)}" aria-expanded="${String(menuExpanded)}">+</button>
        </div>
      </div>
      <div class="inspector ${inspectorOpen ? 'open' : ''}">
        <pre>${inspectorPayload(item)}</pre>
      </div>
    </article>
  `;
}

function toolbarButtons() {
  if (state.tab === 'bookmarks') {
    return `
      <button class="action-button primary" data-global="sync">Sync latest</button>
      <button class="action-button" data-global="clear">Clear filters</button>
    `;
  }
  return `
    <button class="action-button primary" data-global="sync-theories">Sync latest</button>
    <button class="action-button" data-global="clear">Clear filters</button>
  `;
}

function filterChips() {
  const chips = state.tab === 'bookmarks' ? bookmarkFilterChips() : theoryFilterChips();
  return chips.map((chip) => `
    <button class="chip-button ${chip.active ? 'active' : ''}" data-filter="${escapeHtml(chip.kind)}" data-value="${escapeHtml(chip.value)}">
      ${escapeHtml(chip.label)}
    </button>
  `).join('');
}

function heroMeta() {
  const feed = activeFeed();
  const label = state.tab === 'bookmarks' ? 'bookmarks' : 'findings';
  return `${feed.total.toLocaleString()} ${label} · ${feed.sort === 'desc' ? 'newest first' : 'oldest first'}`;
}

function renderActionDock() {
  const action = state.currentAction;
  if (!action) {
    return '<section id="action-dock" class="action-dock hidden"></section>';
  }
  const dockClass = action.status === 'error' ? 'error' : action.status === 'done' ? 'done' : '';
  const resultLinks = [];
  const result = action.result || {};

  if (result.url) {
    resultLinks.push(`<a class="dock-link" href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">${escapeHtml(result.alreadyExists ? 'Existing issue' : 'Open issue')}</a>`);
  }
  if (result.prUrl) {
    resultLinks.push(`<a class="dock-link" href="${escapeHtml(result.prUrl)}" target="_blank" rel="noreferrer">${escapeHtml(result.mergedAt ? 'Merged PR' : 'Pull request')}</a>`);
  }
  if (result.transcriptPath) {
    resultLinks.push(`<a class="dock-link" href="/view?path=${encodeURIComponent(result.transcriptPath)}" target="_blank" rel="noreferrer">Transcript</a>`);
  }
  if (result.consensusPath) {
    resultLinks.push(`<a class="dock-link" href="/view?path=${encodeURIComponent(result.consensusPath)}" target="_blank" rel="noreferrer">Conclusion</a>`);
  }
  if (result.theory?.digestPath) {
    resultLinks.push(`<a class="dock-link" href="/view?path=${encodeURIComponent(result.theory.digestPath)}" target="_blank" rel="noreferrer">Source</a>`);
  }
  const logs = (action.logs || []).slice(-14).join('\n');

  return `
    <section id="action-dock" class="action-dock ${dockClass}">
      <div class="dock-head">
        <div>
          <strong>${escapeHtml(action.label)}</strong>
          <span>${escapeHtml(action.status === 'running'
            ? 'Running through the core CLI…'
            : action.status === 'done'
              ? action.result?.alreadyExists
                ? 'Existing GitHub work found. No duplicate issue was created.'
                : 'Finished. Review links or logs below.'
              : action.error || 'Action failed.')}</span>
        </div>
        <button class="dock-close" data-dock-close="true">×</button>
      </div>
      <div class="dock-command">${escapeHtml(action.command)}</div>
      <div class="progress"><div></div></div>
      ${resultLinks.length ? `<div class="dock-links">${resultLinks.join('')}</div>` : ''}
      <div class="dock-logs">${escapeHtml(logs || 'Waiting for output…')}</div>
    </section>
  `;
}

function renderFeedFooter() {
  const feed = activeFeed();
  if (feed.loading && feed.items.length === 0) {
    return `<div class="empty-state">Loading ${state.tab === 'bookmarks' ? 'bookmarks' : 'findings'}…</div>`;
  }
  if (feed.loadingMore) {
    return '<div class="feed-status">Loading more…</div>';
  }
  if (feed.hasMore) {
    return `<div id="feed-tail" class="feed-status">Scroll for more · showing ${feed.items.length.toLocaleString()} of ${feed.total.toLocaleString()}</div>`;
  }
  if (feed.items.length > 0) {
    return `<div id="feed-tail" class="feed-status end">Showing all ${feed.total.toLocaleString()}</div>`;
  }
  return '';
}

function render() {
  const feed = activeFeed();
  const filters = activeFilters();
  const shouldRestoreSearchFocus = state.searchFocused;
  const itemsMarkup = feed.items.length
    ? feed.items.map((item) => state.tab === 'bookmarks' ? renderBookmarkCard(item) : renderTheoryCard(item)).join('')
    : '';
  const chips = filterChips();

  root.innerHTML = `
    <div class="app-shell">
      <div id="pull-indicator" class="pull-indicator">Pull to sync bookmarks</div>
      <header class="hero">
        <div class="hero-top">
          <div class="hero-title-block">
            <h1>${state.tab === 'bookmarks' ? 'Bookmarks' : 'FT Findings'}</h1>
            <div class="hero-meta">${escapeHtml(heroMeta())}</div>
          </div>
          <div class="hero-side">
            <button class="sort-toggle" data-global="toggle-sort">${feed.sort === 'desc' ? 'Newest' : 'Oldest'}</button>
            <button class="theme-toggle" data-theme-toggle="true" aria-label="Toggle dark mode">
              ${state.theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </div>
        <div class="tab-row">
          <button class="tab-button ${state.tab === 'bookmarks' ? 'active' : ''}" data-tab="bookmarks">Bookmarks</button>
          <button class="tab-button ${state.tab === 'theories' ? 'active' : ''}" data-tab="theories">Theories</button>
        </div>
        <div class="search-shell">
          <input id="search-input" class="search-input" type="search" value="${escapeHtml(filters.query)}" placeholder="${state.tab === 'bookmarks' ? 'Search bookmarks, authors, domains…' : 'Search FT ids, titles, repos, findings…'}" />
          <button class="action-button" data-global="search-clear">Clear</button>
        </div>
        <div class="toolbar-row">${toolbarButtons()}</div>
        ${chips ? `<div class="chip-row">${chips}</div>` : ''}
      </header>
      <main class="timeline">
        ${itemsMarkup || `<div class="empty-state">${state.tab === 'bookmarks' ? 'No bookmarks match the current filters.' : 'No FT findings match the current filters.'}</div>`}
        ${renderFeedFooter()}
      </main>
      ${renderActionDock()}
      <div id="toast" class="toast hidden"></div>
    </div>
  `;

  bindEvents();
  updatePullIndicator();
  setSearchValueSilently(filters.query || '');
  if (shouldRestoreSearchFocus) {
    restoreSearchFocus();
  }
  requestAnimationFrame(() => {
    maybeLoadMoreOnScroll();
  });
}

function clearFeedFilters(feed) {
  Object.keys(feed.filters).forEach((key) => {
    feed.filters[key] = '';
  });
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.tab = button.getAttribute('data-tab');
      state.expandedMenuKey = '';
      render();
      if (!activeFeed().items.length && !activeFeed().loading) {
        await reloadActiveFeed();
      }
    });
  });

  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.addEventListener('click', async () => {
      const kind = button.getAttribute('data-filter');
      const value = button.getAttribute('data-value');
      const filters = activeFilters();
      filters[kind] = filters[kind] === value ? '' : value;
      await reloadActiveFeed();
    });
  });

  document.querySelectorAll('[data-global]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.getAttribute('data-global');
      if (action === 'sync') {
        startAction({ kind: 'bookmarks', action: 'sync' });
        return;
      }
      if (action === 'reload') {
        await reloadActiveFeed();
        showToast('Reloaded.');
        return;
      }
      if (action === 'sync-theories') {
        startAction({ kind: 'theories', action: 'sync' });
        return;
      }
      if (action === 'toggle-sort') {
        const feed = activeFeed();
        feed.sort = feed.sort === 'desc' ? 'asc' : 'desc';
        await reloadActiveFeed();
        showToast(feed.sort === 'desc' ? 'Newest first.' : 'Oldest first.');
        return;
      }
      if (action === 'clear' || action === 'search-clear') {
        clearFeedFilters(activeFeed());
        await reloadActiveFeed();
      }
    });
  });

  document.querySelectorAll('[data-menu]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const key = button.getAttribute('data-menu');
      state.expandedMenuKey = state.expandedMenuKey === key ? '' : key;
      render();
    });
  });

  document.querySelectorAll('[data-inspect]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const key = button.getAttribute('data-inspect');
      if (state.openInspectors.has(key)) {
        state.openInspectors.delete(key);
      } else {
        state.openInspectors.add(key);
      }
      render();
    });
  });

  document.querySelectorAll('[data-run]').forEach((button) => {
    button.addEventListener('click', () => {
      const [kind, action, id] = button.getAttribute('data-run').split(':');
      startAction({ kind, action, id });
    });
  });

  const dockClose = document.querySelector('[data-dock-close]');
  if (dockClose) {
    dockClose.addEventListener('click', () => {
      state.currentAction = null;
      state.currentActionId = '';
      render();
    });
  }

  const themeToggle = document.querySelector('[data-theme-toggle]');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      toggleTheme();
    });
  }

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('focus', () => {
      state.searchFocused = true;
      rememberSearchSelection(searchInput);
    });
    searchInput.addEventListener('blur', () => {
      state.searchFocused = false;
      rememberSearchSelection(searchInput);
    });
    searchInput.addEventListener('input', () => {
      const nextValue = searchInput.value.trim();
      activeFilters().query = nextValue;
      state.searchFocused = true;
      rememberSearchSelection(searchInput);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        await reloadActiveFeed();
      }, SEARCH_DEBOUNCE_MS);
    });
    searchInput.addEventListener('click', () => {
      state.searchFocused = true;
      rememberSearchSelection(searchInput);
    });
    searchInput.addEventListener('keyup', () => {
      rememberSearchSelection(searchInput);
    });
  }
}

function onOutsideClick(event) {
  if (event.target.closest('.path-menu')) return;
  if (!state.expandedMenuKey) return;
  state.expandedMenuKey = '';
  render();
}

function updatePullIndicator() {
  const indicator = document.getElementById('pull-indicator');
  if (!indicator) return;
  const shouldShow = state.tab === 'bookmarks' && (state.pull.active || state.pull.ready);
  indicator.classList.toggle('visible', shouldShow);
  indicator.classList.toggle('ready', state.pull.ready);
  indicator.textContent = state.pull.ready ? 'Release to sync latest bookmarks' : 'Pull to sync latest bookmarks';
}

function bindPullToRefresh() {
  document.addEventListener('touchstart', (event) => {
    if (window.scrollY > 0 || state.tab !== 'bookmarks') return;
    state.pull.startY = event.touches[0].clientY;
    state.pull.active = true;
    state.pull.ready = false;
    updatePullIndicator();
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!state.pull.active || state.tab !== 'bookmarks') return;
    const delta = event.touches[0].clientY - state.pull.startY;
    state.pull.ready = delta > 84;
    updatePullIndicator();
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (state.pull.active && state.pull.ready && state.tab === 'bookmarks') {
      startAction({ kind: 'bookmarks', action: 'sync' });
    }
    state.pull.active = false;
    state.pull.ready = false;
    updatePullIndicator();
  });
}

function maybeLoadMoreOnScroll() {
  const feed = activeFeed();
  if (feed.loading || feed.loadingMore || !feed.hasMore) return;
  const remaining = document.documentElement.scrollHeight - (window.innerHeight + window.scrollY);
  if (remaining < LOAD_MORE_THRESHOLD_PX) {
    void loadMoreActiveFeed();
  }
}

async function startAction(payload) {
  state.expandedMenuKey = '';
  render();
  try {
    const record = await fetchJson('/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    state.currentActionId = record.id;
    state.currentActionKind = `${payload.kind}:${payload.action}`;
    state.currentAction = record;
    showToast(`Started ${record.label}`);
    render();
    pollAction();
  } catch (error) {
    showToast(error.message || 'Action failed to start.');
  }
}

function stopPolling() {
  if (state.actionPoller) {
    clearInterval(state.actionPoller);
    state.actionPoller = null;
  }
}

function pollAction() {
  stopPolling();
  if (!state.currentActionId) return;
  state.actionPoller = setInterval(async () => {
    try {
      const action = await fetchJson(`/api/action?id=${encodeURIComponent(state.currentActionId)}`);
      state.currentAction = action;
      render();
      if (action.status !== 'running') {
        stopPolling();
        await refreshAll();
        showToast(action.status === 'done'
          ? action.result?.alreadyExists
            ? action.result?.mergedAt
              ? 'Merged work already exists.'
              : action.result?.prUrl
                ? 'Pull request already exists.'
                : 'Issue already exists.'
            : 'Action finished.'
          : action.error || 'Action failed.');
      }
    } catch (error) {
      stopPolling();
      showToast(error.message || 'Failed to poll action status.');
    }
  }, 1000);
}

async function init() {
  applyTheme(resolveTheme());
  mediaThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaThemeQuery.addEventListener('change', () => {
    if (!getStoredTheme()) {
      applyTheme(resolveTheme());
      render();
    }
  });
  document.addEventListener('click', onOutsideClick);
  window.addEventListener('scroll', maybeLoadMoreOnScroll, { passive: true });
  bindPullToRefresh();
  await refreshAll();
}

init().catch((error) => {
  root.innerHTML = `<div class="empty-state">${escapeHtml(error.message || String(error))}</div>`;
});
