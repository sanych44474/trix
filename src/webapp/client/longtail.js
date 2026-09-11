
// --- long-tail overlay (GET/POST /api/challenges, /api/injuries, GET /api/boards) ---
var LT = { ch: null, inj: null, boards: null, injKey: null };

function ltOpen() {
  el("lt").classList.remove("hidden");
  el("lt-title").textContent = WA.wa_lt_title;
  el("lt-body").innerHTML = uiSub(WA.wa_loading);
  if (TG && TG.BackButton && TG.BackButton.show) { TG.BackButton.show(); if (TG.BackButton.onClick) TG.BackButton.onClick(ltClose); }
  Promise.all([
    ccFetch("/api/challenges").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/injuries").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/boards").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/records").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/weekcard").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/library").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/whatsnew").then(function (r) { return r.ok ? r.json() : null; }),
  ]).then(function (res) {
    LT.ch = res[0]; LT.inj = res[1]; LT.boards = res[2];
    LT.rec = res[3]; LT.week = res[4]; LT.lib = res[5]; LT.news = res[6];
    ltRender();
  }).catch(function () { el("lt-body").innerHTML = uiCard(L.loaderr); });
}
function ltClose() {
  setTab("home"); // tab bar back to Home when an overlay closes
  el("lt").classList.add("hidden");
  if (TG && TG.BackButton && TG.BackButton.hide) { TG.BackButton.hide(); if (TG.BackButton.offClick) TG.BackButton.offClick(ltClose); }
}
function ltBar(pct) { return '<div class="lt-bar"><span style="width:' + Math.max(0, Math.min(100, pct)) + '%"></span></div>'; }
function ltRender() {
  var h = "";
  // Jump-nav: only link sections that will actually render below (a badge/week-card/news
  // section is conditional on data being present) — a dead anchor is harmless but sloppy.
  var nav = [["lt-s-ch", "🏆 " + WA.wa_lt_challenges], ["lt-s-inj", "🩹 " + WA.wa_lt_injuries], ["lt-s-brd", "🏅 " + WA.wa_lt_boards], ["lt-s-rec", "🏆 " + WA.wa_records]];
  if ((LT.rec && LT.rec.badges || []).length) nav.push(["lt-s-bdg", "🎖 " + WA.wa_badges]);
  if (LT.week && LT.week.card) nav.push(["lt-s-wk", "📤 " + WA.wa_weekcard]);
  nav.push(["lt-s-pl", "🏋️ " + WA.wa_plates], ["lt-s-lib", "📚 " + WA.wa_library]);
  if (LT.news && LT.news.html) nav.push(["lt-s-news", "📣 " + WA.wa_whatsnew]);
  h += '<div class="lt-nav">' + nav.map(function (n) { return '<a href="#' + n[0] + '" class="chipbtn">' + n[1] + "</a>"; }).join("") + "</div>";
  // Challenges
  h += "<h2 id=\"lt-s-ch\">🏆 " + WA.wa_lt_challenges + "</h2>";
  var ch = LT.ch || { active: [], available: [], won: 0 };
  h += '<div class="card">';
  if (ch.active.length) {
    ch.active.forEach(function (c) {
      h += "<div style='margin-bottom:8px'><b>" + esc(c.emoji + " " + c.title) + "</b>" + ltBar(c.pct)
        + '<div class="sub">' + c.current + "/" + c.target + " · " + WA.wa_lt_days_left.replace("{n}", c.daysLeft) + (c.done ? " ✅" : "") + "</div></div>";
    });
  } else h += '<div class="sub">—</div>';
  if (ch.available.length) {
    h += '<div class="sub" style="margin-top:6px">' + WA.wa_lt_available + "</div>";
    ch.available.forEach(function (c) { h += uiChip(esc(c.emoji + " " + c.title), ' data-lt="join" data-c="' + esc(c.code) + '"', { style: "margin:2px 4px 2px 0" }); });
  }
  h += '<div class="sub" style="margin-top:6px">' + WA.wa_lt_won + ": " + ch.won + "</div></div>";
  // Injuries
  h += "<h2 id=\"lt-s-inj\">🩹 " + WA.wa_lt_injuries + "</h2><div class=\"card\">";
  var inj = LT.inj || { injuries: [], areas: [], severities: [] };
  if (inj.injuries.length) {
    inj.injuries.forEach(function (i) { h += '<div class="sub">• ' + esc(i.area + " — " + i.severity + " · " + i.since) + (i.lastScore != null ? " · " + i.lastScore + "/10" : "") + "</div>"; });
  } else h += '<div class="sub">' + WA.wa_lt_inj_none + "</div>";
  h += '<label style="display:block;margin-top:8px;font-size:12px;color:var(--hint)">' + WA.wa_lt_inj_report + "</label>";
  h += '<select id="lt-inj-area">'; (inj.areas || []).forEach(function (a) { h += '<option value="' + esc(a.value) + '">' + esc(a.label) + "</option>"; }); h += "</select>";
  h += '<select id="lt-inj-sev">'; (inj.severities || []).forEach(function (s) { h += '<option value="' + esc(s.value) + '">' + esc(s.label) + "</option>"; }); h += "</select>";
  h += '<div class="cc-save-row"><button class="lbtn" data-lt="injreport">' + WA.wa_lt_inj_report_btn + '</button><span class="sub" id="lt-inj-st"></span></div></div>';
  // Leaderboards (global + friends circle)
  h += "<h2 id=\"lt-s-brd\">🏅 " + WA.wa_lt_boards + "</h2>";
  var b = LT.boards;
  var boardBlock = function (src) {
    var hh = "";
    var rows = [["wa_board_consistency", src.consistency], ["wa_board_improved", src.improved], ["wa_board_relative", src.relative], ["wa_board_total", src.total], ["wa_board_streak", src.streak], ["wa_board_recentprs", src.recentPrs]];
    rows.forEach(function (r) {
      var v = r[1];
      if (!v) return; // an older cached API shape may lack a newer board key
      hh += '<div style="margin-bottom:8px"><b>' + WA[r[0]] + "</b>" + (v.rank ? ' <span class="sub">#' + v.rank + " / " + v.total + "</span>" : ' <span class="sub">—</span>');
      (v.top || []).forEach(function (e2) {
        var medal = e2.pos === 1 ? "🥇" : e2.pos === 2 ? "🥈" : e2.pos === 3 ? "🥉" : e2.pos + ".";
        hh += '<div class="sub"' + (e2.me ? ' style="color:var(--accent);font-weight:600"' : "") + ">" + medal + " " + esc(e2.name) + " — " + esc(String(e2.detail || e2.value)) + "</div>";
      });
      hh += "</div>";
    });
    return hh;
  };
  if (!b || !b.optedIn) h += '<div class="card"><div class="sub">' + WA.wa_lt_board_optout + "</div></div>";
  else {
    // Friends circle first (more motivating), global below.
    if (b.friends && b.friends.count > 0) {
      h += '<div class="card"><div class="sub" style="margin-bottom:4px">👥 ' + WA.wa_board_friends.replace("{n}", b.friends.count) + "</div>" + boardBlock(b.friends) + "</div>";
    } else {
      h += '<div class="card"><div class="sub">👥 ' + WA.wa_board_friends_none + "</div></div>";
    }
    h += '<div class="card">' + boardBlock(b) + "</div>";
  }
  // Personal records
  h += "<h2 id=\"lt-s-rec\">🏆 " + WA.wa_records + "</h2><div class=\"card\">";
  var recs = (LT.rec && LT.rec.records) || [];
  if (recs.length) recs.slice(0, 20).forEach(function (r, ri) {
    var hasChart = r.points && r.points.length >= 2;
    h += '<div class="sub"' + (hasChart ? ' data-lt="e1rm" data-i="' + ri + '" style="cursor:pointer"' : "") + ">• "
      + esc(r.exercise) + " — <b>" + esc(r.best) + "</b>" + (r.updated ? " · " + r.updated : "") + (hasChart ? " 📈" : "") + "</div>";
    if (hasChart) h += '<div id="lt-e1rm-' + ri + '" style="display:none;margin:6px 0"></div>';
  });
  else h += '<div class="sub">' + L.nodata + "</div>";
  h += "</div>";
  // Badges (earned + locked catalog)
  var bds = (LT.rec && LT.rec.badges) || [];
  if (bds.length) {
    h += "<h2 id=\"lt-s-bdg\">🎖 " + WA.wa_badges + "</h2><div class=\"card\">";
    bds.forEach(function (bd) { h += '<span class="chipbtn" style="display:inline-block;margin:2px 4px 2px 0;opacity:' + (bd.earned ? "1" : ".45") + '">' + (bd.earned ? "✅ " : "🔒 ") + esc(bd.label) + "</span>"; });
    h += "</div>";
  }
  // Week card — text (as before) + an optional canvas-rendered PNG a trainer can actually show
  // a client / attach somewhere, since the Mini App can't offer a file download directly (CSP).
  if (LT.week && LT.week.card) {
    h += "<h2 id=\"lt-s-wk\">📤 " + WA.wa_weekcard + '</h2><div class="card">' + LT.week.card;
    if (LT.week.stats) h += '<div class="cc-save-row" style="margin-top:8px">' + uiChip(WA.wa_wcard_gen_btn, ' data-lt="wcgen"') + "</div>";
    h += '<div id="lt-wc-out" style="margin-top:8px"></div></div>';
  }
  // Plates calculator
  h += "<h2 id=\"lt-s-pl\">🏋️ " + WA.wa_plates + '</h2><div class="card"><div class="lrow"><input id="lt-pl-kg" type="number" inputmode="decimal" placeholder="' + esc(WA.wa_plates_ph) + '">' + uiChip(WA.wa_calc, ' data-lt="plates"') + '</div><div id="lt-pl-out"></div></div>';
  // Program library
  h += "<h2 id=\"lt-s-lib\">📚 " + WA.wa_library + "</h2><div class=\"card\">";
  var lib = (LT.lib && LT.lib.programs) || [];
  if (lib.length) {
    lib.forEach(function (pgm) {
      h += '<div class="cc-save-row" style="margin:4px 0"><span style="flex:1">📋 ' + esc(pgm.name) + " · " + pgm.takenCount + "👤</span>";
      if (LT.lib.role !== "client") h += uiChip(WA.wa_take, ' data-lt="take" data-c="' + esc(pgm.code) + '"');
      h += "</div>";
    });
    h += '<span class="sub" id="lt-lib-st"></span>';
  } else h += '<div class="sub">' + L.nodata + "</div>";
  h += "</div>";
  // What's new
  if (LT.news && LT.news.html) h += "<h2 id=\"lt-s-news\">📣 " + WA.wa_whatsnew + " · " + esc(LT.news.version) + '</h2><div class="card">' + LT.news.html + "</div>";
  el("lt-body").innerHTML = h;
}
el("lt-body") && el("lt-body").addEventListener("click", function (e) {
  var t = e.target;
  while (t && t !== this && !(t.getAttribute && t.getAttribute("data-lt"))) t = t.parentNode;
  var a = t && t.getAttribute ? t.getAttribute("data-lt") : null;
  if (!a) return;
  if (a === "e1rm") {
    // Toggle the inline e1RM trend chart under a personal-record row.
    var ei = Number(t.getAttribute("data-i"));
    var box = el("lt-e1rm-" + ei);
    if (!box) return;
    if (box.style.display === "none") {
      var rec = ((LT.rec && LT.rec.records) || [])[ei];
      if (rec && rec.points && !box.innerHTML) box.innerHTML = lineChart(rec.points, null, "kg");
      box.style.display = "block";
    } else box.style.display = "none";
  } else if (a === "join") {
    var code = t.getAttribute("data-c");
    ccFetch("/api/challenges", { method: "POST", body: { code: code } })
      .then(function (r) { if (!r.ok) throw new Error("x"); return ccFetch("/api/challenges").then(function (rr) { return rr.json(); }); })
      .then(function (res) { LT.ch = res; ltRender(); }).catch(function () {});
  } else if (a === "injreport") {
    var area = el("lt-inj-area").value, sev = el("lt-inj-sev").value;
    // Reused across retries of THIS report so a lost-response retry can't log the same injury
    // twice; cleared only on real success.
    if (!LT.injKey) LT.injKey = ccNewIdemKey();
    ccFetch("/api/injuries", { method: "POST", body: { area: area, severity: sev }, idempotencyKey: LT.injKey })
      .then(function (r) { if (!r.ok) throw new Error("x"); LT.injKey = null; return ccFetch("/api/injuries").then(function (rr) { return rr.json(); }); })
      .then(function (res) { LT.inj = res; ltRender(); }).catch(function () { var s = el("lt-inj-st"); if (s) s.textContent = WA.wa_err; });
  } else if (a === "wcgen") {
    wcGenerate();
  } else if (a === "wcsend") {
    wcSend();
  } else if (a === "plates") {
    var kg = Number(el("lt-pl-kg").value);
    if (!kg) return;
    ccFetch("/api/plates?kg=" + kg)
      .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
      .then(function (res) {
        var out = el("lt-pl-out");
        var hh = "";
        if (res.plan) {
          hh += '<div class="sub" style="margin-top:6px"><b>' + res.plan.loaded + " kg</b> · " + WA.wa_per_side + ": " + (res.plan.perSide.length ? res.plan.perSide.join(" + ") : "—") + "</div>";
        }
        if (res.ramp && res.ramp.length) {
          hh += '<div class="sub" style="margin-top:4px">' + WA.wa_warmup + ":</div>";
          res.ramp.forEach(function (w) { hh += '<div class="sub">• ' + w.weight + " kg × " + w.reps + (w.pct ? " (" + w.pct + "%)" : "") + "</div>"; });
        }
        out.innerHTML = hh;
      }).catch(function () {});
  } else if (a === "take") {
    ccFetch("/api/library", { method: "POST", body: { code: t.getAttribute("data-c") } })
      .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
      .then(function () { var s = el("lt-lib-st"); if (s) s.textContent = WA.wa_taken; })
      .catch(function () { var s = el("lt-lib-st"); if (s) s.textContent = WA.wa_err; });
  }
});
el("lt-back") && (el("lt-back").onclick = ltClose);

