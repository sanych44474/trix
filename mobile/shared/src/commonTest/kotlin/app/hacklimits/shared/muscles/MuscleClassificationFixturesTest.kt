package app.hacklimits.shared.muscles

import app.hacklimits.shared.data.AppJson
import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Golden cases shared with the TS classifier: test/fixtures/muscle-classification.json, embedded in
// MuscleFixturesGenerated.kt. Drift between the two classifiers fails here and in test/muscle-classification.test.ts.

@Serializable internal class FixtureMuscles(val primary: List<String> = emptyList(), val secondary: List<String> = emptyList())
@Serializable internal class FixtureCase(val name: String, val learned: FixtureMuscles? = null, val expected: FixtureMuscles? = null)
@Serializable internal class FixtureFile(val cases: List<FixtureCase>)

class MuscleClassificationFixturesTest {
    private val cases = AppJson.decodeFromString<FixtureFile>(MUSCLE_FIXTURES_JSON).cases

    @Test
    fun classifyMatchesTheTypeScriptClassifierOnEveryCase() {
        assertTrue(cases.size >= 60, "the golden set stays broad")
        for (case in cases) {
            val learned = case.learned?.let { l ->
                cleanLearned(l.primary, l.secondary)?.let { mapOf(normalizeExerciseName(case.name) to it) }
            } ?: emptyMap()
            val expected = case.expected?.let { ExerciseMuscles(it.primary, it.secondary) }
            assertEquals(expected, classify(case.name, learned), case.name)
        }
    }
}
