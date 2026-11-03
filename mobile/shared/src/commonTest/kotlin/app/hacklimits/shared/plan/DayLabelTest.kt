package app.hacklimits.shared.plan

import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.PlanEdit
import kotlin.test.Test
import kotlin.test.assertEquals

class DayLabelTest {
    @Test
    fun chipsJoinGroupsWithSlashOnce() {
        assertEquals("Груди", addGroupToLabel("", "Груди"))
        assertEquals("Груди/Руки", addGroupToLabel("Груди", "Руки"))
        // Already there: the draft is left exactly as typed.
        assertEquals(" Груди / Руки ", addGroupToLabel(" Груди / Руки ", "Груди"))
        assertEquals("Upper A/Core", addGroupToLabel("Upper A", "Core"))
    }

    @Test
    fun renameSendsDaynameWithTheLabelAsValue() {
        assertEquals(
            """{"action":"dayname","weekday":2,"index":0,"value":"Груди/Трицепс","clientId":7}""",
            AppJson.encodeToString(PlanEdit("dayname", weekday = 2, index = 0, value = "Груди/Трицепс", clientId = 7)),
        )
    }
}
