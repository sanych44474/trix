
// --- guided workout logger overlay (GET /api/workout/today, POST /api/workout/save) ---
var LG = { p: null, ex: [], timer: null, timerEnd: 0 };

function initLogger(p) {
  var btn = el("lg-open");
  if (!btn) return;
  if (!(p.logForm && p.logForm.exercises && p.logForm.exercises.length)) return;
  btn.textContent = WA.wa_log_open;
  btn.style.display = "block";
  btn.onclick = lgOpen;
}

function lgOpen(dateOverride) {
  var editDate = typeof dateOverride === "string" ? dateOverride : null;
  el("lg").classList.remove("hidden");
  el("lg-title").textContent = editDate ? WA.wa_edit_day + " " + editDate : WA.wa_log_title;
  el("lg-body").innerHTML = '<div class="sub">' + WA.wa_loading + "</div>";
  el("lg-sub").textContent = "";
  el("lg-prog").textContent = "";
  el("lg-st").textContent = "";
  LG.saving = false;
  LG.editMode = false;
  LG.wmOpen = null;
  lgRestBar();
  lgTabsOn();
  if (TG && TG.BackButton && TG.BackButton.show) {
    TG.BackButton.show();
    if (TG.BackButton.onClick) TG.BackButton.onClick(lgClose);
  }
  ccFetch("/api/workout/today" + (editDate ? "?date=" + editDate : ""))
    .then(function (r) {
      if (r.status === 401) throw new Error("auth");
      if (!r.ok) throw new Error("load");
      return r.json();
    })
    .then(lgInit)
    .catch(function (e2) {
      el("lg-body").innerHTML = '<div class="sub">' + (e2.message === "auth" ? L.autherr : L.loaderr) + "</div>";
      lgTabsOff();
    });
}

function lgClose() {
  setTab("home"); // tab bar back to Home when an overlay closes
  lgTabsOff();
  el("lg").classList.add("hidden");
  if (LG.timer) { clearInterval(LG.timer); LG.timer = null; }
  if (TG && TG.BackButton && TG.BackButton.hide) {
    TG.BackButton.hide();
    if (TG.BackButton.offClick) TG.BackButton.offClick(lgClose);
  }
}

function lgInit(p) {
  LG.p = p;
  el("lg-sub").textContent = (p.muscleGroup ? p.muscleGroup + " · " : "") + p.date + (p.alreadyLogged ? " · " + WA.wa_log_done : "");
  if (p.restDay) {
    // Rest day: no planned exercises, but still allow logging an unplanned session — copy a past
    // workout or add exercises ad-hoc, then save to today. Keep the Finish/Timer tabs active.
    LG.ex = [];
    LG.editMode = false;
    lgRestBar();
    lgRender();
    el("lg-body").insertAdjacentHTML("afterbegin", '<div class="card">' + WA.wa_log_restday + "</div>");
    return;
  }
  LG.ex = p.exercises.map(function (x) {
    var n = Math.max(1, x.metric === "distance" ? 1 : x.sets);
    var sets = [];
    for (var i = 0; i < n; i++) sets.push({ w: 0, r: 0, sec: 0, m: 0 });
    return { index: x.index, name: x.name, metric: x.metric, planSets: x.planSets, planWeight: x.planWeight,
      pn: Math.max(1, x.sets), pr: x.reps, pw: x.weightKg, sets: sets, rpe: 0,
      tech: x.technique || "", vid: x.videoUrl || "", vidT: x.videoTitle || "", last: x.last || null, ss: x.ssGroup || "", wm: x.wmode || "total" };
  });
  // Edit mode: the day already has a saved log — prefill it so the user fixes, not re-types.
  var restored = false;
  if (p.saved && p.saved.length) {
    var byName = {};
    p.saved.forEach(function (sv) { byName[sv.name] = sv; });
    var extra = [];
    p.saved.forEach(function (sv) {
      if (!LG.ex.some(function (x) { return x.name === sv.name; })) {
        extra.push({ index: null, name: sv.name, metric: "reps", planSets: "", planWeight: "",
          pn: sv.sets.length, pr: sv.sets[0] ? sv.sets[0].r : 8, pw: sv.sets[0] ? sv.sets[0].w : 0,
          sets: sv.sets.slice(), rpe: sv.rpe || 0, tech: "", vid: "", vidT: "", added: true, last: null });
      }
    });
    LG.ex.forEach(function (x) {
      var sv = byName[x.name];
      if (sv) { x.sets = sv.sets.slice(); x.rpe = sv.rpe || 0; }
    });
    LG.ex = LG.ex.concat(extra);
    LG.editMode = true;
    var tf = el("tb-lgfinish"); if (tf) tf.textContent = WA.wa_tab_save;
  } else {
    restored = lgDraftLoad();
  }
  lgRestBar();
  lgRender();
  // "Fix a past day" chips (only in the normal today view).
  if (p.recentDates && p.recentDates.length) {
    var eh = '<div class="sub" style="margin:8px 0 2px">' + WA.wa_edit_past + "</div><div>";
    p.recentDates.forEach(function (d) { eh += '<button class="chipbtn" data-editday="' + d + '" style="margin:2px 4px 2px 0">' + d.slice(5) + "</button>"; });
    el("lg-body").insertAdjacentHTML("beforeend", eh + "</div>");
  }
  if (restored) {
    el("lg-st").textContent = WA.wa_draft_restored;
    setTimeout(function () { if (el("lg-st").textContent === WA.wa_draft_restored) el("lg-st").textContent = ""; }, 2500);
  }
}

