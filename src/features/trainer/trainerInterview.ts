// Trainer-side client intake: the interview answer labels, the anthropometry block, the mini
// interview a trainer runs for a client, and the AI draft plan that follows it.
import { InlineKeyboard } from "grammy";
import type { Lang, UserDoc, Weekday } from "../../types";
import { listStrength } from "../../adapters/d1/v2Workouts";
import { saveDraftPlan } from "../../adapters/d1/v2Plans";
import { getClientForTrainer, getTrainer } from "../../adapters/d1/v2Trainer";
import { anthroLines, trainerCanSee } from "../../domain/clientCard";
import { formatRecordBest } from "../../domain/progression";
import { escapeHtml, t } from "../../locales/i18n";
import { renderPlan } from "../../render";
import { type MyContext, type TKey, reply } from "../../adapters/telegram/context";
import { buildPlanDoc, deferAi } from "../../bot";
import { trainerStyleBlock } from "./trainerWizard";
import { clientCardKb } from "./trainerCommon";

// Stored onboarding answers are English enum-ish strings; map the known ones back to the
// localized onboarding button labels, fall back to the (escaped) raw text for free-form answers.
export const INTV_VALUE_KEYS: Record<string, string> = {
  "fat loss": "ob_goal_fatloss", "muscle gain": "ob_goal_muscle", recomposition: "ob_goal_recomp",
  strength: "ob_goal_strength", endurance: "ob_goal_endurance",
  beginner: "ob_level_beginner", intermediate: "ob_level_intermediate", advanced: "ob_level_advanced",
  "full gym": "ob_eq_gym", "home basics (dumbbells, bands)": "ob_eq_home",
  "dumbbells only": "ob_eq_dumbbells", "bodyweight only": "ob_eq_bodyweight",
  sedentary: "ob_life_sedentary", moderate: "ob_life_moderate", active: "ob_life_active",
  morning: "ob_sleep_morning", evening: "ob_sleep_evening",
  none: "ob_diet_none", vegetarian: "ob_diet_vegetarian", vegan: "ob_diet_vegan",
};

export function intvLabel(lang: Lang, v?: string): string | undefined {
  if (!v) return undefined;
  const key = INTV_VALUE_KEYS[v.toLowerCase().trim()];
  return key ? t(lang, key as TKey) : escapeHtml(v);
}

// Consent-gated anthropometry block for card views ("" = shared but nothing filled in yet).
export function anthroBlock(lang: Lang, client: UserDoc, cname: string): string {
  if (!trainerCanSee(client.profile, "body")) return t(lang, "cc_share_locked", { name: cname });
  const lines = anthroLines(client.profile, {
    height: t(lang, "cc_anthro_height"), weight: t(lang, "cc_anthro_weight"),
    age: t(lang, "cc_anthro_age"), sex: t(lang, "cc_anthro_sex"),
    goalWeight: t(lang, "cc_anthro_goalweight"), waist: t(lang, "cc_anthro_waist"),
    chest: t(lang, "cc_anthro_chest"), hips: t(lang, "cc_anthro_hips"),
    arm: t(lang, "cc_anthro_arm"), thigh: t(lang, "cc_anthro_thigh"),
    male: t(lang, "cc_sex_male"), female: t(lang, "cc_sex_female"),
  });
  return lines.length ? `${t(lang, "cc_anthro_hdr")}\n${lines.join("\n")}` : "";
}

// AI-draft a plan for a client from an arbitrary profile snapshot. Shared by the card's
// "Draft" action (client's own profile) and the mini-interview (ephemeral trainer answers).
export async function runTrainerDraft(ctx: MyContext, client: UserDoc, profile: UserDoc["profile"]) {
  const lang = ctx.user.lang;
  const clientId = client._id;
  await reply(ctx, t(lang, "draft_generating"));
  await ctx.replyWithChatAction("typing").catch(() => {});
  // Deferred past the webhook response: the full build (catalog + plan AI chain + translate)
  // can outlive the webhook window — run inline it silently died and no draft ever landed.
  deferAi(ctx, "draft", async () => {
    const records = await listStrength(ctx.db, clientId, 8);
    const prs = records.length ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n") : undefined;
    // Bias the draft toward THIS trainer's stated specialization/approach.
    const trainerDoc = await getTrainer(ctx.db, ctx.user._id).catch(() => null);
    const trainerStyle = trainerDoc ? trainerStyleBlock(trainerDoc) : undefined;
    // Generate the client's draft in the CLIENT's language, not the trainer's.
    const plan = await buildPlanDoc(ctx, client.lang, profile, clientId, { prs, authoredBy: ctx.user._id, trainerStyle });
    await saveDraftPlan(ctx.db, plan);
    await reply(ctx, t(lang, "draft_ready"));
    await reply(ctx, renderPlan(lang, plan), clientCardKb(lang, clientId));
  });
}

