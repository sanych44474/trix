
// --- profile / settings / onboarding overlay (GET/POST /api/profile, /api/settings, /api/onboarding) ---
var PF = { data: null, st: null, days: [], share: null, ob: { sex: "" } };

function pfOpen() {
  el("pf").classList.remove("hidden");
  el("pf-title").textContent = WA.wa_profile_title;
  el("pf-body").innerHTML = '<div class="sub">' + WA.wa_loading + "</div>";
  if (TG && TG.BackButton && TG.BackButton.show) { TG.BackButton.show(); if (TG.BackButton.onClick) TG.BackButton.onClick(pfClose); }
  Promise.all([
    ccFetch("/api/profile").then(function (r) { if (r.status === 401) throw new Error("auth"); return r.json(); }),
    ccFetch("/api/settings").then(function (r) { return r.ok ? r.json() : null; }),
  ]).then(function (res) {
    PF.data = res[0]; PF.st = res[1];
    PF.days = (PF.data.profile.trainingWeekdays || []).slice();
    PF.share = PF.data.profile.share;
    pfRender();
  }).catch(function (e) { el("pf-body").innerHTML = '<div class="card">' + (e.message === "auth" ? L.autherr : L.loaderr) + "</div>"; });
}
function pfClose() {
  setTab("home"); // tab bar back to Home when an overlay closes
  el("pf").classList.add("hidden");
  if (TG && TG.BackButton && TG.BackButton.hide) { TG.BackButton.hide(); if (TG.BackButton.offClick) TG.BackButton.offClick(pfClose); }
}
function pfSelect(id, options, current) {
  var h = '<select id="' + id + '"><option value=""></option>';
  options.forEach(function (o) { h += '<option value="' + esc(o.value) + '"' + (o.value === current ? " selected" : "") + ">" + esc(o.label) + "</option>"; });
  return h + "</select>";
}
function pfChip(attr, val, label, on) {
  return '<button class="chipbtn' + (on ? " on" : "") + '" data-' + attr + '="' + esc(String(val)) + '">' + esc(label) + "</button>";
}

// Gamification cards for the profile: level/XP hero + earned badges, reusing the freshly-loaded
// dashboard payload (cached in localStorage) so no extra fetch is needed.
function pfGamification() {
  var d = null;
  try { d = JSON.parse(localStorage.getItem("trix_dash") || "null"); } catch (e) {}
  if (!d) return "";
  var out = "";
  var g = d.gamification;
  if (g) {
    var pct = g.needed > 0 ? Math.max(3, Math.min(100, Math.round((g.intoLevel / g.needed) * 100))) : 100;
    var streak = g.streak ? '<span class="streak">🔥 ' + g.streak + "</span>" : "";
    out += '<div class="xp" style="margin-bottom:10px"><div class="xp-lvl"><b>' + g.level + "</b><span>" + esc(L.levelWord) + "</span></div>"
      + '<div class="xp-body"><div class="xp-top"><span>' + g.xp + " XP</span>" + streak + "</div>"
      + '<div class="xp-bar"><span style="width:' + pct + '%"></span></div>'
      + '<div class="xp-sub">' + g.intoLevel + " / " + g.needed + " → " + esc(L.levelWord) + " " + (g.level + 1) + "</div></div></div>";
  }
  // Achievements showcase: every badge, earned (gradient) vs locked (muted + 🔒).
  var cat = d.badgeCatalog || [];
  var earned = {};
  (d.badges || []).forEach(function (x) { earned[x.code] = 1; });
  if (cat.length) {
    var got = cat.filter(function (x) { return earned[x.code]; }).length;
    out += '<div class="card" style="margin-bottom:10px"><b>🎖 ' + (WA.wa_ach_title || "Achievements") + " · " + got + "/" + cat.length + "</b>"
      + '<div class="ach">'
      + cat.map(function (x) { return '<span class="ach-b ' + (earned[x.code] ? "got" : "lock") + '">' + (earned[x.code] ? "" : "🔒 ") + esc(x.label) + "</span>"; }).join("")
      + "</div></div>";
  }
  return out;
}

