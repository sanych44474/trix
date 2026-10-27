// The reminder switches a user can turn off (profile.remindersOff). One list shared by the bot's
// settings screen, the settings API (the Mini App and Android render what it returns) and the
// tests. Every key except "all" must be read by a nudge: remOff("key") in scheduler.ts and
// schedulerJobs/, or off("key") in features/survey/. "all" is the master switch (outbox).
// Value = locale key of the switch's label.
export const REMINDER_KEYS = [
  ["all", "rem_all"],
  ["workout", "rem_workout"], ["nutrition", "rem_nutrition"], ["steps", "rem_steps"], ["water", "rem_water"],
  ["checkin", "rem_checkin"], ["wellbeing", "rem_wellbeing"], ["tomorrow", "rem_tomorrow"], ["measure", "rem_measure"],
  ["weighin", "rem_weighin"], ["plateau", "rem_plateau"], ["digest", "rem_digest"], ["quality", "rem_quality"],
] as const;

export type ReminderKey = (typeof REMINDER_KEYS)[number][0];
