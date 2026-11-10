package app.hacklimits.shared.plan

/**
 * What the plan editor shows for a refused edit. The server answers 409 "injury:<area>" when the
 * new exercise loads an active injury directly (src/features/plan/planEdits.ts); the screen then
 * names the injury instead of "Something went wrong". Same rule as the Mini App's planEditError.ts.
 */
private val INJURY_AREAS = setOf("shoulder", "elbow", "wrist", "lower_back", "knee", "hip", "ankle", "neck")

/** The plan screen's error key for a failed edit: "injury:<area>" or "generic". */
fun planEditErrorKey(message: String?): String {
    if (message == null || !message.startsWith("injury:")) return "generic"
    val area = message.removePrefix("injury:")
    return if (area in INJURY_AREAS) "injury:$area" else "generic"
}
