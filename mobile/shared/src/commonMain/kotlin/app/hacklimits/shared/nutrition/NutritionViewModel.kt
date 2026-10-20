package app.hacklimits.shared.nutrition

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.FoodItem
import app.hacklimits.shared.data.GroceryLine
import app.hacklimits.shared.data.MealPlan
import app.hacklimits.shared.data.NutritionApi
import app.hacklimits.shared.data.NutritionDay
import app.hacklimits.shared.data.PlanDay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Food: the day's totals against targets, the log, the four ways to add, the meal plan and the
 * grocery list. Port of the Mini App's FuelView.tsx; every action reloads or patches the day. */
@OptIn(ExperimentalUuidApi::class)
class NutritionViewModel(private val api: NutritionApi) : ViewModel() {
    enum class Tab { Day, Plan, Grocery }
    /** The add panels under the quick tiles. The photo tile opens its own screen instead. */
    enum class Panel { Search, Text, Barcode }

    /** Edit fields for one logged meal; strings so a half-typed number survives recomposition. */
    data class Correction(val kcal: String = "", val protein: String = "", val fats: String = "", val carbs: String = "", val grams: String = "")

    /** A meal-plan item: the nested day -> meal -> item address. */
    data class PlanItemRef(val dayIndex: Int, val mealIndex: Int, val itemIndex: Int)

