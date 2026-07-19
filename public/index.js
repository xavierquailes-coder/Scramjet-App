"use strict";

const form = document.getElementById("sj-form");
const address = document.getElementById("sj-address");
const searchEngine = document.getElementById("sj-search-engine");
const error = document.getElementById("sj-error");
const errorCode = document.getElementById("sj-error-code");
const homeBtn = document.getElementById("homeBtn");
const backBtn = document.getElementById("backBtn");
const refreshBtn = document.getElementById("refreshBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const bookmarkBtn = document.getElementById("bookmarkBtn");
const bookmarksBtn = document.getElementById("bookmarksBtn");
const bookmarksPanel = document.getElementById("bookmarksPanel");
const bookmarksList = document.getElementById("bookmarksList");
const emptyBookmarks = document.getElementById("emptyBookmarks");
const closeBookmarksBtn = document.getElementById("closeBookmarksBtn");
const tabList = document.getElementById("tabList");
const newTabBtn = document.getElementById("newTabBtn");
const loadingOverlay = document.getElementById("sj-loading-overlay");

const { ScramjetController } = $scramjetLoadController();
const scramjet = new ScramjetController({
  files: {
    wasm: "/scram/scramjet.wasm.wasm",
    all: "/scram/scramjet.all.js",
    sync: "/scram/scramjet.sync.js"
  }
});
scramjet.init();
const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

const HOME_URL = "https://duckduckgo.com";
const BOOKMARKS_KEY = "squiddcore-browser-bookmarks-v1";
let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let syncTimer = null;
let loadingTimer = null;
let loadingToken = 0;

function showLoadingBee() {
  loadingToken++;
  if (loadingTimer) clearTimeout(loadingTimer);
  loadingOverlay?.classList.add("show");
  loadingOverlay?.setAttribute("aria-hidden", "false");
  const token = loadingToken;
  loadingTimer = setTimeout(() => hideLoadingBee(token), 9000);
  try { window.parent.postMessage({ type: "squiddcore-browser-loading", loading: true }, "*"); } catch (_) {}
  return token;
}

function hideLoadingBee(token) {
  if (token && token !== loadingToken) return;
  if (loadingTimer) {
    clearTimeout(loadingTimer);
    loadingTimer = null;
  }
  loadingOverlay?.classList.remove("show");
  loadingOverlay?.setAttribute("aria-hidden", "true");
  try { window.parent.postMessage({ type: "squiddcore-browser-loading", loading: false }, "*"); } catch (_) {}
}

function getActiveTab() {
  return tabs.find(tab => tab.id === activeTabId) || null;
}

function makeTabTitle(url) {
  if (!url || url === HOME_URL) return "New Tab";
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || "New Tab";
  } catch (_) {
    return "New Tab";
  }
}

function createTab(url = HOME_URL, activate = true) {
  const tab = {
    id: `tab-${++tabCounter}`,
    title: makeTabTitle(url),
    url,
    frame: null,
    lastShownUrl: url
  };
  tabs.push(tab);
  renderTabs();
  if (activate) activateTab(tab.id);
  if (url !== HOME_URL) navigate(url, tab.id);
  return tab;
}

function renderTabs() {
  tabList.innerHTML = "";
  for (const tab of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `browser-tab${tab.id === activeTabId ? " active" : ""}`;
    button.dataset.tabId = tab.id;
    button.innerHTML = `
      <span class="tab-favicon" aria-hidden="true">🌐</span>
      <span class="tab-title"></span>
      <span class="tab-close" role="button" aria-label="Close tab" title="Close tab">×</span>
    `;
    button.querySelector(".tab-title").textContent = tab.title;
    button.addEventListener("click", event => {
      if (event.target.closest(".tab-close")) {
        event.stopPropagation();
        closeTab(tab.id);
        return;
      }
      activateTab(tab.id);
    });
    tabList.appendChild(button);
  }
}

function activateTab(tabId) {
  const nextTab = tabs.find(tab => tab.id === tabId);
  if (!nextTab) return;
  activeTabId = tabId;
  for (const tab of tabs) {
    if (tab.frame?.frame) tab.frame.frame.style.display = tab.id === tabId ? "block" : "none";
  }
  address.value = nextTab.url || HOME_URL;
  document.body.classList.toggle("proxy-open", !!nextTab.frame);
  updateBookmarkButton();
  renderTabs();
  clearInterval(syncTimer);
  syncTimer = setInterval(syncAddressBar, 350);
}

function closeTab(tabId) {
  const index = tabs.findIndex(tab => tab.id === tabId);
  if (index === -1) return;
  const wasActive = activeTabId === tabId;
  const [removed] = tabs.splice(index, 1);
  try { removed.frame?.frame?.remove(); } catch (_) {}

  if (!tabs.length) {
    createTab(HOME_URL, true);
    return;
  }
  if (wasActive) {
    const fallback = tabs[Math.min(index, tabs.length - 1)];
    activateTab(fallback.id);
  } else {
    renderTabs();
  }
}