function pfCurTheme() { try { return localStorage.getItem("trix_theme") || "auto"; } catch (e) { return "auto"; } }
function pfInviteBuddy() {
  var id = TG && TG.initDataUnsafe && TG.initDataUnsafe.user ? TG.initDataUnsafe.user.id : "";
  if (!id || !WA_BOT) return;
  var link = "https://t.me/" + WA_BOT + "?start=buddy_" + id;
  var url = "https://t.me/share/url?url=" + encodeURIComponent(link) + "&text=" + encodeURIComponent(WA.wa_buddy_invite_text || "Be my accountability buddy on trix 💪");
  if (TG && TG.openTelegramLink) TG.openTelegramLink(url); else window.open(url, "_blank");
}
function pfShareProgress() {
  if (!WA_BOT) return;
  var d = null; try { d = JSON.parse(localStorage.getItem("trix_dash") || "null"); } catch (e) {}
  var g = d && d.gamification;
  var lines = ["💪 " + (WA.wa_share_head || "My trix progress")];
  if (g) lines.push((L.levelWord || "Level") + " " + g.level + " · " + g.xp + " XP" + (g.streak ? " · 🔥 " + g.streak : ""));
  if (d && d.badges && d.badges.length) lines.push("🎖 " + d.badges.length);
  var text = lines.join("\n") + "\n\n" + (WA.wa_share_tail || "Train with me 👇");
  var url = "https://t.me/share/url?url=" + encodeURIComponent("https://t.me/" + WA_BOT) + "&text=" + encodeURIComponent(text);
  if (TG && TG.openTelegramLink) TG.openTelegramLink(url); else window.open(url, "_blank");
}
function pfRender() {
  var p = PF.data.profile, o = PF.data.options, st = PF.st;
  var h = pfGamification();
  // 🎨 Theme override + 📣 share progress.
  var ct = pfCurTheme();
  var tchip = function (m, l) { return '<button class="chipbtn' + (ct === m ? " on" : "") + '" data-theme="' + m + '">' + esc(l) + "</button>"; };
  h += '<div class="card" style="margin-bottom:10px"><b>🎨 ' + (WA.wa_theme || "Theme") + '</b><div class="pf-chips" style="margin-top:8px">'
    + tchip("auto", WA.wa_theme_auto || "Auto") + tchip("light", WA.wa_theme_light || "Light") + tchip("dark", WA.wa_theme_dark || "Dark") + "</div></div>";
  h += '<div class="card" style="margin-bottom:10px;display:flex;flex-direction:column;gap:6px">'
    + '<button class="lbtn" data-act2="shareprog" style="width:100%">📣 ' + (WA.wa_share_progress || "Share my progress") + "</button>"
    + '<button class="lbtn" data-act2="buddy" style="width:100%;background:var(--card);color:var(--fg)">🤝 ' + (WA.wa_buddy_invite || "Invite an accountability buddy") + "</button></div>";
  // 💧 Scheduled water reminders (0/2/3/4h), saved with the profile.
  var we = typeof PF.waterEvery === "number" ? PF.waterEvery : (p.waterEvery || 0);
  PF.waterEvery = we;
  var wchip = function (n, l) { return '<button class="chipbtn' + (we === n ? " on" : "") + '" data-water="' + n + '">' + esc(l) + "</button>"; };
  h += '<div class="card" style="margin-bottom:10px"><b>💧 ' + (WA.wa_water_sched || "Water reminders") + '</b><div class="pf-chips" style="margin-top:8px">'
    + wchip(0, WA.wa_off || "Off") + wchip(2, "2h") + wchip(3, "3h") + wchip(4, "4h") + "</div></div>";

  // --- Onboarding extras (only until the profile is complete) ---
  if (st && st.onboarded === false) {
    h += '<div class="card" style="margin-bottom:10px"><b>' + WA.wa_ob_title + "</b>";
    h += "<label>" + WA.wa_sex + '</label><div class="pf-chips" id="pf-ob-sex">' + pfChip("obsex", "male", WA.wa_ob_male, PF.ob.sex === "male") + pfChip("obsex", "female", WA.wa_ob_female, PF.ob.sex === "female") + "</div>";
    h += "<label>" + WA.wa_age + '</label><input id="pf-ob-age" type="number" inputmode="numeric">';
    h += "<label>" + WA.wa_height + ' (cm)</label><input id="pf-ob-h" type="number" inputmode="numeric">';
    h += "<label>" + WA.wa_weight + ' (kg)</label><input id="pf-ob-w" type="number" inputmode="decimal">';
    h += "<label>" + WA.wa_ob_lifestyle + "</label>" + pfSelect("pf-ob-life", [{ value: "sedentary", label: WA.ob_life_sedentary }, { value: "moderate", label: WA.ob_life_moderate }, { value: "active", label: WA.ob_life_active }], "");
    h += "<label>" + WA.wa_ob_sleep + "</label>" + pfSelect("pf-ob-sleep", [{ value: "morning", label: WA.ob_sleep_morning }, { value: "evening", label: WA.ob_sleep_evening }], "");
    h += '<div class="cc-save-row" style="margin-top:8px"><button id="pf-ob-go" class="lbtn">' + WA.wa_ob_submit + '</button><span class="sub" id="pf-ob-st"></span></div></div>';
  }

  // --- Progress photo gallery (bytes come through the authorized /api/photo proxy) ---
  var phs = PF.data.photos || [];
  if (phs.length) {
    h += '<div class="card" style="margin-bottom:10px"><b>📸 ' + WA.wa_photos + "</b>";
    h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px">';
    phs.forEach(function (ph) {
      h += '<a href="' + photoSrc(ph.id) + '" target="_blank"><img loading="lazy" src="' + photoSrc(ph.id)
        + '" style="width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px"><div class="sub" style="text-align:center">' + esc(ph.takenAt) + "</div></a>";
    });
    h += "</div></div>";
  }

  // --- Profile form ---
  h += '<div class="card">';
  h += "<label>" + WA.wa_pf_goal + "</label>" + pfSelect("pf-goal", o.goal, p.goal);
  h += "<label>" + WA.wa_pf_level + "</label>" + pfSelect("pf-level", o.level, p.level);
  h += "<label>" + WA.wa_pf_equipment + "</label>" + pfSelect("pf-equip", o.equipment, p.equipment);
  h += "<label>" + WA.wa_pf_diet + "</label>" + pfSelect("pf-diet", o.diet, p.dietPrefs);
  h += "<label>" + WA.wa_pf_days + '</label><div class="pf-days" id="pf-days">';
  PF.data.weekdays.forEach(function (w) { h += pfChip("wd", w.value, w.label, PF.days.indexOf(w.value) >= 0); });
  h += "</div>";
  h += "<label>" + WA.wa_pf_goalweight + '</label><input id="pf-gw" type="number" inputmode="decimal" value="' + (p.goalWeight != null ? p.goalWeight : "") + '">';
  h += "<label>" + WA.wa_pf_watergoal + '</label><input id="pf-wg" type="number" inputmode="numeric" placeholder="auto" value="' + (p.waterGoalMl != null ? p.waterGoalMl : "") + '">';
  h += "<label>" + WA.wa_pf_stepsgoal + '</label><input id="pf-sg" type="number" inputmode="numeric" placeholder="8000" value="' + (p.stepsGoal != null ? p.stepsGoal : "") + '">';
  h += "<label>" + WA.wa_pf_quiet + '</label><div class="lrow"><input id="pf-qf" type="number" inputmode="numeric" placeholder="' + esc(WA.wa_pf_quiet_from) + '" value="' + (p.quietFrom != null ? p.quietFrom : "") + '"><input id="pf-qt" type="number" inputmode="numeric" placeholder="' + esc(WA.wa_pf_quiet_to) + '" value="' + (p.quietTo != null ? p.quietTo : "") + '"></div>';
  h += "<label>" + WA.wa_pf_reminder + '</label><input id="pf-rem" type="number" inputmode="numeric" min="0" max="23" value="' + (p.reminderHour != null ? p.reminderHour : 9) + '">';
  h += "<label>" + WA.wa_pf_limitations + '</label><textarea id="pf-lim" rows="2">' + esc(p.limitations || "") + "</textarea>";
  h += "</div>";
  if (PF.share) {
    h += '<div class="card" style="margin-top:10px"><div class="sub">' + WA.wa_pf_share_title + "</div>";
    h += '<div class="pf-chips" style="margin-top:6px">' + pfChip("share", "body", WA.wa_pf_share_body, PF.share.body) + pfChip("share", "health", WA.wa_pf_share_health, PF.share.health) + "</div></div>";
  }
  h += '<div class="cc-save-row" style="margin-top:12px"><button id="pf-save" class="lbtn">' + WA.wa_save + '</button><span class="sub" id="pf-st"></span></div>';

  // --- Consolidated settings ---
  if (st) {
    h += '<h2 style="margin-top:16px">' + WA.wa_set_reminders + '</h2><div class="card"><div class="pf-chips" id="pf-rems">';
    st.reminders.forEach(function (r) { h += pfChip("rem", r.key, r.label, r.on); });
    h += "</div></div>";

    h += "<h2>" + WA.wa_set_vacation + '</h2><div class="card"><div class="pf-chips" id="pf-vac">';
    if (st.vacationUntil) {
      h += '<span class="sub">' + WA.wa_vac_until.replace("{d}", st.vacationUntil) + "</span>" + pfChip("vac", "off", WA.wa_vac_off, false);
    } else {
      h += pfChip("vac", "7", WA.wa_vac_7, false) + pfChip("vac", "14", WA.wa_vac_14, false) + pfChip("vac", "28", WA.wa_vac_28, false);
    }
    h += "</div></div>";

    h += "<h2>" + WA.wa_set_lang + '</h2><div class="card"><div class="pf-chips" id="pf-lang">' + pfChip("lang", "uk", "🇺🇦 Українська", st.lang === "uk") + pfChip("lang", "ru", "🇷🇺 Русский", st.lang === "ru") + pfChip("lang", "en", "🇬🇧 English", st.lang === "en") + "</div></div>";

    if (st.cycle) {
      h += "<h2>" + WA.wa_set_cycle + '</h2><div class="card"><div class="pf-chips">' + pfChip("cyc", "toggle", WA.wa_cycle_on, st.cycle.on) + "</div>";
      if (st.cycle.on) {
        h += "<label>" + WA.wa_cycle_last + '</label><input id="pf-cyc-date" type="date" value="' + (st.cycle.lastStart || "") + '">';
        h += "<label>" + WA.wa_cycle_len + '</label><input id="pf-cyc-len" type="number" inputmode="numeric" min="20" max="45" value="' + st.cycle.len + '">';
        h += '<div class="cc-save-row"><button class="chipbtn" data-cyc="save">' + WA.wa_save + "</button></div>";
      }
      h += "</div>";
    }

    h += "<h2>" + WA.wa_set_compete + '</h2><div class="card"><div class="pf-chips">' + pfChip("cmp", "toggle", WA.wa_compete_on, st.compete.on) + "</div>";
    if (st.compete.on) {
      h += "<label>" + WA.wa_alias_ph + '</label><div class="lrow"><input id="pf-alias" value="' + esc(st.compete.alias) + '"><button class="chipbtn" data-cmp="alias">' + WA.wa_save + "</button></div>";
    }
    h += "</div>";

    h += "<h2>" + WA.wa_set_feedback + '</h2><div class="card"><textarea id="pf-fb" rows="2" placeholder="' + esc(WA.wa_feedback_ph) + '"></textarea>';
    h += '<div class="cc-save-row"><button class="chipbtn" data-act2="fb">' + WA.wa_send + '</button><span class="sub" id="pf-fb-st"></span></div></div>';

    h += '<div class="card" style="margin-top:10px"><div class="pf-chips">';
    h += '<button class="chipbtn" data-act2="export">' + WA.wa_export + "</button>";
    if (st.role === "client") h += '<button class="chipbtn pf-danger" data-act2="leave">' + WA.wa_leave_trainer + "</button>";
    h += '<button class="chipbtn pf-danger" data-act2="delete">' + WA.wa_delete_acc + "</button>";
    h += '</div><span class="sub" id="pf-misc-st"></span></div>';
  }

  el("pf-body").innerHTML = h;
  var save = el("pf-save"); if (save) save.onclick = pfSave;
  var obGo = el("pf-ob-go"); if (obGo) obGo.onclick = pfObSubmit;
}

