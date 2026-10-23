package app.hacklimits.shared.plan

import app.hacklimits.shared.data.Plan
import app.hacklimits.shared.muscles.ExerciseMuscles
import app.hacklimits.shared.muscles.classify
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFalse

class PlanLogicTest {
    private fun ex(i: Int, name: String, sets: String = "3 × 10") = Plan.Exercise(index = i, name = name, sets = sets)
    private fun day(weekday: Int, vararg exercises: Plan.Exercise) = Plan.Day(weekday = weekday, exercises = exercises.toList())

    @Test
    fun setCountsReadTheLeadingNumberAndTreatCardioAsOneSet() {
        assertEquals(4, planSetCount("4 × 8–10"))
        assertEquals(3, planSetCount("3 x 12"))
        assertEquals(1, planSetCount("20-25 min"))
        assertEquals(1, planSetCount("5 km"))
        assertEquals(3, planSetCount(null), "anything unparseable counts as a typical 3 sets")
        assertEquals(3, planSetCount("99 × 5"), "an implausible count falls back to 3")
    }

    @Test
    fun exerciseNamesMapToTheirMuscles() {
        val bench = classify("Bench Press")
        assertTrue(bench != null && "chest" in bench.primary)
        assertEquals(null, classify("Zumba Party"), "an unknown name maps to nothing")
    }

    @Test
    fun learnedClassificationsCountTowardThePlanBalance() {
        val days = listOf(day(1, ex(0, "Bench Press"), ex(1, "Dumbbell Fly"), ex(2, "Triceps Pushdown"), ex(3, "Odd machine")))
        val learned = mapOf("odd machine" to ExerciseMuscles(listOf("abs"), emptyList()))
        val issues = planBalance(days) { classify(it, learned) }
        assertFalse(issues.any { it.slug == "abs" }, "a learned abs exercise counts toward the balance check")
        assertTrue(planBalance(days).isEmpty(), "without the learned entry the plan has too little to judge")
    }

    @Test
    fun aPlanWithTooLittleMappableWorkIsNotJudged() {
        assertTrue(planBalance(emptyList()).isEmpty())
        assertTrue(planBalance(listOf(day(1, ex(0, "Zumba"), ex(1, "Yoga flow")))).isEmpty())
    }

    @Test
    fun aMissingKeyMuscleIsFlaggedWithADayToAddItTo() {
        val days = listOf(
            day(1, ex(0, "Bench Press"), ex(1, "Incline Bench Press"), ex(2, "Dumbbell Fly"), ex(3, "Triceps Pushdown")),
            day(3, ex(0, "Barbell Squat"), ex(1, "Romanian Deadlift"), ex(2, "Leg Extension"), ex(3, "Standing Calf Raise")),
        )
        val issues = planBalance(days)
        val missing = issues.filter { it.kind == BalanceKind.MISSING }.map { it.slug }
        assertTrue("abs" in missing, "a plan without any ab work flags abs")
        val abs = issues.first { it.slug == "abs" }
        assertTrue(abs.suggestion != null, "every flagged muscle gets one exercise to add")
    }

    @Test
    fun mesocycleGuidanceMatchesThePhase() {
        assertEquals(MesoGuidance("3–6", "RPE 8–9"), mesoGuidance("strength"))
        assertEquals(MesoGuidance("8–10", "RPE 5–6"), mesoGuidance("deload"))
        assertFalse(mesoGuidance("peak").reps.isEmpty())
    }

    @Test
    fun theLibraryParsesPackedLinesAndFallsBackToTheEnglishName() {
        val all = parseLibrary("Push-Up|chest|body|b|Віджимання\nPlank|abs|body|i\n")
        assertEquals(2, all.size)
        assertEquals("Віджимання", all[0].titleUk)
        assertEquals("Plank", all[1].titleUk, "a missing Ukrainian name falls back to the English one")
        assertEquals("i", all[1].level)
    }

    @Test
    fun aUkrainianMovementWordFindsTheEnglishExercise() {
        val all = parseLibrary(
            "Barbell_Squat|quadriceps|barbell|b|Присідання зі штангою\n" +
                "Plank|abs|body|b|Планка\n" +
                "Dumbbell_Squat|quadriceps|dumbbell|i|Присідання з гантелями",
        )
        val found = filterLibrary(all, query = "присідання з гантелями")
        assertEquals(listOf("Dumbbell_Squat"), found.map { it.id })
        val squats = filterLibrary(all, query = "присідання").map { it.id }
        assertTrue("Barbell_Squat" in squats && "Dumbbell_Squat" in squats)
        assertFalse("Plank" in squats)
    }

    @Test
    fun beginnerExercisesSortBeforeIntermediateAndExpert() {
        val all = parseLibrary("Zed|abs|body|e\nAlpha|abs|body|b\nBeta|abs|body|i")
        assertEquals(listOf("Alpha", "Beta", "Zed"), filterLibrary(all, muscle = "abs").map { it.id })
    }

    @Test
    fun exerciseFramesComeFromThePinnedCommit() {
        val frames = exerciseFrameUrls("3_4_Sit-Up")
        assertEquals(2, frames.size)
        assertTrue(frames[0].endsWith("/exercises/3_4_Sit-Up/0.jpg"))
    }
}