function decodePossibleTarget(rawValue) {
  if (!rawValue) return "";
  const raw = String(rawValue);
  const encodedMatch = raw.match(/(https?%3A%2F%2F.*)$/i);
  if (encodedMatch) {
    try { return decodeURIComponent(encodedMatch[1]); } catch (_) {}
  }
  const plainMatch = raw.match(/(https?:\/\/.*)$/i);
  if (plainMatch && !plainMatch[1].startsWith(location.origin)) return plainMatch[1];
  const pathParts = new URL(raw, location.href).pathname.split("/").filter(Boolean);
  for (let i = pathParts.length - 1; i >= 0; i--) {
    const part = pathParts[i].replace(/-/g, "+").replace(/_/g, "/");
    if (part.length < 12) continue;
    try {
      const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
      const decoded = decodeURIComponent(atob(padded));
      if (/^https?:\/\//i.test(decoded)) {
        const current = new URL(raw, location.href);
        return decoded + current.search + current.hash;
      }
    } catch (_) {}
  }
  return "";
}

function readCurrentTarget(tab = getActiveTab()) {
  if (!tab?.frame?.frame) return "";
  const iframe = tab.frame.frame;
  try {
    const decoded = decodePossibleTarget(iframe.contentWindow.location.href);
    if (decoded) return decoded;
  } catch (_) {}
  try {
    const decoded = decodePossibleTarget(iframe.src);
    if (decoded) return decoded;
  } catch (_) {}
  return "";
}

function syncAddressBar() {
  const tab = getActiveTab();
  if (!tab) return;
  const current = readCurrentTarget(tab);
  if (!current || current === tab.lastShownUrl) return;
  tab.lastShownUrl = current;
  tab.url = current;
  tab.title = makeTabTitle(current);
  if (document.activeElement !== address) address.value = current;
  renderTabs();
  updateBookmarkButton();
}

function bindFrameNavigationSignals(tab) {
  if (!tab?.frame?.frame) return;
  const iframe = tab.frame.frame;
  try {
    const doc = iframe.contentDocument;
    if (!doc || doc.__sqBeeBound) return;
    doc.__sqBeeBound = true;
    doc.addEventListener("click", event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target?.closest?.("a[href]");
      if (!anchor || anchor.hasAttribute("download")) return;
      const href = (anchor.getAttribute("href") || "").trim();
      if (!href || href === "#" || href.startsWith("#") || /^(javascript:|mailto:|tel:|data:|blob:)/i.test(href)) return;
      showLoadingBee();
    }, true);
    doc.addEventListener("submit", event => {
      if (event.target?.matches?.("form")) showLoadingBee();
    }, true);
  } catch (_) {}
}

function attachFrame(tab) {
  if (!tab?.frame?.frame) return;
  const iframe = tab.frame.frame;
  iframe.classList.add("sj-tab-frame");
  iframe.title = "Scramjet browser content";
  iframe.style.display = tab.id === activeTabId ? "block" : "none";
  iframe.addEventListener("load", () => {
    const token = loadingToken;
    setTimeout(syncAddressBar, 80);
    setTimeout(syncAddressBar, 450);
    setTimeout(syncAddressBar, 1200);
    setTimeout(() => bindFrameNavigationSignals(tab), 120);
    setTimeout(() => hideLoadingBee(token), 650);
  });
}

async function ensureTransport() {
  const wispUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;
  if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
    await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
  }
}

async function navigate(raw, targetTabId = activeTabId) {
  const tab = tabs.find(item => item.id === targetTabId);
  if (!tab) return;
  const token = showLoadingBee();
  error.textContent = "";
  errorCode.textContent = "";
  try {
    await registerSW();
    await ensureTransport();
    const url = search(raw, searchEngine.value);
    tab.lastShownUrl = url;
    tab.url = url;
    tab.title = makeTabTitle(url);
    if (tab.id === activeTabId) address.value = url;
    if (!tab.frame) {
      tab.frame = scramjet.createFrame();
      document.body.appendChild(tab.frame.frame);
      attachFrame(tab);
    }
    tab.frame.go(url);
    document.body.classList.toggle("proxy-open", !!getActiveTab()?.frame);
    renderTabs();
    updateBookmarkButton();
    setTimeout(syncAddressBar, 300);
  } catch (err) {
    hideLoadingBee(token);
    error.textContent = "Browser failed to open the page.";
    errorCode.textContent = err?.toString?.() || String(err);
  }
}

