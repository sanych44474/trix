package app.hacklimits.shared

import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.OnboardingRequest
import app.hacklimits.shared.onboarding.Answers
import app.hacklimits.shared.onboarding.Lifts
import app.hacklimits.shared.onboarding.QuestionsResponse
import app.hacklimits.shared.onboarding.Step
import app.hacklimits.shared.onboarding.StepId
import app.hacklimits.shared.onboarding.basicSteps
import app.hacklimits.shared.onboarding.basicsRequest
import app.hacklimits.shared.onboarding.firstOpenStep
import app.hacklimits.shared.onboarding.isAnswered
import app.hacklimits.shared.onboarding.stepsFor
import app.hacklimits.shared.onboarding.stepsFrom
import app.hacklimits.shared.onboarding.toRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The question set as GET /api/v2/onboarding/questions sends it (a copy of the server's list). */
internal const val QUESTIONS_JSON = """{"questions":[
{"id":"sex","kind":"choice","q":"obq_sex","showWhen":"always","basics":true,"options":[{"value":"male","label":"sex_male"},{"value":"female","label":"sex_female"}]},
{"id":"age","kind":"number","q":"obq_age","showWhen":"always","basics":true,"number":{"min":13,"max":100,"step":1,"unit":"obu_years","placeholder":"30"}},
{"id":"height","kind":"number","q":"obq_height","showWhen":"always","basics":true,"number":{"min":100,"max":250,"step":1,"unit":"obu_cm","placeholder":"175"}},
{"id":"weight","kind":"number","q":"obq_weight","showWhen":"always","basics":true,"number":{"min":30,"max":300,"step":0.1,"unit":"obu_kg","placeholder":"75"}},
{"id":"goal","kind":"choice","q":"obq_goal","showWhen":"always","options":[{"value":"fat loss","label":"goal_fat_loss"},{"value":"muscle gain","label":"goal_muscle_gain"},{"value":"recomposition","label":"goal_recomposition"},{"value":"strength","label":"goal_strength"},{"value":"endurance","label":"goal_endurance"}]},
{"id":"level","kind":"choice","q":"obq_level","hint":"obh_level","showWhen":"always","options":[{"value":"beginner","label":"level_beginner"},{"value":"intermediate","label":"level_intermediate"},{"value":"advanced","label":"level_advanced"}]},
{"id":"lifts","kind":"lifts","q":"obq_lifts","hint":"ob_lifts_hint","showWhen":"nonBeginner"},
{"id":"days","kind":"days","q":"obq_days","hint":"obh_days","showWhen":"always"},
{"id":"duration","kind":"choice","q":"obq_duration","showWhen":"always","options":[{"value":"30","label":"obo_min_30"},{"value":"45","label":"obo_min_45"},{"value":"60","label":"obo_min_60"},{"value":"90","label":"obo_min_90"}]},
{"id":"equipment","kind":"choice","q":"obq_equipment","showWhen":"always","options":[{"value":"full gym","label":"equip_full_gym"},{"value":"home basics (dumbbells, bands)","label":"equip_home_basics"},{"value":"dumbbells only","label":"equip_dumbbells_only"},{"value":"bodyweight only","label":"equip_bodyweight_only"}]},
{"id":"lifestyle","kind":"choice","q":"obq_lifestyle","showWhen":"always","options":[{"value":"sedentary","label":"obo_life_sedentary"},{"value":"moderate","label":"obo_life_moderate"},{"value":"active","label":"obo_life_active"}]},
{"id":"sleep","kind":"choice","q":"obq_sleep","showWhen":"always","options":[{"value":"morning","label":"obo_sleep_morning"},{"value":"evening","label":"obo_sleep_evening"}]},
{"id":"diet","kind":"choice","q":"obq_diet","showWhen":"always","options":[{"value":"none","label":"diet_everything"},{"value":"vegetarian","label":"diet_vegetarian"},{"value":"vegan","label":"diet_vegan"}]},
{"id":"limits","kind":"text","q":"obq_limits","hint":"obh_limits","showWhen":"always"},
{"id":"share","kind":"choice","q":"obq_share","hint":"obh_share","showWhen":"trainerClient","options":[{"value":"both","label":"obo_share_both"},{"value":"body","label":"obo_share_body"},{"value":"health","label":"obo_share_health"},{"value":"none","label":"obo_share_none"}]}
]}"""

class OnboardingTest {
    private val all: List<Step> = stepsFrom(AppJson.decodeFromString<QuestionsResponse>(QUESTIONS_JSON).questions)!!

    private val full = Answers(
        sex = "female", age = 29, heightCm = 168, weightKg = 61.25, goal = "strength", level = "beginner",
        trainingWeekdays = listOf(4, 1), sessionMinutes = 45, equipment = "dumbbells only",
        lifestyle = "active", sleepSchedule = "morning", dietPrefs = "none", limitations = "  knee  ",
    )

    @Test
    fun aQuestionThisAppDoesNotKnowFailsTheWholeSet() {
        val unknownLabel = QUESTIONS_JSON.replace("\"goal_strength\"", "\"goal_power\"")
        assertNull(stepsFrom(AppJson.decodeFromString<QuestionsResponse>(unknownLabel).questions))
        val unknownQuestion = QUESTIONS_JSON.replace("\"id\":\"limits\"", "\"id\":\"habits\"")
        assertNull(stepsFrom(AppJson.decodeFromString<QuestionsResponse>(unknownQuestion).questions))
    }

    @Test
    fun liftsAppearOnlyPastBeginnerAndClientsAlsoGetTheSharingQuestion() {
        assertFalse(stepsFor(all, Answers(level = "beginner"), isClient = false).any { it.id == StepId.LIFTS })
        assertTrue(stepsFor(all, Answers(level = "intermediate"), isClient = false).any { it.id == StepId.LIFTS })
        assertEquals(StepId.SHARE, stepsFor(all, full, isClient = true).last().id)
        assertFalse(stepsFor(all, full, isClient = false).any { it.id == StepId.SHARE })
    }

    @Test
    fun theRangesComeFromTheServer() {
        val age = stepsFor(all, full, false).first { it.id == StepId.AGE }
        assertEquals(13.0, age.number?.min)
        assertEquals(100.0, age.number?.max)
        assertFalse(isAnswered(age, Answers(age = 7)), "an implausible age")
        assertFalse(isAnswered(age, Answers(age = 101)), "above the server's maximum")
        assertTrue(isAnswered(age, Answers(age = 29)))
        val weight = stepsFor(all, full, false).first { it.id == StepId.WEIGHT }
        assertFalse(isAnswered(weight, Answers()))
    }

    @Test
    fun theRequestUsesTheServerOptionIdsAndTrimsTheLimitations() {
        val request = toRequest(all, full, isClient = false, timezone = "Europe/Kyiv")!!
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
        val request = toRequest(all, full.copy(level = "advanced", lifts = Lifts(bench = 100, deadlift = 140)), isClient = false, timezone = null)
        assertEquals("bench 100kg, deadlift 140kg", request?.baselineLifts)
    }

    @Test
    fun aClientsShareChoiceBecomesTheBodyAndHealthFlags() {
        val request = toRequest(all, full.copy(share = "body"), isClient = true, timezone = null)
        assertEquals(true, request?.share?.body)
        assertEquals(false, request?.share?.health)
    }

    @Test
    fun aMissingAnswerBlocksTheRequest() {
        assertNull(toRequest(all, full.copy(equipment = null), isClient = false, timezone = null))
    }

    @Test
    fun aResumedDraftContinuesAtTheFirstOpenQuestion() {
        assertEquals(2, firstOpenStep(all, Answers(sex = "male", age = 30), isClient = false))
        assertEquals(stepsFor(all, full, false).size - 1, firstOpenStep(all, full, isClient = false))
    }

    @Test
    fun theReadyProgramBasicsAreTheFourBodyQuestions() {
        assertEquals(listOf(StepId.SEX, StepId.AGE, StepId.HEIGHT, StepId.WEIGHT), basicSteps(all).map { it.id })
        assertNull(basicsRequest(all, Answers(sex = "male", age = 30)))
        val basics = basicsRequest(all, Answers(sex = "male", age = 30, heightCm = 180, weightKg = 80.04))
        assertNotNull(basics)
        assertEquals(80.0, basics.weightKg)
    }
}