function lgFilled(x) { return x.sets.some(function (s) { return s.r || s.sec || s.m; }); }
// Header progress: "3/6" + mini bar; recomputed on every input/render.
function lgProg() {
  var box = el("lg-prog");
  if (!box) return;
  if (!LG.ex.length) { box.textContent = ""; return; }
  var done = LG.ex.filter(lgFilled).length;
  var W = 10, f = Math.round((done / LG.ex.length) * W);
  var bar = ""; for (var i = 0; i < W; i++) bar += i < f ? "▰" : "▱";
  box.textContent = done + "/" + LG.ex.length + "  " + bar;
}
function lgLastSummary(x) {
  if (!x.last || !x.last.length) return "";
  if (x.metric === "reps") {
    var w = x.last[0].w;
    return (w ? w + " " + WA.wa_kg + " × " : "") + x.last.map(function (s) { return s.r; }).join("/");
  }
  return "";
}
// Fill an exercise's sets from what was logged last time.
function lgApplyLast(e) {
  var x = LG.ex[e];
  if (!x || !x.last || !x.last.length) return false;
  x.sets = x.last.map(function (s) { return { w: s.w, r: s.r, sec: s.sec, m: s.m }; });
  return true;
}
function lgScrollToNext(e) {
  var nxt = el("lg-exc-" + (e + 1));
  if (nxt && nxt.scrollIntoView) setTimeout(function () { nxt.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
}
function lgIn(e, si, f, v, ph) {
  return '<input type="number" inputmode="decimal" data-e="' + e + '" data-s="' + si + '" data-f="' + f
    + '" value="' + (v > 0 ? v : "") + '" placeholder="' + esc(ph) + '">';
}

function lgRender() {
  var h = "";
  var anyLast = LG.ex.some(function (x) { return x.last && x.last.length; });
  if (anyLast) h += '<button class="chipbtn" data-act="prevall" style="width:100%;margin-bottom:8px">' + WA.wa_repeat_last + "</button>";
  // Copy any past workout into today's session (not in edit-a-saved-day mode).
  if (!LG.editMode) h += '<button class="chipbtn" data-act="copypast" style="width:100%;margin-bottom:8px">' + WA.wa_copy_past + "</button>";
  LG.ex.forEach(function (x, e) {
    var joined = e > 0 && x.ss && LG.ex[e - 1].ss === x.ss;
    var ssLabel = "";
    if (x.ss) {
      var ssPos = 1;
      for (var sbi = 0; sbi < e; sbi++) if (LG.ex[sbi].ss === x.ss) ssPos++;
      ssLabel = '<span style="color:var(--accent)">🔗' + esc(x.ss) + ssPos + "</span> ";
    }
    h += '<div class="card lg-ex" id="lg-exc-' + e + '"' + (joined ? ' style="margin-top:-6px;border-top:2px dashed var(--accent)"' : "") + ">";
    h += '<div class="lg-exh"><b class="lg-exname">' + (lgFilled(x) ? "✅ " : "") + ssLabel + esc(x.name) + '</b><span class="lg-exbtns">';
    if (e > 0) h += '<button class="chipbtn" data-act="mvup" data-e="' + e + '">⬆️</button>';
    if (e < LG.ex.length - 1) h += '<button class="chipbtn" data-act="mvdn" data-e="' + e + '">⬇️</button>';
    h += '<button class="chipbtn" data-act="swap" data-e="' + e + '">' + WA.wa_swap + "</button>";
    if (e < LG.ex.length - 1) h += '<button class="chipbtn' + (x.ss && LG.ex[e + 1].ss === x.ss ? " on" : "") + '" data-act="lgss" data-e="' + e + '">🔗</button>';
    h += '<button class="chipbtn' + (x.wm && x.wm !== "total" ? " on" : "") + '" data-act="lgwm" data-e="' + e + '">⚖️</button>';
    h += '<button class="chipbtn" data-act="rmex" data-e="' + e + '">🗑</button></span></div>';
    // Inline weight-mode picker (explicit choice, no confusing cycle).
    if (LG.wmOpen === e) {
      h += '<div class="lg-wmmenu">';
      [["total", WA.wa_wmode_total], ["perSide", WA.wa_wmode_perside], ["perHand", WA.wa_wmode_perhand]].forEach(function (o) {
        h += '<button class="chipbtn' + ((x.wm || "total") === o[0] ? " on" : "") + '" data-act="wmset" data-e="' + e + '" data-m="' + o[0] + '">' + o[1] + "</button>";
      });
      h += "</div>";
    }
    if (x.planSets || x.planWeight) h += '<div class="sub">' + esc(x.planSets) + (x.planWeight ? " · " + esc(x.planWeight) : "") + "</div>";
    // Always offer the info dropdown; if technique/video are missing (custom/swapped exercise)
    // they're fetched lazily on first open (lg-info-<e> holds the loaded content).
    h += '<details class="lg-info" data-e="' + e + '"><summary>' + WA.wa_ex_info + "</summary>";
    h += '<div id="lg-info-' + e + '">';
    if (x.tech) h += '<div class="sub lg-tech">' + esc(x.tech) + "</div>";
    if (x.vid) {
      h += '<button class="chipbtn" data-act="video" data-e="' + e + '" data-u="' + esc(x.vid) + '">' + WA.wa_watch_video
        + (x.vidT ? " · " + esc(x.vidT).slice(0, 40) : "") + "</button>";
    }
    if (!x.tech && !x.vid) h += '<div class="sub">' + WA.wa_loading + "</div>";
    h += "</div></details>";
    h += '<div id="lg-sw-' + e + '"></div>';
    x.sets.forEach(function (s, si) {
      h += '<div class="setrow"><span class="u">' + (si + 1) + "</span>";
      if (x.metric === "time") {
        h += lgIn(e, si, "sec", s.sec, "") + '<span class="u">' + WA.wa_seconds + "</span>";
      } else if (x.metric === "distance") {
        h += lgIn(e, si, "m", s.m, "") + '<span class="u">' + WA.wa_meters + "</span>";
        h += lgIn(e, si, "sec", s.sec, "") + '<span class="u">' + WA.wa_seconds + "</span>";
      } else {
        var wmU = x.wm === "perSide" ? "/" + WA.wa_wmode_perside : x.wm === "perHand" ? "/" + WA.wa_wmode_perhand : "";
        h += lgIn(e, si, "w", s.w, String(x.pw || 0)) + '<span class="u">' + WA.wa_kg + wmU + " ×</span>";
        h += lgIn(e, si, "r", s.r, String(x.pr)) + '<span class="u">' + WA.wa_reps + "</span>";
      }
      h += '<button class="del" data-act="del" data-e="' + e + '" data-s="' + si + '">–</button></div>';
    });
    h += '<div class="lg-rpe"><button class="chipbtn" data-act="add" data-e="' + e + '">' + WA.wa_add_set + "</button>";
    if (lgLastSummary(x)) {
      h += '<button class="chipbtn" data-act="prev" data-e="' + e + '">↺ ' + WA.wa_last_time + ": " + esc(lgLastSummary(x)) + "</button>";
    }
    if (x.metric === "reps" && !x.added) {
      h += '<button class="chipbtn" data-act="fill" data-e="' + e + '">✓ ' + x.pn + "×" + x.pr + (x.pw ? " · " + x.pw + " " + WA.wa_kg : "") + "</button>";
    }
    h += "</div>";
    h += '<div class="sub" style="margin-top:8px">' + WA.wa_rpe_q + "</div>";
    h += '<div class="lg-rpe">';
    [[5.5, WA.wa_rpe_easy], [7, WA.wa_rpe_mod], [8.5, WA.wa_rpe_hard], [10, WA.wa_rpe_max]].forEach(function (rv) {
      h += '<button class="chipbtn' + (x.rpe === rv[0] ? " on" : "") + '" data-act="rpe" data-e="' + e + '" data-v="' + rv[0] + '">' + rv[1] + "</button>";
    });
    h += "</div></div>";
  });
  // Ad-hoc "add an exercise to today's session" (not in the plan) — search the catalog or create one.
  h += '<div class="card"><button class="chipbtn" data-act="addex" style="width:100%">' + WA.wa_add_ex + '</button><div id="lg-addbox" style="margin-top:6px"></div></div>';
  el("lg-body").innerHTML = h;
  lgProg();
}

// Copy a past workout into today: show a date picker of recent completed sessions.
function lgCopyPastList() {
  var existing = el("lg-copypick");
  if (existing) { existing.remove(); return; } // toggle off
  el("lg-st").textContent = WA.wa_loading;
  ccFetch("/api/workout/history")
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (d) {
      el("lg-st").textContent = "";
      if (!d.logs || !d.logs.length) { el("lg-st").textContent = WA.wa_copy_none; return; }
      var h = '<div class="card"><b>' + WA.wa_copy_past + "</b>";
      d.logs.forEach(function (l) {
        h += '<button class="chipbtn" data-copyday="' + l.date + '" style="display:block;width:100%;text-align:left;margin:4px 0">'
          + l.date.slice(5) + " · " + esc(l.title) + " (" + l.n + ")</button>";
      });
      h += '<button class="chipbtn" data-act="copycancel" style="margin-top:4px">' + WA.wa_close + "</button></div>";
      var body = el("lg-body");
      var pick = document.createElement("div");
      pick.id = "lg-copypick";
      pick.innerHTML = h;
      body.insertBefore(pick, body.firstChild);
      if (pick.scrollIntoView) pick.scrollIntoView({ behavior: "smooth", block: "start" });
    })
    .catch(function () { el("lg-st").textContent = WA.wa_err; });
}

// Load a past workout's exercises+sets as today's editable entries (added ad-hoc, saved to today).
function lgCopyApply(date) {
  el("lg-st").textContent = WA.wa_loading;
  ccFetch("/api/workout/past?date=" + encodeURIComponent(date))
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (d) {
      el("lg-st").textContent = "";
      if (!d.exercises || !d.exercises.length) { el("lg-st").textContent = WA.wa_copy_none; return; }
      LG.ex = d.exercises.map(function (x) {
        var sets = (x.sets || []).map(function (s) { return { w: s.w || 0, r: s.r || 0, sec: s.sec || 0, m: s.m || 0 }; });
        if (!sets.length) sets.push({ w: 0, r: 0, sec: 0, m: 0 });
        return { index: null, name: x.name, metric: x.metric || "reps", planSets: "", planWeight: "",
          pn: sets.length, pr: sets[0].r || 8, pw: sets[0].w || 0, sets: sets, rpe: x.rpe || 0,
          tech: "", vid: "", vidT: "", added: true, last: null, ss: "", wm: "total" };
      });
      lgRender(); // wipes the picker card and rebuilds the logger with the copied entries
      lgDraftSave();
      el("lg-st").textContent = WA.wa_copy_done;
      setTimeout(function () { if (el("lg-st").textContent === WA.wa_copy_done) el("lg-st").textContent = ""; }, 2500);
    })
    .catch(function () { el("lg-st").textContent = WA.wa_err; });
}

