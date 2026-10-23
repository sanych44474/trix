package app.hacklimits.shared.onboarding

import app.hacklimits.shared.data.BasicsRequest
import app.hacklimits.shared.data.OnboardingRequest
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import kotlinx.serialization.Serializable
import org.jetbrains.compose.resources.StringResource
import kotlin.math.floor

// The onboarding questionnaire flow (port of apps/mini-app/src/logic/onboardingWizard.ts): one
// question per screen. The questions themselves (order, options, ranges) come from
// GET /api/v2/onboarding/questions; this file maps them to this app's strings and decides which
// steps appear for this person (current lifts only past beginner, sharing only for a client).

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

/** A question's id on the wire (the server's StepId names). */
enum class StepId(val wire: String) {
    SEX("sex"), AGE("age"), HEIGHT("height"), WEIGHT("weight"), GOAL("goal"), LEVEL("level"), LIFTS("lifts"), DAYS("days"),
    DURATION("duration"), EQUIPMENT("equipment"), LIFESTYLE("lifestyle"), SLEEP("sleep"), DIET("diet"), LIMITS("limits"), SHARE("share"),
}

enum class StepKind { CHOICE, NUMBER, LIFTS, DAYS, TEXT }

/** A choice: the server's value and the label to show. */
class Option(val value: String, val label: StringResource)

class NumberSpec(val min: Double, val max: Double, val step: Double, val unit: StringResource, val placeholder: String)

class Step(
    val id: StepId,
    val question: StringResource,
    val kind: StepKind,
    val hint: StringResource?,
    val options: List<Option>,
    val number: NumberSpec?,
    /** "always" | "nonBeginner" | "trainerClient" (see [stepsFor]). */
    val showWhen: String,
    /** One of the four body-data questions asked before a ready program. */
    val basics: Boolean,
)

// The question set as the server sends it. Labels are keys of the Mini App catalog.
@Serializable data class QuestionsResponse(val questions: List<QuestionDto>)
@Serializable data class QuestionDto(
    val id: String,
    val kind: String,
    val q: String,
    val hint: String? = null,
    val options: List<OptionDto> = emptyList(),
    val number: NumberDto? = null,
    val showWhen: String,
    val basics: Boolean = false,
)
@Serializable data class OptionDto(val value: String, val label: String)
@Serializable data class NumberDto(val min: Double, val max: Double, val step: Double, val unit: String, val placeholder: String)

