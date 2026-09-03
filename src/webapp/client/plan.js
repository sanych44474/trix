
// --- plan view + editor overlay (GET/POST /api/plan) ---
var PL = { clientId: null, version: "", days: [] };

function plOpen(clientId) {
  PL.clientId = (clientId === undefined || clientId === null) ? null : clientId;
  el("pl").classList.remove("hidden");
  el("pl-title").textContent = WA.wa_plan_title;
  el("pl-sub").textContent = "";
  el("pl-body").innerHTML = '<div class="sub">' + WA.wa_loading + "</div>";
  if (TG && TG.BackButton && TG.BackButton.show) { TG.BackButton.show(); if (TG.BackButton.onClick) TG.BackButton.onClick(plClose); }
  ccFetch("/api/plan" + (PL.clientId ? "?clientId=" + PL.clientId : ""))
    .then(function (r) {
      if (r.status === 401) throw new Error("auth");
      if (r.status === 404) throw new Error("noplan");
      if (!r.ok) throw new Error("load");
      return r.json();
    })
    .then(function (p) {
      PL.version = p.version; PL.days = p.days || [];
      el("pl-sub").textContent = p.owner ? p.owner.name : "";
      plRender();
    })
    .catch(function (e) {
      el("pl-body").innerHTML = '<div class="card">' + (e.message === "auth" ? L.autherr : e.message === "noplan" ? WA.wa_plan_empty : L.loaderr) + "</div>";
    });
}

function plClose() {
  setTab("home"); // tab bar back to Home when an overlay closes
  el("pl").classList.add("hidden");
  if (TG && TG.BackButton && TG.BackButton.hide) { TG.BackButton.hide(); if (TG.BackButton.offClick) TG.BackButton.offClick(plClose); }
}

function plRender() {
  var h = "";
  PL.days.forEach(function (d) {
    h += '<div class="pl-day-h">' + esc(d.name + " · " + d.muscleGroup) + "</div>";
    d.exercises.forEach(function (x) {
      // Superset label from the shared group letter: 🔗A1 / 🔗A2 (same field the AI plans use).
      var prev = x.index > 0 ? d.exercises[x.index - 1] : null;
      var joined = prev && x.ssGroup && prev.ssGroup === x.ssGroup;
      var ssLabel = "";
      if (x.ssGroup) {
        var pos = 1;
        for (var bi = 0; bi < x.index; bi++) if (d.exercises[bi].ssGroup === x.ssGroup) pos++;
        ssLabel = '<span style="color:var(--accent)">🔗' + esc(x.ssGroup) + pos + "</span> ";
      }
      h += '<div class="card pl-ex"' + (joined ? ' style="margin-top:-6px;border-top:2px dashed var(--accent)"' : "") + ">";
      h += '<div class="pl-exh"><b class="pl-exname">' + ssLabel + esc(x.name) + '</b><span class="pl-exbtns">';
      if (x.index > 0) h += '<button class="chipbtn" data-act="up" data-wd="' + d.weekday + '" data-i="' + x.index + '">⬆️</button>';
      if (x.index < d.exercises.length - 1) h += '<button class="chipbtn" data-act="down" data-wd="' + d.weekday + '" data-i="' + x.index + '">⬇️</button>';
      h += "</span></div>";
      var wmLbl = x.wmode && x.wmode !== "total" ? " · " + (x.wmode === "perside" || x.wmode === "perSide" ? WA.wa_wmode_perside : WA.wa_wmode_perhand) : "";
      h += '<div class="sub">' + esc(x.sets) + " · " + esc(x.startWeight) + esc(wmLbl) + "</div>";
      if (x.technique || x.videoUrl) {
        h += '<details class="lg-info"><summary>' + WA.wa_ex_info + "</summary>";
        if (x.technique) h += '<div class="sub lg-tech">' + esc(x.technique) + "</div>";
        if (x.videoUrl) h += '<button class="chipbtn" data-act="vid" data-u="' + esc(x.videoUrl) + '">' + WA.wa_watch_video + (x.videoTitle ? " · " + esc(x.videoTitle).slice(0, 32) : "") + "</button>";
        h += "</details>";
      }
      h += '<div class="pl-edit" id="pl-ed-' + d.weekday + "-" + x.index + '"></div>';
      h += '<div class="pl-acts">';
      h += '<button class="chipbtn" data-act="w" data-wd="' + d.weekday + '" data-i="' + x.index + '" data-n="' + esc(x.name) + '">' + WA.wa_ex_weight + "</button>";
      h += '<button class="chipbtn" data-act="s" data-wd="' + d.weekday + '" data-i="' + x.index + '" data-n="' + esc(x.name) + '">' + WA.wa_ex_sets + "</button>";
      h += '<button class="chipbtn" data-act="sw" data-wd="' + d.weekday + '" data-i="' + x.index + '" data-n="' + esc(x.name) + '">' + WA.wa_swap + "</button>";
      if (x.index < d.exercises.length - 1) h += '<button class="chipbtn' + (x.ssGroup && d.exercises[x.index + 1].ssGroup === x.ssGroup ? " on" : "") + '" data-act="link" data-wd="' + d.weekday + '" data-i="' + x.index + '" data-n="' + esc(x.name) + '">🔗</button>';
      h += '<button class="chipbtn' + (x.wmode && x.wmode !== "total" ? " on" : "") + '" data-act="wmode" data-wd="' + d.weekday + '" data-i="' + x.index + '" data-n="' + esc(x.name) + '">⚖️</button>';
      h += '<button class="chipbtn" data-act="del" data-wd="' + d.weekday + '" data-i="' + x.index + '" data-n="' + esc(x.name) + '">🗑</button>';
      h += "</div>";
      if (PL.wmOpen === d.weekday + ":" + x.index) {
        h += '<div class="pl-wmmenu">';
        [["total", WA.wa_wmode_total], ["perSide", WA.wa_wmode_perside], ["perHand", WA.wa_wmode_perhand]].forEach(function (o) {
          h += '<button class="chipbtn' + ((x.wmode || "total") === o[0] ? " on" : "") + '" data-act="wmset" data-wd="' + d.weekday + '" data-i="' + x.index + '" data-n="' + esc(x.name) + '" data-m="' + o[0] + '">' + o[1] + "</button>";
        });
        h += "</div>";
      }
      h += "</div>";
    });
    h += '<button class="chipbtn" data-act="add" data-wd="' + d.weekday + '" style="margin-bottom:8px">' + WA.wa_add_ex + "</button>";
  });
  el("pl-body").innerHTML = h;
}

