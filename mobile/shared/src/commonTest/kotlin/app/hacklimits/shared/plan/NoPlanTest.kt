package app.hacklimits.shared.plan

import app.hacklimits.shared.data.Dashboard
import app.hacklimits.shared.today.TodayState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NoPlanTest {
    @Test
    fun anOnboardedAthleteWithoutAPlanBuildsOne() {
        // Left their trainer (the plan is switched off), or a build failed.
        assertEquals(NoPlanAction.Build, noPlanAction(role = "solo", onboarded = true, planPending = false))
        assertEquals(NoPlanAction.Build, noPlanAction(role = "trainer", onboarded = true, planPending = false))
    }

    @Test
    fun aTrainerWhoNeverDidTheQuestionnaireOpensIt() {
        assertEquals(NoPlanAction.Questionnaire, noPlanAction(role = "trainer", onboarded = false, planPending = false))
    }

    @Test
    fun aClientWithATrainerWaitsForTheTrainerWithNoButton() {
        assertEquals(NoPlanAction.Trainer, noPlanAction(role = "client", onboarded = true, planPending = false))
    }

    @Test
    fun aFirstPlanStillBeingBuiltSaysSo() {
        assertEquals(NoPlanAction.Building, noPlanAction(role = "trainer", onboarded = false, planPending = true))
    }

    @Test
    fun todayShowsNoPlanInsteadOfARestDayOnly() {
        val none = Dashboard.Calendar()
        val withPlan = Dashboard.Calendar(split = listOf(Dashboard.Calendar.Split(weekday = 1, group = "legs", n = 4)))
        assertFalse(hasActivePlan(none))
        assertTrue(hasActivePlan(withPlan))
        assertTrue(showsNoPlan(TodayState.Rest, hasPlan = false))
        assertFalse(showsNoPlan(TodayState.Rest, hasPlan = true), "a plan's rest day stays a rest day")
        assertFalse(showsNoPlan(TodayState.Done, hasPlan = false), "a workout logged today still shows")
        assertFalse(showsNoPlan(TodayState.Continue, hasPlan = false), "a workout under way still shows")
    }
}
