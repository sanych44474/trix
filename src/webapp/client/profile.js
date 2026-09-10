
// --- profile / settings / onboarding overlay (GET/POST /api/profile, /api/settings, /api/onboarding) ---
var PF = { data: null, st: null, days: [], share: null, ob: { sex: "" }, cmp: [] };

function pfOpen() {
  el("pf").classList.remove("hidden");
  el("pf-title").textContent = WA.wa_profile_title;
  el("pf-body").innerHTML = uiSub(WA.wa_loading);
  if (TG && TG.BackButton && TG.BackButton.show) { TG.BackButton.show(); if (TG.BackButton.onClick) TG.BackButton.onClick(pfClose); }
  Promise.all([
    ccFetch("/api/profile").then(function (r) { if (r.status === 401) throw new Error("auth"); return r.json(); }),
    ccFetch("/api/settings").then(function (r) { return r.ok ? r.json() : null; }),
  ]).then(function (res) {
    PF.data = res[0]; PF.st = res[1];
    PF.days = (PF.data.profile.trainingWeekdays || []).slice();
    PF.share = PF.data.profile.share;
    pfRender();
  }).catch(function (e) { el("pf-body").innerHTML = uiCard(e.message === "auth" ? L.autherr : L.loaderr); });
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
  return uiChip(esc(label), ' data-' + attr + '="' + esc(String(val)) + '"', { on: on });
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
      + cat.map(function (x) {
        if (earned[x.code]) return '<span class="ach-b got">' + esc(x.label) + "</span>";
        var prog = x.progress ? " (" + x.progress.current + "/" + x.progress.needed + ")" : "";
        return '<span class="ach-b lock">🔒 ' + esc(x.label) + prog + "</span>";
      }).join("")
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
// Before/after composite from the two picked gallery photos. Drawn client-side (the photos are
// same-origin via /api/photo, so the canvas isn't tainted and toBlob works) and pushed to the
// user's own chat by the bot — the webview can't hand over a file directly (CSP), same route
// the week-card PNG already takes.
function pfPhotoCompare() {
  var st = el("pf-photocmp-st");
  var phs = (PF.data && PF.data.photos) || [];
  var byId = {};
  phs.forEach(function (p) { byId[p.id] = p; });
  var a = byId[PF.cmp[0]], b = byId[PF.cmp[1]];
  if (!a || !b) return;
  // Oldest on the left regardless of tap order — "before → after" only reads right one way.
  if (a.takenAt > b.takenAt) { var tmp = a; a = b; b = tmp; }
  if (st) st.textContent = WA.wa_loading;
  var load = function (id) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error("img")); };
      img.src = photoSrc(id);
    });
  };
  Promise.all([load(a.id), load(b.id)])
    .then(function (imgs) {
      var W = 1080, pad = 24, label = 56;
      var half = Math.floor((W - pad * 3) / 2);
      var H = Math.round(half * 4 / 3) + pad * 2 + label;
      var c = document.createElement("canvas");
      c.width = W; c.height = H;
      var g = c.getContext("2d");
      var css = getComputedStyle(document.body);
      g.fillStyle = css.backgroundColor || "#fff";
      g.fillRect(0, 0, W, H);
      // object-fit: cover, by hand — keeps both shots the same size without squashing either.
      var draw = function (img, x) {
        var boxW = half, boxH = Math.round(half * 4 / 3);
        var scale = Math.max(boxW / img.width, boxH / img.height);
        var w = img.width * scale, hh = img.height * scale;
        g.save();
        g.beginPath();
        g.rect(x, pad, boxW, boxH);
        g.clip();
        g.drawImage(img, x + (boxW - w) / 2, pad + (boxH - hh) / 2, w, hh);
        g.restore();
      };
      draw(imgs[0], pad);
      draw(imgs[1], pad * 2 + half);
      g.fillStyle = css.color || "#000";
      g.font = "600 26px -apple-system, system-ui, sans-serif";
      g.textAlign = "center";
      var ty = H - pad - 8;
      g.fillText(a.takenAt, pad + half / 2, ty);
      g.fillText(b.takenAt, pad * 2 + half + half / 2, ty);
      c.toBlob(function (blob) {
        if (!blob) { if (st) st.textContent = WA.wa_err; return; }
        var fd = new FormData();
        fd.append("photo", blob, "progress.png");
        fd.append("from", a.takenAt);
        fd.append("to", b.takenAt);
        ccFetch("/api/photocompare", { method: "POST", body: fd })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (st) st.textContent = res && res.ok ? WA.wa_export_sent : WA.wa_err;
            if (res && res.ok && TG && TG.HapticFeedback && TG.HapticFeedback.notificationOccurred) TG.HapticFeedback.notificationOccurred("success");
          })
          .catch(function () { if (st) st.textContent = WA.wa_err; });
      }, "image/png");
    })
    .catch(function () { if (st) st.textContent = WA.wa_err; });
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
  // Settings accordions stay open across a re-render triggered by an action inside one of them
  // (e.g. saving the cycle form) — otherwise every save silently closes the section the user is
  // looking at, with no other feedback that anything happened.
  var openAcc = {};
  var oldBody = el("pf-body");
  if (oldBody) {
    var openEls = oldBody.querySelectorAll("details.ui-acc[open]");
    for (var oi = 0; oi < openEls.length; oi++) { if (openEls[oi].id) openAcc[openEls[oi].id] = true; }
  }
  var h = pfGamification();
  // 🎨 Theme override + 📣 share progress.
  var ct = pfCurTheme();
  var tchip = function (m, l) { return uiChip(esc(l), ' data-theme="' + m + '"', { on: ct === m }); };
  h += '<div class="card" style="margin-bottom:10px"><b>🎨 ' + (WA.wa_theme || "Theme") + '</b><div class="pf-chips" style="margin-top:8px">'
    + tchip("auto", WA.wa_theme_auto || "Auto") + tchip("light", WA.wa_theme_light || "Light") + tchip("dark", WA.wa_theme_dark || "Dark") + "</div></div>";
  h += '<div class="card" style="margin-bottom:10px;display:flex;flex-direction:column;gap:6px">'
    + '<button class="lbtn" data-act2="shareprog" style="width:100%">📣 ' + (WA.wa_share_progress || "Share my progress") + "</button>"
    + '<button class="lbtn" data-act2="buddy" style="width:100%;background:var(--card);color:var(--fg)">🤝 ' + (WA.wa_buddy_invite || "Invite an accountability buddy") + "</button></div>";
  // 💧 Scheduled water reminders (0/2/3/4h), saved with the profile.
  var we = typeof PF.waterEvery === "number" ? PF.waterEvery : (p.waterEvery || 0);
  PF.waterEvery = we;
  var wchip = function (n, l) { return uiChip(esc(l), ' data-water="' + n + '"', { on: we === n }); };
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
    // Tap two photos to build a before/after composite (PF.cmp holds the picked ids, in tap
    // order, so "before" is whichever was tapped first — same shot can't be picked twice).
    if (phs.length > 1) h += '<div class="sub" style="margin-top:4px">' + (WA.wa_photo_cmp_hint || "Tap two photos to compare") + "</div>";
    h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px">';
    phs.forEach(function (ph) {
      var picked = PF.cmp.indexOf(ph.id) >= 0;
      var mark = picked ? (PF.cmp.indexOf(ph.id) === 0 ? "1" : "2") : "";
      h += '<div data-photo="' + esc(ph.id) + '" style="position:relative;cursor:pointer">'
        + '<img loading="lazy" src="' + photoSrc(ph.id) + '" style="width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px'
        + (picked ? ";outline:3px solid var(--accent);outline-offset:-3px" : "") + '">'
        + (picked ? '<span style="position:absolute;top:4px;left:4px;background:var(--accent);color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">' + mark + "</span>" : "")
        + '<div class="sub" style="text-align:center">' + esc(ph.takenAt) + "</div></div>";
    });
    h += "</div>";
    if (PF.cmp.length === 2) {
      // NB: id is pf-photocmp-st, not pf-cmp-st — the latter is the compete-alias save status.
      h += '<div class="cc-save-row" style="margin-top:8px">' + uiChip(WA.wa_photo_cmp_btn || "🔀 Compare & send", ' data-act2="photocmp"')
        + '<span class="sub" id="pf-photocmp-st"></span></div>';
    }
    h += "</div>";
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

  // --- Consolidated settings: collapsed by default (a wall of always-open cards read as
  // cluttered) — each stays a plain <details>, so nothing about how it's filled in changes. ---
  if (st) {
    var remBody = '<div class="pf-chips" id="pf-rems">';
    st.reminders.forEach(function (r) { remBody += pfChip("rem", r.key, r.label, r.on); });
    remBody += "</div>";
    h += uiAccordion(WA.wa_set_reminders, remBody, ' id="pf-acc-rem" style="margin-top:16px"');

    var vacBody = '<div class="pf-chips" id="pf-vac">';
    if (st.vacationUntil) {
      vacBody += '<span class="sub">' + WA.wa_vac_until.replace("{d}", st.vacationUntil) + "</span>" + pfChip("vac", "off", WA.wa_vac_off, false);
    } else {
      vacBody += pfChip("vac", "7", WA.wa_vac_7, false) + pfChip("vac", "14", WA.wa_vac_14, false) + pfChip("vac", "28", WA.wa_vac_28, false);
    }
    vacBody += "</div>";
    h += uiAccordion(WA.wa_set_vacation, vacBody, ' id="pf-acc-vac"');

    h += uiAccordion(WA.wa_set_lang, '<div class="pf-chips" id="pf-lang">' + pfChip("lang", "uk", "🇺🇦 Українська", st.lang === "uk") + pfChip("lang", "en", "🇬🇧 English", st.lang === "en") + "</div>", ' id="pf-acc-lang"');

    if (st.cycle) {
      var cycBody = '<div class="pf-chips">' + pfChip("cyc", "toggle", WA.wa_cycle_on, st.cycle.on) + "</div>";
      if (st.cycle.on) {
        cycBody += "<label>" + WA.wa_cycle_last + '</label><input id="pf-cyc-date" type="date" value="' + (st.cycle.lastStart || "") + '">';
        cycBody += "<label>" + WA.wa_cycle_len + '</label><input id="pf-cyc-len" type="number" inputmode="numeric" min="20" max="45" value="' + st.cycle.len + '">';
        cycBody += '<div class="cc-save-row">' + uiChip(WA.wa_save, ' data-cyc="save"') + '<span class="sub" id="pf-cyc-st"></span></div>';
      }
      h += uiAccordion(WA.wa_set_cycle, cycBody, ' id="pf-acc-cyc"');
    }

    var cmpBody = '<div class="pf-chips">' + pfChip("cmp", "toggle", WA.wa_compete_on, st.compete.on) + "</div>";
    if (st.compete.on) {
      cmpBody += "<label>" + WA.wa_alias_ph + '</label><div class="lrow"><input id="pf-alias" value="' + esc(st.compete.alias) + '">' + uiChip(WA.wa_save, ' data-cmp="alias"') + "</div><span class=\"sub\" id=\"pf-cmp-st\"></span>";
    }
    h += uiAccordion(WA.wa_set_compete, cmpBody, ' id="pf-acc-cmp"');

    var fbBody = '<textarea id="pf-fb" rows="2" placeholder="' + esc(WA.wa_feedback_ph) + '"></textarea>'
      + '<div class="cc-save-row">' + uiChip(WA.wa_send, ' data-act2="fb"') + '<span class="sub" id="pf-fb-st"></span></div>';
    h += uiAccordion(WA.wa_set_feedback, fbBody, ' id="pf-acc-fb"');

    var accBody = '<div class="pf-chips">'
      + uiChip(WA.wa_export, ' data-act2="export"')
      + uiChip(WA.wa_export_json, ' data-act2="export_json"')
      + (st.role === "client" ? uiChip(WA.wa_leave_trainer, ' data-act2="leave"', { danger: true }) : "")
      + uiChip(WA.wa_delete_acc, ' data-act2="delete"', { danger: true })
      + '</div><span class="sub" id="pf-misc-st"></span>';
    h += uiAccordion(WA.wa_set_account, accBody, ' id="pf-acc-account"');
  }

  el("pf-body").innerHTML = h;
  for (var accId in openAcc) { var accEl = el(accId); if (accEl) accEl.open = true; }
  var save = el("pf-save"); if (save) save.onclick = pfSave;
  var obGo = el("pf-ob-go"); if (obGo) obGo.onclick = pfObSubmit;
}

