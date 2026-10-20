package app.hacklimits.shared.account

import kotlin.test.Test
import kotlin.test.assertEquals

class StoryCardTest {
    @Test
    fun shareTextListsTheRowsBetweenTitleAndFooter() {
        val card = StoryCardContent(
            eyebrow = "10-13 → 10-19",
            title = "My training week",
            rows = listOf("Workouts" to "3/4", "Streak" to "5 🔥"),
            footer = "Free AI coach in Telegram",
        )
        assertEquals(
            "My training week\n10-13 → 10-19\nWorkouts: 3/4\nStreak: 5 🔥\nFree AI coach in Telegram",
            card.shareText(),
        )
    }

    @Test
    fun blankEyebrowIsLeftOut() {
        val card = StoryCardContent(eyebrow = " ", title = "T", rows = emptyList(), footer = "F")
        assertEquals("T\nF", card.shareText())
    }
}
