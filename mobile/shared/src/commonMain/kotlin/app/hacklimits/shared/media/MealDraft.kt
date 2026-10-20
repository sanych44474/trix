package app.hacklimits.shared.media

import kotlin.math.roundToInt

/** The server takes at most 12 items per add_items call and silently drops the rest. */
internal const val MAX_MEAL_ITEMS = 12
private const val MAX_GRAMS = 3000.0

/**
 * One estimated item the person can correct. The estimate's macros belong to its own portion, so
 * editing the grams scales them in proportion; without a portion in the estimate they stay as is.
 */
internal data class DraftItem(val estimate: LoggedFood, val gramsText: String) {
    fun toLogged(): LoggedFood {
        val grams = gramsText.toDoubleOrNull()
        val portion = estimate.grams
        val ratio = if (grams != null && portion != null && portion > 0) grams / portion else 1.0
        return LoggedFood(
            desc = estimate.desc,
            kcal = (estimate.kcal * ratio).roundTenth(),
            protein = (estimate.protein * ratio).roundTenth(),
            fats = (estimate.fats * ratio).roundTenth(),
            carbs = (estimate.carbs * ratio).roundTenth(),
            grams = grams,
            query = estimate.query,
        )
    }
}

/** Blank is allowed (the estimate's own macros are used); anything typed must be a real portion. */
internal fun isValidGrams(text: String): Boolean =
    text.isBlank() || text.toDoubleOrNull()?.let { it >= 1.0 && it <= MAX_GRAMS } == true

internal fun formatGrams(grams: Double): String =
    if (grams % 1.0 == 0.0) grams.toInt().toString() else grams.toString()

private fun Double.roundTenth(): Double = (this * 10).roundToInt() / 10.0
