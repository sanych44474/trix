package app.hacklimits.shared.plan

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import coil3.compose.AsyncImage
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

private val MUSCLE_SLUGS = listOf(
    "chest", "upper-back", "deltoids", "biceps", "triceps", "forearm", "abs", "obliques", "quadriceps",
    "hamstring", "gluteal", "calves", "adductors", "lower-back", "trapezius", "neck",
)
private val EQUIPMENT_CODES = listOf("body", "dumbbell", "barbell", "kettlebell", "band", "cable", "machine", "ezbar", "ball", "other")
private const val PAGE = 30

/**
 * The searchable, filterable exercise list with pictures. [action] renders under an opened exercise
 * (frames and steps above it): "add to my plan" on the library screen, "add to this day" or "swap"
 * in the plan editor. [loadSteps] fetches the technique steps of an opened exercise.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LibraryBrowser(
    loadSteps: suspend (String) -> List<String>,
    action: @Composable (entry: LibraryEntry, name: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val all by produceState<List<LibraryEntry>?>(null) { value = ExerciseCatalog.all() }
    var query by remember { mutableStateOf("") }
    var muscle by remember { mutableStateOf("") }
    var equipment by remember { mutableStateOf("") }
    var shown by remember { mutableIntStateOf(PAGE) }
    var open by remember { mutableStateOf<String?>(null) }
    val entries = all
    if (entries == null) {
        Box(modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    val list = remember(entries, muscle, equipment, query) { filterLibrary(entries, muscle, equipment, query) }
    val isUk = stringResource(Res.string.pl_exlib_lang) == "uk"

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it; shown = PAGE },
            placeholder = { Text(stringResource(Res.string.pl_library_search_ph)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FilterChip(selected = muscle.isEmpty(), onClick = { muscle = ""; shown = PAGE }, label = { Text(stringResource(Res.string.pl_library_all_muscles)) })
            MUSCLE_SLUGS.forEach { slug ->
                FilterChip(selected = muscle == slug, onClick = { muscle = if (muscle == slug) "" else slug; shown = PAGE }, label = { Text(stringResource(muscleLabel(slug))) })
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            EQUIPMENT_CODES.forEach { code ->
                FilterChip(selected = equipment == code, onClick = { equipment = if (equipment == code) "" else code; shown = PAGE }, label = { Text(stringResource(equipmentLabel(code))) })
            }
        }
        if (list.isEmpty()) Text(stringResource(Res.string.pl_library_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)

        list.take(shown).forEach { ex ->
            val isOpen = open == ex.id
            val name = if (isUk) ex.titleUk else ex.title
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        Modifier.fillMaxWidth().clickable { open = if (isOpen) null else ex.id },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        AsyncImage(
                            model = exerciseFrameUrls(ex.id).first(),
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.size(width = 72.dp, height = 54.dp),
                        )
                        Column(Modifier.weight(1f)) {
                            Text(name, fontWeight = FontWeight.SemiBold)
                            Text(
                                "${stringResource(muscleLabel(ex.muscle))} · ${stringResource(equipmentLabel(ex.equipment))} · ${stringResource(levelLabel(ex.level))}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (isOpen) LibraryDetail(ex, name, loadSteps, action)
                }
            }
        }
        if (shown < list.size) {
            OutlinedButton(onClick = { shown += PAGE }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(Res.string.pl_library_more, list.size - shown))
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LibraryDetail(
    ex: LibraryEntry,
    name: String,
    loadSteps: suspend (String) -> List<String>,
    action: @Composable (LibraryEntry, String) -> Unit,
) {
    val frames = exerciseFrameUrls(ex.id)
    val steps by produceState<List<String>?>(null, ex.id) { value = loadSteps(ex.id) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        frames.forEachIndexed { i, url ->
            AsyncImage(
                model = url,
                contentDescription = "$name ${i + 1}/2",
                contentScale = ContentScale.Fit,
                modifier = Modifier.weight(1f).aspectRatio(4f / 3f),
            )
        }
    }
    val loaded = steps
    when {
        loaded == null -> CircularProgressIndicator(Modifier.size(20.dp))
        loaded.isNotEmpty() -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            loaded.forEachIndexed { i, s -> Text("${i + 1}. $s", style = MaterialTheme.typography.bodyMedium) }
        }
    }
    action(ex, name)
}

/** The library as its own screen: browse, and add an exercise to a day of your plan. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ExerciseLibraryScreen(vm: ExerciseLibraryViewModel, onBack: () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = onBack) { Text(stringResource(Res.string.pl_nav_more)) }
        Text(stringResource(Res.string.pl_exlib_eyebrow), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stringResource(Res.string.pl_exlib_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        LibraryBrowser(
            loadSteps = vm::steps,
            action = { entry, name ->
                val days = s.plan?.days.orEmpty()
                when {
                    !s.planLoaded -> Unit
                    days.isEmpty() -> Text(stringResource(Res.string.pl_library_no_plan), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    else -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            days.forEach { d ->
                                FilterChip(
                                    selected = s.day == d.weekday,
                                    onClick = { vm.selectDay(d.weekday) },
                                    label = { Text("${stringResource(weekdayLabel(d.weekday))} · ${d.muscleGroup}") },
                                )
                            }
                        }
                        val added = entry.id in s.added
                        Button(
                            onClick = { vm.add(entry, name) },
                            enabled = !added && s.adding == null,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(stringResource(if (added) Res.string.pl_library_added else Res.string.pl_library_add))
                        }
                        if (s.error) Text(stringResource(Res.string.pl_generic_error), color = MaterialTheme.colorScheme.error)
                    }
                }
            },
        )
    }
}

/** The exercise-list library is shared with the plan editor; these map a code to its label. */
fun muscleLabel(slug: String): StringResource = when (slug) {
    "chest" -> Res.string.pl_muscle_chest
    "upper-back" -> Res.string.pl_muscle_upper_back
    "deltoids" -> Res.string.pl_muscle_deltoids
    "biceps" -> Res.string.pl_muscle_biceps
    "triceps" -> Res.string.pl_muscle_triceps
    "forearm" -> Res.string.pl_muscle_forearm
    "abs" -> Res.string.pl_muscle_abs
    "obliques" -> Res.string.pl_muscle_obliques
    "quadriceps" -> Res.string.pl_muscle_quadriceps
    "hamstring" -> Res.string.pl_muscle_hamstring
    "gluteal" -> Res.string.pl_muscle_gluteal
    "calves" -> Res.string.pl_muscle_calves
    "adductors" -> Res.string.pl_muscle_adductors
    "lower-back" -> Res.string.pl_muscle_lower_back
    "trapezius" -> Res.string.pl_muscle_trapezius
    "neck" -> Res.string.pl_muscle_neck
    "tibialis" -> Res.string.pl_muscle_tibialis
    else -> Res.string.pl_muscle_abs
}

