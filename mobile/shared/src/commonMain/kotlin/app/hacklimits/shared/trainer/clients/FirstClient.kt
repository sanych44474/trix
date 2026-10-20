package app.hacklimits.shared.trainer.clients

/** The trainer's first-client path, in order: invite, the client joins, finishes the intake, the plan is assigned. */
enum class FirstClientStep { Invite, Joined, Intake, Assigned }

data class FirstClientProgress(
    val done: Set<FirstClientStep>,
    /** The first step not done yet; null when the path is complete. */
    val next: FirstClientStep?,
    /** A client whose plan draft is waiting for review, if any. */
    val draftClientId: Long?,
)

/** Mirrors the Mini App's firstClientProgress: a later step implies the earlier ones. */
fun firstClientProgress(clients: List<ClientRow>, invitesSent: Int): FirstClientProgress {
    val joined = clients.isNotEmpty()
    val assigned = clients.any { it.plan == "active" }
    val done = buildSet {
        if (invitesSent > 0 || joined) add(FirstClientStep.Invite)
        if (joined) add(FirstClientStep.Joined)
        if (assigned || clients.any { it.onboarded }) add(FirstClientStep.Intake)
        if (assigned) add(FirstClientStep.Assigned)
    }
    return FirstClientProgress(
        done = done,
        next = FirstClientStep.entries.firstOrNull { it !in done },
        draftClientId = clients.firstOrNull { it.plan == "draft" }?.id,
    )
}