// --- week card PNG: canvas-drawn client-side (Workers has no server-side image rendering),
// then uploaded as a photo the Bot API pushes to the viewer's own chat (the Mini App can't
// offer a file download directly — same CSP constraint every other export in this app hits). ---
var WC_BLOB = null;
function wcDraw(stats, name) {
  var W = 900, H = 1180;
  var c = document.createElement("canvas");
  c.width = W; c.height = H;
  var g = c.getContext("2d");
  var grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#173029"); grad.addColorStop(1, "#0b1917");
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = "#eaf6f0";
  g.font = "700 52px system-ui, -apple-system, sans-serif";
  g.fillText("🏋️ " + (name || ""), 56, 130);
  g.fillStyle = "#7fb9a3";
  g.font = "400 30px system-ui, -apple-system, sans-serif";
  g.fillText((stats.since || "").slice(5) + " → " + (stats.until || "").slice(5), 56, 178);
  g.strokeStyle = "rgba(127,185,163,.35)"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(56, 210); g.lineTo(W - 56, 210); g.stroke();
  var rows = [
    [WA.wa_wcard_workouts, stats.planned ? (stats.done + "/" + stats.planned) : String(stats.done)],
    [WA.wa_wcard_sets, String(stats.totalSets)],
    [WA.wa_wcard_volume, stats.volumeKg + " " + WA.wa_kg],
  ];
  if (stats.prs > 0) rows.push([WA.wa_wcard_prs, stats.prs + " 🏆"]);
  rows.push([WA.wa_wcard_streak, stats.streak + " 🔥"]);
  rows.push([WA.wa_wcard_level, stats.level + " ⭐ (" + stats.xp + " XP)"]);
  var y = 300;
  rows.forEach(function (r) {
    g.fillStyle = "#7fb9a3";
    g.font = "400 32px system-ui, -apple-system, sans-serif";
    g.fillText(r[0], 56, y);
    g.fillStyle = "#ffffff";
    g.font = "700 46px system-ui, -apple-system, sans-serif";
    g.textAlign = "right";
    g.fillText(r[1], W - 56, y);
    g.textAlign = "left";
    y += 120;
  });
  g.fillStyle = "#4d7568";
  g.font = "400 24px system-ui, -apple-system, sans-serif";
  g.fillText("trix", 56, H - 36);
  return c;
}
function wcGenerate() {
  var stats = LT.week && LT.week.stats;
  var box = el("lt-wc-out");
  if (!stats || !box) return;
  var canvas = wcDraw(stats, LT.week.name || "");
  canvas.style.width = "100%"; canvas.style.borderRadius = "10px";
  box.innerHTML = "";
  box.appendChild(canvas);
  WC_BLOB = null;
  canvas.toBlob(function (blob) {
    WC_BLOB = blob;
    box.insertAdjacentHTML(
      "beforeend",
      '<div class="cc-save-row" style="margin-top:8px">' + uiChip(WA.wa_wcard_send_btn, ' data-lt="wcsend"') + '<span class="sub" id="lt-wc-st"></span></div>',
    );
  });
}
function wcSend() {
  if (!WC_BLOB) return;
  var st = el("lt-wc-st");
  if (st) st.textContent = WA.wa_loading;
  var fd = new FormData();
  fd.append("photo", WC_BLOB, "weekcard.png");
  ccFetch("/api/weekcard", { method: "POST", body: fd })
    .then(function (r) { return r.json(); })
    .then(function (res) { if (st) st.textContent = res.ok ? WA.wa_export_sent : WA.wa_err; })
    .catch(function () { if (st) st.textContent = WA.wa_err; });
}