function plEdit(payload, thenReload) {
  payload.version = PL.version;
  if (PL.clientId) payload.clientId = PL.clientId;
  return ccFetch("/api/plan", { method: "POST", body: payload })
    .then(function (r) {
      if (r.status === 409) { plOpen(PL.clientId); throw new Error("stale"); }
      if (!r.ok) throw new Error("save");
      return r.json();
    })
    .then(function (res) {
      if (res.days) { PL.days = res.days; PL.version = res.version || PL.version; plRender(); }
    })
    .catch(function (e) { if (e.message !== "stale") { /* transient */ } });
}

function plInlineForm(wd, i, kind) {
  var box = el("pl-ed-" + wd + "-" + i);
  if (!box) return;
  var ph = kind === "w" ? WA.wa_weight_ph : WA.wa_sets_ph;
  box.innerHTML = '<div class="lrow"><input id="pl-inp-' + wd + "-" + i + '" placeholder="' + esc(ph)
    + '"><button class="chipbtn" data-act="save' + kind + '" data-wd="' + wd + '" data-i="' + i + '">' + WA.wa_save + "</button></div>";
  var inp = el("pl-inp-" + wd + "-" + i); if (inp) inp.focus();
}

function plSwapForm(wd, i) {
  var box = el("pl-ed-" + wd + "-" + i);
  if (!box) return;
  box.innerHTML = '<div class="lrow"><input id="pl-sq-' + wd + "-" + i + '" placeholder="' + esc(WA.wa_swap_ph)
    + '"><button class="chipbtn" data-act="sqrun" data-wd="' + wd + '" data-i="' + i + '">' + WA.wa_search + "</button></div>"
    + '<div id="pl-sr-' + wd + "-" + i + '"></div>';
  var inp = el("pl-sq-" + wd + "-" + i); if (inp) inp.focus();
}

function plSearch(wd, i, forAdd) {
  var inp = el(forAdd ? "pl-aq-" + wd : "pl-sq-" + wd + "-" + i);
  var box = el(forAdd ? "pl-ar-" + wd : "pl-sr-" + wd + "-" + i);
  if (!inp || !box) return;
  var q = (inp.value || "").trim();
  if (q.length < 2) return;
  box.innerHTML = '<span class="sub">' + WA.wa_loading + "</span>";
  ccFetch("/api/workout/search?q=" + encodeURIComponent(q))
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) {
      var ms = res.matches || [], h = "";
      ms.forEach(function (a) {
        h += '<button class="chipbtn" data-act="' + (forAdd ? "addpick" : "swpick") + '" data-wd="' + wd + '" data-i="' + i + '" data-id="' + esc(a.id) + '" data-n="' + esc(a.name) + '" style="margin:2px 4px 2px 0">' + esc(a.name) + "</button>";
      });
      // Also allow using the typed text as-is (custom exercise, no catalog id).
      h += '<button class="chipbtn" data-act="' + (forAdd ? "addpick" : "swpick") + '" data-wd="' + wd + '" data-i="' + i + '" data-n="' + esc(q) + '" style="margin:2px 4px 2px 0">➕ «' + esc(q) + "»</button>";
      box.innerHTML = h;
    })
    .catch(function () { box.innerHTML = '<span class="sub">' + WA.wa_err + "</span>"; });
}

