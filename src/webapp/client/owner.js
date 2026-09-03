
// --- owner console overlay (GET /api/owner/report, POST /api/owner/ask-inactive) ---
var OW_SECTIONS = [
  ["overview", "wa_ow_overview"], ["ai", "wa_ow_ai"], ["trainers", "wa_ow_trainers"],
  ["onboarding", "wa_ow_onboarding"], ["errors", "wa_ow_errors"], ["events", "wa_ow_events"], ["users", "wa_ow_users"],
];
var OW = { sec: "overview" };

function owOpen() {
  el("ow").classList.remove("hidden");
  el("ow-title").textContent = WA.wa_ow_title;
  if (TG && TG.BackButton && TG.BackButton.show) { TG.BackButton.show(); if (TG.BackButton.onClick) TG.BackButton.onClick(owClose); }
  el("ow-actions").innerHTML = '<button class="lbtn" id="ow-ask" style="width:100%">' + WA.wa_ow_ask + '</button><span class="sub" id="ow-ask-st"></span>';
  el("ow-ask").onclick = function () {
    var b = el("ow-ask");
    b.disabled = true;
    el("ow-ask-st").textContent = "…";
    ccFetch("/api/owner/ask-inactive", { method: "POST", body: {} })
      .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
      .then(function (res) { el("ow-ask-st").textContent = WA.wa_ow_ask_done.replace("{n}", res.sent).replace("{total}", res.total); })
      .catch(function () { el("ow-ask-st").textContent = WA.wa_err; })
      .then(function () { b.disabled = false; });
  };
  owTabs();
  owLoad(OW.sec);
}
function owClose() {
  setTab("home");
  el("ow").classList.add("hidden");
  if (TG && TG.BackButton && TG.BackButton.hide) { TG.BackButton.hide(); if (TG.BackButton.offClick) TG.BackButton.offClick(owClose); }
}
function owTabs() {
  var h = "";
  OW_SECTIONS.forEach(function (s) {
    h += '<button class="chipbtn' + (OW.sec === s[0] ? " on" : "") + '" data-ow="' + s[0] + '">' + WA[s[1]] + "</button>";
  });
  el("ow-tabs").innerHTML = h;
}
function owLoad(sec) {
  OW.sec = sec;
  owTabs();
  el("ow-body").innerHTML = '<div class="sub">' + WA.wa_loading + "</div>";
  // Users get a real interactive table (sort + group) instead of the flat text report.
  if (sec === "users") { owUsersTable(); return; }
  ccFetch("/api/owner/report?section=" + sec)
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) { el("ow-body").innerHTML = res.html; })
    .catch(function () { el("ow-body").innerHTML = '<div class="card">' + L.loaderr + "</div>"; });
}

