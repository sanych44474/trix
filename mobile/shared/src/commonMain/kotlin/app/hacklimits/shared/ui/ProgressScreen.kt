package app.hacklimits.shared.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.data.Dashboard
import app.hacklimits.shared.progress.ProgressViewModel
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import org.jetbrains.compose.resources.stringResource

@Composable
fun ProgressScreen(vm: ProgressViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.refresh() }
    LazyColumn(Modifier.fillMaxSize().imePadding(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text(stringResource(Res.string.tab_progress), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold) }
        s.error?.let { code -> item { Text(stringResource(if (code == "invalid_weight") Res.string.progress_invalid_weight else errorText(code)), color = MaterialTheme.colorScheme.error) } }

        item {
            Block(stringResource(Res.string.progress_weight)) {
                val points = s.weight.points.takeLast(60)
                if (points.size >= 2) WeightChart(points, s.weight.goal) else Text(stringResource(Res.string.progress_weight_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                points.lastOrNull()?.let { Text(stringResource(Res.string.progress_weight_last, formatKg(it.kg), it.date)) }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(s.weightInput, vm::onWeight, label = { Text(stringResource(Res.string.unit_kg)) }, singleLine = true, modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                    Button(onClick = vm::logWeight, enabled = !s.busy && s.weightInput.isNotBlank()) { Text(stringResource(Res.string.save)) }
                }
            }
        }

        item {
            Block(stringResource(Res.string.progress_photos)) {
                if (s.photos.isNotEmpty()) {
                    val context = LocalPlatformContext.current
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(s.photos, key = { it.id }) { photo ->
                            Column {
                                AsyncImage(
                                    model = ImageRequest.Builder(context)
                                        .data(vm.photoUrl(photo.id))
                                        .httpHeaders(NetworkHeaders.Builder().apply { s.bearer?.let { set("Authorization", it) } }.build())
                                        .build(),
                                    contentDescription = stringResource(Res.string.progress_photo_from, photo.takenAt),
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.height(140.dp).aspectRatio(0.75f).clip(RoundedCornerShape(10.dp)),
                                )
                                Text(photo.takenAt, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                OutlinedButton(onClick = vm::addPhoto, enabled = !s.busy) { Text(stringResource(Res.string.progress_add_photo)) }
            }
        }

        if (s.records.records.isNotEmpty()) item {
            Block(stringResource(Res.string.progress_records)) {
                s.records.records.take(12).forEach { r ->
                    Row { Text(r.exercise, Modifier.weight(1f)); Text(r.best, fontWeight = FontWeight.SemiBold) }
                }
            }
        }

        if (s.history.isNotEmpty()) item {
            Block(stringResource(Res.string.progress_history)) {
                s.history.take(10).forEach { h ->
                    Row { Text("${h.date} · ${h.title}", Modifier.weight(1f)); Text(stringResource(Res.string.progress_exercises, h.n), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }
}

@Composable
private fun WeightChart(points: List<Dashboard.Weight.Point>, goal: Double?) {
    val line = MaterialTheme.colorScheme.primary
    val goalColor = MaterialTheme.colorScheme.onSurfaceVariant
    val values = points.map { it.kg } + listOfNotNull(goal)
    val min = values.min() - 1
    val max = values.max() + 1
    val first = points.first(); val last = points.last()
    Canvas(
        Modifier.fillMaxWidth().height(140.dp).semantics {
            contentDescription = "${first.date}: ${formatKg(first.kg)} kg → ${last.date}: ${formatKg(last.kg)} kg"
        },
    ) {
        fun y(kg: Double) = (size.height * (1 - (kg - min) / (max - min))).toFloat()
        val step = size.width / (points.size - 1)
        val path = Path()
        points.forEachIndexed { i, p -> if (i == 0) path.moveTo(0f, y(p.kg)) else path.lineTo(i * step, y(p.kg)) }
        drawPath(path, line, style = Stroke(width = 3.dp.toPx()))
        goal?.let { drawLine(goalColor, Offset(0f, y(it)), Offset(size.width, y(it)), strokeWidth = 1.dp.toPx()) }
    }
}

@Composable
private fun Block(title: String, content: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

private fun formatKg(kg: Double): String = if (kg % 1.0 == 0.0) kg.toInt().toString() else ((kg * 10).toLong() / 10.0).toString()
