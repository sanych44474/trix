package app.hacklimits.shared.onboarding

import app.hacklimits.shared.data.BasicsRequest
import app.hacklimits.shared.data.OnboardingRequest
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import kotlinx.serialization.Serializable
import org.jetbrains.compose.resources.StringResource
import kotlin.math.floor

// The onboarding questionnaire as data (port of apps/mini-app/src/logic/onboardingWizard.ts): one
// question per screen. Which steps appear depends on the answers so far (current lifts only past
// beginner) and on the role (a trainer's client is also asked what the trainer may see).

@Serializable data class Lifts(val bench: Int? = null, val squat: Int? = null, val deadlift: Int? = null)

/** The questionnaire answers, also the draft kept on the server. Values are the server's option ids. */
@Serializable
data class Answers(
    val sex: String? = null,
    val age: Int? = null,
    val heightCm: Int? = null,
    val weightKg: Double? = null,
    val goal: String? = null,
    val level: String? = null,
    val lifts: Lifts? = null,
    val trainingWeekdays: List<Int> = emptyList(),
    val sessionMinutes: Int? = null,
    val equipment: String? = null,
    val lifestyle: String? = null,
    val sleepSchedule: String? = null,
    val dietPrefs: String? = null,
    val limitations: String? = null,
    /** Trainer clients only: both | body | health | none. */
    val share: String? = null,
)

enum class StepId {
    SEX, AGE, HEIGHT, WEIGHT, GOAL, LEVEL, LIFTS, DAYS, DURATION, EQUIPMENT, LIFESTYLE, SLEEP, DIET, LIMITS, SHARE,
}

enum class StepKind { CHOICE, NUMBER, LIFTS, DAYS, TEXT }

/** A choice: the server's value and the label to show. */
class Option(val value: String, val label: StringResource)

class NumberSpec(val min: Double, val max: Double, val step: Double, val unit: StringResource, val placeholder: String)

class Step(
    val id: StepId,
    val question: StringResource,
    val kind: StepKind,
    val hint: StringResource? = null,
    val options: List<Option> = emptyList(),
    val number: NumberSpec? = null,
)

private val SEX_OPTIONS = listOf(Option("male", Res.string.ob_sex_male), Option("female", Res.string.ob_sex_female))
private val LEVEL_OPTIONS = listOf(
    Option("beginner", Res.string.ob_level_beginner),
    Option("intermediate", Res.string.ob_level_intermediate),
    Option("advanced", Res.string.ob_level_advanced),
)

