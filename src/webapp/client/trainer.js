
// --- trainer client card overlay (fetches /api/trainer/client/:id/card) ---
var WA = WA_ALL.en; // reassigned in render() once the payload language is known
var CC = { id: null, flagged: false, labeled: false };

function ccFetch(path, opts) {
  opts = opts || {};
  var headers = {};
  if (opts.body) headers["Content-Type"] = "application/json";
  if (initData) headers.Authorization = "tma " + initData;
  return fetch(path + (initData ? "" : location.search), {
    method: opts.method || "GET",
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

function ccLabels() {
  if (CC.labeled) return;
  CC.labeled = true;
  el("cc-back").title = WA.wa_back;
  el("cc-health-l").textContent = WA.wa_card_health;
  el("cc-health").placeholder = WA.wa_card_health_ph;
  el("cc-pers-l").textContent = WA.wa_card_personal;
  el("cc-pers").placeholder = WA.wa_card_personal_ph;
  el("cc-bday-l").textContent = WA.wa_card_bday;
  el("cc-note-l").textContent = WA.wa_card_note;
  el("cc-note").placeholder = WA.wa_card_note_ph;
  el("cc-save").textContent = WA.wa_save;
  el("cc-note-save").textContent = WA.wa_save;
}

function ccClose() {
  setTab("home"); // tab bar back to Home when an overlay closes
  el("cc").classList.add("hidden");
  CC.id = null;
  if (TG && TG.BackButton && TG.BackButton.hide) {
    TG.BackButton.hide();
    if (TG.BackButton.offClick) TG.BackButton.offClick(ccClose);
  }
}

function ccFlagLabel() { el("cc-flag").textContent = (CC.flagged ? "🚩 " : "") + (CC.flagged ? WA.wa_unflag : WA.wa_flag); }
function ccStatus(id, msg) { el(id).textContent = msg; }

function ccSharedHtml(p) {
  var b = p.shared.body, hp = p.shared.health, lines = [];
  if (b) {
    if (b.heightCm != null) lines.push(WA.wa_height + ": " + b.heightCm + " cm");
    if (b.weightKg != null) lines.push(WA.wa_weight + ": " + b.weightKg + " kg");
    if (b.age != null) lines.push(WA.wa_age + ": " + b.age);
    if (b.sex) lines.push(WA.wa_sex + ": " + (b.sex === "male" ? WA.wa_male : WA.wa_female));
    if (b.goalWeight != null) lines.push(WA.wa_goal_weight + ": " + b.goalWeight + " kg");
    if (b.measurements) {
      for (var k in b.measurements) lines.push(esc(k) + ": " + b.measurements[k] + " cm");
    }
  }
  if (hp) {
    if (hp.limitations) lines.push(WA.wa_limitations + ": " + esc(hp.limitations));
    if (hp.injuries && hp.injuries.length) {
      lines.push("<b>" + WA.wa_injuries + "</b>");
      hp.injuries.forEach(function (inj) {
        lines.push("• " + esc(inj.area) + " — " + esc(inj.severity) + " · " + esc(inj.since)
          + (inj.lastScore != null ? " · " + inj.lastScore + "/10" : ""));
      });
    }
  }
  var body = (b || hp)
    ? (lines.length ? lines.join("<br>") : "—")
    : '<span class="sub">' + WA.wa_shared_locked + "</span>";
  return "<h2>" + WA.wa_shared + '</h2><div class="card">' + body + "</div>";
}

function ccBillingHtml(bl) {
  bl = bl || {};
  var cur = [];
  if (bl.paidUntil != null) cur.push(WA.wa_paid_until + " " + esc(bl.paidUntil));
  if (bl.sessionsLeft != null) cur.push(WA.wa_sessions_left + " " + bl.sessionsLeft);
  var h = "<h2>" + WA.wa_billing + '</h2><div class="card">';
  if (cur.length) h += '<div class="sub" style="margin-bottom:6px">' + cur.join(" · ") + "</div>";
  h += '<label>' + WA.wa_paid_until + '</label><input id="cc-bill-paid" placeholder="YYYY-MM-DD" value="' + (bl.paidUntil != null ? esc(bl.paidUntil) : "") + '">';
  h += '<label>' + WA.wa_sessions_left + '</label><input id="cc-bill-sess" type="number" inputmode="numeric" value="' + (bl.sessionsLeft != null ? bl.sessionsLeft : "") + '">';
  h += '<div class="cc-save-row"><button id="cc-bill-save" class="lbtn">' + WA.wa_save + '</button><span class="sub" id="cc-bill-st"></span></div></div>';
  return h;
}

// Charts reuse the page's PURE svg builders (lineChart/heatmap/volumeBars/dayBars) on the
// client's embedded dashboard payload. initMonth/initLog are bound to fixed page ids — skipped.
function ccPhotosHtml(phs) {
  if (!phs || !phs.length) return "";
  var h = "<h2>📸 " + WA.wa_photos + '</h2><div class="card"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">';
  phs.forEach(function (ph) {
    h += '<a href="' + photoSrc(ph.id) + '" target="_blank"><img loading="lazy" src="' + photoSrc(ph.id)
      + '" style="width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px"><div class="sub" style="text-align:center">' + esc(ph.takenAt) + "</div></a>";
  });
  return h + "</div></div>";
}

function ccCharts(d) {
  var h = "";
  if (d.weight && d.weight.points.length >= 2) {
    h += "<h2>" + L.weight + '</h2><div class="card">'
      + lineChart(d.weight.points.map(function (q) { return { date: q.date, v: q.kg }; }), d.weight.goal, "kg")
      + "</div>";
  }
  if (d.calendar && d.calendar.days.length) {
    h += "<h2>" + L.cal + '</h2><div class="card">' + heatmap(d.calendar.days) + "</div>";
  }
  if (d.volume && d.volume.length) {
    h += "<h2>" + L.vol + '</h2><div class="card">' + volumeBars(d.volume, L.groups) + "</div>";
  }
  if (d.macros && d.macros.days.some(function (q) { return q.kcal > 0; })) {
    var t = d.macros.targets;
    h += "<h2>" + L.mac + '</h2><div class="card">' + dayBars(d.macros.days, "kcal", t ? t.calories : 0) + "</div>";
  }
  el("cc-charts").innerHTML = h;
}

function ccRender(p) {
  CC.flagged = p.client.flagged;
  el("cc-name").textContent = (p.client.onboarded ? "" : "⏳ ") + p.client.name;
  el("cc-flag").style.display = "";
  ccFlagLabel();
  // Open the plan editor for this client (P5 overlay). plOpen is defined in PLAN_JS.
  var planBtn = el("cc-plan");
  if (planBtn) { planBtn.textContent = WA.wa_edit_plan; planBtn.onclick = function () { plOpen(CC.id); }; }
  var bookBtn = el("cc-book-b");
  if (bookBtn) { bookBtn.textContent = WA.wa_book; bookBtn.onclick = ccBookForm; }
  var tplBtn = el("cc-tpl-b");
  if (tplBtn) { tplBtn.textContent = WA.wa_templates; tplBtn.onclick = ccTemplates; }
  el("cc-ops").innerHTML = "";
  if (p.cycle) {
    el("cc-cycle").style.display = "";
    el("cc-cycle").textContent = WA.wa_cycle + ": " + p.cycle.phase + " · " + p.cycle.day;
  }
  if (p.card) {
    el("cc-health").value = p.card.healthNotes || "";
    el("cc-pers").value = p.card.personalNotes || "";
    el("cc-bday").value = p.card.birthday || "";
  }
  el("cc-note").value = p.note || "";
  el("cc-shared").innerHTML = ccSharedHtml(p);
  el("cc-billing").innerHTML = ccBillingHtml(p.billing);
  var bs = el("cc-bill-save");
  if (bs) bs.onclick = ccSaveBilling;
  ccCharts(p.dashboard);
  el("cc-charts").innerHTML = ccPhotosHtml(p.photos) + el("cc-charts").innerHTML;
}

function ccSaveBilling() {
  var paid = (el("cc-bill-paid").value || "").trim();
  var sessRaw = (el("cc-bill-sess").value || "").trim();
  var body = { paidUntil: paid, sessionsLeft: sessRaw === "" ? null : Number(sessRaw) };
  var btn = el("cc-bill-save"); btn.disabled = true;
  ccStatus("cc-bill-st", "");
  ccFetch("/api/trainer/client/" + CC.id + "/billing", { method: "POST", body: body })
    .then(function (r) { if (r.status === 401) throw new Error("auth"); if (!r.ok) throw new Error("save"); return r.json(); })
    .then(function () { ccStatus("cc-bill-st", WA.wa_saved); })
    .catch(function (e) { ccStatus("cc-bill-st", e.message === "auth" ? L.autherr : WA.wa_err); })
    .then(function () { btn.disabled = false; });
}

function ccOpen(id, name, w, n) {
  CC.id = id;
  ccLabels();
  el("cc-name").textContent = name || WA.wa_loading;
  el("cc-flag").style.display = "none";
  el("cc-comp").style.display = "none";
  el("cc-cycle").style.display = "none";
  el("cc-shared").innerHTML = "";
  el("cc-billing").innerHTML = "";
  el("cc-charts").innerHTML = '<div class="sub">' + WA.wa_loading + "</div>";
  el("cc-health").value = ""; el("cc-pers").value = ""; el("cc-bday").value = ""; el("cc-note").value = "";
  ccStatus("cc-save-st", ""); ccStatus("cc-note-st", "");
  el("cc").classList.remove("hidden");
  el("cc").scrollTop = 0;
  if (TG && TG.BackButton && TG.BackButton.show) { TG.BackButton.onClick(ccClose); TG.BackButton.show(); }
  if (w != null && w !== "") {
    el("cc-comp").style.display = "";
    el("cc-comp").textContent = WA.wa_compliance + ": " + WA.wa_workouts + " " + w + "% · " + WA.wa_nutrition + " " + n + "%";
  }
  ccFetch("/api/trainer/client/" + id + "/card")
    .then(function (r) {
      if (r.status === 401) throw new Error("auth");
      if (!r.ok) throw new Error("load");
      return r.json();
    })
    .then(ccRender)
    .catch(function (e) {
      el("cc-charts").innerHTML = '<div class="sub">' + (e.message === "auth" ? L.autherr : WA.wa_err) + "</div>";
    });
}

el("cc-back").onclick = ccClose;

el("cc-save").onclick = function () {
  if (!CC.id) return;
  var btn = el("cc-save"); btn.disabled = true;
  ccStatus("cc-save-st", "…");
  ccFetch("/api/trainer/client/" + CC.id + "/card", { method: "POST", body: {
    healthNotes: el("cc-health").value.trim(),
    personalNotes: el("cc-pers").value.trim(),
    birthday: el("cc-bday").value.trim(),
  } })
    .then(function (r) {
      if (r.status === 401) throw new Error("auth");
      if (!r.ok) throw new Error("save");
      return r.json();
    })
    .then(function () { ccStatus("cc-save-st", WA.wa_saved); })
    .catch(function (e) { ccStatus("cc-save-st", e.message === "auth" ? L.autherr : WA.wa_err); })
    .then(function () { btn.disabled = false; });
};

el("cc-note-save").onclick = function () {
  if (!CC.id) return;
  var btn = el("cc-note-save"); btn.disabled = true;
  ccStatus("cc-note-st", "…");
  ccFetch("/api/trainer/client/" + CC.id + "/note", { method: "POST", body: { note: el("cc-note").value.trim() } })
    .then(function (r) {
      if (r.status === 401) throw new Error("auth");
      if (!r.ok) throw new Error("save");
      return r.json();
    })
    .then(function () { ccStatus("cc-note-st", WA.wa_saved); })
    .catch(function (e) { ccStatus("cc-note-st", e.message === "auth" ? L.autherr : WA.wa_err); })
    .then(function () { btn.disabled = false; });
};

el("cc-flag").onclick = function () {
  if (!CC.id) return;
  var next = !CC.flagged;
  var btn = el("cc-flag"); btn.disabled = true;
  ccFetch("/api/trainer/client/" + CC.id + "/flag", { method: "POST", body: { flagged: next } })
    .then(function (r) {
      if (!r.ok) throw new Error("save");
      return r.json();
    })
    .then(function (r) { CC.flagged = !!r.flagged; ccFlagLabel(); })
    .catch(function () { ccStatus("cc-save-st", WA.wa_err); })
    .then(function () { btn.disabled = false; });
};

// Delegated tap handler on the trainer clients list (rows carry data-id / data-w / data-n).
el("c-team").addEventListener("click", function (e) {
  var tgt = e.target;
  while (tgt && tgt !== this && !(tgt.getAttribute && tgt.getAttribute("data-id"))) tgt = tgt.parentNode;
  var id = tgt && tgt.getAttribute && tgt.getAttribute("data-id");
  if (!id) return;
  if (TG && TG.HapticFeedback) TG.HapticFeedback.selectionChanged();
  var nameEl = tgt.querySelector("span");
  ccOpen(Number(id), nameEl ? nameEl.textContent : "", tgt.getAttribute("data-w"), tgt.getAttribute("data-n"));
});

// ---- Q&A inbox overlay (list the trainer's client questions, answer inline) ----
function qaOpen() {
  el("qa").classList.remove("hidden");
  el("qa-title").textContent = WA.wa_qa_title;
  el("qa-body").innerHTML = '<div class="sub">' + WA.wa_loading + "</div>";
  if (TG && TG.BackButton && TG.BackButton.show) { TG.BackButton.show(); if (TG.BackButton.onClick) TG.BackButton.onClick(qaClose); }
  ccFetch("/api/trainer/questions")
    .then(function (r) { if (r.status === 401) throw new Error("auth"); if (!r.ok) throw new Error("load"); return r.json(); })
    .then(function (res) { qaRender(res.questions || []); })
    .catch(function (e) { el("qa-body").innerHTML = '<div class="card">' + (e.message === "auth" ? L.autherr : L.loaderr) + "</div>"; });
}
function qaClose() {
  setTab("home"); // tab bar back to Home when an overlay closes
  el("qa").classList.add("hidden");
  if (TG && TG.BackButton && TG.BackButton.hide) { TG.BackButton.hide(); if (TG.BackButton.offClick) TG.BackButton.offClick(qaClose); }
}
function qaRender(list) {
  var open = list.filter(function (q) { return q.status === "pending"; });
  if (!open.length) { el("qa-body").innerHTML = '<div class="card">' + WA.wa_qa_empty + "</div>"; return; }
  var h = "";
  open.forEach(function (q) {
    h += '<div class="card" style="margin-bottom:10px" id="qa-q-' + q.id + '">';
    h += "<b>" + esc(q.client || "") + "</b><div style=\"margin:4px 0\">" + esc(q.text) + "</div>";
    h += '<textarea id="qa-a-' + q.id + '" rows="2" placeholder="' + esc(WA.wa_qa_answer_ph) + '">' + esc(q.draft || "") + "</textarea>";
    h += '<div class="cc-save-row"><button class="lbtn" data-qa="' + q.id + '">' + WA.wa_qa_answer + '</button><span class="sub" id="qa-st-' + q.id + '"></span></div></div>';
  });
  el("qa-body").innerHTML = h;
}
function qaAnswer(id) {
  var ta = el("qa-a-" + id);
  var text = ta ? (ta.value || "").trim() : "";
  if (!text) return;
  var st = el("qa-st-" + id);
  ccFetch("/api/trainer/question/" + id + "/answer", { method: "POST", body: { text: text } })
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function () { var card = el("qa-q-" + id); if (card) card.innerHTML = '<div class="sub">' + WA.wa_qa_sent + "</div>"; })
    .catch(function () { if (st) st.textContent = WA.wa_err; });
}
el("qa-body").addEventListener("click", function (e) {
  var t2 = e.target;
  var id = t2 && t2.getAttribute ? t2.getAttribute("data-qa") : null;
  if (id) qaAnswer(Number(id));
});
el("qa-back").onclick = qaClose;

// ---- Booking: date + hour → propose a session (client confirms via bot push) ----
function ccBookForm() {
  var box = el("cc-ops");
  var h = '<div class="card"><label>' + WA.wa_book_date + '</label><input id="cc-bk-date" type="date">';
  h += '<label>' + WA.wa_book_hour + '</label><select id="cc-bk-hour">';
  [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21].forEach(function (x) { h += "<option>" + x + ":00</option>"; });
  h += '</select><div class="cc-save-row"><button id="cc-bk-send" class="lbtn">' + WA.wa_book_send + '</button><span class="sub" id="cc-bk-st"></span></div></div>';
  box.innerHTML = h;
  el("cc-bk-send").onclick = function () {
    var date = el("cc-bk-date").value;
    var hour = parseInt(el("cc-bk-hour").value, 10);
    if (!date) { ccStatus("cc-bk-st", WA.wa_err); return; }
    var b = el("cc-bk-send"); b.disabled = true;
    ccFetch("/api/trainer/client/" + CC.id + "/session", { method: "POST", body: { date: date, hour: hour } })
      .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
      .then(function () { ccStatus("cc-bk-st", WA.wa_book_sent); })
      .catch(function () { ccStatus("cc-bk-st", WA.wa_err); })
      .then(function () { b.disabled = false; });
  };
}

// ---- Program templates: list, assign to this client, delete ----
function ccTemplates() {
  var box = el("cc-ops");
  box.innerHTML = '<div class="sub">' + WA.wa_loading + "</div>";
  ccFetch("/api/trainer/templates")
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) {
      var list = res.templates || [];
      if (!list.length) { box.innerHTML = '<div class="card"><div class="sub">' + WA.wa_tpl_empty + "</div></div>"; return; }
      var h = '<div class="card">';
      list.forEach(function (tp) {
        h += '<div class="cc-save-row" style="margin:4px 0"><span style="flex:1">' + esc(tp.name) + "</span>";
        h += '<button class="chipbtn" data-tpl="assign" data-id="' + tp.id + '">' + WA.wa_tpl_assign + "</button>";
        h += '<button class="chipbtn" data-tpl="del" data-id="' + tp.id + '">🗑</button></div>';
      });
      h += '<span class="sub" id="cc-tpl-st"></span></div>';
      box.innerHTML = h;
    })
    .catch(function () { box.innerHTML = '<div class="sub">' + WA.wa_err + "</div>"; });
}
el("cc-ops").addEventListener("click", function (e) {
  var t2 = e.target; var a = t2 && t2.getAttribute ? t2.getAttribute("data-tpl") : null;
  if (!a) return;
  var id = Number(t2.getAttribute("data-id"));
  if (a === "assign") {
    ccFetch("/api/trainer/templates", { method: "POST", body: { action: "assign", id: id, clientId: CC.id } })
      .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
      .then(function () { ccStatus("cc-tpl-st", WA.wa_tpl_assigned); })
      .catch(function () { ccStatus("cc-tpl-st", WA.wa_err); });
  } else if (a === "del") {
    ccFetch("/api/trainer/templates", { method: "POST", body: { action: "delete", id: id } })
      .then(function () { ccTemplates(); }).catch(function () {});
  }
});

