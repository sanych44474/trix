// Shared string-builder primitives for the Mini App client views — same CSS classes the 8
// client files (shell.html + profile/trainer/plan/nutrition/logger/longtail/owner .js) already
// hand-write inline (74x ".card", 67x ".chipbtn", 39x "<h2>" section headers, 16x ".lrow" —
// counted directly in the source, not a guess). This is step 1 of "component layer, then
// redesign": pure DRY-up, ZERO visual/behavior change — every helper emits byte-identical
// markup to what was written by hand, just from one place instead of eight. A later visual pass
// can then restyle by editing these functions instead of hunting every call site.
//
// Loaded first in the concatenated bundle (see scripts/build-webapp.mjs) so every other client
// file can call these as plain global functions, same as el()/esc()/ccFetch() already work.

// A bordered card wrapping arbitrary inner HTML. `attrs` (optional) is a raw string of extra
// attributes, e.g. ' id="foo" style="margin-top:8px"'.
function uiCard(innerHtml, attrs) {
  return '<div class="card"' + (attrs || "") + ">" + innerHtml + "</div>";
}

// A .sub-styled loading/empty/error line, optionally wrapped in its own card (most call sites
// want the card; a few — status spans inside an existing card — just want the bare line).
function uiSub(msg, wrapInCard) {
  var line = '<div class="sub">' + msg + "</div>";
  return wrapInCard ? uiCard(line) : line;
}

// One pill/chip button. `dataAttrs` is a raw string of data-* attributes (e.g. ' data-act="x"
// data-i="3"') — kept as a raw string rather than an object because every existing call site
// already has its own mix of data-* keys; forcing them through one object shape right now would
// touch far more than the string-building this pass is scoped to. `opts.on`/`opts.danger` map
// to the existing " on" / " pf-danger" class modifiers; `opts.style` is a raw inline style string.
function uiChip(label, dataAttrs, opts) {
  opts = opts || {};
  var cls = "chipbtn" + (opts.on ? " on" : "") + (opts.danger ? " pf-danger" : "");
  return '<button class="' + cls + '"' + (dataAttrs || "") + (opts.style ? ' style="' + opts.style + '"' : "") + ">" + label + "</button>";
}

// The `<h2 id="...">` section header used before nearly every card across every view.
function uiSectionHeader(id, title) {
  return '<h2 id="' + id + '">' + title + "</h2>";
}

// One .lrow input+button row (search boxes, quick-add fields, etc.).
function uiRow(innerHtml) {
  return '<div class="lrow">' + innerHtml + "</div>";
}

// A collapsed-by-default settings section: <h2>-style eyebrow as the <summary>, body in a card.
// Used to de-clutter screens that stack many always-open settings blocks (profile) — first
// real visual/UX change of the redesign pass, not just a markup dedup like the helpers above.
// `attrs` is a raw string of extra attributes on the <details> itself (e.g. ' style="..."').
function uiAccordion(title, bodyHtml, attrs) {
  return '<details class="ui-acc"' + (attrs || "") + "><summary>" + title + '</summary><div class="card">' + bodyHtml + "</div></details>";
}
