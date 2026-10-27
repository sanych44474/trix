package app.hacklimits.shared.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.intl.Locale
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.media.NoSpeechInput
import app.hacklimits.shared.media.SpeechInput
import app.hacklimits.shared.nutrition.AdviceSection
import app.hacklimits.shared.nutrition.BarcodePanel
import app.hacklimits.shared.nutrition.FuelTabs
import app.hacklimits.shared.nutrition.GroceryCard
import app.hacklimits.shared.nutrition.KcalCard
import app.hacklimits.shared.nutrition.MealActions
import app.hacklimits.shared.nutrition.MealList
import app.hacklimits.shared.nutrition.NutritionViewModel
import app.hacklimits.shared.nutrition.PlanCard
import app.hacklimits.shared.nutrition.QuickTiles
import app.hacklimits.shared.nutrition.SearchPanel
import app.hacklimits.shared.nutrition.TextPanel
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject

/** Food: the day's totals, the quick adds (search, voice text, barcode, photo), the meal list with its
 * editor, the meal plan and the grocery list. Port of the Mini App's FuelView.tsx. */
@Composable
fun NutritionScreen(vm: NutritionViewModel, onOpenMealPhoto: () -> Unit) {
    val s by vm.state.collectAsStateWithLifecycle()
    val speech: SpeechInput = koinInject()
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { vm.refresh() }

    val day = s.day
    val loadError = s.loadError
    val planDays = day?.mealPlan?.days.orEmpty()
    val hasPlan = planDays.isNotEmpty()
    val tab = if (hasPlan) s.tab else NutritionViewModel.Tab.Day
    val actions = MealActions(
        onToggle = vm::toggleMealEdit,
        onCorrection = vm::onCorrection,
        onSaveMacros = vm::saveMacros,
        onSaveGrams = vm::saveMealGrams,
        onScale = vm::scaleMeal,
        onDelete = vm::deleteMeal,
    )

    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Text(stringResource(Res.string.fd_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold) }
        item { OfflineStatusNotice(s.offline, s.pendingSync, s.needsAttention, s.lastUpdatedAtMs) }
        if (day == null) {
            item {
                if (loadError != null) {
                    LoadErrorCard(loadError, onRetry = vm::refresh)
                } else {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                }
            }
            return@LazyColumn
        }

        if (hasPlan) item { FuelTabs(tab, vm::setTab) }
        s.actionError?.let { code -> item { ActionErrorCard(code, vm::dismissError) } }

        when (tab) {
            NutritionViewModel.Tab.Day -> {
                item { KcalCard(day) }
                item {
                    QuickTiles(
                        panel = s.panel,
                        onSearch = { vm.togglePanel(NutritionViewModel.Panel.Search) },
                        onPhoto = onOpenMealPhoto,
                        onVoice = { vm.togglePanel(NutritionViewModel.Panel.Text) },
                        onBarcode = { vm.togglePanel(NutritionViewModel.Panel.Barcode) },
                    )
                }
                when (s.panel) {
                    NutritionViewModel.Panel.Search -> item {
                        SearchPanel(
                            query = s.query,
                            onQuery = vm::onQuery,
                            onSearch = vm::search,
                            searching = s.searching,
                            results = s.results,
                            recent = day.recent,
                            onReadd = vm::readd,
                            onPick = vm::pick,
                            busy = s.busy,
                            selected = s.selected,
                            grams = s.grams,
                            onGrams = vm::onGrams,
                            onAdd = vm::addSelected,
                        )
                    }
                    NutritionViewModel.Panel.Text -> item {
                        TextPanel(
                            text = s.freeText,
                            onText = vm::onFreeText,
                            onSend = vm::sendText,
                            busy = s.busy,
                            micAvailable = speech !is NoSpeechInput,
                            onVoice = {
                                val tag = if (Locale.current.language == "uk") "uk-UA" else "en-US"
                                scope.launch { speech.listen(tag)?.let(vm::appendSpoken) }
                            },
                        )
                    }
                    NutritionViewModel.Panel.Barcode -> item {
                        BarcodePanel(
                            code = s.barcode,
                            onCode = vm::onBarcode,
                            onScan = vm::searchBarcode,
                            searching = s.searching,
                            results = s.results,
                            onPick = vm::pick,
                            busy = s.busy,
                            selected = s.selected,
                            grams = s.grams,
                            onGrams = vm::onGrams,
                            onAdd = vm::addSelected,
                        )
                    }
                    null -> Unit
                }
                item { MealList(day.meals, s.editingMeal, s.correction, s.busy, actions) }
                item { AdviceSection(s.advice, s.adviceBusy, onRecipe = { vm.askAdvice(true) }, onRecover = { vm.askAdvice(false) }) }
            }
            NutritionViewModel.Tab.Plan -> item {
                PlanCard(
                    days = planDays,
                    editing = s.planEditing,
                    planGrams = s.planGrams,
                    busy = s.busy,
                    regenerating = s.regenerating,
                    regenerated = s.regenerated,
                    onToggleItem = vm::togglePlanItem,
                    onPlanGrams = vm::onPlanGrams,
                    onScale = vm::scalePlanItem,
                    onSave = vm::savePlanItemGrams,
                    onDelete = vm::deletePlanItem,
                    onRegenerate = vm::regenerateMealPlan,
                )
            }
            NutritionViewModel.Tab.Grocery -> item {
                GroceryCard(
                    days = s.groceryDays,
                    lines = s.grocery,
                    sending = s.grocerySending,
                    sent = s.grocerySent,
                    onDays = vm::loadGrocery,
                    onSend = vm::sendGrocery,
                )
            }
        }
    }
}

/** The whole Food screen cannot load: the error and a retry, nothing else. */
@Composable
private fun LoadErrorCard(code: String, onRetry: () -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(errorText(code)), color = MaterialTheme.colorScheme.error)
            TextButton(onClick = onRetry) { Text(stringResource(Res.string.fd_retry)) }
        }
    }
}

/** A single action failed: shown over the loaded day, dismissible. */
@Composable
private fun ActionErrorCard(code: String, onDismiss: () -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Row(Modifier.padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(errorText(code)), Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
            TextButton(onClick = onDismiss) { Text(stringResource(Res.string.fd_close)) }
        }
    }
}
