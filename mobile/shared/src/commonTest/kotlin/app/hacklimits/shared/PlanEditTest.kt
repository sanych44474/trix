package app.hacklimits.shared

import app.hacklimits.shared.data.AppJson
import app.hacklimits.shared.data.PlanEdit
import kotlin.test.Test
import kotlin.test.assertEquals

class PlanEditTest {
    @Test
    fun addSendsIndexMinusOneAndNoEmptyFields() {
        // AppJson drops defaults and nulls, so index has no default: "add" must still send -1.
        assertEquals(
            """{"action":"add","weekday":2,"index":-1,"value":"Pull-up","catalogId":"pullup"}""",
            AppJson.encodeToString(PlanEdit("add", 2, -1, value = "Pull-up", catalogId = "pullup")),
        )
        assertEquals(
            """{"action":"move","weekday":1,"index":3,"dir":"up","expectName":"Squat"}""",
            AppJson.encodeToString(PlanEdit("move", 1, 3, dir = "up", expectName = "Squat")),
        )
    }
}