// ---- Trainer ops: requests inbox, upcoming sessions (cancel), finance summary ----
function opsOpen() {
  el("qa").classList.remove("hidden");
  el("qa-title").textContent = WA.wa_ops_title;
  el("qa-body").innerHTML = '<div class="sub">' + WA.wa_loading + "</div>";
  if (TG && TG.BackButton && TG.BackButton.show) { TG.BackButton.show(); if (TG.BackButton.onClick) TG.BackButton.onClick(qaClose); }
  Promise.all([
    ccFetch("/api/requests").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/trainer/sessions").then(function (r) { return r.ok ? r.json() : null; }),
    ccFetch("/api/trainer/finance").then(function (r) { return r.ok ? r.json() : null; }),
  ]).then(function (res) { opsRender(res[0], res[1], res[2]); })
    .catch(function () { el("qa-body").innerHTML = '<div class="card">' + L.loaderr + "</div>"; });
}
function opsRender(reqs, sess, fin) {
  var h = "<h2>📥 " + WA.wa_requests + "</h2><div class=\"card\">";
  var rl = (reqs && reqs.requests) || [];
  if (rl.length) {
    rl.forEach(function (r) {
      h += '<div class="cc-save-row" style="margin:4px 0" id="ops-req-' + r.id + '"><span style="flex:1"><b>' + esc(r.name) + "</b>" + (r.note ? ' <span class="sub">' + esc(r.note) + "</span>" : "") + "</span>";
      h += '<button class="chipbtn" data-ops="acc" data-id="' + r.id + '">' + WA.wa_accept + "</button>";
      h += '<button class="chipbtn" data-ops="dec" data-id="' + r.id + '">' + WA.wa_decline + "</button></div>";
    });
  } else h += '<div class="sub">' + L.nodata + "</div>";
  h += "</div>";
  h += "<h2>📅 " + WA.wa_sessions + "</h2><div class=\"card\">";
  var sl = (sess && sess.sessions) || [];
  if (sl.length) {
    sl.forEach(function (s) {
      h += '<div class="cc-save-row" style="margin:4px 0" id="ops-sess-' + s.id + '"><span style="flex:1">' + s.date + " " + s.hour + ":00 · " + esc(s.client || "") + ' <span class="sub">' + esc(s.status) + "</span></span>";
      h += '<button class="chipbtn" data-ops="cxl" data-id="' + s.id + '">' + WA.wa_cancel + "</button></div>";
    });
  } else h += '<div class="sub">' + L.nodata + "</div>";
  h += "</div>";
  if (fin) {
    h += "<h2>💰 " + WA.wa_finance + "</h2><div class=\"card\">";
    h += '<div class="sub">' + WA.wa_fin_done_month + ": " + fin.doneThisMonth + "</div>";
    var finRow = function (label, list) {
      h += '<div class="sub" style="margin-top:4px"><b>' + label + " (" + list.length + ")</b></div>";
      list.forEach(function (x) { h += '<div class="sub">• ' + esc(x.name) + (x.paidUntil ? " · " + x.paidUntil : "") + (x.sessionsLeft != null ? " · " + x.sessionsLeft : "") + "</div>"; });
    };
    finRow(WA.wa_fin_paying, fin.paying || []);
    finRow(WA.wa_fin_expiring, fin.expiring || []);
    finRow(WA.wa_fin_expired, fin.expired || []);
    h += "</div>";
  }
  el("qa-body").innerHTML = h;
}
el("qa-body").addEventListener("click", function (e) {
  var t2 = e.target;
  var op = t2 && t2.getAttribute ? t2.getAttribute("data-ops") : null;
  if (!op) return;
  var id = Number(t2.getAttribute("data-id"));
  if (op === "acc" || op === "dec") {
    ccFetch("/api/requests", { method: "POST", body: { id: id, action: op === "acc" ? "accept" : "decline" } })
      .then(function (r) { if (!r.ok) throw new Error("x"); var card = el("ops-req-" + id); if (card) card.innerHTML = '<span class="sub">' + (op === "acc" ? WA.wa_accepted : WA.wa_declined) + "</span>"; })
      .catch(function () {});
  } else if (op === "cxl") {
    ccFetch("/api/trainer/sessions", { method: "POST", body: { id: id, action: "cancel" } })
      .then(function (r) { if (!r.ok) throw new Error("x"); var row = el("ops-sess-" + id); if (row) row.innerHTML = '<span class="sub">' + WA.wa_cancelled + "</span>"; })
      .catch(function () {});
  }
});