private val STEPS: Map<StepId, Step> = mapOf(
    StepId.SEX to Step(StepId.SEX, Res.string.ob_obq_sex, StepKind.CHOICE, options = SEX_OPTIONS),
    StepId.AGE to Step(StepId.AGE, Res.string.ob_obq_age, StepKind.NUMBER, number = NumberSpec(13.0, 100.0, 1.0, Res.string.ob_obu_years, "30")),
    StepId.HEIGHT to Step(StepId.HEIGHT, Res.string.ob_obq_height, StepKind.NUMBER, number = NumberSpec(100.0, 250.0, 1.0, Res.string.ob_obu_cm, "175")),
    StepId.WEIGHT to Step(StepId.WEIGHT, Res.string.ob_obq_weight, StepKind.NUMBER, number = NumberSpec(30.0, 300.0, 0.1, Res.string.ob_obu_kg, "75")),
    StepId.GOAL to Step(
        StepId.GOAL, Res.string.ob_obq_goal, StepKind.CHOICE,
        options = listOf(
            Option("fat loss", Res.string.ob_goal_fat_loss),
            Option("muscle gain", Res.string.ob_goal_muscle_gain),
            Option("recomposition", Res.string.ob_goal_recomposition),
            Option("strength", Res.string.ob_goal_strength),
            Option("endurance", Res.string.ob_goal_endurance),
        ),
    ),
    StepId.LEVEL to Step(StepId.LEVEL, Res.string.ob_obq_level, StepKind.CHOICE, hint = Res.string.ob_obh_level, options = LEVEL_OPTIONS),
    StepId.LIFTS to Step(StepId.LIFTS, Res.string.ob_obq_lifts, StepKind.LIFTS, hint = Res.string.ob_lifts_hint),
    StepId.DAYS to Step(StepId.DAYS, Res.string.ob_obq_days, StepKind.DAYS, hint = Res.string.ob_obh_days),
    StepId.DURATION to Step(
        StepId.DURATION, Res.string.ob_obq_duration, StepKind.CHOICE,
        options = listOf(
            Option("30", Res.string.ob_obo_min_30),
            Option("45", Res.string.ob_obo_min_45),
            Option("60", Res.string.ob_obo_min_60),
            Option("90", Res.string.ob_obo_min_90),
        ),
    ),
    StepId.EQUIPMENT to Step(
        StepId.EQUIPMENT, Res.string.ob_obq_equipment, StepKind.CHOICE,
        options = listOf(
            Option("full gym", Res.string.ob_equip_full_gym),
            Option("home basics (dumbbells, bands)", Res.string.ob_equip_home_basics),
            Option("dumbbells only", Res.string.ob_equip_dumbbells_only),
            Option("bodyweight only", Res.string.ob_equip_bodyweight_only),
        ),
    ),
    StepId.LIFESTYLE to Step(
        StepId.LIFESTYLE, Res.string.ob_obq_lifestyle, StepKind.CHOICE,
        options = listOf(
            Option("sedentary", Res.string.ob_obo_life_sedentary),
            Option("moderate", Res.string.ob_obo_life_moderate),
            Option("active", Res.string.ob_obo_life_active),
        ),
    ),
    StepId.SLEEP to Step(
        StepId.SLEEP, Res.string.ob_obq_sleep, StepKind.CHOICE,
        options = listOf(Option("morning", Res.string.ob_obo_sleep_morning), Option("evening", Res.string.ob_obo_sleep_evening)),
    ),
    StepId.DIET to Step(
        StepId.DIET, Res.string.ob_obq_diet, StepKind.CHOICE,
        options = listOf(
            Option("none", Res.string.ob_diet_everything),
            Option("vegetarian", Res.string.ob_diet_vegetarian),
            Option("vegan", Res.string.ob_diet_vegan),
        ),
    ),
    StepId.LIMITS to Step(StepId.LIMITS, Res.string.ob_obq_limits, StepKind.TEXT, hint = Res.string.ob_obh_limits),
    StepId.SHARE to Step(
        StepId.SHARE, Res.string.ob_obq_share, StepKind.CHOICE, hint = Res.string.ob_obh_share,
        options = listOf(
            Option("both", Res.string.ob_obo_share_both),
            Option("body", Res.string.ob_obo_share_body),
            Option("health", Res.string.ob_obo_share_health),
            Option("none", Res.string.ob_obo_share_none),
        ),
    ),
)

/** The steps for this person, in order. Lifts appear only past beginner; sharing only for a client. */
fun stepsFor(answers: Answers, isClient: Boolean): List<Step> {
    val ids = mutableListOf(StepId.SEX, StepId.AGE, StepId.HEIGHT, StepId.WEIGHT, StepId.GOAL, StepId.LEVEL)
    if (answers.level != null && answers.level != "beginner") ids += StepId.LIFTS
    ids += listOf(StepId.DAYS, StepId.DURATION, StepId.EQUIPMENT, StepId.LIFESTYLE, StepId.SLEEP, StepId.DIET, StepId.LIMITS)
    if (isClient) ids += StepId.SHARE
    return ids.map { STEPS.getValue(it) }
}

/** The body-data questions asked before a ready program is applied (the no-questionnaire entry). */
fun basicSteps(): List<Step> = listOf(StepId.SEX, StepId.AGE, StepId.HEIGHT, StepId.WEIGHT).map { STEPS.getValue(it) }

/** Whether the step has a valid answer (the Next button and the final submit both use this). */
fun isAnswered(step: Step, a: Answers): Boolean {
    fun inRange(v: Double?): Boolean {
        val n = step.number ?: return v != null
        return v != null && v >= n.min && v <= n.max
    }
    return when (step.id) {
        StepId.SEX -> a.sex != null
        StepId.AGE -> inRange(a.age?.toDouble())
        StepId.HEIGHT -> inRange(a.heightCm?.toDouble())
        StepId.WEIGHT -> inRange(a.weightKg)
        StepId.GOAL -> a.goal != null
        StepId.LEVEL -> a.level != null
        StepId.LIFTS -> true // optional: an empty answer means "start from technique weights"
        StepId.DAYS -> a.trainingWeekdays.isNotEmpty()
        StepId.DURATION -> a.sessionMinutes != null
        StepId.EQUIPMENT -> a.equipment != null
        StepId.LIFESTYLE -> a.lifestyle != null
        StepId.SLEEP -> a.sleepSchedule != null
        StepId.DIET -> a.dietPrefs != null
        StepId.LIMITS -> a.limitations != null
        StepId.SHARE -> a.share != null
    }
}