function lgAddForm() {
  var box = el("lg-addbox");
  if (!box) return;
  box.innerHTML = '<div class="lrow"><input id="lg-addq" placeholder="' + esc(WA.wa_add_ex_ph)
    + '"><button class="chipbtn" data-act="addsearch">' + WA.wa_search + "</button></div>" + '<div id="lg-addr"></div>';
  var inp = el("lg-addq"); if (inp) inp.focus();
}

function lgAddSearch() {
  var inp = el("lg-addq"), box = el("lg-addr");
  if (!inp || !box) return;
  var q = (inp.value || "").trim();
  if (q.length < 2) return;
  box.innerHTML = '<span class="sub">' + WA.wa_loading + "</span>";
  ccFetch("/api/workout/search?q=" + encodeURIComponent(q))
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) {
      var ms = res.matches || [], h = "";
      ms.forEach(function (a) {
        h += '<button class="chipbtn" data-act="addpick" data-n="' + esc(a.name) + '" style="margin:2px 4px 2px 0">' + esc(a.name) + "</button>";
      });
      h += '<div style="margin-top:4px"><button class="chipbtn" data-act="addcreate" data-q="' + esc(q) + '">' + WA.wa_swap_create + " «" + esc(q) + "»</button></div>";
      box.innerHTML = h;
    })
    .catch(function () { box.innerHTML = '<span class="sub">' + WA.wa_err + "</span>"; });
}

