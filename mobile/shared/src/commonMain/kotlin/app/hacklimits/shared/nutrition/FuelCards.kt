package app.hacklimits.shared.nutrition

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.data.FoodItem
import app.hacklimits.shared.data.GroceryLine
import app.hacklimits.shared.data.NutritionDay
import app.hacklimits.shared.data.PlanDay
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.today.formatDecimal
import org.jetbrains.compose.resources.stringResource

// The Food cards: day totals, the quick-add panels, the meal list, the meal plan and the grocery
// list. Copy comes from strings_today.xml (fd_ keys). Port of the Mini App's FuelView.tsx.

@Composable
internal fun KcalCard(day: NutritionDay) {
    val t = day.targets
    val kcal = day.totals.kcal
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                val big = if (t != null) {
                    stringResource(Res.string.fd_kcal_of, formatDecimal(kcal), formatDecimal(t.calories), stringResource(Res.string.fd_kcal_unit))
                } else {
                    formatDecimal(kcal)
                }
                Text(big, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                if (day.isRestDay) Pill(stringResource(Res.string.fd_rest_day_badge))
            }
            LinearProgressIndicator(progress = { progressFraction(kcal, t?.calories) }, modifier = Modifier.fillMaxWidth())
            MacroRow(stringResource(Res.string.fd_metric_protein), day.totals.protein, t?.protein, MaterialTheme.colorScheme.primary)
            MacroRow(stringResource(Res.string.fd_metric_fats), day.totals.fats, t?.fats, MaterialTheme.colorScheme.tertiary)
            MacroRow(stringResource(Res.string.fd_metric_carbs), day.totals.carbs, t?.carbs, MaterialTheme.colorScheme.secondary)
        }
    }
}

@Composable
private fun MacroRow(label: String, value: Double, goal: Double?, color: androidx.compose.ui.graphics.Color) {
    val unit = stringResource(Res.string.fd_unit_g)
    val text = if (goal != null && goal > 0) {
        stringResource(Res.string.fd_macro_value, formatDecimal(value), formatDecimal(goal), unit)
    } else {
        "${formatDecimal(value)} $unit"
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, Modifier.width(72.dp), style = MaterialTheme.typography.labelLarge)
        LinearProgressIndicator(progress = { progressFraction(value, goal) }, color = color, modifier = Modifier.weight(1f))
        Text(text, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
internal fun Pill(text: String) {
    Box(Modifier.clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.primaryContainer).padding(horizontal = 10.dp, vertical = 4.dp)) {
        Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
    }
}

/** The four quick tiles. Search, voice and barcode open a panel below; the photo tile opens its own screen. */
@Composable
internal fun QuickTiles(panel: NutritionViewModel.Panel?, onSearch: () -> Unit, onPhoto: () -> Unit, onVoice: () -> Unit, onBarcode: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        QuickTile(stringResource(Res.string.fd_tile_search), panel == NutritionViewModel.Panel.Search, onSearch)
        QuickTile(stringResource(Res.string.fd_tile_photo), false, onPhoto)
        QuickTile(stringResource(Res.string.fd_tile_voice), panel == NutritionViewModel.Panel.Text, onVoice)
        QuickTile(stringResource(Res.string.fd_tile_barcode), panel == NutritionViewModel.Panel.Barcode, onBarcode)
    }
}

@Composable
private fun RowScope.QuickTile(label: String, selected: Boolean, onClick: () -> Unit) {
    if (selected) {
        Button(onClick = onClick, modifier = Modifier.weight(1f)) { Text(label) }
    } else {
        OutlinedButton(onClick = onClick, modifier = Modifier.weight(1f)) { Text(label) }
    }
}