function pfSetAction(body, cb) {
  ccFetch("/api/settings", { method: "POST", body: body })
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) {
      if (res.deleted) { el("pf-body").innerHTML = uiCard(WA.wa_deleted); return; }
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
    .then(function () { el("pf-body").innerHTML = uiCard(WA.wa_ob_pending); })
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
      pfSetAction({ action: "cycle", lastStart: el("pf-cyc-date").value, len: Number(el("pf-cyc-len").value) }, function () {
        pfRender();
        var s = el("pf-cyc-st"); if (s) s.textContent = WA.wa_saved;
      });
      return;
    }
    var cmp = t.getAttribute("data-cmp");
    if (cmp === "toggle") { pfSetAction({ action: "compete", on: !(PF.st.compete && PF.st.compete.on) }); return; }
    if (cmp === "alias") {
      pfSetAction({ action: "compete", alias: el("pf-alias").value }, function () {
        pfRender();
        var s = el("pf-cmp-st"); if (s) s.textContent = WA.wa_saved;
      });
      return;
    }
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
    // Photo picker for the before/after composite: tap to select, tap again to deselect, a
    // third pick replaces the older of the two (so tapping around never dead-ends at "clear first").
    var photoEl = t.closest ? t.closest("[data-photo]") : null;
    if (photoEl) {
      var pid = photoEl.getAttribute("data-photo");
      var at = PF.cmp.indexOf(pid);
      if (at >= 0) PF.cmp.splice(at, 1);
      else if (PF.cmp.length < 2) PF.cmp.push(pid);
      else PF.cmp = [PF.cmp[1], pid];
      pfRender();
      return;
    }
    var a2 = t.getAttribute("data-act2");
    if (a2 === "photocmp") { pfPhotoCompare(); return; }
    if (a2 === "shareprog") { pfShareProgress(); return; }
    if (a2 === "buddy") { pfInviteBuddy(); return; }
    if (a2 === "fb") {
      var txt = (el("pf-fb").value || "").trim();
      if (txt.length < 2) return;
      pfSetAction({ action: "feedback", text: txt }, function () { el("pf-fb").value = ""; el("pf-fb-st").textContent = WA.wa_saved; });
      return;
    }
    if (a2 === "export") { pfSetAction({ action: "export" }, function (res) { el("pf-misc-st").textContent = res.ok ? WA.wa_export_sent : WA.wa_err; }); return; }
    if (a2 === "export_json") { pfSetAction({ action: "export_json" }, function (res) { el("pf-misc-st").textContent = res.ok ? WA.wa_export_sent : WA.wa_err; }); return; }
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
