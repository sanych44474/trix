package app.hacklimits.shared.trainer.clients

import app.hacklimits.shared.data.AppJson
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TrainerQuestionContextTest {
    @Test
    fun pendingQuestionDecodesTheClientSnapshot() {
        // The shape GET /api/v2/trainer/questions sends (src/domain/clientSnapshot.ts).
        val json = """
            {"id":5,"clientId":8102,"client":"Віктор","text":"Add weight?","draft":"Yes","status":"pending",
             "context":{"weekDone":1,"weekPlanned":3,"daysSinceLast":0,
               "recent":[{"date":"2026-11-03","weekday":2,"label":"Груди/Трицепс","completed":true,"done":2,"planned":3,
                          "durationMin":50,"rpe":8,"top":["Bench Press 82.5x6","Dips BWx12"]}],
               "questsDone":1,
               "quests":[{"code":"muscle_sets:hamstring","kind":"muscle_sets","muscle":"hamstring","current":6,"target":6,"done":true}]}}
        """.trimIndent()
        val q = AppJson.decodeFromString(TrainerQuestion.serializer(), json)
        val c = q.context!!
        assertEquals(3, c.weekPlanned)
        assertEquals("Груди/Трицепс", c.recent.single().label)
        assertEquals(8.0, c.recent.single().rpe)
        assertEquals(listOf("Bench Press 82.5x6", "Dips BWx12"), c.recent.single().top)
        assertEquals("hamstring", c.quests.single().muscle)
    }

    @Test
    fun answeredQuestionHasNoContextAndNullsDecode() {
        val q = AppJson.decodeFromString(
            TrainerQuestion.serializer(),
            """{"id":6,"clientId":1,"client":"A","text":"Hi","status":"answered"}""",
        )
        assertNull(q.context)
        val c = AppJson.decodeFromString(
            ClientSnapshot.serializer(),
            """{"weekDone":0,"weekPlanned":0,"daysSinceLast":null,"recent":[{"date":"2026-11-01","weekday":7,"label":null,"completed":false,"done":1,"planned":null,"durationMin":null,"rpe":null,"top":[]}],"questsDone":0,"quests":[]}""",
        )
        assertNull(c.recent.single().planned)
        assertNull(c.daysSinceLast)
    }
}
