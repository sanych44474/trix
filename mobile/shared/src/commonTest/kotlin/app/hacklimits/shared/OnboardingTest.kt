package app.hacklimits.shared

import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.OnboardingRequest
import app.hacklimits.shared.onboarding.Answers
import app.hacklimits.shared.onboarding.Lifts
import app.hacklimits.shared.onboarding.StepId
import app.hacklimits.shared.onboarding.basicSteps
import app.hacklimits.shared.onboarding.basicsRequest
import app.hacklimits.shared.onboarding.firstOpenStep
import app.hacklimits.shared.onboarding.isAnswered
import app.hacklimits.shared.onboarding.stepsFor
import app.hacklimits.shared.onboarding.toRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OnboardingTest {
    private val full = Answers(
        sex = "female", age = 29, heightCm = 168, weightKg = 61.25, goal = "strength", level = "beginner",
        trainingWeekdays = listOf(4, 1), sessionMinutes = 45, equipment = "dumbbells only",
        lifestyle = "active", sleepSchedule = "morning", dietPrefs = "none", limitations = "  knee  ",
    )

    @Test
    fun liftsAppearOnlyPastBeginnerAndClientsAlsoGetTheSharingQuestion() {
        assertFalse(stepsFor(Answers(level = "beginner"), isClient = false).any { it.id == StepId.LIFTS })
        assertTrue(stepsFor(Answers(level = "intermediate"), isClient = false).any { it.id == StepId.LIFTS })
        assertEquals(StepId.SHARE, stepsFor(full, isClient = true).last().id)
        assertFalse(stepsFor(full, isClient = false).any { it.id == StepId.SHARE })
    }

    @Test
    fun aTypedAnswerNeedsAValidValueInRange() {
        val age = stepsFor(full, false).first { it.id == StepId.AGE }
        assertFalse(isAnswered(age, Answers(age = 7)), "an implausible age")
        assertTrue(isAnswered(age, Answers(age = 29)))
        val weight = stepsFor(full, false).first { it.id == StepId.WEIGHT }
        assertFalse(isAnswered(weight, Answers()))
    }

    @Test
    fun theRequestUsesTheServerOptionIdsAndTrimsTheLimitations() {
        val request = toRequest(full, isClient = false, timezone = "Europe/Kyiv")!!
        assertEquals("knee", request.limitations)
        assertEquals(listOf(1, 4), request.trainingWeekdays)
        assertEquals("none", request.baselineLifts, "beginners start from technique weights")
        assertEquals(61.3, request.weightKg)
        assertNull(request.share)
        val json = AppJson.encodeToString(OnboardingRequest.serializer(), request)
        assertTrue(json.contains("\"equipment\":\"dumbbells only\""))
        assertTrue(json.contains("\"timezone\":\"Europe/Kyiv\""))
    }

    @Test
    fun theLiftsBecomeABaselineSentence() {
        val request = toRequest(full.copy(level = "advanced", lifts = Lifts(bench = 100, deadlift = 140)), isClient = false, timezone = null)
        assertEquals("bench 100kg, deadlift 140kg", request?.baselineLifts)
    }

    @Test
    fun aClientsShareChoiceBecomesTheBodyAndHealthFlags() {
        val request = toRequest(full.copy(share = "body"), isClient = true, timezone = null)
        assertEquals(true, request?.share?.body)
        assertEquals(false, request?.share?.health)
    }

    @Test
    fun aMissingAnswerBlocksTheRequest() {
        assertNull(toRequest(full.copy(equipment = null), isClient = false, timezone = null))
    }

    @Test
    fun aResumedDraftContinuesAtTheFirstOpenQuestion() {
        assertEquals(2, firstOpenStep(Answers(sex = "male", age = 30), isClient = false))
        assertEquals(stepsFor(full, false).size - 1, firstOpenStep(full, isClient = false))
    }

    @Test
    fun theReadyProgramBasicsAreTheFourBodyQuestions() {
        assertEquals(listOf(StepId.SEX, StepId.AGE, StepId.HEIGHT, StepId.WEIGHT), basicSteps().map { it.id })
        assertNull(basicsRequest(Answers(sex = "male", age = 30)))
        val basics = basicsRequest(Answers(sex = "male", age = 30, heightCm = 180, weightKg = 80.04))
        assertEquals(80.0, basics?.weightKg)
    }
}