function lgAddExercise(name, video) {
  if (!name) return;
  LG.ex.push({ index: null, name: name, metric: "reps", planSets: "", planWeight: "",
    pn: 3, pr: 8, pw: 0, sets: [{ w: 0, r: 0, sec: 0, m: 0 }], rpe: 0,
    tech: "", vid: (video && video.url) || "", vidT: (video && video.title) || "", added: true });
  lgRender(); lgDraftSave();
}

function lgAddCreate(q) {
  if (!q) return;
  var box = el("lg-addr");
  if (box) box.innerHTML = '<span class="sub">' + WA.wa_loading + "</span>";
  ccFetch("/api/workout/custom", { method: "POST", body: { name: q } })
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) { lgAddExercise(res.name || q, { url: res.videoUrl, title: res.videoTitle }); })
    .catch(function () { if (box) box.innerHTML = '<span class="sub">' + WA.wa_err + "</span>"; });
}

// Rest timer lives in ONE footer button: tap -> a picker pops up (0:30 / 0:45 / 1:00 / 1:30 /
// 2:00 / 3:00, last choice remembered); while running, the button itself shows the countdown.
var REST_OPTS = [30, 45, 60, 90, 120, 180];

function lgFmt(s) { var m = Math.floor(s / 60), r = s % 60; return m + ":" + (r < 10 ? "0" : "") + r; }

function lgRestPref() {
  var v = 60;
  try { v = Number(localStorage.getItem("trix_rest")) || 60; } catch (e) {}
  return v;
}

