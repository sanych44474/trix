package app.hacklimits.shared.trainer.clients

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class FirstClientTest {
    private fun client(id: Long, onboarded: Boolean = false, plan: String = "none") =
        ClientRow(id = id, name = "client $id", onboarded = onboarded, plan = plan)

    @Test
    fun noInvitesAndNoClientsStartsAtTheInvite() {
        val progress = firstClientProgress(emptyList(), invitesSent = 0)
        assertEquals(emptySet(), progress.done)
        assertEquals(FirstClientStep.Invite, progress.next)
        assertNull(progress.draftClientId)
    }

    @Test
    fun aSentInviteCompletesTheFirstStep() {
        val progress = firstClientProgress(emptyList(), invitesSent = 1)
        assertEquals(setOf(FirstClientStep.Invite), progress.done)
        assertEquals(FirstClientStep.Joined, progress.next)
    }

    @Test
    fun anAssignedPlanImpliesTheEarlierSteps() {
        val progress = firstClientProgress(listOf(client(1, plan = "active")), invitesSent = 0)
        assertEquals(FirstClientStep.entries.toSet(), progress.done)
        assertNull(progress.next)
    }

    @Test
    fun aWaitingDraftIsPointedOutForReview() {
        val progress = firstClientProgress(listOf(client(5, onboarded = true, plan = "draft")), invitesSent = 0)
        assertEquals(setOf(FirstClientStep.Invite, FirstClientStep.Joined, FirstClientStep.Intake), progress.done)
        assertEquals(FirstClientStep.Assigned, progress.next)
        assertEquals(5L, progress.draftClientId)
    }
}