@Composable
internal fun SearchPanel(
    query: String,
    onQuery: (String) -> Unit,
    onSearch: () -> Unit,
    searching: Boolean,
    results: List<FoodItem>,
    recent: List<NutritionDay.Recent>,
    onReadd: (Int) -> Unit,
    onPick: (FoodItem) -> Unit,
    busy: Boolean,
    selected: FoodItem?,
    grams: String,
    onGrams: (String) -> Unit,
    onAdd: () -> Unit,
) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(query, onQuery, placeholder = { Text(stringResource(Res.string.fd_search_ph)) }, singleLine = true, modifier = Modifier.weight(1f))
                Button(onClick = onSearch, enabled = !searching) { Text(stringResource(Res.string.fd_search_btn)) }
            }
            if (results.isEmpty() && recent.isNotEmpty()) {
                Text(stringResource(Res.string.fd_recent_hint), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                recent.take(6).forEach { r ->
                    FoodRow(r.desc, formatDecimal(r.kcal), enabled = !busy) { onReadd(r.ri) }
                }
            }
            results.forEach { item ->
                FoodRow(
                    listOfNotNull(item.name, item.brand?.takeIf { it.isNotBlank() }).joinToString(" · "),
                    if (item.brand.isNullOrBlank()) "${formatDecimal(item.per100.kcal)} · ${stringResource(Res.string.fd_per_100g)}" else formatDecimal(item.per100.kcal),
                    enabled = true,
                ) { onPick(item) }
            }
            selected?.let { PortionEditor(it, grams, onGrams, onAdd, busy) }
        }
    }
}

@Composable
private fun FoodRow(title: String, trailing: String, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, Modifier.weight(1f), fontWeight = FontWeight.Medium)
        Text(trailing, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun PortionEditor(item: FoodItem, grams: String, onGrams: (String) -> Unit, onAdd: () -> Unit, busy: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(item.name, fontWeight = FontWeight.SemiBold)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                grams, onGrams, singleLine = true, modifier = Modifier.weight(1f),
                placeholder = { Text(stringResource(Res.string.fd_grams_unit)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            Text(stringResource(Res.string.fd_grams_unit), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = onAdd, enabled = !busy) { Text(stringResource(Res.string.fd_add_portion)) }
        }
    }
}

@Composable
internal fun TextPanel(text: String, onText: (String) -> Unit, onSend: () -> Unit, busy: Boolean, micAvailable: Boolean, onVoice: () -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(text, onText, placeholder = { Text(stringResource(Res.string.fd_text_ph)) }, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (micAvailable) TextButton(onClick = onVoice, enabled = !busy) { Text(stringResource(Res.string.fd_tile_voice)) }
                Button(onClick = onSend, enabled = !busy && text.isNotBlank()) { Text(stringResource(Res.string.fd_log)) }
            }
        }
    }
}

@Composable
internal fun BarcodePanel(
    code: String,
    onCode: (String) -> Unit,
    onScan: () -> Unit,
    searching: Boolean,
    results: List<FoodItem>,
    onPick: (FoodItem) -> Unit,
    busy: Boolean,
    selected: FoodItem?,
    grams: String,
    onGrams: (String) -> Unit,
    onAdd: () -> Unit,
) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    code, onCode, singleLine = true, modifier = Modifier.weight(1f),
                    placeholder = { Text(stringResource(Res.string.fd_barcode_ph)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                Button(onClick = onScan, enabled = !searching) { Text(stringResource(Res.string.fd_scan_code)) }
            }
            results.forEach { item ->
                FoodRow(item.name, formatDecimal(item.per100.kcal), enabled = true) { onPick(item) }
            }
            selected?.let { PortionEditor(it, grams, onGrams, onAdd, busy) }
        }
    }
}

