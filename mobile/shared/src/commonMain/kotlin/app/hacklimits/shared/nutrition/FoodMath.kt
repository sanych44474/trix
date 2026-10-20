package app.hacklimits.shared.nutrition

/** Progress of a value against its goal, 0..1 (0 when there is no goal). */
fun progressFraction(value: Double, goal: Double?): Float {
    if (goal == null || goal <= 0.0) return 0f
    return (value / goal).coerceIn(0.0, 1.0).toFloat()
}
