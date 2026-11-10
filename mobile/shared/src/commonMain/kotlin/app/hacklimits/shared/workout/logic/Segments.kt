package app.hacklimits.shared.workout.logic

/** One segment of the progress bar above the focused exercise. */
data class SegmentLook(val progress: Progress, val current: Boolean) {
    enum class Progress { COMPLETE, STARTED, TODO }
}

/**
 * How a segment looks. Progress (complete / started / to do) sets the colour; "current" is a
 * separate mark drawn on top. They used to share one colour slot, with "complete" winning, so
 * going back to a finished exercise left every finished segment the same green and nothing said
 * which one was open.
 */
fun segmentLook(index: Int, at: Int, complete: Boolean, filledSets: Int): SegmentLook = SegmentLook(
    progress = when {
        complete -> SegmentLook.Progress.COMPLETE
        filledSets > 0 -> SegmentLook.Progress.STARTED
        else -> SegmentLook.Progress.TODO
    },
    current = index == at,
)
