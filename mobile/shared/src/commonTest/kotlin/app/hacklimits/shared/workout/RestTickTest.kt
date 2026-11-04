package app.hacklimits.shared.workout

import app.hacklimits.shared.workout.logic.REST_OVERRUN_CAP_SEC
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotSame
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** The logger's state changes on a rest's phase changes only, so its flow doesn't emit every second. */
class RestTickTest {
    private val endAt = 1_000_000L
    private val counting = RestUi(endAtMs = endAt, left = 90, target = 90, label = "Bench")

    @Test
    fun ticksInsideTheCountdownKeepTheSameState() {
        for (now in listOf(endAt - 89_500, endAt - 60_000, endAt - 1_000, endAt - 1)) {
            assertSame(counting, nextRestUi(counting, endAt, now))
        }
    }

    @Test
    fun countdownToOverIsOneChangeThenStable() {
        val over = nextRestUi(counting, endAt, endAt + 500)
        assertNotSame(counting, over)
        assertTrue(over.done)
        assertEquals(0, over.left)
        assertSame(over, nextRestUi(over, endAt, endAt + 30_000))
    }

    @Test
    fun pastTheOverrunCapTheRestCloses() {
        val over = nextRestUi(counting, endAt, endAt + 500)
        val closed = nextRestUi(over, endAt, endAt + REST_OVERRUN_CAP_SEC * 1000L)
        assertNull(closed.endAtMs)
        assertEquals(90, closed.target)
    }

    @Test
    fun aTickFromAnOlderRestChangesNothing() {
        assertSame(counting, nextRestUi(counting, endAt + 5, endAt + 10))
    }
}
