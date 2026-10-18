// Which screen the app is on, and which tabs a person sees. Pure: App.tsx used to carry both inline,
// next to the dashboard loading and the Telegram buttons, where neither could be tested.

export type View = "today" | "train" | "plan" | "fuel" | "progress" | "role" | "more" | "settings" | "library" | "inbox" | "coach";

/** Every screen a link may open. A `?view=` that is not here lands on Today. */
export const VIEWS: readonly View[] = ["today", "train", "plan", "fuel", "progress", "role", "more", "settings", "library", "coach", "inbox"];

/** Names the bot's notification buttons and older links use for the same screens. */
const ALIASES: Record<string, View> = {
  home: "today", log: "train", workout: "train", survey: "progress", nutrition: "fuel", food: "fuel",
  profile: "settings", owner: "role", chat: "coach", ask: "coach",
};

/** The screen a deep link opens: `?view=` (or Telegram's `startapp`), through the aliases, else Today. */
export function viewFromSearch(search: string): View {
  const params = new URLSearchParams(search);
  const raw = params.get("view") ?? params.get("startapp");
  const value = raw ? ALIASES[raw] ?? (raw as View) : "today";
  return VIEWS.includes(value) ? value : "today";
}

/** The bottom tabs: five at most. The plan opens from the Training tab; settings, the library and
 *  the rest from More. A trainer's fifth slot is the client list (which leads with the clients who
 *  need attention) in place of their own progress, which moves to More. A role the app does not
 *  know yet (no dashboard) gets only Today and the role tab. */
export function navigationFor(role: string | undefined): View[] {
  if (role === "trainer") return ["today", "train", "role", "fuel", "more"];
  if (role === "solo" || role === "client") return ["today", "train", "fuel", "progress", "more"];
  return ["today", "role"];
}

/** The screens More links to, for whatever the tab bar no longer carries. */
export function moreLinksFor(role: string | undefined): View[] {
  return role === "trainer" ? ["progress", "library"] : ["role", "library"];
}

/** The tab a screen belongs to, so the bar highlights it (the plan sits under Training). */
export function tabFor(view: View): View {
  return view === "plan" ? "train" : view === "library" ? "more" : view;
}
