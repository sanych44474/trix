package app.hacklimits.shared.update

import app.hacklimits.shared.data.ApiClient
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.InMemorySessionStore
import app.hacklimits.shared.platform.ErrorReporter
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AppUpdatesTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    @Test
    fun belowMinimumBlocksBelowLatestOffersAndUnknownBuildIsNeverGated() {
        val gate = VersionGate(minVersionCode = 5, latestVersionCode = 8)
        assertEquals(Gate.Required, decide(4, gate))
        assertEquals(Gate.Optional, decide(5, gate))
        assertEquals(Gate.Optional, decide(7, gate))
        assertEquals(Gate.Current, decide(8, gate))
        assertEquals(Gate.Current, decide(0, gate))
    }

    @Test
    fun readsTheAndroidGateFromThePublicConfig() = runTest {
        val api = ApiClient("https://api.example.test", InMemorySessionStore(), HttpClient(MockEngine { request ->
            assertEquals("/api/v2/app/config", request.url.encodedPath)
            respond("""{"data":{"android":{"minVersionCode":3,"latestVersionCode":9}}}""", HttpStatusCode.OK, json)
        }))
        assertEquals(VersionGate(3, 9), AppConfigApi(api).android())
    }

    @Test
    fun readsTheSelfUpdateDownloadWhenAnApkIsPublished() = runTest {
        val sha = "a".repeat(64)
        val api = ApiClient("https://api.example.test", InMemorySessionStore(), HttpClient(MockEngine {
            respond("""{"data":{"android":{"minVersionCode":1,"latestVersionCode":4,"download":{"url":"https://api.example.test/download/android","versionCode":4,"versionName":"0.2.0","sha256":"$sha","size":3200000}}}}""", HttpStatusCode.OK, json)
        }))
        val gate = AppConfigApi(api).android()
        assertEquals(ApkDownload("https://api.example.test/download/android", 4, "0.2.0", sha, 3_200_000), gate.download)
        assertEquals(Gate.Optional, decide(2, gate))
    }

    @Test
    fun anUnreadableSuccessIsReportedAsBadResponseNotAsNoConnection() = runTest {
        val reported = mutableListOf<String>()
        val api = ApiClient(
            "https://api.example.test",
            InMemorySessionStore(),
            HttpClient(MockEngine { respond("""{"data":{"android":"oops"}}""", HttpStatusCode.OK, json) }),
            reporter = ErrorReporter { _, where -> reported += where },
        )
        val error = assertFailsWith<ApiException> { AppConfigApi(api).android() }
        assertEquals("bad_response", error.code)
        assertTrue(reported.single().endsWith("/api/v2/app/config"))
    }
}