/** The logged meals of the day; a tap opens the editor for correcting, scaling or deleting one. */
@Composable
internal fun MealList(meals: List<NutritionDay.Meal>, editing: Int?, correction: NutritionViewModel.Correction, busy: Boolean, actions: MealActions) {
    if (meals.isEmpty()) {
        Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(Res.string.fd_nothing_title), fontWeight = FontWeight.SemiBold)
            Text(stringResource(Res.string.fd_nothing_detail), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        meals.forEach { meal ->
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Row(Modifier.fillMaxWidth().clickable { actions.onToggle(meal) }, verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(meal.desc, fontWeight = FontWeight.SemiBold)
                            val grams = meal.grams?.let { stringResource(Res.string.fd_grams_prefix, formatDecimal(it)) } ?: ""
                            Text(
                                grams + stringResource(
                                    Res.string.fd_macro_line,
                                    formatDecimal(meal.protein), formatDecimal(meal.fats), formatDecimal(meal.carbs),
                                ),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text(formatDecimal(meal.kcal), fontWeight = FontWeight.SemiBold)
                    }
                    if (editing == meal.index) {
                        MealEditor(correction, busy, actions)
                    }
                }
            }
        }
    }
}

/** What the meal list's editor can do; all of it is a single write on the server. */
internal class MealActions(
    val onToggle: (NutritionDay.Meal) -> Unit,
    val onCorrection: (NutritionViewModel.Correction) -> Unit,
    val onSaveMacros: () -> Unit,
    val onSaveGrams: () -> Unit,
    val onScale: (Double) -> Unit,
    val onDelete: () -> Unit,
)