    data class State(
        val day: NutritionDay? = null,
        /** The load failed and there is nothing to show: the whole screen is the error state. */
        val loadError: String? = null,
        /** A single action failed; shown as a dismissible note over the loaded day. */
        val actionError: String? = null,
        val busy: Boolean = false,
        val tab: Tab = Tab.Day,
        val panel: Panel? = null,
        val freeText: String = "",
        val query: String = "",
        val barcode: String = "",
        val searching: Boolean = false,
        val results: List<FoodItem> = emptyList(),
        val selected: FoodItem? = null,
        val grams: String = "100",
        val editingMeal: Int? = null,
        val correction: Correction = Correction(),
        /** null: nothing asked yet; "": asked, nothing came back. */
        val advice: String? = null,
        val adviceBusy: Boolean = false,
        val grocery: List<GroceryLine>? = null,
        val groceryDays: Int = 3,
        val grocerySending: Boolean = false,
        val grocerySent: Boolean = false,
        val regenerating: Boolean = false,
        val regenerated: Boolean = false,
        val planEditing: PlanItemRef? = null,
        val planGrams: String = "",
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    /** First load and retry: a failure replaces the screen with the error state. */
    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(loadError = null) }
            try {
                val day = api.day()
                _state.update { it.copy(day = day, loadError = null) }
            } catch (e: ApiException) {
                _state.update { it.copy(loadError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(loadError = "network") }
            }
        }
    }

    fun setTab(tab: Tab) = _state.update { it.copy(tab = tab) }

    fun togglePanel(panel: Panel) = _state.update { it.copy(panel = if (it.panel == panel) null else panel) }

    fun dismissError() = _state.update { it.copy(actionError = null) }

    fun onFreeText(value: String) = _state.update { it.copy(freeText = value.take(500)) }

    /** Speech input adds to the text the same way the Mini App's voice button does. */
    fun appendSpoken(spoken: String) = _state.update {
        it.copy(freeText = if (it.freeText.trim().isNotEmpty()) "${it.freeText.trim()}, $spoken" else spoken)
    }

    fun onQuery(value: String) = _state.update { it.copy(query = value) }
    fun onBarcode(value: String) = _state.update { it.copy(barcode = value.filter(Char::isDigit).take(32)) }
    fun onGrams(value: String) = _state.update { it.copy(grams = value.filter(Char::isDigit).take(4)) }

    fun search() {
        val q = _state.value.query.trim()
        if (q.length < 2) return
        lookup { api.search(q, key()) }
    }

    fun searchBarcode() {
        val code = _state.value.barcode.filter(Char::isDigit)
        if (code.length < 2) return
        lookup { api.barcode(code, key()) }
    }

    private fun lookup(block: suspend () -> List<FoodItem>) {
        viewModelScope.launch {
            _state.update { it.copy(searching = true, actionError = null) }
            try {
                val items = block()
                _state.update { it.copy(results = items) }
            } catch (e: ApiException) {
                _state.update { it.copy(actionError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(actionError = "network") }
            } finally {
                _state.update { it.copy(searching = false) }
            }
        }
    }

    /** Picking a result fills in its typical portion when it has one. */
    fun pick(item: FoodItem) = _state.update {
        it.copy(selected = item, grams = item.portionG?.let { g -> formatGrams(g) } ?: it.grams)
    }

    fun addSelected() {
        val s = _state.value
        val item = s.selected ?: return
        val amount = s.grams.toDoubleOrNull()?.takeIf { it in 1.0..3000.0 } ?: return
        act {
            api.addFromDb(item, amount, key())
            _state.update { it.copy(selected = null, results = emptyList(), query = "", barcode = "") }
        }
    }

    fun readd(ri: Int) = act { api.readd(ri, key()) }

    fun sendText() {
        val text = _state.value.freeText.trim().ifEmpty { return }
        act {
            api.logText(text, key())
            _state.update { it.copy(freeText = "") }
        }
    }

    fun toggleMealEdit(meal: NutritionDay.Meal) {
        _state.update {
            if (it.editingMeal == meal.index) {
                it.copy(editingMeal = null)
            } else {
                it.copy(
                    editingMeal = meal.index,
                    correction = Correction(
                        kcal = formatGrams(meal.kcal), protein = formatGrams(meal.protein), fats = formatGrams(meal.fats),
                        carbs = formatGrams(meal.carbs), grams = meal.grams?.let { g -> formatGrams(g) } ?: "",
                    ),
                )
            }
        }
    }

    fun onCorrection(correction: Correction) = _state.update { it.copy(correction = correction) }

    fun saveMacros() {
        val s = _state.value
        val index = s.editingMeal ?: return
        val c = s.correction
        val kcal = c.kcal.toDoubleOrNull() ?: return
        val protein = c.protein.toDoubleOrNull() ?: return
        val fats = c.fats.toDoubleOrNull() ?: return
        val carbs = c.carbs.toDoubleOrNull() ?: return
        act(closeEditor = true) { api.setMacros(index, kcal, protein, fats, carbs, key()) }
    }

    fun saveMealGrams() {
        val s = _state.value
        val index = s.editingMeal ?: return
        val grams = s.correction.grams.toDoubleOrNull() ?: return
        act(closeEditor = true) { api.setGrams(index, grams, key()) }
    }

    fun scaleMeal(factor: Double) {
        val index = _state.value.editingMeal ?: return
        act(closeEditor = true) { api.scale(index, factor, key()) }
    }

    fun deleteMeal() {
        val index = _state.value.editingMeal ?: return
        act(closeEditor = true) { api.delete(index, key()) }
    }

    fun askAdvice(recipe: Boolean) {
        viewModelScope.launch {
            _state.update { it.copy(adviceBusy = true, actionError = null) }
            try {
                val text = if (recipe) api.recipe(key()) else api.recover(key())
                _state.update { it.copy(advice = text.trim()) }
            } catch (e: ApiException) {
                _state.update { it.copy(actionError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(actionError = "network") }
            } finally {
                _state.update { it.copy(adviceBusy = false) }
            }
        }
    }

    fun loadGrocery(days: Int) {
        viewModelScope.launch {
            _state.update { it.copy(groceryDays = days, grocerySent = false, actionError = null) }
            try {
                val lines = api.grocery(days, key())
                _state.update { it.copy(grocery = lines) }
            } catch (e: ApiException) {
                _state.update { it.copy(actionError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(actionError = "network") }
            }
        }
    }

    fun sendGrocery() {
        viewModelScope.launch {
            _state.update { it.copy(grocerySending = true, grocerySent = false, actionError = null) }
            try {
                api.grocerySend(_state.value.groceryDays, key())
                _state.update { it.copy(grocerySent = true) }
            } catch (e: ApiException) {
                _state.update { it.copy(actionError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(actionError = "network") }
            } finally {
                _state.update { it.copy(grocerySending = false) }
            }
        }
    }

    /** A fresh day built from the saved allergen, likes and dislikes (the bot's "use previous" action). */
    fun regenerateMealPlan() {
        viewModelScope.launch {
            _state.update { it.copy(regenerating = true, regenerated = false, actionError = null) }
            try {
                val days = api.regenerateMealPlan(key())
                _state.update { it.copy(day = it.day.withPlan(days), regenerated = true) }
            } catch (e: ApiException) {
                _state.update { it.copy(actionError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(actionError = "network") }
            } finally {
                _state.update { it.copy(regenerating = false) }
            }
        }
    }

    fun togglePlanItem(ref: PlanItemRef, grams: Double) = _state.update {
        if (it.planEditing == ref) it.copy(planEditing = null) else it.copy(planEditing = ref, planGrams = formatGrams(grams))
    }

    fun onPlanGrams(value: String) = _state.update { it.copy(planGrams = value.filter(Char::isDigit).take(4)) }

    fun scalePlanItem(factor: Double) {
        val ref = _state.value.planEditing ?: return
        planAct { api.planItemScale(ref.dayIndex, ref.mealIndex, ref.itemIndex, factor, key()) }
    }

    fun savePlanItemGrams() {
        val s = _state.value
        val ref = s.planEditing ?: return
        val grams = s.planGrams.toDoubleOrNull() ?: return
        planAct { api.planItemGrams(ref.dayIndex, ref.mealIndex, ref.itemIndex, grams, key()) }
    }

    fun deletePlanItem() {
        val ref = _state.value.planEditing ?: return
        planAct { api.planItemDelete(ref.dayIndex, ref.mealIndex, ref.itemIndex, key()) }
    }

    private fun planAct(block: suspend () -> List<PlanDay>) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, actionError = null) }
            try {
                val days = block()
                _state.update { it.copy(day = it.day.withPlan(days), planEditing = null) }
            } catch (e: ApiException) {
                _state.update { it.copy(actionError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(actionError = "network") }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }

    /** A write that changes the day: runs, then reloads the day. */
    private fun act(closeEditor: Boolean = false, block: suspend () -> Unit) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, actionError = null) }
            try {
                block()
                if (closeEditor) _state.update { it.copy(editingMeal = null) }
                val day = api.day()
                _state.update { it.copy(day = day) }
            } catch (e: ApiException) {
                _state.update { it.copy(actionError = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(actionError = "network") }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }

    private fun NutritionDay?.withPlan(days: List<PlanDay>): NutritionDay? = this?.copy(mealPlan = MealPlan(days))

    private fun key() = Uuid.random().toString()
}

/** Grams as the Mini App shows them: whole numbers without a decimal point. */
internal fun formatGrams(value: Double): String =
    if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()
