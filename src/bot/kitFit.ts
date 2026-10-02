// "Fit my plan to my equipment" in the chat. Reached three ways: a button under the plan when it
// has exercises the person can't do with their equipment, the coach chat when someone says what
// they have ("в мене тільки гантелі", "замініть вправи зі штангою") — answered with the one-tap
// fix instead of an AI list of what to replace — and the Mini App's plan card (webapp/planApi.ts,
// action=fitkit), which shares the pure core (domain/equipmentFit.ts).
import { InlineKeyboard } from "grammy";
import type { UserDoc } from "../types";
import { getActivePlan, recordPlanChange, updateActivePlanSplit } from "../adapters/d1/v2Plans";
import { getUser, updateUser } from "../adapters/d1/v2Users";
import { fitSplitToKit, kitFromEquipment, kitMismatches, type Kit } from "../domain/equipmentFit";
import { escapeHtml, t } from "../locales/i18n";
import { weekdayName } from "../render";
import { type MyContext, planOwnerId, reply } from "../adapters/telegram/context";
import { menuBtn } from "../bot";

const KIT_EQUIPMENT: Record<Kit, string> = {
  gym: "full gym",
  home: "home basics (dumbbells, bands)",
  dumbbells: "dumbbells only",
  bodyweight: "bodyweight only",
};

/** Is the message about equipment or swapping exercises for it? */
export function isEquipmentTalk(text: string): boolean {
  return /обладнан|інвентар|штанг|тренажер|гантел|вдома|дома|без залу|нема\p{L}* залу|не ходжу в зал|власн\p{L}* ваг|equipment|barbell|dumbbell|at home|no gym|bodyweight|замін\p{L}* вправ|replace .*exercis/iu.test(text);
}

/** The kit a message states outright ("лише гантелі", "тільки власна вага", "only dumbbells"),
 *  or null when it only mentions equipment in passing ("сьогодні тренувався вдома", "є штанга і
 *  гантелі" — someone with a barbell must not be downgraded to dumbbells). */
export function statedKit(text: string): Kit | null {
  const n = text.toLowerCase();
  if (!/тільки|лише|только|only|є\s|маю|у мене|в мене|вдома|дома|at home|нема\p{L}* залу|без залу/u.test(n)) return null;
  if (/власн\p{L}* ваг|без (обладнан|інвентар)|нічого немає|bodyweight/u.test(n)) return "bodyweight";
  const bands = /гум|резин|band/u.test(n);
  if (/(тільки|лише|только|only)\s+(\p{L}+\s+)?(гантел|dumbbell)/u.test(n)) return bands ? "home" : "dumbbells";
  const bigKit = /штанг|barbell|тренажер|machine|кросовер|cable|блок/u.test(n) && !/(без|нема\p{L}*|no)\s+(штанг|тренажер|barbell|machine)/u.test(n);
  if (bigKit) return null;
  if (/гантел|dumbbell/u.test(n)) return bands || /вдома|дома|at home/u.test(n) ? "home" : "dumbbells";
  // Training at home as a habit or a constraint, not "trained at home today".
  if (/(тренуюс|займаюс)\p{L}*\s+(вдома|дома)|(тільки|лише|only)\s+(вдома|дома|at home)|train\p{L}* at home|нема\p{L}* залу|без залу|не ходжу в зал|no gym/u.test(n)) return "home";
  return null;
}

/** An explicit ask to change exercises for the equipment (vs. a question that merely mentions it,
 *  like "як робити жим гантелей?", which the AI coach should answer). */
function asksToReplace(text: string): boolean {
  return /замін|заміни|поміняй|replace|swap|не можу|не маю|нема|немає|don.?t have|no (barbell|gym|machine)/iu.test(text);
}

async function ownerOf(ctx: MyContext): Promise<UserDoc | null> {
  const id = planOwnerId(ctx);
  return id === ctx.user._id ? ctx.user : await getUser(ctx.db, id);
}

/** Plan-view button when the plan doesn't fit the equipment; null when it does. */
export async function kitFitButton(ctx: MyContext): Promise<{ text: string; data: string } | null> {
  const owner = await ownerOf(ctx);
  const plan = owner ? await getActivePlan(ctx.db, owner._id).catch(() => null) : null;
  if (!owner || !plan) return null;
  const kit = kitFromEquipment(owner.profile.equipment);
  const n = kitMismatches(plan.split, kit);
  return n ? { text: t(ctx.user.lang, "kitfit_btn", { n }), data: `kitfit:${kit}` } : null;
}

/** Coach chat: offer the one-tap fit when the message is about equipment and the plan has
 *  exercises outside it. Returns true when it answered (the AI coach is then skipped). */
export async function offerKitFit(ctx: MyContext, text: string): Promise<boolean> {
  if (!isEquipmentTalk(text)) return false;
  const stated = statedKit(text);
  if (!stated && !asksToReplace(text)) return false;
  const owner = await ownerOf(ctx);
  if (!owner) return false;
  const plan = await getActivePlan(ctx.db, owner._id).catch(() => null);
  if (!plan) return false;
  const kit = stated ?? kitFromEquipment(owner.profile.equipment);
  const n = kitMismatches(plan.split, kit);
  if (!n) return false;
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard()
    .text(t(lang, "kitfit_btn", { n }), `kitfit:${kit}`)
    .row()
    .text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, t(lang, "kitfit_offer", { n, kit: t(lang, `kitfit_kit_${kit}`) }), kb);
  return true;
}

/** kitfit:<kit> — set the equipment (if it changed), swap what doesn't fit, report the swaps. */
export async function applyKitFit(ctx: MyContext, kitArg: string) {
  const lang = ctx.user.lang;
  const kit = (["gym", "home", "dumbbells", "bodyweight"] as const).find((k) => k === kitArg);
  const owner = await ownerOf(ctx);
  const plan = owner ? await getActivePlan(ctx.db, owner._id).catch(() => null) : null;
  if (!kit || !owner || !plan) { await reply(ctx, t(lang, "no_plan"), menuBtn(lang)); return; }
  if (kitFromEquipment(owner.profile.equipment) !== kit) {
    owner.profile = { ...owner.profile, equipment: KIT_EQUIPMENT[kit] };
    await updateUser(ctx.db, owner._id, { profile: owner.profile });
  }
  const { split, swaps, dropped } = fitSplitToKit(plan.split, kit, owner.lang === "en" ? "en" : "uk");
  if (!swaps.length && !dropped.length) { await reply(ctx, t(lang, "kitfit_nothing"), menuBtn(lang)); return; }
  await updateActivePlanSplit(ctx.db, owner._id, split);
  await recordPlanChange(ctx.db, owner._id, owner._id === ctx.user._id ? "manual" : "trainer", `fitted to equipment: ${swaps.length} swapped, ${dropped.length} removed`).catch(() => {});
  const lines = [...swaps, ...dropped].slice(0, 12).map((s) =>
    `• ${weekdayName(lang, s.weekday as 1)}: ${escapeHtml(s.from)} → ${s.to ? `<b>${escapeHtml(s.to)}</b>` : t(lang, "kitfit_removed")}`);
  const more = swaps.length + dropped.length > 12 ? `\n… +${swaps.length + dropped.length - 12}` : "";
  const kb = new InlineKeyboard().text(t(lang, "menu_plan"), "menu:plan").row().text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, `${t(lang, "kitfit_done", { n: swaps.length + dropped.length })}\n\n${lines.join("\n")}${more}\n\n${t(lang, "kitfit_done_hint")}`, kb);
}
