package app.hacklimits.shared

import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.OnboardingAnswers
import app.hacklimits.shared.onboarding.OnboardingViewModel.State
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class OnboardingTest {
    @Test
    fun eachStepNeedsOnlyWhatThePlanGeneratorRequires() {
        assertFalse(State(step = 0).canContinue)
        assertTrue(State(step = 0, answers = OnboardingAnswers(goal = "strength")).canContinue)
        assertFalse(State(step = 1, answers = OnboardingAnswers(level = "beginner")).canContinue, "equipment too")
        assertTrue(State(step = 1, answers = OnboardingAnswers(level = "beginner", equipment = "full gym")).canContinue)
        assertFalse(State(step = 2).canContinue, "at least one training day")
        assertTrue(State(step = 2, answers = OnboardingAnswers(trainingWeekdays = listOf(1, 4))).canContinue)
        assertFalse(State(step = 3, answers = OnboardingAnswers(sex = "female", age = 7)).canContinue, "an implausible age")
        assertTrue(State(step = 3, answers = OnboardingAnswers(sex = "female", age = 29)).canContinue, "height and weight are optional")
    }

    @Test
    fun theBodyUsesTheServerOptionIdsAndOmitsWhatWasNotAnswered() {
        val json = AppJson.encodeToString(OnboardingAnswers(goal = "muscle gain", level = "beginner", equipment = "full gym", trainingWeekdays = listOf(1, 3), sex = "male", age = 30))
        assertEquals("""{"goal":"muscle gain","level":"beginner","equipment":"full gym","trainingWeekdays":[1,3],"sex":"male","age":30}""", json)
    }
}
