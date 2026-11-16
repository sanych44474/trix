package app.hacklimits.shared.plan

import app.hacklimits.shared.data.Dashboard
import app.hacklimits.shared.today.TodayState

// The "no plan" state of Today and the Plan screen, kept apart from a rest day and from an error.
// An account has no active plan after leaving a trainer (the plan is switched off), as a trainer who
// never did the questionnaire, or while a plan build is running or after it failed.
// Port of the Mini App's logic/noPlan.ts.

/** Build: start the plan build; Questionnaire: open onboarding; Trainer: the trainer prepares it; Building: the first plan is on its way. */
enum class NoPlanAction { Build, Questionnaire, Trainer, Building }

fun noPlanAction(role: String, onboarded: Boolean, planPending: Boolean): NoPlanAction = when {
    planPending -> NoPlanAction.Building
    // The server builds no plan without the questionnaire (409 not_onboarded).
    !onboarded -> NoPlanAction.Questionnaire
    // A client who has a trainer cannot rebuild (403 trainer_managed): the trainer assigns the plan.
    role == "client" -> NoPlanAction.Trainer
    else -> NoPlanAction.Build
}

/** The dashboard's plan day summaries are empty exactly when there is no active plan with days. */
fun hasActivePlan(calendar: Dashboard.Calendar): Boolean = calendar.split.isNotEmpty()

/** Today shows the no-plan card where a rest day would be; a workout logged or under way still shows. */
fun showsNoPlan(state: TodayState, hasPlan: Boolean): Boolean = !hasPlan && state == TodayState.Rest
