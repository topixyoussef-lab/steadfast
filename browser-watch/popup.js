"use strict";

const $ = (id) => document.getElementById(id);

function refresh() {
  chrome.runtime.sendMessage({ type: "getStatus" }, (st) => {
    if (chrome.runtime.lastError || !st) return;
    const status = $("status");
    status.className = "badge " + (st.linked ? "ok" : "no");
    status.textContent = st.linked ? "متصل" : "غير متصل";
    $("link").hidden = st.linked;
    $("unlink").hidden = !st.linked;
    $("counts").textContent = (st.allowed + st.blocked) + " · بلوك: " + st.blocked;
    $("last").textContent = st.lastDomain || "—";
    $("code").textContent = st.lastCode || "—";
  });
}

$("link").onclick = () => chrome.runtime.sendMessage({ type: "link" });
$("unlink").onclick = () => {
  chrome.runtime.sendMessage({ type: "unlink" }, () => refresh());
};
$("flush").onclick = () => {
  chrome.runtime.sendMessage({ type: "flush" });
  setTimeout(refresh, 900);
};

refresh();