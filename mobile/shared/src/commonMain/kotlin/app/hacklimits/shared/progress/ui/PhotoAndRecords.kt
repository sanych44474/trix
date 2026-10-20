package app.hacklimits.shared.progress.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import coil3.compose.LocalPlatformContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.data.PhotoRef
import app.hacklimits.shared.data.ProgressDashboard
import app.hacklimits.shared.data.Records
import app.hacklimits.shared.progress.formatOneDecimal
import app.hacklimits.shared.progress.muscle.jsRound
import app.hacklimits.shared.progress.pickPhotoPair
import app.hacklimits.shared.progress.weightNear
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.pr_no_records_hint
import app.hacklimits.shared.resources.pr_photo_pair_before
import app.hacklimits.shared.resources.pr_photo_pair_need_first
import app.hacklimits.shared.resources.pr_photo_pair_need_second
import app.hacklimits.shared.resources.pr_photo_pair_now
import app.hacklimits.shared.resources.pr_photo_pair_span
import app.hacklimits.shared.resources.pr_record_updated_metric
import app.hacklimits.shared.resources.pr_recent_label
import app.hacklimits.shared.resources.pr_unit_kg
import coil3.compose.AsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import org.jetbrains.compose.resources.stringResource
import kotlin.math.abs

/**
 * "A while ago vs now": the newest progress photo beside the one closest to 30 days before it,
 * each with its date and the weight logged nearest to it. Images load with the bearer session.
 */
@Composable
fun PhotoPairView(
    photos: List<PhotoRef>,
    weights: List<ProgressDashboard.Weight.Point>,
    photoUrl: (Long) -> String,
    bearer: String?,
    uk: Boolean,
) {
    val pair = pickPhotoPair(photos)
    if (pair == null) {
        MutedText(stringResource(if (photos.isNotEmpty()) Res.string.pr_photo_pair_need_second else Res.string.pr_photo_pair_need_first))
        return
    }
    val kg = stringResource(Res.string.pr_unit_kg)
    val wBefore = weightNear(weights, pair.before.takenAt)
    val wAfter = weightNear(weights, pair.after.takenAt)
    val delta = if (wBefore != null && wAfter != null) jsRound((wAfter - wBefore) * 10) / 10 else null
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PhotoSide(photoUrl(pair.before.id), stringResource(Res.string.pr_photo_pair_before), shortDate(pair.before.takenAt, uk) + (wBefore?.let { " · ${formatNumber(it, uk)} $kg" } ?: ""), bearer, Modifier.weight(1f))
            PhotoSide(photoUrl(pair.after.id), stringResource(Res.string.pr_photo_pair_now), shortDate(pair.after.takenAt, uk) + (wAfter?.let { " · ${formatNumber(it, uk)} $kg" } ?: ""), bearer, Modifier.weight(1f))
        }
        val deltaText = delta?.let { d -> " · " + (if (d > 0) "+" else if (d < 0) "−" else "") + formatOneDecimal(abs(d)) + " $kg" }.orEmpty()
        MutedText(stringResource(Res.string.pr_photo_pair_span, pair.days) + deltaText)
    }
}

@Composable
private fun PhotoSide(url: String, label: String, caption: String, bearer: String?, modifier: Modifier) {
    val context = LocalPlatformContext.current
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        AsyncImage(
            model = ImageRequest.Builder(context)
                .data(url)
                .httpHeaders(NetworkHeaders.Builder().apply { bearer?.let { set("Authorization", it) } }.build())
                .build(),
            contentDescription = "$label · $caption",
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxWidth().aspectRatio(0.75f).clip(RoundedCornerShape(10.dp)),
        )
        Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        Text(caption, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * Personal records (the Mini App's Records panel): each lift with its best and when it was set;
 * a tap opens its estimated 1RM trend. Earned badges are listed under them.
 */
@Composable
fun RecordsView(records: Records, uk: Boolean) {
    var open by remember { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (records.records.isEmpty()) {
            MutedText(stringResource(Res.string.pr_no_records_hint))
        } else {
            records.records.forEach { record ->
                val expanded = open == record.exercise
                Column(
                    Modifier.fillMaxWidth().clickable(enabled = record.points.size > 1) { open = if (expanded) null else record.exercise },
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(Modifier.weight(1f)) {
                            Text(record.exercise, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                            Text(
                                stringResource(Res.string.pr_record_updated_metric, record.updated ?: stringResource(Res.string.pr_recent_label), record.metric),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text(record.best, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                    }
                    if (expanded && record.points.size > 1) {
                        LineChart(record.points.map { ChartPoint(it.date, it.v) }, MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
        val earned = records.badges.filter { it.earned }
        if (earned.isNotEmpty()) {
            Text(earned.joinToString(" · ") { it.label }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}