@Composable
private fun MealEditor(c: NutritionViewModel.Correction, busy: Boolean, actions: MealActions) {
    Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NumberField(stringResource(Res.string.fd_metric_calories), c.kcal, Modifier.weight(1f)) { actions.onCorrection(c.copy(kcal = it)) }
            NumberField(stringResource(Res.string.fd_metric_protein), c.protein, Modifier.weight(1f)) { actions.onCorrection(c.copy(protein = it)) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NumberField(stringResource(Res.string.fd_metric_fats), c.fats, Modifier.weight(1f)) { actions.onCorrection(c.copy(fats = it)) }
            NumberField(stringResource(Res.string.fd_metric_carbs), c.carbs, Modifier.weight(1f)) { actions.onCorrection(c.copy(carbs = it)) }
        }
        NumberField(stringResource(Res.string.fd_grams_unit), c.grams, Modifier.fillMaxWidth()) { actions.onCorrection(c.copy(grams = it)) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = actions.onSaveMacros, enabled = !busy) { Text(stringResource(Res.string.fd_save)) }
            OutlinedButton(onClick = actions.onSaveGrams, enabled = !busy) { Text(stringResource(Res.string.fd_save_grams)) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { actions.onScale(0.5) }, enabled = !busy) { Text("×0.5") }
            TextButton(onClick = { actions.onScale(1.5) }, enabled = !busy) { Text("×1.5") }
            TextButton(onClick = actions.onDelete, enabled = !busy) { Text(stringResource(Res.string.fd_delete), color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun NumberField(label: String, value: String, modifier: Modifier, onValue: (String) -> Unit) {
    OutlinedTextField(
        value, onValue, singleLine = true, modifier = modifier,
        placeholder = { Text(label) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
    )
}

/** The generated meal plan: days -> meals -> items, each item editable in place. */
@Composable
internal fun PlanCard(
    days: List<PlanDay>,
    editing: NutritionViewModel.PlanItemRef?,
    planGrams: String,
    busy: Boolean,
    regenerating: Boolean,
    regenerated: Boolean,
    onToggleItem: (NutritionViewModel.PlanItemRef, Double) -> Unit,
    onPlanGrams: (String) -> Unit,
    onScale: (Double) -> Unit,
    onSave: () -> Unit,
    onDelete: () -> Unit,
    onRegenerate: () -> Unit,
) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(Res.string.fd_plan_eyebrow), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Text(stringResource(Res.string.fd_plan_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                }
                Pill(days.size.toString())
            }
            Text(stringResource(Res.string.fd_plan_detail, days.size), color = MaterialTheme.colorScheme.onSurfaceVariant)
            days.forEachIndexed { dayIndex, day ->
                Text(day.label, fontWeight = FontWeight.Bold)
                day.meals.forEachIndexed { mealIndex, meal ->
                    Text(meal.name, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    meal.items.forEachIndexed { itemIndex, item ->
                        val ref = NutritionViewModel.PlanItemRef(dayIndex, mealIndex, itemIndex)
                        TextButton(onClick = { onToggleItem(ref, item.grams) }) {
                            Text("${item.food} ${formatDecimal(item.grams)}g")
                        }
                        if (editing == ref) {
                            Column(Modifier.padding(start = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    listOf(0.5, 1.5, 2.0).forEach { f ->
                                        OutlinedButton(onClick = { onScale(f) }, enabled = !busy) { Text("×${formatDecimal(f)}") }
                                    }
                                }
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedTextField(planGrams, onPlanGrams, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                                    OutlinedButton(onClick = onSave, enabled = !busy && planGrams.isNotBlank()) { Text(stringResource(Res.string.fd_save)) }
                                    TextButton(onClick = onDelete, enabled = !busy) { Text(stringResource(Res.string.fd_delete), color = MaterialTheme.colorScheme.error) }
                                }
                            }
                        }
                    }
                }
            }
            OutlinedButton(onClick = onRegenerate, enabled = !regenerating) {
                Text(stringResource(if (regenerating) Res.string.td_saving else Res.string.fd_regenerate))
            }
            if (regenerated) Text(stringResource(Res.string.fd_regenerated), color = MaterialTheme.colorScheme.primary)
        }
    }
}

/** The grocery list for 3, 5 or 7 days of the plan, which can be sent to the Telegram chat. */
@Composable
internal fun GroceryCard(
    days: Int,
    lines: List<GroceryLine>?,
    sending: Boolean,
    sent: Boolean,
    onDays: (Int) -> Unit,
    onSend: () -> Unit,
) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(Res.string.fd_grocery_eyebrow), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(stringResource(Res.string.fd_grocery_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(3, 5, 7).forEach { n ->
                    if (n == days) Button(onClick = { onDays(n) }) { Text("${n}d") } else OutlinedButton(onClick = { onDays(n) }) { Text("${n}d") }
                }
            }
            when {
                lines == null -> Text(stringResource(Res.string.fd_grocery_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
                lines.isEmpty() -> Text(stringResource(Res.string.fd_grocery_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> lines.forEach { line ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(line.food, fontWeight = FontWeight.Medium)
                        Text("${formatDecimal(line.grams)} g", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (!lines.isNullOrEmpty()) {
                Button(onClick = onSend, enabled = !sending) { Text(stringResource(Res.string.fd_grocery_send)) }
            }
            if (sent) Text(stringResource(Res.string.fd_grocery_sent), color = MaterialTheme.colorScheme.primary)
        }
    }
}

/** The two advice actions and the answer under them. */
@Composable
internal fun AdviceSection(advice: String?, busy: Boolean, onRecipe: () -> Unit, onRecover: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onRecipe, enabled = !busy) { Text(stringResource(Res.string.fd_recipe)) }
            TextButton(onClick = onRecover, enabled = !busy) { Text(stringResource(Res.string.fd_recover)) }
        }
        if (advice != null) {
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh)) {
                Text(
                    advice.ifBlank { stringResource(Res.string.fd_no_advice) },
                    Modifier.padding(16.dp),
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

/** Day / Plan / Shopping switch, shown once there is a meal plan. */
@Composable
internal fun FuelTabs(tab: NutritionViewModel.Tab, onSelect: (NutritionViewModel.Tab) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        NutritionViewModel.Tab.entries.forEach { t ->
            val label = stringResource(
                when (t) {
                    NutritionViewModel.Tab.Day -> Res.string.fd_tab_day
                    NutritionViewModel.Tab.Plan -> Res.string.fd_tab_plan
                    NutritionViewModel.Tab.Grocery -> Res.string.fd_tab_grocery
                },
            )
            if (t == tab) Button(onClick = { onSelect(t) }, modifier = Modifier.weight(1f)) { Text(label) }
            else OutlinedButton(onClick = { onSelect(t) }, modifier = Modifier.weight(1f)) { Text(label) }
        }
    }
}