/** This app's string for each catalog key the server uses. */
private val LABELS: Map<String, StringResource> = mapOf(
    "obq_sex" to Res.string.ob_obq_sex, "obq_age" to Res.string.ob_obq_age, "obq_height" to Res.string.ob_obq_height,
    "obq_weight" to Res.string.ob_obq_weight, "obq_goal" to Res.string.ob_obq_goal, "obq_level" to Res.string.ob_obq_level,
    "obq_lifts" to Res.string.ob_obq_lifts, "obq_days" to Res.string.ob_obq_days, "obq_duration" to Res.string.ob_obq_duration,
    "obq_equipment" to Res.string.ob_obq_equipment, "obq_lifestyle" to Res.string.ob_obq_lifestyle, "obq_sleep" to Res.string.ob_obq_sleep,
    "obq_diet" to Res.string.ob_obq_diet, "obq_limits" to Res.string.ob_obq_limits, "obq_share" to Res.string.ob_obq_share,
    "obh_level" to Res.string.ob_obh_level, "ob_lifts_hint" to Res.string.ob_lifts_hint, "obh_days" to Res.string.ob_obh_days,
    "obh_limits" to Res.string.ob_obh_limits, "obh_share" to Res.string.ob_obh_share,
    "obu_years" to Res.string.ob_obu_years, "obu_cm" to Res.string.ob_obu_cm, "obu_kg" to Res.string.ob_obu_kg,
    "sex_male" to Res.string.ob_sex_male, "sex_female" to Res.string.ob_sex_female,
    "goal_fat_loss" to Res.string.ob_goal_fat_loss, "goal_muscle_gain" to Res.string.ob_goal_muscle_gain,
    "goal_recomposition" to Res.string.ob_goal_recomposition, "goal_strength" to Res.string.ob_goal_strength,
    "goal_endurance" to Res.string.ob_goal_endurance,
    "level_beginner" to Res.string.ob_level_beginner, "level_intermediate" to Res.string.ob_level_intermediate,
    "level_advanced" to Res.string.ob_level_advanced,
    "obo_min_30" to Res.string.ob_obo_min_30, "obo_min_45" to Res.string.ob_obo_min_45,
    "obo_min_60" to Res.string.ob_obo_min_60, "obo_min_90" to Res.string.ob_obo_min_90,
    "equip_full_gym" to Res.string.ob_equip_full_gym, "equip_home_basics" to Res.string.ob_equip_home_basics,
    "equip_dumbbells_only" to Res.string.ob_equip_dumbbells_only, "equip_bodyweight_only" to Res.string.ob_equip_bodyweight_only,
    "obo_life_sedentary" to Res.string.ob_obo_life_sedentary, "obo_life_moderate" to Res.string.ob_obo_life_moderate,
    "obo_life_active" to Res.string.ob_obo_life_active,
    "obo_sleep_morning" to Res.string.ob_obo_sleep_morning, "obo_sleep_evening" to Res.string.ob_obo_sleep_evening,
    "diet_everything" to Res.string.ob_diet_everything, "diet_vegetarian" to Res.string.ob_diet_vegetarian,
    "diet_vegan" to Res.string.ob_diet_vegan,
    "obo_share_both" to Res.string.ob_obo_share_both, "obo_share_body" to Res.string.ob_obo_share_body,
    "obo_share_health" to Res.string.ob_obo_share_health, "obo_share_none" to Res.string.ob_obo_share_none,
)

/**
 * The server's questions as steps. Null when a question, option or label is unknown to this app
 * (the server is newer than the app): the wizard then fails to load instead of asking half a form.
 */
fun stepsFrom(questions: List<QuestionDto>): List<Step>? = questions.map { d ->
    val id = StepId.entries.firstOrNull { it.wire == d.id } ?: return null
    val kind = StepKind.entries.firstOrNull { it.name.equals(d.kind, ignoreCase = true) } ?: return null
    Step(
        id = id,
        question = LABELS[d.q] ?: return null,
        kind = kind,
        hint = d.hint?.let { LABELS[it] ?: return null },
        options = d.options.map { o -> Option(o.value, LABELS[o.label] ?: return null) },
        number = d.number?.let { n -> NumberSpec(n.min, n.max, n.step, LABELS[n.unit] ?: return null, n.placeholder) },
        showWhen = d.showWhen,
        basics = d.basics,
    )
}

/** The steps for this person, in order. Lifts appear only past beginner; sharing only for a client. */
fun stepsFor(all: List<Step>, answers: Answers, isClient: Boolean): List<Step> = all.filter {
    when (it.showWhen) {
        "nonBeginner" -> answers.level != null && answers.level != "beginner"
        "trainerClient" -> isClient
        else -> true
    }
}

/** The body-data questions asked before a ready program is applied (the no-questionnaire entry). */
fun basicSteps(all: List<Step>): List<Step> = all.filter { it.basics }

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
fun firstOpenStep(all: List<Step>, a: Answers, isClient: Boolean): Int {
    val steps = stepsFor(all, a, isClient)
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
fun toRequest(all: List<Step>, a: Answers, isClient: Boolean, timezone: String?): OnboardingRequest? {
    if (!stepsFor(all, a, isClient).all { isAnswered(it, a) }) return null
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
fun basicsRequest(all: List<Step>, a: Answers): BasicsRequest? {
    if (!basicSteps(all).all { isAnswered(it, a) }) return null
    return BasicsRequest(sex = a.sex!!, age = a.age!!, heightCm = a.heightCm!!, weightKg = round1(a.weightKg!!))
}