function plAddInner(wd) {
  return '<div class="lrow" style="margin:4px 0"><input id="pl-aq-' + wd + '" placeholder="' + esc(WA.wa_add_ex_ph)
    + '"><button class="chipbtn" data-act="aqrun" data-wd="' + wd + '">' + WA.wa_search + "</button></div>"
    + '<div id="pl-ar-' + wd + '"></div>';
}

(function plWire() {
  var body = el("pl-body");
  if (!body) return;
  body.addEventListener("keydown", function (ev) {
    var t = ev.target; if (ev.key !== "Enter" || !t || !t.id) return;
    if (t.id.indexOf("pl-sq-") === 0) { ev.preventDefault(); var p = t.id.slice(6).split("-"); plSearch(Number(p[0]), Number(p[1]), false); }
    else if (t.id.indexOf("pl-aq-") === 0) { ev.preventDefault(); plSearch(Number(t.id.slice(6)), 0, true); }
  });
  body.addEventListener("click", function (ev) {
    var t = ev.target;
    while (t && t !== body && !(t.getAttribute && t.getAttribute("data-act"))) t = t.parentNode;
    if (!t || t === body) return;
    var act = t.getAttribute("data-act");
    var wd = Number(t.getAttribute("data-wd")), i = Number(t.getAttribute("data-i")), n = t.getAttribute("data-n");
    if (act === "vid") { var u = t.getAttribute("data-u"); if (u) { if (TG && TG.openLink) TG.openLink(u); else window.open(u, "_blank"); } return; }
    if (act === "up") { plEdit({ weekday: wd, index: i, action: "move", dir: "up", expectName: n }); return; }
    if (act === "down") { plEdit({ weekday: wd, index: i, action: "move", dir: "down", expectName: n }); return; }
    if (act === "del") { plEdit({ weekday: wd, index: i, action: "del", expectName: n }); return; }
    if (act === "link") { plEdit({ weekday: wd, index: i, action: "link", expectName: n }); return; }
    if (act === "wmode") { PL.wmOpen = PL.wmOpen === wd + ":" + i ? null : wd + ":" + i; plRender(); return; }
    if (act === "wmset") { PL.wmOpen = null; plEdit({ weekday: wd, index: i, action: "wmode", value: t.getAttribute("data-m"), expectName: n }); return; }
    if (act === "w") { plInlineForm(wd, i, "w"); return; }
    if (act === "s") { plInlineForm(wd, i, "s"); return; }
    if (act === "sw") { plSwapForm(wd, i); return; }
    if (act === "savew") { var v = el("pl-inp-" + wd + "-" + i); if (v) plEdit({ weekday: wd, index: i, action: "weight", value: v.value }); return; }
    if (act === "saves") { var v2 = el("pl-inp-" + wd + "-" + i); if (v2) plEdit({ weekday: wd, index: i, action: "sets", value: v2.value }); return; }
    if (act === "sqrun") { plSearch(wd, i, false); return; }
    if (act === "swpick") { plEdit({ weekday: wd, index: i, action: "swap", name: n, catalogId: t.getAttribute("data-id") || undefined, expectName: null }); return; }
    if (act === "add") { plAddFormInto(t, wd); return; }
    if (act === "aqrun") { plSearch(wd, 0, true); return; }
    if (act === "addpick") { plEdit({ weekday: wd, index: 0, action: "add", name: n, catalogId: t.getAttribute("data-id") || undefined }); return; }
  });
  el("pl-back").onclick = plClose;
})();

// Render the add-exercise form right under the tapped day's "add" button.
function plAddFormInto(btn, wd) {
  var box = el("pl-addbox-" + wd);
  if (!box) {
    box = document.createElement("div");
    box.id = "pl-addbox-" + wd;
    btn.parentNode.insertBefore(box, btn.nextSibling);
  }
  box.innerHTML = plAddInner(wd);
  var ia = el("pl-aq-" + wd); if (ia) ia.focus();
}