function pfSetAction(body, cb) {
  ccFetch("/api/settings", { method: "POST", body: body })
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) {
      if (res.deleted) { el("pf-body").innerHTML = '<div class="card">' + WA.wa_deleted + "</div>"; return; }
      if (res.state) PF.st = res.state;
      if (cb) cb(res); else pfRender();
    })
    .catch(function () { var s = el("pf-misc-st"); if (s) s.textContent = WA.wa_err; });
}

function pfObSubmit() {
  var body = {
    sex: PF.ob.sex,
    age: Number(el("pf-ob-age").value) || 0,
    heightCm: Number(el("pf-ob-h").value) || 0,
    weightKg: Number(el("pf-ob-w").value) || 0,
    lifestyle: el("pf-ob-life").value, sleepSchedule: el("pf-ob-sleep").value,
    goal: el("pf-goal").value, level: el("pf-level").value, equipment: el("pf-equip").value,
    dietPrefs: el("pf-diet").value, limitations: el("pf-lim").value, trainingWeekdays: PF.days,
  };
  var st = el("pf-ob-st"); var b = el("pf-ob-go"); b.disabled = true;
  ccFetch("/api/onboarding", { method: "POST", body: body })
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function () { el("pf-body").innerHTML = '<div class="card">' + WA.wa_ob_pending + "</div>"; })
    .catch(function () { if (st) st.textContent = WA.wa_ob_incomplete; b.disabled = false; });
}

