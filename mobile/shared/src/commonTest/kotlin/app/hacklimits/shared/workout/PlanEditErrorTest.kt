package app.hacklimits.shared.workout

import app.hacklimits.shared.plan.planEditErrorKey
import kotlin.test.Test
import kotlin.test.assertEquals

class PlanEditErrorTest {
    @Test
    fun anInjuryRefusalNamesTheArea() {
        assertEquals("injury:knee", planEditErrorKey("injury:knee"))
        assertEquals("injury:lower_back", planEditErrorKey("injury:lower_back"))
    }

    @Test
    fun anythingElseIsGeneric() {
        assertEquals("generic", planEditErrorKey("stale"))
        assertEquals("generic", planEditErrorKey("injury:spleen"))
        assertEquals("generic", planEditErrorKey(null))
    }
}
