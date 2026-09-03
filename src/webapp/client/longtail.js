
// --- long-tail overlay (GET/POST /api/challenges, /api/injuries, GET /api/boards) ---
var LT = { ch: null, inj: null, boards: null };

function ltOpen() {
  el("lt").classList.remove("hidden");
  el("lt-title").textContent = WA.wa_lt_title;
  el("lt-body").innerHTML = '<div class="sub">' + WA.wa_loading + "</div>";
  if (TG && TG.BackButton && TG.BackButton.show) { TG.BackButton.show(); if (TG.BackButton.onClick) TG.BackButton.onClick(ltClose); }
  Promise.all([
    ccFetch("/api/challenges").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/injuries").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/boards").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/records").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/weekcard").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/library").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/trainers").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/whatsnew").then(function (r) { return r.ok ? r.json() : null; }),
  ]).then(function (res) {
    LT.ch = res[0]; LT.inj = res[1]; LT.boards = res[2];
    LT.rec = res[3]; LT.week = res[4]; LT.lib = res[5]; LT.dir = res[6]; LT.news = res[7];
    ltRender();
  }).catch(function () { el("lt-body").innerHTML = '<div class="card">' + L.loaderr + "</div>"; });
}
function ltClose() {
  setTab("home"); // tab bar back to Home when an overlay closes
  el("lt").classList.add("hidden");
  if (TG && TG.BackButton && TG.BackButton.hide) { TG.BackButton.hide(); if (TG.BackButton.offClick) TG.BackButton.offClick(ltClose); }
}
function ltBar(pct) { return '<div class="lt-bar"><span style="width:' + Math.max(0, Math.min(100, pct)) + '%"></span></div>'; }
function ltRender() {
  var h = "";
  // Challenges
  h += "<h2>🏆 " + WA.wa_lt_challenges + "</h2>";
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
    ch.available.forEach(function (c) { h += '<button class="chipbtn" data-lt="join" data-c="' + esc(c.code) + '" style="margin:2px 4px 2px 0">' + esc(c.emoji + " " + c.title) + "</button>"; });
  }
  h += '<div class="sub" style="margin-top:6px">' + WA.wa_lt_won + ": " + ch.won + "</div></div>";
  // Injuries
  h += "<h2>🩹 " + WA.wa_lt_injuries + "</h2><div class=\"card\">";
  var inj = LT.inj || { injuries: [], areas: [], severities: [] };
  if (inj.injuries.length) {
    inj.injuries.forEach(function (i) { h += '<div class="sub">• ' + esc(i.area + " — " + i.severity + " · " + i.since) + (i.lastScore != null ? " · " + i.lastScore + "/10" : "") + "</div>"; });
  } else h += '<div class="sub">' + WA.wa_lt_inj_none + "</div>";
  h += '<label style="display:block;margin-top:8px;font-size:12px;color:var(--hint)">' + WA.wa_lt_inj_report + "</label>";
  h += '<select id="lt-inj-area">'; (inj.areas || []).forEach(function (a) { h += '<option value="' + esc(a.value) + '">' + esc(a.label) + "</option>"; }); h += "</select>";
  h += '<select id="lt-inj-sev">'; (inj.severities || []).forEach(function (s) { h += '<option value="' + esc(s.value) + '">' + esc(s.label) + "</option>"; }); h += "</select>";
  h += '<div class="cc-save-row"><button class="lbtn" data-lt="injreport">' + WA.wa_lt_inj_report_btn + '</button><span class="sub" id="lt-inj-st"></span></div></div>';
  // Leaderboards (global + friends circle)
  h += "<h2>🏅 " + WA.wa_lt_boards + "</h2>";
  var b = LT.boards;
  var boardBlock = function (src) {
    var hh = "";
    var rows = [["wa_board_consistency", src.consistency], ["wa_board_improved", src.improved], ["wa_board_relative", src.relative], ["wa_board_total", src.total]];
    rows.forEach(function (r) {
      var v = r[1];
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
  h += "<h2>🏆 " + WA.wa_records + "</h2><div class=\"card\">";
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
    h += "<h2>🎖 " + WA.wa_badges + "</h2><div class=\"card\">";
    bds.forEach(function (bd) { h += '<span class="chipbtn" style="display:inline-block;margin:2px 4px 2px 0;opacity:' + (bd.earned ? "1" : ".45") + '">' + (bd.earned ? "✅ " : "🔒 ") + esc(bd.label) + "</span>"; });
    h += "</div>";
  }
  // Week card
  if (LT.week && LT.week.card) h += "<h2>📤 " + WA.wa_weekcard + '</h2><div class="card">' + LT.week.card + "</div>";
  // Plates calculator
  h += "<h2>🏋️ " + WA.wa_plates + '</h2><div class="card"><div class="lrow"><input id="lt-pl-kg" type="number" inputmode="decimal" placeholder="' + esc(WA.wa_plates_ph) + '"><button class="chipbtn" data-lt="plates">' + WA.wa_calc + '</button></div><div id="lt-pl-out"></div></div>';
  // Program library
  h += "<h2>📚 " + WA.wa_library + "</h2><div class=\"card\">";
  var lib = (LT.lib && LT.lib.programs) || [];
  if (lib.length) {
    lib.forEach(function (pgm) {
      h += '<div class="cc-save-row" style="margin:4px 0"><span style="flex:1">📋 ' + esc(pgm.name) + " · " + pgm.takenCount + "👤</span>";
      if (LT.lib.role !== "client") h += '<button class="chipbtn" data-lt="take" data-c="' + esc(pgm.code) + '">' + WA.wa_take + "</button>";
      h += "</div>";
    });
    h += '<span class="sub" id="lt-lib-st"></span>';
  } else h += '<div class="sub">' + L.nodata + "</div>";
  h += "</div>";
  // Find a trainer (solo users)
  if (LT.dir && LT.dir.role === "solo" && LT.dir.trainers && LT.dir.trainers.length) {
    h += "<h2>🔍 " + WA.wa_findtrainer + "</h2><div class=\"card\">";
    LT.dir.trainers.forEach(function (tr) {
      h += '<div class="cc-save-row" style="margin:4px 0"><span style="flex:1"><b>' + esc(tr.name) + "</b>" + (tr.specialization ? " — " + esc(tr.specialization) : "") + (tr.rating ? " ⭐" + tr.rating : "") + (tr.price ? " · " + tr.price + " " + esc(tr.currency || "") : "") + "</span>";
      h += '<button class="chipbtn" data-lt="reqtr" data-id="' + tr.id + '">' + WA.wa_request + "</button></div>";
    });
    h += '<span class="sub" id="lt-tr-st"></span></div>';
  }
  // What's new
  if (LT.news && LT.news.html) h += "<h2>📣 " + WA.wa_whatsnew + " · " + esc(LT.news.version) + '</h2><div class="card">' + LT.news.html + "</div>";
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
    ccFetch("/api/injuries", { method: "POST", body: { area: area, severity: sev } })
      .then(function (r) { if (!r.ok) throw new Error("x"); return ccFetch("/api/injuries").then(function (rr) { return rr.json(); }); })
      .then(function (res) { LT.inj = res; ltRender(); }).catch(function () { var s = el("lt-inj-st"); if (s) s.textContent = WA.wa_err; });
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
  } else if (a === "reqtr") {
    ccFetch("/api/trainers", { method: "POST", body: { trainerId: Number(t.getAttribute("data-id")) } })
      .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
      .then(function () { var s = el("lt-tr-st"); if (s) s.textContent = WA.wa_requested; })
      .catch(function () { var s = el("lt-tr-st"); if (s) s.textContent = WA.wa_err; });
  }
});
el("lt-back") && (el("lt-back").onclick = ltClose);