function pfSave() {
  var gw = (el("pf-gw").value || "").trim();
  var body = {
    goal: el("pf-goal").value, level: el("pf-level").value, equipment: el("pf-equip").value, dietPrefs: el("pf-diet").value,
    limitations: el("pf-lim").value, trainingWeekdays: PF.days,
    goalWeight: gw === "" ? null : Number(gw), reminderHour: Number(el("pf-rem").value),
    waterGoalMl: (el("pf-wg").value || "").trim() === "" ? null : Number(el("pf-wg").value),
    stepsGoal: (el("pf-sg").value || "").trim() === "" ? null : Number(el("pf-sg").value),
    quietFrom: (el("pf-qf").value || "").trim() === "" ? null : Number(el("pf-qf").value),
    quietTo: (el("pf-qt").value || "").trim() === "" ? null : Number(el("pf-qt").value),
    waterEvery: PF.waterEvery || 0,
  };
  if (PF.share) body.share = PF.share;
  var btn = el("pf-save"); btn.disabled = true; el("pf-st").textContent = "";
  ccFetch("/api/profile", { method: "POST", body: body })
    .then(function (r) { if (r.status === 401) throw new Error("auth"); if (!r.ok) throw new Error("save"); return r.json(); })
    .then(function () { el("pf-st").textContent = WA.wa_saved; })
    .catch(function (e) { el("pf-st").textContent = e.message === "auth" ? L.autherr : WA.wa_err; })
    .then(function () { btn.disabled = false; });
}