// During a workout the tab bar itself becomes the control panel: Food -> ✅ Finish,
// More -> ⏱ Timer (with a live countdown in the label). Restored on close/celebrate.
function lgTabsOn() {
  var f = el("tab-food"), m2 = document.querySelector('#tabbar [data-tab="more"]');
  if (f) f.style.display = "none";
  if (m2) m2.style.display = "none";
  el("tab-lgfinish").style.display = "";
  el("tab-lgtimer").style.display = "";
  el("tb-lgfinish").textContent = LG.editMode ? WA.wa_tab_save : WA.wa_tab_finish;
  el("tb-lgtimer").textContent = lgFmt(lgRestPref());
}
function lgTabsOff() {
  var f = el("tab-food"), m2 = document.querySelector('#tabbar [data-tab="more"]');
  if (f) f.style.display = "";
  if (m2) m2.style.display = "";
  var tf = el("tab-lgfinish"), tt = el("tab-lgtimer");
  if (tf) tf.style.display = "none";
  if (tt) tt.style.display = "none";
  var pop = el("lg-rest-pop");
  if (pop) pop.classList.add("hidden");
}
// Finishing asks for a confirmation right in the app (native Telegram dialog when available).
function lgFinishConfirm() {
  if (LG.saving) return;
  var entries = lgCollect();
  if (!entries.length) { el("lg-st").textContent = WA.wa_err; return; }
  var q = LG.editMode ? WA.wa_save_q : WA.wa_finish_q;
  if (TG && TG.showConfirm) TG.showConfirm(q, function (ok) { if (ok) lgFinish(); });
  else lgFinish();
}
function lgRestBar() {
  var pop = el("lg-rest-pop");
  if (pop) { pop.classList.add("hidden"); pop.innerHTML = ""; }
  var tt = el("tb-lgtimer");
  if (tt) tt.textContent = lgFmt(lgRestPref());
}

function lgRestPopToggle() {
  var pop = el("lg-rest-pop");
  if (!pop) return;
  if (!pop.classList.contains("hidden")) { pop.classList.add("hidden"); return; }
  var h = "";
  REST_OPTS.forEach(function (s) { h += '<button class="chipbtn' + (s === lgRestPref() ? " on" : "") + '" data-rest="' + s + '">' + lgFmt(s) + "</button>"; });
  if (LG.timer) h += '<button class="chipbtn" data-rest="0">✖ ' + WA.wa_rest_stop + "</button>";
  pop.innerHTML = h;
  pop.classList.remove("hidden");
}

function lgRestStop() {
  if (LG.timer) { clearInterval(LG.timer); LG.timer = null; }
  var tt = el("tb-lgtimer");
  if (tt) tt.textContent = lgFmt(lgRestPref());
}

function lgRest(sec) {
  // Reliable push is scheduled server-side (survives screen lock); the countdown is cosmetic.
  ccFetch("/api/workout/rest", { method: "POST", body: { seconds: sec } }).catch(function () {});
  LG.timerEnd = Date.now() + sec * 1000;
  if (LG.timer) clearInterval(LG.timer);
  var tick = function () {
    var tt = el("tb-lgtimer");
    if (!tt) { clearInterval(LG.timer); LG.timer = null; return; }
    var left = Math.round((LG.timerEnd - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(LG.timer); LG.timer = null;
      tt.textContent = WA.wa_rest_over;
      if (TG && TG.HapticFeedback && TG.HapticFeedback.notificationOccurred) TG.HapticFeedback.notificationOccurred("success");
      setTimeout(function () { if (!LG.timer) lgRestBar(); }, 4000);
    } else tt.textContent = lgFmt(left);
  };
  LG.timer = setInterval(tick, 500);
  tick();
}

function lgSwapForm(e) {
  return '<div class="lrow" style="margin-top:6px"><input id="lg-swq-' + e + '" placeholder="' + esc(WA.wa_swap_ph)
    + '"><button class="chipbtn" data-act="swsearch" data-e="' + e + '">' + WA.wa_search + "</button></div>"
    + '<div id="lg-swr-' + e + '"></div>';
}

function lgSwap(e) {
  var x = LG.ex[e];
  var box = el("lg-sw-" + e);
  if (!x || !box) return;
  box.innerHTML = '<span class="sub">' + WA.wa_loading + "</span>";
  ccFetch("/api/workout/swap?index=" + x.index)
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) {
      var alts = res.alternatives || [];
      var h = "";
      if (alts.length) {
        h += '<div class="sub">' + WA.wa_swap_pick + "</div>";
        alts.forEach(function (a) {
          h += '<button class="chipbtn" data-act="swpick" data-e="' + e + '" data-n="' + esc(a.name) + '" style="margin:2px 4px 2px 0">' + esc(a.name) + "</button>";
        });
      }
      box.innerHTML = h + lgSwapForm(e);
    })
    .catch(function () { box.innerHTML = lgSwapForm(e); });
}

function lgSwSearch(e) {
  var inp = el("lg-swq-" + e);
  var box = el("lg-swr-" + e);
  if (!inp || !box) return;
  var q = (inp.value || "").trim();
  if (q.length < 2) return;
  box.innerHTML = '<span class="sub">' + WA.wa_loading + "</span>";
  ccFetch("/api/workout/search?q=" + encodeURIComponent(q))
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) {
      var ms = res.matches || [];
      var h = "";
      if (ms.length) {
        ms.forEach(function (a) {
          h += '<button class="chipbtn" data-act="swpick" data-e="' + e + '" data-n="' + esc(a.name) + '" style="margin:2px 4px 2px 0">' + esc(a.name) + "</button>";
        });
      } else {
        h += '<div class="sub">' + WA.wa_swap_none + "</div>";
        h += '<button class="chipbtn" data-act="swcreate" data-e="' + e + '" data-q="' + esc(q) + '" style="margin-top:4px">'
          + WA.wa_swap_create + " «" + esc(q) + "»</button>";
      }
      box.innerHTML = h;
    })
    .catch(function () { box.innerHTML = '<span class="sub">' + WA.wa_err + "</span>"; });
}

