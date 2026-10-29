package app.hacklimits.shared.media

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.platform.AppPlatform
import app.hacklimits.shared.platform.PhotoPicker
import app.hacklimits.shared.platform.PickedPhoto
import app.hacklimits.shared.telemetry.Telemetry
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class MealPhotoNotFoodTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private val photo = object : PhotoPicker {
        override suspend fun pick(): PickedPhoto = PickedPhoto(byteArrayOf(1, 2, 3), "image/jpeg")
    }

    private val platform = object : AppPlatform {
        override val language = "en"
        override val appVersion = "test"
        override val pushPlatform = "android"
        override val privacyPolicyUrl: String? = null
    }

    @Test
    fun aNotFoodPhotoExposesTheServerMessageAndNoItems() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            // MockEngine answers on its own thread: the test waits for the state rather than assuming it.
            val http = HttpClient(MockEngine { request ->
                if (request.url.encodedPath == "/api/v2/media/meal-photo") {
                    respond(
                        """{"data":{"items":[],"reason":"not_food","message":"No food in this photo."},"meta":{"version":2}}""",
                        HttpStatusCode.OK, json,
                    )
                } else {
                    respond("""{"data":{"ok":true,"counted":1},"meta":{"version":2}}""", HttpStatusCode.OK, json)
                }
            })
            val client = ApiClient("https://api.example.test", InMemorySessionStore("m".repeat(64)), http)
            val vm = MealPhotoViewModel(
                api = MediaApi(client),
                photos = photo,
                speech = NoSpeechInput,
                platform = platform,
                telemetry = Telemetry(client, CoroutineScope(StandardTestDispatcher(testScheduler))),
            )

            vm.choosePhoto()
            awaitUntil { vm.state.value.estimated }

            assertTrue(vm.state.value.draft.isEmpty())
            assertEquals("No food in this photo.", vm.state.value.notFoodMessage)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun aPhotoWithItemsShowsNoNotFoodMessage() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val http = HttpClient(MockEngine { request ->
                if (request.url.encodedPath == "/api/v2/media/meal-photo") {
                    respond(
                        """{"data":{"items":[{"desc":"Rice","kcal":200,"protein":4,"fats":1,"carbs":44,"grams":150}]},"meta":{"version":2}}""",
                        HttpStatusCode.OK, json,
                    )
                } else {
                    respond("""{"data":{"ok":true,"counted":1},"meta":{"version":2}}""", HttpStatusCode.OK, json)
                }
            })
            val client = ApiClient("https://api.example.test", InMemorySessionStore("m".repeat(64)), http)
            val vm = MealPhotoViewModel(
                api = MediaApi(client),
                photos = photo,
                speech = NoSpeechInput,
                platform = platform,
                telemetry = Telemetry(client, CoroutineScope(StandardTestDispatcher(testScheduler))),
            )

            vm.choosePhoto()
            awaitUntil { vm.state.value.estimated }

            assertEquals(1, vm.state.value.draft.size)
            assertNull(vm.state.value.notFoodMessage)
        } finally {
            Dispatchers.resetMain()
        }
    }
}

private suspend fun TestScope.awaitUntil(check: () -> Boolean) {
    repeat(400) {
        if (check()) return
        advanceUntilIdle()
        withContext(Dispatchers.Default) { delay(25) }
    }
}