fun equipmentLabel(code: String): StringResource = when (code) {
    "dumbbell" -> Res.string.pl_libeq_dumbbell
    "barbell" -> Res.string.pl_libeq_barbell
    "kettlebell" -> Res.string.pl_libeq_kettlebell
    "band" -> Res.string.pl_libeq_band
    "cable" -> Res.string.pl_libeq_cable
    "machine" -> Res.string.pl_libeq_machine
    "ezbar" -> Res.string.pl_libeq_ezbar
    "ball" -> Res.string.pl_libeq_ball
    "other" -> Res.string.pl_libeq_other
    else -> Res.string.pl_libeq_body
}

fun weekdayLabel(weekday: Int): StringResource = when (weekday) {
    1 -> Res.string.pl_weekday_mon
    2 -> Res.string.pl_weekday_tue
    3 -> Res.string.pl_weekday_wed
    4 -> Res.string.pl_weekday_thu
    5 -> Res.string.pl_weekday_fri
    6 -> Res.string.pl_weekday_sat
    else -> Res.string.pl_weekday_sun
}

fun levelLabel(code: String): StringResource = when (code) {
    "i" -> Res.string.pl_liblevel_i
    "e" -> Res.string.pl_liblevel_e
    else -> Res.string.pl_liblevel_b
}