(function pfWire() {
  var body = el("pf-body");
  if (!body) return;
  body.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var wd = t.getAttribute("data-wd");
    if (wd) {
      var w = Number(wd), i = PF.days.indexOf(w);
      if (i >= 0) { PF.days.splice(i, 1); t.className = "chipbtn"; } else { PF.days.push(w); t.className = "chipbtn on"; }
      return;
    }
    var sh = t.getAttribute("data-share");
    if (sh && PF.share) { PF.share[sh] = !PF.share[sh]; t.className = "chipbtn" + (PF.share[sh] ? " on" : ""); return; }
    var obsex = t.getAttribute("data-obsex");
    if (obsex) {
      PF.ob.sex = obsex;
      var sibs = el("pf-ob-sex").querySelectorAll("button");
      for (var j = 0; j < sibs.length; j++) sibs[j].className = "chipbtn" + (sibs[j] === t ? " on" : "");
      return;
    }
    var rem = t.getAttribute("data-rem");
    if (rem) { pfSetAction({ action: "remToggle", key: rem }); return; }
    var vac = t.getAttribute("data-vac");
    if (vac) { pfSetAction(vac === "off" ? { action: "vacation", off: true } : { action: "vacation", days: Number(vac) }); return; }
    var lng = t.getAttribute("data-lang");
    if (lng) { pfSetAction({ action: "lang", lang: lng }, function () { pfOpen(); }); return; }
    var cyc = t.getAttribute("data-cyc");
    if (cyc === "toggle") { pfSetAction({ action: "cycle", on: !(PF.st.cycle && PF.st.cycle.on) }); return; }
    if (cyc === "save") {
      pfSetAction({ action: "cycle", lastStart: el("pf-cyc-date").value, len: Number(el("pf-cyc-len").value) });
      return;
    }
    var cmp = t.getAttribute("data-cmp");
    if (cmp === "toggle") { pfSetAction({ action: "compete", on: !(PF.st.compete && PF.st.compete.on) }); return; }
    if (cmp === "alias") { pfSetAction({ action: "compete", alias: el("pf-alias").value }); return; }
    var thm = t.getAttribute("data-theme");
    if (thm) {
      applyTheme(thm);
      var tsib = t.parentNode.querySelectorAll("[data-theme]");
      for (var ti = 0; ti < tsib.length; ti++) tsib[ti].className = "chipbtn" + (tsib[ti] === t ? " on" : "");
      return;
    }
    var wt = t.getAttribute("data-water");
    if (wt !== null) {
      PF.waterEvery = Number(wt);
      var wsib = t.parentNode.querySelectorAll("[data-water]");
      for (var wi = 0; wi < wsib.length; wi++) wsib[wi].className = "chipbtn" + (wsib[wi] === t ? " on" : "");
      return;
    }
    var a2 = t.getAttribute("data-act2");
    if (a2 === "shareprog") { pfShareProgress(); return; }
    if (a2 === "buddy") { pfInviteBuddy(); return; }
    if (a2 === "fb") {
      var txt = (el("pf-fb").value || "").trim();
      if (txt.length < 2) return;
      pfSetAction({ action: "feedback", text: txt }, function () { el("pf-fb").value = ""; el("pf-fb-st").textContent = WA.wa_saved; });
      return;
    }
    if (a2 === "export") { pfSetAction({ action: "export" }, function (res) { el("pf-misc-st").textContent = res.ok ? WA.wa_export_sent : WA.wa_err; }); return; }
    if (a2 === "leave") {
      var doLeave = function () { pfSetAction({ action: "leaveTrainer" }, function () { pfOpen(); }); };
      if (TG && TG.showConfirm) TG.showConfirm(WA.wa_leave_confirm, function (ok) { if (ok) doLeave(); }); else doLeave();
      return;
    }
    if (a2 === "delete") {
      var doDel = function () { pfSetAction({ action: "deleteAccount", confirm: true }); };
      if (TG && TG.showConfirm) TG.showConfirm(WA.wa_delete_confirm, function (ok) { if (ok) doDel(); }); else doDel();
      return;
    }
  });
  el("pf-back").onclick = pfClose;
})();