function goHome(tab = getActiveTab()) {
  if (!tab) return;
  hideLoadingBee();
  try { tab.frame?.frame?.remove(); } catch (_) {}
  tab.frame = null;
  tab.url = HOME_URL;
  tab.lastShownUrl = HOME_URL;
  tab.title = "New Tab";
  address.value = HOME_URL;
  document.body.classList.remove("proxy-open");
  renderTabs();
  updateBookmarkButton();
}

function loadBookmarks() {
  try {
    const saved = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch (_) {
    return [];
  }
}

function saveBookmarks(bookmarks) {
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
}

function currentPageUrl() {
  const tab = getActiveTab();
  return readCurrentTarget(tab) || tab?.url || address.value || HOME_URL;
}

function updateBookmarkButton() {
  const url = currentPageUrl();
  const isBookmarked = loadBookmarks().some(item => item.url === url);
  bookmarkBtn?.classList.toggle("is-bookmarked", isBookmarked);
  if (bookmarkBtn) {
    bookmarkBtn.textContent = isBookmarked ? "★" : "☆";
    bookmarkBtn.title = isBookmarked ? "Remove bookmark" : "Bookmark this page";
  }
}

function toggleBookmark() {
  const url = currentPageUrl();
  if (!url) return;
  const bookmarks = loadBookmarks();
  const existingIndex = bookmarks.findIndex(item => item.url === url);
  if (existingIndex >= 0) {
    bookmarks.splice(existingIndex, 1);
  } else {
    const tab = getActiveTab();
    bookmarks.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: tab?.title || makeTabTitle(url),
      url
    });
  }
  saveBookmarks(bookmarks);
  renderBookmarks();
  updateBookmarkButton();
}

function renderBookmarks() {
  const bookmarks = loadBookmarks();
  bookmarksList.innerHTML = "";
  emptyBookmarks.classList.toggle("show", !bookmarks.length);
  for (const bookmark of bookmarks) {
    const row = document.createElement("div");
    row.className = "bookmark-row";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "bookmark-open";
    open.innerHTML = `<span class="bookmark-name"></span><span class="bookmark-url"></span>`;
    open.querySelector(".bookmark-name").textContent = bookmark.name;
    open.querySelector(".bookmark-url").textContent = bookmark.url;
    open.addEventListener("click", () => {
      closeBookmarks();
      navigate(bookmark.url);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "bookmark-delete";
    remove.title = "Delete bookmark";
    remove.setAttribute("aria-label", `Delete ${bookmark.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      saveBookmarks(loadBookmarks().filter(item => item.id !== bookmark.id));
      renderBookmarks();
      updateBookmarkButton();
    });
    row.append(open, remove);
    bookmarksList.appendChild(row);
  }
}

function openBookmarks() {
  renderBookmarks();
  bookmarksPanel.classList.add("open");
  bookmarksPanel.setAttribute("aria-hidden", "false");
}

function closeBookmarks() {
  bookmarksPanel.classList.remove("open");
  bookmarksPanel.setAttribute("aria-hidden", "true");
}

form.addEventListener("submit", event => {
  event.preventDefault();
  navigate(address.value);
});
homeBtn.addEventListener("click", () => goHome());
backBtn.addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab?.frame) return;
  showLoadingBee();
  try { tab.frame.frame.contentWindow.history.back(); } catch (_) { hideLoadingBee(); }
});
refreshBtn.addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab?.frame) return;
  showLoadingBee();
  try {
    tab.frame.frame.contentWindow.location.reload();
  } catch (_) {
    const current = readCurrentTarget(tab);
    if (current) tab.frame.go(current); else hideLoadingBee();
  }
});
address.addEventListener("focus", () => address.select());
newTabBtn.addEventListener("click", () => createTab(HOME_URL, true));
bookmarkBtn.addEventListener("click", toggleBookmark);
bookmarksBtn.addEventListener("click", () => {
  if (bookmarksPanel.classList.contains("open")) closeBookmarks(); else openBookmarks();
});
closeBookmarksBtn.addEventListener("click", closeBookmarks);
document.addEventListener("pointerdown", event => {
  if (!bookmarksPanel.classList.contains("open")) return;
  if (bookmarksPanel.contains(event.target) || bookmarksBtn.contains(event.target)) return;
  closeBookmarks();
});

function syncFullscreenButton() {
  if (!fullscreenBtn) return;
  const active = !!document.fullscreenElement;
  fullscreenBtn.classList.toggle("is-fullscreen", active);
  fullscreenBtn.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
  fullscreenBtn.title = active ? "Exit fullscreen" : "Fullscreen";
}

fullscreenBtn.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (err) {
    error.textContent = "Fullscreen was blocked by the browser.";
    errorCode.textContent = err?.toString?.() || String(err);
  }
});
document.addEventListener("fullscreenchange", syncFullscreenButton);

createTab(HOME_URL, true);
renderBookmarks();
syncFullscreenButton();
