package app.hacklimits.shared.nutrition

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.ApiException
import app.hacklimits.shared.data.FoodItem
import app.hacklimits.shared.data.NutritionApi
import app.hacklimits.shared.data.NutritionDay
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Today's food: totals against targets, the log, and four ways to add (search, recent, text). */
@OptIn(ExperimentalUuidApi::class)
class NutritionViewModel(private val api: NutritionApi) : ViewModel() {
    data class State(
        val day: NutritionDay? = null,
        val busy: Boolean = false,
        val error: String? = null,
        val query: String = "",
        val results: List<FoodItem> = emptyList(),
        val picked: FoodItem? = null,
        val grams: String = "",
        val freeText: String = "",
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state
    private var searchJob: Job? = null

    fun refresh() {
        viewModelScope.launch {
            _state.update {
                try { it.copy(day = api.day(), error = null) }
                catch (e: ApiException) { it.copy(error = e.code) }
                catch (e: Exception) { it.copy(error = "network") }
            }
        }
    }

    fun onQuery(value: String) {
        _state.update { it.copy(query = value, picked = null) }
        searchJob?.cancel()
        if (value.trim().length < 2) { _state.update { it.copy(results = emptyList()) }; return }
        searchJob = viewModelScope.launch {
            delay(350)
            val found = runCatching { api.search(value.trim()) }.getOrDefault(emptyList())
            _state.update { it.copy(results = found) }
        }
    }

    fun pick(item: FoodItem) = _state.update { it.copy(picked = item, grams = item.portionG?.toInt()?.toString() ?: "100", results = emptyList()) }
    fun onGrams(value: String) = _state.update { it.copy(grams = value.filter(Char::isDigit).take(4)) }
    fun onFreeText(value: String) = _state.update { it.copy(freeText = value.take(500)) }

    fun addPicked() {
        val s = _state.value
        val item = s.picked ?: return
        val grams = s.grams.toDoubleOrNull()?.takeIf { it in 1.0..5000.0 } ?: return
        act { api.addFromDb(item, grams, key()); _state.update { it.copy(picked = null, query = "", grams = "") } }
    }

    fun addText() {
        val text = _state.value.freeText.trim().takeIf { it.length >= 2 } ?: return
        act { api.logText(text, key()); _state.update { it.copy(freeText = "") } }
    }

    fun readd(ri: Int) = act { api.readd(ri, key()) }
    fun delete(index: Int) = act { api.delete(index) }

    private fun key() = Uuid.random().toString()

    private fun act(block: suspend () -> Unit) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            try {
                block()
                _state.update { it.copy(day = api.day()) }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.code) }
            } catch (e: Exception) {
                _state.update { it.copy(error = "network") }
            } finally {
                _state.update { it.copy(busy = false) }
            }
        }
    }
}
