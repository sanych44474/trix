package app.hacklimits.shared.trainer.clients

// The trainer's "log a client's workout" form (ADR-0018), as plain data: what it starts from, how a
// voice proposal lands in it, how a typed cell changes it and what is sent on save. Pure, so
// TrainerLogLogicTest covers it without a screen. Mirrors apps/mini-app/src/logic/trainerLog.ts.

/** One row of the form. Text, because that is what the fields hold while the trainer types. */
data class FormSet(val weight: String = "", val reps: String = "", val seconds: String = "", val meters: String = "")

data class FormExercise(
    val name: String,
    /** "reps", "time" or "distance": which fields the rows show. */
    val metric: String = "reps",
    val rows: List<FormSet> = listOf(FormSet()),
    /** The plan exercise this one stands in for, sent back as planName. */
    val planName: String? = null,
    val rpe: Double? = null,
    /** The plan's numbers, shown as placeholders (never pre-filled as if done). */
    val hintWeight: String = "",
    val hintReps: String = "",
)

private fun num(v: Double): String = if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()
private fun numOrBlank(v: Double): String = if (v > 0) num(v) else ""

/** The form for a day: the saved log when there is one, else the plan with one empty row per set. */
fun formFromDay(day: TrainerLogDay): List<FormExercise> {
    val saved = day.saved.orEmpty()
    if (saved.isNotEmpty()) {
        return saved.map { e ->
            val metric = when {
                e.sets.any { it.m > 0 } -> "distance"
                e.sets.any { it.sec > 0 } && e.sets.all { it.r <= 0 } -> "time"
                else -> "reps"
            }
            FormExercise(
                name = e.name,
                metric = metric,
                rows = e.sets.map { FormSet(numOrBlank(it.w), numOrBlank(it.r), numOrBlank(it.sec), numOrBlank(it.m)) }.ifEmpty { listOf(FormSet()) },
                planName = e.planName,
                rpe = e.rpe,
            )
        }
    }
    return day.exercises.map { e ->
        FormExercise(
            name = e.name,
            metric = e.metric,
            rows = List(e.sets.coerceAtLeast(1)) { FormSet() },
            hintWeight = e.weightKg?.let(::numOrBlank).orEmpty(),
            hintReps = e.reps?.let(::numOrBlank).orEmpty(),
        )
    }
}

private fun same(a: String, b: String) = a.trim().equals(b.trim(), ignoreCase = true)

/** A voice proposal into the form: an exercise already there (by name, or the plan name it stands in
 * for) gets the spoken sets in place of its own; a new one is added at the end. */
fun mergeProposal(form: List<FormExercise>, entries: List<TrainerLogEntry>): List<FormExercise> {
    val out = form.toMutableList()
    for (entry in entries) {
        if (entry.sets.isEmpty()) continue
        val rows = entry.sets.map { s ->
            FormSet(numOrBlank(s.weight), if (s.reps > 0) s.reps.toString() else "", s.seconds?.toString().orEmpty(), s.meters?.toString().orEmpty())
        }
        val metric = when {
            entry.sets.any { (it.meters ?: 0) > 0 } -> "distance"
            entry.sets.any { (it.seconds ?: 0) > 0 } && entry.sets.all { it.reps <= 0 } -> "time"
            else -> "reps"
        }
        val at = out.indexOfFirst { same(it.name, entry.name) || (it.planName != null && same(it.planName, entry.name)) }
        if (at >= 0) out[at] = out[at].copy(rows = rows, rpe = entry.rpe ?: out[at].rpe)
        else out += FormExercise(name = entry.name, metric = metric, rows = rows, rpe = entry.rpe)
    }
    return out
}

/** Change one cell; only digits and one decimal point are kept. */
fun editCell(form: List<FormExercise>, exercise: Int, row: Int, field: String, value: String): List<FormExercise> {
    val clean = value.filter { it.isDigit() || it == '.' || it == ',' }.replace(',', '.').take(7)
    return form.mapIndexed { i, e ->
        if (i != exercise) e
        else e.copy(rows = e.rows.mapIndexed { r, s ->
            if (r != row) s
            else when (field) {
                "weight" -> s.copy(weight = clean)
                "reps" -> s.copy(reps = clean.substringBefore('.'))
                "seconds" -> s.copy(seconds = clean.substringBefore('.'))
                else -> s.copy(meters = clean.substringBefore('.'))
            }
        })
    }
}

fun addRow(form: List<FormExercise>, exercise: Int): List<FormExercise> =
    form.mapIndexed { i, e -> if (i == exercise && e.rows.size < 20) e.copy(rows = e.rows + FormSet()) else e }

fun addExercise(form: List<FormExercise>, name: String): List<FormExercise> {
    val clean = name.trim().take(80)
    if (clean.isEmpty() || form.any { same(it.name, clean) } || form.size >= 30) return form
    return form + FormExercise(name = clean)
}

/** The save body: only filled sets, only exercises that have one. */
fun formEntries(form: List<FormExercise>): List<TrainerLogEntry> = form.mapNotNull { e ->
    val sets = e.rows.mapNotNull { s ->
        val reps = s.reps.toIntOrNull() ?: 0
        val seconds = s.seconds.toIntOrNull()?.takeIf { it > 0 }
        val meters = s.meters.toIntOrNull()?.takeIf { it > 0 }
        if (reps <= 0 && seconds == null && meters == null) null
        else TrainerLogSet(weight = s.weight.toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0, reps = reps.coerceAtLeast(0), seconds = seconds, meters = meters)
    }
    if (sets.isEmpty()) null else TrainerLogEntry(e.name, sets, e.rpe, e.planName?.takeIf { it != e.name })
}

/** The plan editor's action for a proposal action ("delete" is "del" there); null when it cannot apply it. */
fun planActionFor(kind: String): String? = when (kind) {
    "weight" -> "weight"
    "sets" -> "sets"
    "delete" -> "del"
    "swap" -> "swap"
    "add" -> "add"
    else -> null
}
