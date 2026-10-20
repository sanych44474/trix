package app.hacklimits.shared.trainer.business

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class BusinessFormatTest {
    @Test
    fun amountsAreShownAsGivenWithTheServerCurrencyOnly() {
        assertEquals("1500 UAH", formatMoney(1500.0, "UAH"))
        assertEquals("12.5 EUR", formatMoney(12.5, "EUR"))
        // No currency from the server means no currency symbol, rather than a guessed one.
        assertEquals("250", formatMoney(250.0, ""))
    }

    @Test
    fun unreadableStartTimesAreRejected() {
        assertNull(parseLocalStart("tomorrow at six"))
        assertNull(parseLocalStart(""))
    }
}