// ============ Trainer mini-interview: a 6-question stand-in for the client's intake ============
// The trainer answers FOR the client; the answers live only in the callback data and are merged
// into an EPHEMERAL profile for one draft generation. The client's own profile/session/onboarded
// flags are never touched, so their full interview still runs from where they left off.
export const MI_STEPS: { q: TKey; options: { key?: TKey; label?: string; code: string }[] }[] = [
  { q: "ob_q_sex", options: [{ key: "ob_sex_male", code: "m" }, { key: "ob_sex_female", code: "f" }] },
  { q: "ob_q_age", options: [{ key: "mi_age_1", code: "22" }, { key: "mi_age_2", code: "30" }, { key: "mi_age_3", code: "40" }, { key: "mi_age_4", code: "52" }] },
  { q: "ob_q_goal", options: [{ key: "ob_goal_fatloss", code: "fl" }, { key: "ob_goal_muscle", code: "mg" }, { key: "ob_goal_recomp", code: "rc" }, { key: "ob_goal_strength", code: "st" }, { key: "ob_goal_endurance", code: "en" }] },
  { q: "ob_q_level", options: [{ key: "ob_level_beginner", code: "b" }, { key: "ob_level_intermediate", code: "i" }, { key: "ob_level_advanced", code: "a" }] },
  { q: "mi_q_days", options: [{ label: "2", code: "2" }, { label: "3", code: "3" }, { label: "4", code: "4" }, { label: "5", code: "5" }] },
  { q: "ob_q_equipment", options: [{ key: "ob_eq_gym", code: "g" }, { key: "ob_eq_home", code: "h" }, { key: "ob_eq_dumbbells", code: "d" }, { key: "ob_eq_bodyweight", code: "bw" }] },
];

export const MI_GOALS: Record<string, string> = { fl: "fat loss", mg: "muscle gain", rc: "recomposition", st: "strength", en: "endurance" };

export const MI_LEVELS: Record<string, UserDoc["profile"]["level"]> = { b: "beginner", i: "intermediate", a: "advanced" };

export const MI_EQ: Record<string, string> = { g: "full gym", h: "home basics (dumbbells, bands)", d: "dumbbells only", bw: "bodyweight only" };

export const MI_WEEKDAYS: Record<string, Weekday[]> = { "2": [1, 4], "3": [1, 3, 5], "4": [1, 2, 4, 5], "5": [1, 2, 3, 4, 5] };

export function miProfilePatch(codes: string[]): Partial<UserDoc["profile"]> {
  const [sex, age, goal, level, days, eq] = codes;
  const out: Partial<UserDoc["profile"]> = {};
  if (sex === "m" || sex === "f") out.sex = sex === "f" ? "female" : "male";
  if (age && Number(age) > 0) out.age = Number(age);
  if (goal && MI_GOALS[goal]) out.goal = MI_GOALS[goal];
  if (level && MI_LEVELS[level]) out.level = MI_LEVELS[level];
  if (days && MI_WEEKDAYS[days]) {
    out.daysPerWeek = Number(days);
    out.trainingWeekdays = MI_WEEKDAYS[days];
  }
  if (eq && MI_EQ[eq]) out.equipment = MI_EQ[eq];
  return out;
}

// Callback flow: "mi:<clientId>" starts it, "mi:<clientId>:<c1.c2...>" carries answers so far.
export async function onMiniInterview(ctx: MyContext, payload: string) {
  const lang = ctx.user.lang;
  const [idStr, codesStr] = payload.split(":");
  const clientId = Number(idStr);
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) {
    await reply(ctx, t(lang, "error_generic"));
    return;
  }
  const codes = codesStr ? codesStr.split(".") : [];
  if (codes.length >= MI_STEPS.length) {
    // Done — merge over whatever the client already answered (their answers stay authoritative
    // in the DB; the trainer's take precedence only inside this one-off generation snapshot).
    const profile = { ...client.profile, ...miProfilePatch(codes) };
    await runTrainerDraft(ctx, client, profile);
    return;
  }
  const step = MI_STEPS[codes.length];
  const kb = new InlineKeyboard();
  step.options.forEach((o, i) => {
    kb.text(o.key ? t(lang, o.key) : (o.label ?? o.code), `mi:${clientId}:${[...codes, o.code].join(".")}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  const cname = escapeHtml(client.profile.name ?? `id ${clientId}`);
  const title = codes.length === 0 ? `${t(lang, "mi_title", { name: cname })}\n\n` : "";
  await reply(ctx, `${title}(${codes.length + 1}/${MI_STEPS.length}) ${t(lang, step.q)}`, kb);
}
