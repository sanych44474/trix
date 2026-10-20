package app.hacklimits.shared.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.nutrition.NutritionViewModel
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.stringResource
import kotlin.math.roundToInt

@Composable
fun NutritionScreen(vm: NutritionViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.refresh() }
    LazyColumn(Modifier.fillMaxSize().imePadding(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text(stringResource(Res.string.tab_food), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold) }
        s.error?.let { item { Text(stringResource(errorText(it)), color = MaterialTheme.colorScheme.error) } }
        val day = s.day
        if (day != null) {
            item {
                Panel {
                    val t = day.targets
                    MacroBar(stringResource(Res.string.food_kcal), day.totals.kcal, t?.calories)
                    MacroBar(stringResource(Res.string.food_protein), day.totals.protein, t?.protein)
                    MacroBar(stringResource(Res.string.food_fats), day.totals.fats, t?.fats)
                    MacroBar(stringResource(Res.string.food_carbs), day.totals.carbs, t?.carbs)
                }
            }
            item {
                Panel {
                    Text(stringResource(Res.string.food_add), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(s.freeText, vm::onFreeText, label = { Text(stringResource(Res.string.food_free_text)) }, modifier = Modifier.fillMaxWidth())
                    Button(onClick = vm::addText, enabled = !s.busy && s.freeText.trim().length >= 2) { Text(stringResource(Res.string.food_log_text)) }
                    OutlinedTextField(s.query, vm::onQuery, label = { Text(stringResource(Res.string.food_search)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    s.results.take(8).forEach { item ->
                        Column(Modifier.fillMaxWidth().clickable { vm.pick(item) }.padding(vertical = 6.dp)) {
                            Text(listOfNotNull(item.name, item.brand).joinToString(" · "))
                            Text(stringResource(Res.string.food_per100, item.per100.kcal.roundToInt(), item.per100.p.roundToInt()), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    s.picked?.let { picked ->
                        Text(picked.name, fontWeight = FontWeight.SemiBold)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(s.grams, vm::onGrams, label = { Text(stringResource(Res.string.food_grams)) }, singleLine = true, modifier = Modifier.weight(1f),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                            Button(onClick = vm::addPicked, enabled = !s.busy && s.grams.isNotBlank()) { Text(stringResource(Res.string.food_add_short)) }
                        }
                    }
                    if (day.recent.isNotEmpty()) {
                        Text(stringResource(Res.string.food_recent), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        day.recent.take(6).forEach { r ->
                            Row(Modifier.fillMaxWidth().clickable(enabled = !s.busy) { vm.readd(r.ri) }.padding(vertical = 4.dp)) {
                                Text("+ ${r.desc}", Modifier.weight(1f)); Text("${r.kcal.roundToInt()}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
            item {
                Panel {
                    Text(stringResource(Res.string.food_today), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    if (day.meals.isEmpty()) Text(stringResource(Res.string.food_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    day.meals.forEach { m ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(m.desc)
                                Text(stringResource(Res.string.food_meal_line, m.kcal.roundToInt(), m.protein.roundToInt(), m.fats.roundToInt(), m.carbs.roundToInt()),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            TextButton(onClick = { vm.delete(m.index) }, enabled = !s.busy) { Text(stringResource(Res.string.plan_delete)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MacroBar(label: String, value: Double, target: Double?) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row { Text(label, Modifier.weight(1f)); Text(if (target != null) "${value.roundToInt()} / ${target.roundToInt()}" else "${value.roundToInt()}") }
        if (target != null && target > 0) LinearProgressIndicator(progress = { (value / target).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun Panel(content: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}
