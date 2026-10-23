package app.hacklimits.shared.progress.muscle

import app.hacklimits.shared.muscles.MuscleLearning
import kotlinx.serialization.Serializable

// The server's learned classifications (dashboard calendar.learnedMuscles) for exercises the rules miss.

@Serializable data class LearnedMuscles(val name: String, val primary: List<String> = emptyList(), val secondary: List<String> = emptyList())

fun registerLearnedMuscles(entries: List<LearnedMuscles>) {
    for (e in entries) MuscleLearning.remember(e.name, e.primary, e.secondary)
}
