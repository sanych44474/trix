package app.hacklimits.shared.plan

/** Longest day label the server keeps (src/domain/dayLabel.ts, DAY_LABEL_MAX). */
const val DAY_LABEL_MAX = 40

/**
 * The rename sheet's group chips: add [group] to a draft label as "A/B", skipping one already in it.
 * Mirrors addGroupToLabel in src/domain/dayLabel.ts; the server still cleans what is saved.
 */
fun addGroupToLabel(draft: String, group: String): String {
    val parts = draft.split("/").map { it.trim() }.filter { it.isNotEmpty() }
    return if (group in parts) draft else (parts + group).joinToString("/")
}
