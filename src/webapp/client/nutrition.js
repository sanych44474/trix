
// --- nutrition suite overlay (GET/POST /api/nutrition) ---
var NU = { data: null };

function nuOpen() {
  el("nu").classList.remove("hidden");
  el("nu-title").textContent = WA.wa_nu_title;
  el("nu-sub").textContent = "";
  el("nu-body").innerHTML = '<div class="sub">' + WA.wa_loading + "</div>";
  if (TG && TG.BackButton && TG.BackButton.show) { TG.BackButton.show(); if (TG.BackButton.onClick) TG.BackButton.onClick(nuClose); }
  ccFetch("/api/nutrition")
    .then(function (r) { if (r.status === 401) throw new Error("auth"); if (!r.ok) throw new Error("load"); return r.json(); })
    .then(function (d) { NU.data = d; nuRender(); })
    .catch(function (e) { el("nu-body").innerHTML = '<div class="card">' + (e.message === "auth" ? L.autherr : L.loaderr) + "</div>"; });
}
function nuClose() {
  setTab("home"); // tab bar back to Home when an overlay closes
  el("nu").classList.add("hidden");
  if (TG && TG.BackButton && TG.BackButton.hide) { TG.BackButton.hide(); if (TG.BackButton.offClick) TG.BackButton.offClick(nuClose); }
}
function nuTotals() {
  var d = NU.data, t = d.totals, tg = d.targets;
  var line = WA.wa_nu_total + ": " + Math.round(t.kcal) + (tg ? " / " + tg.calories : "") + " " + WA.wa_kcal
    + " · Б" + Math.round(t.protein) + (tg ? "/" + tg.protein : "") + " Ж" + Math.round(t.fats) + (tg ? "/" + tg.fats : "") + " В" + Math.round(t.carbs) + (tg ? "/" + tg.carbs : "");
  return '<div class="sub" style="margin:6px 0">' + esc(line) + "</div>";
}
function nuRender() {
  var d = NU.data;
  el("nu-sub").textContent = d.date;
  var h = "<h2>" + WA.wa_nu_today + "</h2>";
  if (!d.meals.length) {
    h += '<div class="card"><div class="sub">' + WA.wa_nu_empty + "</div></div>";
  } else {
    h += '<div class="card">' + nuTotals();
    d.meals.forEach(function (m) {
      h += '<div class="nu-meal"><div><b>' + esc(m.desc) + "</b> — " + m.kcal + " " + WA.wa_kcal
        + (m.grams != null ? " · " + m.grams + " " + WA.wa_g : "")
        + '<div class="sub">Б' + m.protein + " Ж" + m.fats + " В" + m.carbs + "</div></div>";
      h += '<div class="nu-acts">';
      h += '<button class="chipbtn" data-nu="scale" data-i="' + m.index + '" data-f="0.5">½×</button>';
      h += '<button class="chipbtn" data-nu="scale" data-i="' + m.index + '" data-f="1.5">1.5×</button>';
      h += '<button class="chipbtn" data-nu="scale" data-i="' + m.index + '" data-f="2">2×</button>';
      if (m.grams != null) h += '<input type="number" inputmode="numeric" id="nu-g-' + m.index + '" placeholder="' + m.grams + '"><button class="chipbtn" data-nu="grams" data-i="' + m.index + '">' + WA.wa_g + "</button>";
      h += '<button class="chipbtn" data-nu="macros-open" data-i="' + m.index + '">✏️</button>';
      h += '<button class="chipbtn" data-nu="del" data-i="' + m.index + '">🗑</button>';
      h += "</div>";
      // Hidden inline macro-edit form, shown when ✏️ is tapped. A header labels the four fields
      // (they'd otherwise read as bare unlabeled numbers once filled).
      h += '<div id="nu-mf-' + m.index + '" class="nu-mform hidden">';
      h += '<div class="sub" style="margin:4px 0 2px">' + WA.wa_macros_edit + "</div>";
      h += '<div class="lrow" style="gap:4px;flex-wrap:wrap">';
      h += '<input type="number" inputmode="numeric" id="nu-mk-' + m.index + '" placeholder="ккал" value="' + m.kcal + '" style="width:60px">';
      h += '<input type="number" inputmode="numeric" id="nu-mp-' + m.index + '" placeholder="Б" value="' + m.protein + '" style="width:50px">';
      h += '<input type="number" inputmode="numeric" id="nu-mf2-' + m.index + '" placeholder="Ж" value="' + m.fats + '" style="width:50px">';
      h += '<input type="number" inputmode="numeric" id="nu-mc-' + m.index + '" placeholder="В" value="' + m.carbs + '" style="width:50px">';
      h += '<button class="chipbtn" data-nu="macros-save" data-i="' + m.index + '">' + WA.wa_macros_saved + '</button>';
      h += '<button class="chipbtn" data-nu="macros-cancel" data-i="' + m.index + '">' + WA.wa_macros_cancel + '</button>';
      h += '</div></div>';
      h += "</div>";
    });
    h += "</div>";
  }
  // 🍳 AI recipe for remaining macros · 🍔 recover-from-overeating plan.
  h += '<div style="margin:10px 0;display:flex;flex-direction:column;gap:6px">'
    + '<button class="lbtn" data-nu="recipe" style="width:100%">🍳 ' + (WA.wa_recipe_btn || "Recipe for remaining") + "</button>"
    + '<button class="lbtn" data-nu="recover" style="width:100%;background:var(--card);color:var(--fg)">🍔 ' + (WA.wa_recover_btn || "Ate too much? Recovery plan") + "</button>"
    + '<div id="nu-recipe" style="margin-top:2px"></div></div>';
  // Food-DB search: exact per-100g macros from Open Food Facts (server-proxied).
  h += "<h2>🔍 " + WA.wa_food_db + '</h2><div class="card">';
  h += '<div class="lrow"><input id="nu-dbq" placeholder="' + esc(WA.wa_food_db_ph) + '"><button class="chipbtn" data-nu="dbsearch">' + WA.wa_search + "</button></div>";
  h += '<div id="nu-dbr" style="margin-top:6px"></div></div>';
  if (d.mealPlan && d.mealPlan.days && d.mealPlan.days.length) {
    h += "<h2>" + WA.wa_nu_plan + "</h2>";
    d.mealPlan.days.forEach(function (day) {
      h += '<div class="card" style="margin-bottom:8px"><b>' + esc(day.label) + "</b>";
      (day.meals || []).forEach(function (meal) {
        h += '<div class="sub" style="margin-top:4px"><b>' + esc(meal.name) + "</b> — " + Math.round(meal.kcal) + " " + WA.wa_kcal + "</div>";
        (meal.items || []).forEach(function (it) { h += '<div class="sub">• ' + esc(it.food) + " " + it.grams + " " + WA.wa_g + "</div>"; });
      });
      h += "</div>";
    });
  }
  // ⭐ Quick re-add: recently-logged foods as one-tap chips.
  if (d.recent && d.recent.length) {
    h += "<h2>⭐ " + (WA.wa_recent || "Recent") + '</h2><div class="card"><div style="display:flex;flex-wrap:wrap;gap:6px">';
    d.recent.forEach(function (r) {
      h += '<button class="chipbtn" data-nu="readd" data-ri="' + r.ri + '">' + esc(r.desc) + " · " + r.kcal + " " + WA.wa_kcal + "</button>";
    });
    h += "</div></div>";
  }
  el("nu-body").innerHTML = h;
}
function nuRecipe(action) {
  var box = el("nu-recipe");
  if (!box) return;
  box.innerHTML = '<span class="sub">' + WA.wa_loading + "</span>";
  ccFetch("/api/nutrition", { method: "POST", body: { action: action || "recipe" } })
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) {
      if (res.done) { box.innerHTML = '<div class="sub">' + (WA.wa_recipe_done || "🎯 Goal reached for today") + "</div>"; return; }
      if (!res.text) { box.innerHTML = '<div class="sub">' + WA.wa_err + "</div>"; return; }
      box.innerHTML = '<div class="card" style="white-space:pre-wrap">' + esc(res.text) + "</div>";
    })
    .catch(function () { box.innerHTML = '<div class="sub">' + WA.wa_err + "</div>"; });
}
function nuAct(action, i, extra) {
  var body = { action: action, index: i };
  if (extra) for (var k in extra) body[k] = extra[k];
  ccFetch("/api/nutrition", { method: "POST", body: body })
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) {
      if (res.meals) { NU.data.meals = res.meals; NU.data.totals = res.totals; nuRender(); }
      if (action === "macros" && res.cached && WA.wa_macros_cached) {
        if (TG && TG.showPopup) TG.showPopup({ message: WA.wa_macros_cached, buttons: [{ type: "close" }] }).catch(function(){});
      }
    })
    .catch(function () {});
}
// Not in any food database (common for Ukrainian products) → let the AI estimate it from a
// free-text description. Reuses the dashboard's /api/log food path, then reloads the meals.
function nuAiFallbackHtml(seed) {
  return '<div class="sub" style="margin:4px 0">' + WA.wa_food_db_none + "</div>"
    + '<div class="lrow"><input id="nu-ai" placeholder="' + esc(WA.wa_food_ai_ph) + '" value="' + esc(seed || "") + '"><button class="chipbtn" data-nu="aiest">' + WA.wa_food_ai_btn + "</button></div>"
    + '<div class="sub" id="nu-ai-st" style="min-height:1em"></div>';
}
function nuAiEstimate() {
  var inp = el("nu-ai"), st = el("nu-ai-st");
  if (!inp) return;
  var text = (inp.value || "").trim();
  if (text.length < 2) return;
  if (st) st.textContent = WA.wa_loading;
  apiPost({ kind: "food", text: text })
    .then(function (r) {
      if (r && r.ok) { if (st) st.textContent = WA.wa_food_ai_ok.replace("{kcal}", r.kcal); nuReload(); }
      else if (st) st.textContent = WA.wa_food_ai_bad;
    })
    .catch(function () { if (st) st.textContent = WA.wa_err; });
}
function nuReload() {
  ccFetch("/api/nutrition").then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d) { NU.data = d; nuRender(); } }).catch(function () {});
}
function nuDbSearch() {
  var inp = el("nu-dbq"), box = el("nu-dbr");
  if (!inp || !box) return;
  var q = (inp.value || "").trim();
  if (q.length < 2) return;
  box.innerHTML = '<span class="sub">' + WA.wa_loading + "</span>";
  ccFetch("/api/nutrition", { method: "POST", body: { action: "dbsearch", q: q } })
    .then(function (r) { if (!r.ok) throw new Error("x"); return r.json(); })
    .then(function (res) {
      NU.db = res.items || [];
      if (!NU.db.length) { box.innerHTML = nuAiFallbackHtml(q); return; }
      var hh = "";
      NU.db.forEach(function (it, k) {
        hh += '<button class="chipbtn" data-nu="dbpick" data-k="' + k + '" style="margin:2px 4px 2px 0">' + esc(it.name)
          + (it.brand ? " · " + esc(it.brand) : "") + (it.ai ? " " + WA.wa_food_ai_tag : "") + " — " + ((it.per100 && it.per100.kcal) || 0) + " " + WA.wa_kcal + "/100" + WA.wa_g + "</button>";
      });
      box.innerHTML = hh;
    })
    .catch(function () { box.innerHTML = '<span class="sub">' + WA.wa_err + "</span>"; });
}
(function nuWire() {
  var body = el("nu-body");
  if (!body) return;
  body.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target && e.target.id === "nu-dbq") { e.preventDefault(); nuDbSearch(); }
  });
  body.addEventListener("click", function (e) {
    var t = e.target; var a = t && t.getAttribute ? t.getAttribute("data-nu") : null;
    if (!a) return;
    var i = Number(t.getAttribute("data-i"));
    if (a === "dbsearch") { nuDbSearch(); return; }
    if (a === "readd") { nuAct("readd", undefined, { ri: Number(t.getAttribute("data-ri")) }); return; }
    if (a === "recipe") { nuRecipe("recipe"); return; }
    if (a === "recover") { nuRecipe("recover"); return; }
    if (a === "aiest") { nuAiEstimate(); return; }
    if (a === "dbpick") {
      var it = NU.db && NU.db[Number(t.getAttribute("data-k"))];
      if (!it) return;
      var box = el("nu-dbr");
      var p100p = it.per100 || {}; box.innerHTML = '<div class="sub" style="margin:4px 0"><b>' + esc(it.name) + "</b>" + (it.ai ? " " + WA.wa_food_ai_tag : "") + " · " + (p100p.kcal || 0) + " " + WA.wa_kcal + "/100" + WA.wa_g + "</div>"
        + '<div class="lrow"><input id="nu-dbg" type="number" inputmode="numeric" placeholder="' + esc(WA.wa_food_db_g) + '"><button class="chipbtn" data-nu="dbadd" data-k="' + t.getAttribute("data-k") + '">' + WA.wa_add + "</button></div>";
      var gi = el("nu-dbg"); if (gi) gi.focus();
      return;
    }
    if (a === "dbadd") {
      var it2 = NU.db && NU.db[Number(t.getAttribute("data-k"))];
      var g2 = Number(el("nu-dbg") ? el("nu-dbg").value : 0);
      if (!it2 || !(g2 > 0)) return;
      nuAct("dbadd", undefined, { name: it2.name + (it2.brand ? " (" + it2.brand + ")" : ""), grams: g2, per100: it2.per100 });
      return;
    }
    if (a === "del") nuAct("del", i);
    else if (a === "scale") nuAct("scale", i, { factor: Number(t.getAttribute("data-f")) });
    else if (a === "grams") { var g = el("nu-g-" + i); var v = g ? Number(g.value) : 0; if (v > 0) nuAct("grams", i, { grams: v }); }
    else if (a === "macros-open") { var mf = el("nu-mf-" + i); if (mf) mf.classList.toggle("hidden"); }
    else if (a === "macros-cancel") { var mf2 = el("nu-mf-" + i); if (mf2) mf2.classList.add("hidden"); }
    else if (a === "macros-save") {
      var k = el("nu-mk-" + i), p = el("nu-mp-" + i), f = el("nu-mf2-" + i), c = el("nu-mc-" + i);
      var kv = k ? Number(k.value) : NaN, pv = p ? Number(p.value) : NaN, fv = f ? Number(f.value) : NaN, cv = c ? Number(c.value) : NaN;
      if (!isNaN(kv) && !isNaN(pv) && !isNaN(fv) && !isNaN(cv) && kv >= 0) {
        nuAct("macros", i, { kcal: kv, protein: pv, fats: fv, carbs: cv });
      }
    }
  });
  el("nu-back").onclick = nuClose;
})();