function lgSwCreate(e, q) {
  var x = LG.ex[e];
  var box = el("lg-swr-" + e);
  if (!x || !box || !q) return;
  box.innerHTML = '<span class="sub">' + WA.wa_loading + "</span>";
  ccFetch("/api/workout/custom", { method: "POST", body: { name: q } })
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) {
      x.name = res.name || q;
      x.tech = "";
      x.vid = res.videoUrl || "";
      x.vidT = res.videoTitle || "";
      lgRender(); lgDraftSave();
    })
    .catch(function () { box.innerHTML = '<span class="sub">' + WA.wa_err + "</span>"; });
}

function lgKey() { return "trix_log_" + (LG.p ? LG.p.date : ""); }
function lgNamesKey() { return LG.p.exercises.map(function (x) { return x.name; }).join("|"); }
function lgDraftLoad() {
  try {
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var k = localStorage.key(i);
      if (k && k.indexOf("trix_log_") === 0 && k !== lgKey()) localStorage.removeItem(k);
    }
    var raw = localStorage.getItem(lgKey());
    if (!raw) return false;
    var d = JSON.parse(raw);
    // Key ties the draft to the plan (not the session), so restoring keeps in-session swaps,
    // reordering and added exercises. Wholesale replace: each LG.ex entry is self-contained.
    if (!d || d.k !== lgNamesKey() || !d.ex || !d.ex.length) return false;
    var touched = false;
    LG.ex = d.ex.map(function (dx) {
      if (dx.sets && dx.sets.some(function (s) { return (s.r || s.sec || s.m); })) touched = true;
      return {
        index: dx.index, name: dx.name || "?", metric: dx.metric || "reps",
        planSets: dx.planSets || "", planWeight: dx.planWeight || "",
        pn: dx.pn || 3, pr: dx.pr || 8, pw: dx.pw || 0,
        sets: (dx.sets && dx.sets.length) ? dx.sets : [{ w: 0, r: 0, sec: 0, m: 0 }],
        rpe: dx.rpe || 0, tech: dx.tech || "", vid: dx.vid || "", vidT: dx.vidT || "", added: !!dx.added, last: dx.last || null, ss: dx.ss || "", wm: dx.wm || "total",
      };
    });
    return touched;
  } catch (e) { return false; }
}
var lgDraftT = null;
function lgDraftSave() {
  clearTimeout(lgDraftT);
  lgDraftT = setTimeout(function () {
    try { localStorage.setItem(lgKey(), JSON.stringify({ k: lgNamesKey(), ex: LG.ex })); } catch (e) {}
  }, 300);
}
function lgDraftClear() { try { localStorage.removeItem(lgKey()); } catch (e) {} }

function lgCollect() {
  var entries = [];
  LG.ex.forEach(function (x) {
    var sets = [];
    x.sets.forEach(function (s) {
      var reps = Number(s.r) || 0, w = Number(s.w) || 0, sec = Number(s.sec) || 0, m = Number(s.m) || 0;
      if (reps <= 0 && sec <= 0 && m <= 0) return;
      var o = { reps: reps, weight: w };
      if (sec > 0) o.seconds = sec;
      if (m > 0) o.meters = m;
      sets.push(o);
    });
    if (!sets.length) return;
    var entry = { name: x.name, sets: sets };
    if (x.rpe) entry.rpe = x.rpe;
    entries.push(entry);
  });
  return entries;
}

function lgFinish() {
  var entries = lgCollect();
  if (!entries.length) { el("lg-st").textContent = WA.wa_err; return; }
  if (LG.saving) return;
  LG.saving = true;
  el("lg-st").textContent = WA.wa_saving;
  ccFetch("/api/workout/save", { method: "POST", body: { entries: entries, date: LG.p ? LG.p.date : undefined } })
    .then(function (r) {
      if (r.status === 401) throw new Error("auth");
      if (!r.ok) throw new Error("save");
      return r.json();
    })
    .then(function (res) {
      lgDraftClear();
      lgCelebrate(res);
    })
    .catch(function (e2) {
      LG.saving = false;
      el("lg-st").textContent = e2.message === "auth" ? L.autherr : WA.wa_err;
    });
}

