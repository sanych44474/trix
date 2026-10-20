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
        assertEquals(DisplayPrefs(ThemeMode.SYSTEM, Accent.GREEN, false), parseDisplayPrefs("purple", "blue", "0"))
        assertEquals(DisplayPrefs(ThemeMode.DARK, Accent.RED, true), parseDisplayPrefs("dark", "red", "1"))
    }

    @Test
    fun highContrastWinsOverTheChosenScheme() {
        assertEquals(ResolvedTheme.CONTRAST, DisplayPrefs(ThemeMode.DARK, highContrast = true).resolvedTheme(systemDark = false))
        assertEquals(ResolvedTheme.LIGHT, DisplayPrefs(ThemeMode.LIGHT).resolvedTheme(systemDark = true))
        assertEquals(ResolvedTheme.DARK, DisplayPrefs(ThemeMode.SYSTEM).resolvedTheme(systemDark = true))
        assertEquals(ResolvedTheme.LIGHT, DisplayPrefs(ThemeMode.SYSTEM).resolvedTheme(systemDark = false))
    }

    @Test
    fun redAccentDoesNotApplyUnderHighContrast() {
        assertEquals(Accent.RED, DisplayPrefs(accent = Accent.RED).effectiveAccent())
        assertNull(DisplayPrefs(accent = Accent.RED, highContrast = true).effectiveAccent())
        assertNull(DisplayPrefs(accent = Accent.GREEN).effectiveAccent())
    }

    @Test
    fun preferencesSurviveAReload() = runTest {
        val store = InMemoryKeyValueStore()
        val first = DisplayPreferences(store)
        first.update(DisplayPrefs(ThemeMode.DARK, Accent.RED, highContrast = true))

        val second = DisplayPreferences(store)
        second.load()
        assertEquals(DisplayPrefs(ThemeMode.DARK, Accent.RED, highContrast = true), second.prefs.value)
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