// --- owner users: sortable + groupable table ---
var OWU = null;
var OWU_COLS = [
  { k: "name", label: "User", txt: true },
  { k: "trainer", label: "🧑‍🏫", txt: true },
  { k: "w", label: "🏋️" }, { k: "c", label: "✅" }, { k: "n", label: "🍽" }, { k: "s", label: "👟" },
  { k: "total", label: "Σ" },
  { k: "last", label: "Last", txt: true },
];
function owStatusGlyph(s) {
  return s === "banned" ? "⛔" : s === "blocked" ? "🚫" : s === "onboarding" ? "🟡" : s === "active" ? "🟢" : s === "draft" ? "🟠" : "⚪";
}
function owUsersTable() {
  ccFetch("/api/owner/users")
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (d) { OWU = { rows: d.rows || [], feedback: d.feedback || [], sort: { col: "total", dir: -1 }, group: "none" }; owUsersRender(); })
    .catch(function () { el("ow-body").innerHTML = '<div class="card">' + L.loaderr + "</div>"; });
}
function owUsersRender() {
  var s = OWU.sort;
  var cmp = function (a, b) {
    var va = a[s.col], vb = b[s.col];
    if (typeof va === "string") { va = va.toLowerCase(); vb = String(vb).toLowerCase(); return va < vb ? -s.dir : va > vb ? s.dir : 0; }
    return (va - vb) * s.dir;
  };
  var groups = [["none", "All " + OWU.rows.length], ["trainer", "🧑‍🏫 Trainer"], ["status", "● Status"]];
  var ctl = '<div class="owu-ctl">';
  groups.forEach(function (g) { ctl += '<button class="chipbtn' + (OWU.group === g[0] ? " on" : "") + '" data-owg="' + g[0] + '">' + g[1] + "</button>"; });
  ctl += '<span class="sub owu-hint">tap a column to sort</span></div>';
  var thead = "<tr>";
  OWU_COLS.forEach(function (c) { thead += '<th data-ows="' + c.k + '"' + (c.txt ? "" : ' class="num"') + '>' + c.label + (s.col === c.k ? (s.dir < 0 ? " ▾" : " ▴") : "") + "</th>"; });
  thead += "</tr>";
  var rowHtml = function (r) {
    return "<tr><td class='owu-nm'>" + owStatusGlyph(r.status) + " " + esc(r.name) + (r.nick ? ' <span class="sub">' + esc(r.nick) + "</span>" : "") + (r.onb ? ' <span class="sub">' + r.onb + "</span>" : "") + "</td>"
      + "<td>" + (esc(r.trainer) || "·") + "</td>"
      + '<td class="num">' + (r.w || "") + '</td><td class="num">' + (r.c || "") + '</td><td class="num">' + (r.n || "") + '</td><td class="num">' + (r.s || "") + "</td>"
      + '<td class="num">' + r.total + '</td><td class="num">' + (esc(r.last) || "·") + "</td></tr>";
  };
  var body = "";
  if (OWU.group === "none") {
    OWU.rows.slice().sort(cmp).forEach(function (r) { body += rowHtml(r); });
  } else {
    var buckets = {};
    OWU.rows.forEach(function (r) { var k = OWU.group === "trainer" ? (r.trainer || "— solo") : r.status; (buckets[k] = buckets[k] || []).push(r); });
    Object.keys(buckets).sort(function (a, b) { return buckets[b].length - buckets[a].length; }).forEach(function (k) {
      var list = buckets[k].slice().sort(cmp);
      body += '<tr class="owu-grp"><td colspan="8">' + (OWU.group === "status" ? owStatusGlyph(k) + " " : "") + esc(k) + " · " + list.length + "</td></tr>";
      list.forEach(function (r) { body += rowHtml(r); });
    });
  }
  var fb = OWU.feedback.length
    ? '<h2 style="margin-top:16px">Recent feedback</h2>' + OWU.feedback.map(function (f) { return '<div class="sub" style="margin:2px 0">• <b>' + esc(f.who) + "</b> (" + esc(f.date) + "): " + esc(f.text) + "</div>"; }).join("")
    : "";
  el("ow-body").innerHTML = ctl + '<div class="owu-wrap"><table class="owu"><thead>' + thead + "</thead><tbody>" + body + "</tbody></table></div>" + fb;
  el("ow-body").onclick = function (ev) {
    var t2 = ev.target;
    while (t2 && t2 !== this && !(t2.getAttribute && (t2.getAttribute("data-ows") || t2.getAttribute("data-owg")))) t2 = t2.parentNode;
    if (!t2 || t2 === this) return;
    var sc = t2.getAttribute("data-ows"), gc = t2.getAttribute("data-owg");
    if (sc) { OWU.sort = { col: sc, dir: OWU.sort.col === sc ? -OWU.sort.dir : (sc === "name" || sc === "trainer" || sc === "last" ? 1 : -1) }; owUsersRender(); }
    else if (gc) { OWU.group = gc; owUsersRender(); }
  };
}
el("ow-tabs") && el("ow-tabs").addEventListener("click", function (ev) {
  var t2 = ev.target;
  var s = t2 && t2.getAttribute ? t2.getAttribute("data-ow") : null;
  if (s) owLoad(s);
});
el("ow-back") && (el("ow-back").onclick = owClose);