/** Applies a choice-step answer. */
fun choose(step: Step, a: Answers, value: String): Answers = when (step.id) {
    StepId.SEX -> a.copy(sex = value)
    StepId.GOAL -> a.copy(goal = value)
    StepId.LEVEL -> a.copy(level = value, lifts = if (value == "beginner") null else a.lifts)
    StepId.DURATION -> a.copy(sessionMinutes = value.toIntOrNull())
    StepId.EQUIPMENT -> a.copy(equipment = value)
    StepId.LIFESTYLE -> a.copy(lifestyle = value)
    StepId.SLEEP -> a.copy(sleepSchedule = value)
    StepId.DIET -> a.copy(dietPrefs = value)
    StepId.SHARE -> a.copy(share = value)
    else -> a
}

/** The currently chosen value of a choice step (to highlight it when coming back). */
fun chosen(step: Step, a: Answers): String? = when (step.id) {
    StepId.SEX -> a.sex
    StepId.GOAL -> a.goal
    StepId.LEVEL -> a.level
    StepId.DURATION -> a.sessionMinutes?.toString()
    StepId.EQUIPMENT -> a.equipment
    StepId.LIFESTYLE -> a.lifestyle
    StepId.SLEEP -> a.sleepSchedule
    StepId.DIET -> a.dietPrefs
    StepId.SHARE -> a.share
    else -> null
}

/** Index of the first unanswered step (where a resumed draft continues). */
fun firstOpenStep(a: Answers, isClient: Boolean): Int {
    val steps = stepsFor(a, isClient)
    val i = steps.indexOfFirst { !isAnswered(it, a) }
    return if (i == -1) steps.size - 1 else i
}

/** "bench 100kg, squat 120kg", or "none" when no lift was entered. */
private fun liftsText(l: Lifts?): String {
    val parts = listOfNotNull(
        l?.bench?.takeIf { it > 0 }?.let { "bench ${it}kg" },
        l?.squat?.takeIf { it > 0 }?.let { "squat ${it}kg" },
        l?.deadlift?.takeIf { it > 0 }?.let { "deadlift ${it}kg" },
    )
    return if (parts.isEmpty()) "none" else parts.joinToString(", ")
}

private fun round1(x: Double): Double = floor(x * 10 + 0.5) / 10

/** The submit body; null while a required answer is missing. */
fun toRequest(a: Answers, isClient: Boolean, timezone: String?): OnboardingRequest? {
    if (!stepsFor(a, isClient).all { isAnswered(it, a) }) return null
    val share = a.share
    return OnboardingRequest(
        sex = a.sex!!,
        age = a.age!!,
        heightCm = a.heightCm!!,
        weightKg = round1(a.weightKg!!),
        goal = a.goal!!,
        level = a.level!!,
        equipment = a.equipment!!,
        dietPrefs = a.dietPrefs!!,
        trainingWeekdays = a.trainingWeekdays.sorted(),
        limitations = a.limitations!!.trim().ifEmpty { "none" },
        baselineLifts = if (a.level == "beginner") "none" else liftsText(a.lifts),
        sessionMinutes = a.sessionMinutes!!,
        lifestyle = a.lifestyle!!,
        sleepSchedule = a.sleepSchedule!!,
        timezone = timezone,
        share = if (isClient) OnboardingRequest.Share(body = share == "both" || share == "body", health = share == "both" || share == "health") else null,
    )
}

/** The basics for a ready program; null while one is missing. */
fun basicsRequest(a: Answers): BasicsRequest? {
    if (!basicSteps().all { isAnswered(it, a) }) return null
    return BasicsRequest(sex = a.sex!!, age = a.age!!, heightCm = a.heightCm!!, weightKg = round1(a.weightKg!!))
}
