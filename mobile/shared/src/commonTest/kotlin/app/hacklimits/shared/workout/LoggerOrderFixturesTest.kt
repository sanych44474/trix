package app.hacklimits.shared.workout

import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.workout.logic.Reordered
import app.hacklimits.shared.workout.logic.RunningRest
import app.hacklimits.shared.workout.logic.moveInList
import app.hacklimits.shared.workout.logic.removeFromList
import app.hacklimits.shared.workout.logic.resumableRest
import app.hacklimits.shared.workout.logic.startsRest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Golden cases computed by the Mini App's apps/mini-app/src/logic/loggerOrder.ts
// (test/fixtures/logger-order.json, embedded in LoggerOrderFixturesGenerated.kt). Drift between the
// two loggers fails here and in test/logger-order.test.ts.

@Serializable internal class OrderResult(val order: List<Int>, val focus: Int? = null)
@Serializable internal class MoveCase(val length: Int, val at: Int, val focus: Int? = null, val direction: Int, val expected: OrderResult? = null)
@Serializable internal class RemoveCase(val length: Int, val at: Int, val focus: Int? = null, val expected: OrderResult)
@Serializable internal class StartsRestCase(val autoRest: Boolean, val wasDone: Boolean, val expected: Boolean)
@Serializable internal class ResumeCase(val saved: JsonElement? = null, val expected: RunningRest? = null)
@Serializable internal class LoggerOrderFixtures(
    val now: Long,
    val defaultTarget: Int,
    val move: List<MoveCase>,
    val remove: List<RemoveCase>,
    val startsRest: List<StartsRestCase>,
    val resume: List<ResumeCase>,
)

class LoggerOrderFixturesTest {
    private val fixtures = AppJson.decodeFromString<LoggerOrderFixtures>(LOGGER_ORDER_FIXTURES_JSON)

    private fun OrderResult.toReordered() = Reordered(order, focus)

    @Test
    fun moveMatchesTheMiniApp() {
        assertTrue(fixtures.move.size >= 100)
        for (c in fixtures.move) {
            assertEquals(c.expected?.toReordered(), moveInList(c.length, c.at, c.direction, c.focus), "move ${c.length}/${c.at}/${c.direction}/${c.focus}")
        }
    }

    @Test
    fun removeMatchesTheMiniApp() {
        for (c in fixtures.remove) {
            assertEquals(c.expected.toReordered(), removeFromList(c.length, c.at, c.focus), "remove ${c.length}/${c.at}/${c.focus}")
        }
    }

    @Test
    fun startsRestMatchesTheMiniApp() {
        for (c in fixtures.startsRest) assertEquals(c.expected, startsRest(c.autoRest, c.wasDone))
    }

    @Test
    fun resumeMatchesTheMiniApp() {
        for (c in fixtures.resume) assertEquals(c.expected, resumableRest(c.saved, fixtures.now, fixtures.defaultTarget), "resume ${c.saved}")
    }
}
