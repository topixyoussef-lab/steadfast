"use strict";

/*
 * Steadfast Watch - browser companion (Manifest V3).
 *
 * Mirrors the Android / Windows companions: a consented member links their
 * account once, and this extension reports the domains they visit and blocks
 * the protected block list natively in the browser. Consent remains enforced
 * on the server - when protection is off the server refuses, and this
 * extension goes quiet instead of fighting it.
 *
 * Honest limits (same as the device apps):
 *   * Only what the browser does is visible. Native apps on the same machine
 *     are not covered - that still needs the OS-level guard.
 *   * Incognito browsing is only captured if the user grants "allow in
 *     incognito" in the extension detail page.
 */

const CONFIG = {
  base: "https://steadfast-lake-eta.vercel.app",
  supabase: "https://cwjutkluhzuxlinglequ.supabase.co",
  anon: "sb_publishable_a6RgW2BO0KMNimeyt3uOUw_rQeqxZbP",
  flushAlarmMin: 0.5,
  pollAlarmMin: 1,
  dedupeMs: 30000,
};

const BLOCKED = [
  "pornhub.com",
  "xvideos.com",
  "xhamster.com",
  "xnxx.com",
  "redtube.com",
  "youporn.com",
  "tube8.com",
  "brazzers.com",
];

const state = {
  queue: [],
  lastDomain: "",
  allowed: 0,
  blocked: 0,
  lastCode: "",
  consent: true,
  seen: Object.create(null),
};

/* ------------------------------------------------------------------ */
/* storage helpers                                                     */
/* ------------------------------------------------------------------ */

function storageGet(keys) {
  return new Promise((res) => chrome.storage.local.get(keys, res));
}

function storageSet(obj) {
  return new Promise((res) => chrome.storage.local.set(obj, res));
}

/* ------------------------------------------------------------------ */
/* token handling                                                      */
/* ------------------------------------------------------------------ */

async function relinkFromCookie() {
  try {
    const r = await fetch(CONFIG.base + "/api/watch/token", {
      credentials: "include",
      cache: "no-store",
    });
    if (!r.ok) return false;
    const d = await r.json();
    if (!d || !d.token) return false;
    await storageSet({
      token: d.token,
      refresh: d.refresh || "",
      exp: d.expiresAt || 0,
    });
    state.lastCode = "linked";
    return true;
  } catch {
    return false;
  }
}

async function refreshAccessToken() {
  const o = await storageGet(["refresh"]);
  if (!o.refresh) return false;
  try {
    const r = await fetch(CONFIG.supabase + "/auth/v1/token", {
      method: "POST",
      headers: {
        apikey: CONFIG.anon,
        Authorization: "Bearer " + CONFIG.anon,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: o.refresh,
      }),
    });
    if (!r.ok) return false;
    const d = await r.json();
    const exp = d.expires_at
      ? d.expires_at
      : Math.floor(Date.now() / 1000) + (d.expires_in || 3600);
    await storageSet({
      token: d.access_token,
      refresh: d.refresh_token || o.refresh,
      exp: exp,
    });
    state.lastCode = "refreshed";
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* block rules (declarativeNetRequest)                                 */
/* ------------------------------------------------------------------ */

async function updateBlockRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const addRules = BLOCKED.map((d, i) => ({
    id: i + 1,
    priority: 1,
    action: { type: "block" },
    condition: {
      urlFilter: "||" + d + "^",
      resourceTypes: ["main_frame", "sub_frame"],
    },
  }));
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: addRules,
  });
}

