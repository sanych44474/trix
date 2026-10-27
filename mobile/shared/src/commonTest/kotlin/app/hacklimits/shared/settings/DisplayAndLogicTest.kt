package app.hacklimits.shared.settings

import app.hacklimits.shared.data.InMemoryKeyValueStore
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DisplayAndLogicTest {
    @Test
    fun unknownStoredValuesFallBackToDefaults() {
        assertEquals(DisplayPrefs(), parseDisplayPrefs(null, null, null))
        assertEquals(DisplayPrefs(), parseDisplayPrefs("purple", "cyan", "0", "sometimes"))
        assertEquals(DisplayPrefs(ThemeMode.DARK, Accent.RED, true), parseDisplayPrefs("dark", "red", "1"))
        assertEquals(DisplayPrefs(accent = Accent.BLUE, reducedMotion = true), parseDisplayPrefs("system", "blue", "0", "1"))
        assertEquals(DisplayPrefs(accent = Accent.VIOLET), parseDisplayPrefs("system", "violet", "0", "0"))
    }

    @Test
    fun highContrastWinsOverTheChosenScheme() {
        assertEquals(ResolvedTheme.CONTRAST, DisplayPrefs(ThemeMode.DARK, highContrast = true).resolvedTheme(systemDark = false))
        assertEquals(ResolvedTheme.LIGHT, DisplayPrefs(ThemeMode.LIGHT).resolvedTheme(systemDark = true))
        assertEquals(ResolvedTheme.DARK, DisplayPrefs(ThemeMode.SYSTEM).resolvedTheme(systemDark = true))
        assertEquals(ResolvedTheme.LIGHT, DisplayPrefs(ThemeMode.SYSTEM).resolvedTheme(systemDark = false))
    }

    @Test
    fun customAccentsDoNotApplyUnderHighContrast() {
        listOf(Accent.RED, Accent.BLUE, Accent.VIOLET).forEach { accent ->
            assertEquals(accent, DisplayPrefs(accent = accent).effectiveAccent())
            assertNull(DisplayPrefs(accent = accent, highContrast = true).effectiveAccent())
        }
        assertNull(DisplayPrefs(accent = Accent.GREEN).effectiveAccent())
    }

    @Test
    fun preferencesSurviveAReload() = runTest {
        val store = InMemoryKeyValueStore()
        val first = DisplayPreferences(store)
        first.update(DisplayPrefs(ThemeMode.DARK, Accent.BLUE, highContrast = true, reducedMotion = true))

        val second = DisplayPreferences(store)
        second.load()
        assertEquals(DisplayPrefs(ThemeMode.DARK, Accent.BLUE, highContrast = true, reducedMotion = true), second.prefs.value)
    }

    @Test
    fun isoDatesAreParsedStrictly() {
        assertEquals(LocalDate(2026, 10, 25), parseIsoDate("2026-10-25"))
        assertNull(parseIsoDate("25.10.2026"))
        assertNull(parseIsoDate("2026-13-01"))
        assertNull(parseIsoDate(""))
    }

    @Test
    fun vacationIsClampedToTheServerRange() {
        val today = LocalDate(2026, 10, 20)
        assertEquals(5, vacationDaysUntil(today, LocalDate(2026, 10, 25)))
        assertEquals(1, vacationDaysUntil(today, LocalDate(2026, 10, 20)))
        assertEquals(1, vacationDaysUntil(today, LocalDate(2025, 1, 1)))
        assertEquals(90, vacationDaysUntil(today, LocalDate(2030, 1, 1)))
    }
}
