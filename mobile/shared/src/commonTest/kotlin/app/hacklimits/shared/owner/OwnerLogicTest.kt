package app.hacklimits.shared.owner

import kotlinx.datetime.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class OwnerLogicTest {
    private val now = Instant.parse("2026-10-20T12:00:00Z")

    private fun user(id: Long, status: String = "active", lastSeen: String?) = OwnerUser(id = id, name = "u$id", status = status, lastSeen = lastSeen)

    @Test
    fun seenLabelCountsCalendarDaysInUtc() {
        assertEquals(SeenKind.NEVER, seenLabel(null, now).kind)
        assertEquals(SeenKind.TODAY, seenLabel("2026-10-20T00:01:00Z", now).kind)
        assertEquals(SeenKind.YESTERDAY, seenLabel("2026-10-19T23:59:00Z", now).kind)
        val five = seenLabel("2026-10-15T12:00:00Z", now)
        assertEquals(SeenKind.DAYS, five.kind)
        assertEquals(5, five.days)
        val old = seenLabel("2026-08-01T10:00:00Z", now)
        assertEquals(SeenKind.DATE, old.kind)
        assertEquals("2026-08-01", old.date)
    }

    @Test
    fun aMalformedTimestampReadsAsNever() {
        assertEquals(SeenKind.NEVER, seenLabel("yesterday-ish", now).kind)
    }

    @Test
    fun idleMeansSevenPlusDaysOrNeverSeen() {
        assertTrue(isIdle(user(1, lastSeen = null), now))
        assertTrue(isIdle(user(2, lastSeen = "2026-10-12T12:00:00Z"), now))
        assertFalse(isIdle(user(3, lastSeen = "2026-10-14T12:00:00Z"), now))
        assertTrue(isIdle(user(4, lastSeen = "2026-07-01T12:00:00Z"), now))
    }

    @Test
    fun rosterFiltersAndSortsMostRecentFirstWithNeverSeenLast() {
        val users = listOf(
            user(1, status = "onboarding", lastSeen = "2026-10-20T09:00:00Z"),
            user(2, status = "active", lastSeen = "2026-10-19T09:00:00Z"),
            user(3, status = "active", lastSeen = null),
            user(4, status = "active", lastSeen = "2026-10-01T09:00:00Z"),
        )
        assertEquals(listOf(1L, 2L, 4L, 3L), rosterRows(users, RosterFilter.ALL, now).map { it.id })
        assertEquals(listOf(1L), rosterRows(users, RosterFilter.ONBOARDING, now).map { it.id })
        assertEquals(listOf(2L), rosterRows(users, RosterFilter.ACTIVE, now).map { it.id })
        assertEquals(listOf(4L, 3L), rosterRows(users, RosterFilter.IDLE, now).map { it.id })
    }

    @Test
    fun plainReportStripsTagsAndDecodesTheTwoEntities() {
        assertEquals(" Users :42 &more", plainReport("<b>Users</b>:42&nbsp;&amp;more"))
        assertEquals("a & b", plainReport("a &amp; b"))
    }
}