function isBlocked(domain) {
  const d = String(domain || "").toLowerCase().replace(/^\.+|\.+$/g, "");
  if (BLOCKED.indexOf(d) !== -1) return true;
  for (const b of BLOCKED) {
    if (d.endsWith("." + b)) return true;
  }
  return false;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

function normalizeDomain(host) {
  return host.startsWith("www.") ? host.slice(4) : host;
}

/* ------------------------------------------------------------------ */
/* observation                                                        */
/* ------------------------------------------------------------------ */

function recordVisit(host) {
  if (!host) return;
  const norm = normalizeDomain(host);
  if (norm === "steadfast-lake-eta.vercel.app" || norm === "steadfast.app") {
    return;
  }
  const now = Date.now();
  if (now - (state.seen[host] || 0) < CONFIG.dedupeMs) return;

  delete state.seen[host]; // re-add with the new timestamp
  state.seen[host] = now;

  state.lastDomain = host;
  const blocked = isBlocked(host);
  state.queue.push({ domain: host, blocked: blocked });
  if (blocked) state.blocked++;
  else state.allowed++;
  state.lastCode = "queued";
}

chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId !== 0) return;
  if (!/^https?:/.test(d.url)) return;
  recordVisit(hostOf(d.url));
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && /^https?:/.test(tab.url || "")) recordVisit(hostOf(tab.url));
  } catch {
    /* tab closed before we could read it */
  }
});

/* ------------------------------------------------------------------ */
/* reporting                                                           */
/* ------------------------------------------------------------------ */

async function flush() {
  if (!state.queue.length) return;

  const o = await storageGet(["token"]);
  if (!o.token) {
    const ok = await relinkFromCookie();
    if (!ok) {
      state.lastCode = "relink";
      return;
    }
    return flush();
  }

  const payload = { events: state.queue.slice() };
  try {
    const r = await fetch(CONFIG.base + "/api/watch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + o.token,
      },
      body: JSON.stringify(payload),
    });

    if (r.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return flush();
      await storageSet({ token: "", refresh: "" });
      state.lastCode = "refused";
      return;
    }
    if (r.status === 403) {
      state.consent = false;
      state.lastCode = "consent";
      return;
    }
    if (!r.ok) {
      state.lastCode = "retry";
      return;
    }
    state.queue = [];
    state.consent = true;
    state.lastCode = "ok";
  } catch {
    state.lastCode = "offline";
  }
}

/* ------------------------------------------------------------------ */
/* lifecycle                                                          */
/* ------------------------------------------------------------------ */

function ensureAlarms() {
  chrome.alarms.create("flush", {
    delayInMinutes: CONFIG.flushAlarmMin,
    periodInMinutes: CONFIG.flushAlarmMin,
  });
  chrome.alarms.create("poll", {
    delayInMinutes: CONFIG.pollAlarmMin,
    periodInMinutes: CONFIG.pollAlarmMin,
  });
}

async function pollLink() {
  const o = await storageGet(["token"]);
  if (!o.token) {
    await relinkFromCookie();
  } else if (!state.consent && state.queue.length) {
    flush(); // retry the queue now that consent may be back on
  }
}

chrome.runtime.onInstalled.addListener(() => {
  updateBlockRules().catch(() => {});
  ensureAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms();
  relinkFromCookie();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "flush") flush();
  else if (a.name === "poll") pollLink();
});

/* ------------------------------------------------------------------ */
/* popup messages                                                      */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === "getStatus") {
      const o = await storageGet(["token"]);
      if (!o.token) await relinkFromCookie();
      const o2 = await storageGet(["token"]);
      sendResponse({
        linked: !!o2.token,
        lastDomain: state.lastDomain || "",
        allowed: state.allowed,
        blocked: state.blocked,
        lastCode: state.lastCode || "",
        consent: state.consent,
      });
    } else if (msg.type === "link") {
      chrome.tabs.create({ url: CONFIG.base + "/watch/link?browser=1" });
      sendResponse({ ok: true });
    } else if (msg.type === "unlink") {
      await storageSet({ token: "", refresh: "" });
      state.queue = [];
      state.lastCode = "unlinked";
      state.consent = true;
      sendResponse({ ok: true });
    } else if (msg.type === "flush") {
      flush();
      sendResponse({ ok: true });
    }
  })().catch((e) => sendResponse({ error: String(e) }));
  return true;
});