function lgCelebrate(res) {
  if (LG.timer) { clearInterval(LG.timer); LG.timer = null; }
  lgTabsOff();
  var prs = res.prExercises || [];
  var h = "";
  // 💥 Prominent PR celebration banner when a new record was set.
  if (prs.length) {
    var pr = [WA.wa_pr_praise1, WA.wa_pr_praise2, WA.wa_pr_praise3].filter(Boolean);
    var praise = pr.length ? pr[Math.floor(Math.random() * pr.length)] : "";
    h += '<div class="pr-banner">💥 ' + (WA.wa_pr_title || "NEW RECORD!") + '<div class="pr-lifts">' + prs.map(esc).join(" · ") + "</div>"
      + (praise ? '<div class="pr-praise">' + esc(praise) + "</div>" : "") + "</div>";
  }
  h += '<div class="card"><b>' + WA.wa_saved_title + "</b>";
  h += '<div class="sub" style="margin-top:6px">' + WA.wa_total_workouts + " " + res.totalWorkouts + "</div>";
  (res.newBadges || []).forEach(function (n) { h += "<div style='margin-top:4px'>" + WA.wa_badge_new + " " + esc(n) + "</div>"; });
  if (res.leveledUp) h += "<div style='margin-top:4px'>⬆️ " + WA.wa_level + " " + res.level + "!</div>";
  h += '<div style="margin-top:10px"><button id="lg-close2" class="lbtn">' + WA.wa_close + "</button></div></div>";
  el("lg-body").innerHTML = h;
  el("lg-st").textContent = "";
  // Haptic + a trophy pop-in for a record — make it feel earned.
  if (prs.length && TG && TG.HapticFeedback) {
    if (TG.HapticFeedback.notificationOccurred) TG.HapticFeedback.notificationOccurred("success");
    if (TG.HapticFeedback.impactOccurred) setTimeout(function () { TG.HapticFeedback.impactOccurred("heavy"); }, 160);
  }
  if (prs.length && el("badge-pop")) {
    var pop = el("badge-pop"), em = pop.querySelector(".bp-emoji");
    if (em) em.textContent = "🏆";
    el("bp-label").textContent = WA.wa_pr_title || "NEW RECORD!";
    el("bp-sub").textContent = prs.join(" · ");
    pop.style.display = "flex";
    pop.onclick = function () { pop.style.display = "none"; if (em) em.textContent = "🎖"; };
    setTimeout(function () { if (pop.style.display === "flex") { pop.style.display = "none"; if (em) em.textContent = "🎖"; } }, 2600);
  }
  var b = el("lg-close2");
  if (b) b.onclick = lgClose;
}

