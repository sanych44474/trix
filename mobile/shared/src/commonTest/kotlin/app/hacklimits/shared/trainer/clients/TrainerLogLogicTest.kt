package app.hacklimits.shared.trainer.clients

import app.hacklimits.shared.data.WorkoutToday
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrainerLogLogicTest {
    private val planDay = TrainerLogDay(
        date = "2026-11-23",
        exercises = listOf(
            WorkoutToday.Exercise(index = 0, name = "Bench Press", metric = "reps", sets = 3, reps = 8.0, weightKg = 60.0),
            WorkoutToday.Exercise(index = 1, name = "Plank", metric = "time", sets = 2, reps = 45.0),
        ),
    )

    @Test
    fun aDayWithNothingSavedStartsFromThePlanWithEmptyRowsAndThePlanAsHints() {
        val form = formFromDay(planDay)
        assertEquals(listOf("Bench Press", "Plank"), form.map { it.name })
        assertEquals(3, form[0].rows.size)
        assertTrue(form[0].rows.all { it == FormSet() }, "the plan's numbers are not pre-filled as if done")
        assertEquals("60", form[0].hintWeight)
        assertEquals("8", form[0].hintReps)
        assertEquals("time", form[1].metric)
    }

    @Test
    fun aSavedDayStartsFromWhatWasLogged() {
        val day = planDay.copy(
            saved = listOf(WorkoutToday.SavedEntry("Barbell Squat", rpe = 8.0, sets = listOf(WorkoutToday.PastSet(w = 100.0, r = 5.0), WorkoutToday.PastSet(w = 102.5, r = 4.0)))),
            savedAt = "2026-11-23T09:00:00.000Z",
        )
        val form = formFromDay(day)
        assertEquals(1, form.size)
        assertEquals(listOf(FormSet("100", "5"), FormSet("102.5", "4")), form[0].rows)
        assertEquals(8.0, form[0].rpe)
    }

    @Test
    fun aProposalReplacesTheSetsOfAnExerciseInTheFormAndAppendsANewOne() {
        val merged = mergeProposal(
            formFromDay(planDay),
            listOf(
                TrainerLogEntry("bench press", listOf(TrainerLogSet(80.0, 6), TrainerLogSet(80.0, 5)), rpe = 8.0),
                TrainerLogEntry("Rowing", listOf(TrainerLogSet(0.0, 0, seconds = 480, meters = 2000))),
                TrainerLogEntry("Nothing", emptyList()),
            ),
        )
        assertEquals(3, merged.size, "an entry with no sets adds nothing")
        assertEquals(listOf(FormSet("80", "6"), FormSet("80", "5")), merged[0].rows)
        assertEquals(8.0, merged[0].rpe)
        assertEquals("distance", merged[2].metric)
        assertEquals("2000", merged[2].rows.single().meters)
    }

    @Test
    fun cellsKeepOnlyNumbersAndRepsAreWhole() {
        var form = formFromDay(planDay)
        form = editCell(form, 0, 0, "weight", "82,5kg")
        form = editCell(form, 0, 0, "reps", "6.7")
        assertEquals(FormSet("82.5", "6"), form[0].rows[0])
        assertEquals(4, addRow(form, 0)[0].rows.size)
        assertEquals(3, addExercise(form, "  Face Pull ").size)
        assertEquals(2, addExercise(form, "bench press").size, "already in the form")
    }

    @Test
    fun theSaveSendsOnlyFilledSets() {
        var form = formFromDay(planDay)
        form = editCell(form, 0, 0, "weight", "80")
        form = editCell(form, 0, 0, "reps", "6")
        form = editCell(form, 0, 1, "weight", "80") // a weight with no reps is not a set
        val entries = formEntries(form)
        assertEquals(1, entries.size)
        assertEquals(listOf(TrainerLogSet(80.0, 6)), entries[0].sets)
        assertTrue(formEntries(formFromDay(planDay)).isEmpty())
        val plank = formEntries(editCell(formFromDay(planDay), 1, 0, "seconds", "45"))
        assertEquals(45, plank.single().sets.single().seconds)
    }

    @Test
    fun proposalKindsMapToThePlanEditorsActions() {
        assertEquals("del", planActionFor("delete"))
        assertEquals("weight", planActionFor("weight"))
        assertNull(planActionFor("harder"))
    }
}