// ---- Broadcast composer (dashboard trainer section) ----
function bcOpen() {
  el("qa").classList.remove("hidden");
  el("qa-title").textContent = WA.wa_bc_title;
  if (TG && TG.BackButton && TG.BackButton.show) { TG.BackButton.show(); if (TG.BackButton.onClick) TG.BackButton.onClick(qaClose); }
  var h = '<div class="card"><textarea id="bc-text" rows="4" placeholder="' + esc(WA.wa_bc_ph) + '"></textarea>';
  h += '<div class="cc-save-row"><button id="bc-send" class="lbtn">' + WA.wa_bc_send + '</button><span class="sub" id="bc-st"></span></div></div>';
  el("qa-body").innerHTML = h;
  el("bc-send").onclick = function () {
    var text = (el("bc-text").value || "").trim();
    if (text.length < 2) return;
    if (!(TG && TG.showConfirm)) { bcSend(text); return; }
    TG.showConfirm(WA.wa_bc_confirm, function (ok) { if (ok) bcSend(text); });
  };
}
function bcSend(text) {
  var b = el("bc-send"); if (b) b.disabled = true;
  ccStatus("bc-st", WA.wa_bc_sending);
  ccFetch("/api/trainer/broadcast", { method: "POST", body: { text: text } })
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) { ccStatus("bc-st", WA.wa_bc_done.replace("{n}", res.sent)); })
    .catch(function () { ccStatus("bc-st", WA.wa_err); if (b) b.disabled = false; });
}