(function lgWire() {
  var body = el("lg-body");
  if (!body) return;
  // Lazy technique/video: fetch the first time an exercise's info dropdown is opened.
  body.addEventListener("toggle", function (ev) {
    var d = ev.target;
    if (!d || d.tagName !== "DETAILS" || !d.open || !d.getAttribute) return;
    var e = Number(d.getAttribute("data-e"));
    var x = LG.ex[e];
    if (!x || x.tech || x.vid || x.infoLoaded) return;
    x.infoLoaded = true;
    ccFetch("/api/workout/exinfo?name=" + encodeURIComponent(x.name))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        if (!info) { x.infoLoaded = false; return; }
        x.tech = info.technique || ""; x.vid = info.videoUrl || ""; x.vidT = info.videoTitle || "";
        var box = el("lg-info-" + e);
        if (!box) return;
        var hh = "";
        if (x.tech) hh += '<div class="sub lg-tech">' + esc(x.tech) + "</div>";
        if (x.vid) hh += '<button class="chipbtn" data-act="video" data-e="' + e + '" data-u="' + esc(x.vid) + '">' + WA.wa_watch_video + (x.vidT ? " · " + esc(x.vidT).slice(0, 40) : "") + "</button>";
        box.innerHTML = hh || '<div class="sub">' + WA.wa_ex_info_none + "</div>";
      })
      .catch(function () { x.infoLoaded = false; });
  }, true); // capture: <details> toggle doesn't bubble
  body.addEventListener("input", function (ev) {
    var t2 = ev.target;
    if (!t2 || !t2.getAttribute) return;
    var e = t2.getAttribute("data-e"), s = t2.getAttribute("data-s"), f = t2.getAttribute("data-f");
    if (e == null || s == null || !f) return;
    var x = LG.ex[Number(e)];
    if (!x || !x.sets[Number(s)]) return;
    x.sets[Number(s)][f] = parseFloat(t2.value) || 0;
    lgDraftSave();
    lgProg();
  });
  body.addEventListener("keydown", function (ev) {
    var t2 = ev.target;
    if (ev.key !== "Enter" || !t2 || !t2.id) return;
    if (t2.id.indexOf("lg-swq-") === 0) { ev.preventDefault(); lgSwSearch(Number(t2.id.slice("lg-swq-".length))); }
    else if (t2.id === "lg-addq") { ev.preventDefault(); lgAddSearch(); }
  });
  body.addEventListener("click", function (ev) {
    var ed = ev.target && ev.target.getAttribute ? ev.target.getAttribute("data-editday") : null;
    if (ed) { lgOpen(ed); return; }
    var cd = ev.target && ev.target.getAttribute ? ev.target.getAttribute("data-copyday") : null;
    if (cd) { lgCopyApply(cd); return; }
    var t2 = ev.target;
    while (t2 && t2 !== body && !(t2.getAttribute && t2.getAttribute("data-act"))) t2 = t2.parentNode;
    if (!t2 || t2 === body) return;
    var act = t2.getAttribute("data-act"), e = Number(t2.getAttribute("data-e"));
    // Add-exercise actions carry no exercise index — handle them before the per-exercise guard.
    if (act === "addex") { lgAddForm(); return; }
    if (act === "copypast") { lgCopyPastList(); return; }
    if (act === "copycancel") { var pk0 = el("lg-copypick"); if (pk0) pk0.remove(); return; }
    if (act === "addsearch") { lgAddSearch(); return; }
    if (act === "addpick") { lgAddExercise(t2.getAttribute("data-n"), null); return; }
    if (act === "addcreate") { lgAddCreate(t2.getAttribute("data-q")); return; }
    var x = LG.ex[e];
    if (!x) return;
    if (act === "mvup" || act === "mvdn") {
      var j = act === "mvup" ? e - 1 : e + 1;
      if (j >= 0 && j < LG.ex.length) { var tmp = LG.ex[e]; LG.ex[e] = LG.ex[j]; LG.ex[j] = tmp; lgRender(); lgDraftSave(); }
    } else if (act === "lgss") {
      // Session-local superset grouping (visual A1/A2 for today; the plan editor persists it).
      var nx = LG.ex[e + 1];
      if (nx) {
        if (x.ss && x.ss === nx.ss) { var g = x.ss; x.ss = ""; if (LG.ex.filter(function (z) { return z.ss === g; }).length <= 1) LG.ex.forEach(function (z) { if (z.ss === g) z.ss = ""; }); }
        else if (nx.ss) x.ss = nx.ss;
        else if (x.ss) nx.ss = x.ss;
        else { var used = {}; LG.ex.forEach(function (z) { if (z.ss) used[z.ss] = 1; }); var L2 = "ABCDEFGH".split("").filter(function (c) { return !used[c]; })[0] || "A"; x.ss = L2; nx.ss = L2; }
        lgRender(); lgDraftSave();
      }
      return;
    } else if (act === "lgwm") {
      LG.wmOpen = LG.wmOpen === e ? null : e;
      lgRender();
      return;
    } else if (act === "wmset") {
      x.wm = t2.getAttribute("data-m") || "total";
      LG.wmOpen = null;
      lgRender(); lgDraftSave();
      return;
    } else if (act === "rmex") {
      // Remove the whole exercise from today's session (skip it). Confirm only when the user
      // already typed data into its sets — otherwise one tap is enough.
      var rmTouched = x.sets.some(function (s2) { return s2.r || s2.sec || s2.m; });
      var doRm = function () { LG.ex.splice(e, 1); lgRender(); lgDraftSave(); };
      if (rmTouched && TG && TG.showConfirm) TG.showConfirm(WA.wa_rmex_q, function (ok) { if (ok) doRm(); });
      else doRm();
    } else if (act === "add") {
      var last = x.sets[x.sets.length - 1] || { w: 0, r: 0, sec: 0, m: 0 };
      x.sets.push({ w: last.w, r: last.r, sec: last.sec, m: last.m });
      lgRender(); lgDraftSave();
    } else if (act === "del") {
      x.sets.splice(Number(t2.getAttribute("data-s")), 1);
      if (!x.sets.length) x.sets.push({ w: 0, r: 0, sec: 0, m: 0 });
      lgRender(); lgDraftSave();
    } else if (act === "rpe") {
      var v = parseFloat(t2.getAttribute("data-v"));
      x.rpe = x.rpe === v ? 0 : v;
      lgRender(); lgDraftSave();
    } else if (act === "fill") {
      x.sets = [];
      for (var i = 0; i < x.pn; i++) x.sets.push({ w: x.pw, r: x.pr, sec: 0, m: 0 });
      lgRender(); lgDraftSave(); lgScrollToNext(e);
    } else if (act === "prev") {
      if (lgApplyLast(e)) { lgRender(); lgDraftSave(); lgScrollToNext(e); }
    } else if (act === "prevall") {
      var applied = false;
      LG.ex.forEach(function (_x2, e2) { if (lgApplyLast(e2)) applied = true; });
      if (applied) { lgRender(); lgDraftSave(); }
    } else if (act === "swap") {
      lgSwap(e);
    } else if (act === "swpick") {
      x.name = t2.getAttribute("data-n") || x.name;
      // Technique/video belong to the ORIGINAL exercise — hide them after a swap.
      x.tech = ""; x.vid = ""; x.vidT = "";
      lgRender(); lgDraftSave();
    } else if (act === "swsearch") {
      lgSwSearch(e);
    } else if (act === "swcreate") {
      lgSwCreate(e, t2.getAttribute("data-q"));
    } else if (act === "video") {
      var u = t2.getAttribute("data-u");
      if (u) { if (TG && TG.openLink) TG.openLink(u); else window.open(u, "_blank"); }
    }
  });
  el("lg-rest-pop").addEventListener("click", function (ev) {
    var t2 = ev.target;
    var v = t2 && t2.getAttribute ? t2.getAttribute("data-rest") : null;
    if (v == null) return;
    el("lg-rest-pop").classList.add("hidden");
    var sec = Number(v);
    if (!sec) { lgRestStop(); return; }
    try { localStorage.setItem("trix_rest", String(sec)); } catch (e) {}
    lgRest(sec);
  });
  el("lg-back").onclick = lgClose;
})();
