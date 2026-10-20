package app.hacklimits.shared.workout.ui

import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.wk_muscle_abs
import app.hacklimits.shared.resources.wk_muscle_adductors
import app.hacklimits.shared.resources.wk_muscle_biceps
import app.hacklimits.shared.resources.wk_muscle_calves
import app.hacklimits.shared.resources.wk_muscle_chest
import app.hacklimits.shared.resources.wk_muscle_deltoids
import app.hacklimits.shared.resources.wk_muscle_forearm
import app.hacklimits.shared.resources.wk_muscle_gluteal
import app.hacklimits.shared.resources.wk_muscle_hamstring
import app.hacklimits.shared.resources.wk_muscle_lower_back
import app.hacklimits.shared.resources.wk_muscle_neck
import app.hacklimits.shared.resources.wk_muscle_obliques
import app.hacklimits.shared.resources.wk_muscle_quadriceps
import app.hacklimits.shared.resources.wk_muscle_tibialis
import app.hacklimits.shared.resources.wk_muscle_trapezius
import app.hacklimits.shared.resources.wk_muscle_triceps
import app.hacklimits.shared.resources.wk_muscle_upper_back
import app.hacklimits.shared.workout.logic.Slug
import org.jetbrains.compose.resources.StringResource

/** A number as typed and shown: "82.5", "80" (no trailing ".0"). */
fun fmtNum(n: Double): String = if (n % 1.0 == 0.0) n.toLong().toString() else n.toString()

/** "82.5×5", or "BW×8" for a set without load. */
fun setLabel(weight: Double, reps: Double): String = "${if (weight > 0) fmtNum(weight) else "BW"}×${fmtNum(reps)}"

/** Parses a typed number, accepting a decimal comma. Blank or half-typed input is 0. */
fun parseTyped(raw: String): Double = raw.replace(',', '.').toDoubleOrNull() ?: 0.0

fun muscleRes(slug: Slug): StringResource = when (slug) {
    Slug.ABS -> Res.string.wk_muscle_abs
    Slug.ADDUCTORS -> Res.string.wk_muscle_adductors
    Slug.BICEPS -> Res.string.wk_muscle_biceps
    Slug.CALVES -> Res.string.wk_muscle_calves
    Slug.CHEST -> Res.string.wk_muscle_chest
    Slug.DELTOIDS -> Res.string.wk_muscle_deltoids
    Slug.FOREARM -> Res.string.wk_muscle_forearm
    Slug.GLUTEAL -> Res.string.wk_muscle_gluteal
    Slug.HAMSTRING -> Res.string.wk_muscle_hamstring
    Slug.LOWER_BACK -> Res.string.wk_muscle_lower_back
    Slug.NECK -> Res.string.wk_muscle_neck
    Slug.OBLIQUES -> Res.string.wk_muscle_obliques
    Slug.QUADRICEPS -> Res.string.wk_muscle_quadriceps
    Slug.TIBIALIS -> Res.string.wk_muscle_tibialis
    Slug.TRAPEZIUS -> Res.string.wk_muscle_trapezius
    Slug.TRICEPS -> Res.string.wk_muscle_triceps
    Slug.UPPER_BACK -> Res.string.wk_muscle_upper_back
}

/** The first sentence of the technique note: a cue, not an article. */
fun techniqueCue(technique: String?): String {
    if (technique.isNullOrBlank()) return ""
    val flat = technique.replace(Regex("\\s+"), " ").trim()
    val first = Regex("(?<=[.!?])\\s").split(flat).firstOrNull().orEmpty()
    return if (first.length > 120) first.take(117) + "…" else first
}
