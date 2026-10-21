package app.hacklimits.shared.progress.ui

import androidx.compose.runtime.Composable
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.pr_measure_key_arm
import app.hacklimits.shared.resources.pr_measure_key_chest
import app.hacklimits.shared.resources.pr_measure_key_hips
import app.hacklimits.shared.resources.pr_measure_key_neck
import app.hacklimits.shared.resources.pr_measure_key_thigh
import app.hacklimits.shared.resources.pr_measure_key_waist
import app.hacklimits.shared.resources.pr_mg_arms
import app.hacklimits.shared.resources.pr_mg_back
import app.hacklimits.shared.resources.pr_mg_chest
import app.hacklimits.shared.resources.pr_mg_core
import app.hacklimits.shared.resources.pr_mg_legs
import app.hacklimits.shared.resources.pr_mg_shoulders
import app.hacklimits.shared.resources.pr_muscle_abs
import app.hacklimits.shared.resources.pr_muscle_adductors
import app.hacklimits.shared.resources.pr_muscle_biceps
import app.hacklimits.shared.resources.pr_muscle_calves
import app.hacklimits.shared.resources.pr_muscle_chest
import app.hacklimits.shared.resources.pr_muscle_deltoids
import app.hacklimits.shared.resources.pr_muscle_forearm
import app.hacklimits.shared.resources.pr_muscle_gluteal
import app.hacklimits.shared.resources.pr_muscle_hamstring
import app.hacklimits.shared.resources.pr_muscle_lower_back
import app.hacklimits.shared.resources.pr_muscle_neck
import app.hacklimits.shared.resources.pr_muscle_obliques
import app.hacklimits.shared.resources.pr_muscle_quadriceps
import app.hacklimits.shared.resources.pr_muscle_tibialis
import app.hacklimits.shared.resources.pr_muscle_trapezius
import app.hacklimits.shared.resources.pr_muscle_triceps
import app.hacklimits.shared.resources.pr_muscle_upper_back
import app.hacklimits.shared.resources.pr_weekday_fri
import app.hacklimits.shared.resources.pr_weekday_mon
import app.hacklimits.shared.resources.pr_weekday_sat
import app.hacklimits.shared.resources.pr_weekday_sun
import app.hacklimits.shared.resources.pr_weekday_thu
import app.hacklimits.shared.resources.pr_weekday_tue
import app.hacklimits.shared.resources.pr_weekday_wed
import app.hacklimits.shared.resources.pr_zone_above
import app.hacklimits.shared.resources.pr_zone_below
import app.hacklimits.shared.resources.pr_zone_optimal
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

// Localised names for the codes the Progress screen gets from the server or computes locally.

private fun muscleRes(slug: String): StringResource? = when (slug) {
    "abs" -> Res.string.pr_muscle_abs
    "adductors" -> Res.string.pr_muscle_adductors
    "biceps" -> Res.string.pr_muscle_biceps
    "calves" -> Res.string.pr_muscle_calves
    "chest" -> Res.string.pr_muscle_chest
    "deltoids" -> Res.string.pr_muscle_deltoids
    "forearm" -> Res.string.pr_muscle_forearm
    "gluteal" -> Res.string.pr_muscle_gluteal
    "hamstring" -> Res.string.pr_muscle_hamstring
    "lower-back" -> Res.string.pr_muscle_lower_back
    "neck" -> Res.string.pr_muscle_neck
    "obliques" -> Res.string.pr_muscle_obliques
    "quadriceps" -> Res.string.pr_muscle_quadriceps
    "tibialis" -> Res.string.pr_muscle_tibialis
    "trapezius" -> Res.string.pr_muscle_trapezius
    "triceps" -> Res.string.pr_muscle_triceps
    "upper-back" -> Res.string.pr_muscle_upper_back
    else -> null
}

@Composable
fun muscleLabel(slug: String): String = muscleRes(slug)?.let { stringResource(it) } ?: slug

@Composable
fun groupLabel(group: String): String = stringResource(
    when (group) {
        "legs" -> Res.string.pr_mg_legs
        "back" -> Res.string.pr_mg_back
        "chest" -> Res.string.pr_mg_chest
        "shoulders" -> Res.string.pr_mg_shoulders
        "arms" -> Res.string.pr_mg_arms
        else -> Res.string.pr_mg_core
    },
)

@Composable
fun zoneLabel(zone: String): String = stringResource(
    when (zone) {
        "below" -> Res.string.pr_zone_below
        "optimal" -> Res.string.pr_zone_optimal
        else -> Res.string.pr_zone_above
    },
)

@Composable
fun measureLabel(key: String): String = stringResource(
    when (key) {
        "waist" -> Res.string.pr_measure_key_waist
        "chest" -> Res.string.pr_measure_key_chest
        "hips" -> Res.string.pr_measure_key_hips
        "arm" -> Res.string.pr_measure_key_arm
        "thigh" -> Res.string.pr_measure_key_thigh
        else -> Res.string.pr_measure_key_neck
    },
)

/** ISO weekday 1 (Monday) to 7 (Sunday). */
@Composable
fun weekdayLabel(weekday: Int): String = stringResource(
    when (weekday) {
        1 -> Res.string.pr_weekday_mon
        2 -> Res.string.pr_weekday_tue
        3 -> Res.string.pr_weekday_wed
        4 -> Res.string.pr_weekday_thu
        5 -> Res.string.pr_weekday_fri
        6 -> Res.string.pr_weekday_sat
        else -> Res.string.pr_weekday_sun
    },
)
