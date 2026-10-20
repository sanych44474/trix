package app.hacklimits.shared.today

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.hacklimits.shared.data.TrackingApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** Water, steps and the daily check-in, one tap each from Today. */
@OptIn(ExperimentalUuidApi::class)
class QuickLogViewModel(private val api: TrackingApi) : ViewModel() {
    enum class Done { Water, Steps, Checkin }

    data class State(
        val busy: Boolean = false,
        val done: Done? = null,
        val failed: Boolean = false,
        val waterToday: Int = 0,
        val steps: String = "",
        val energy: Int = 3,
        val sleep: Int = 3,
        val stress: Int = 3,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    fun addWater(ml: Int = 250) = act(Done.Water) { api.water(ml, key()); _state.update { it.copy(waterToday = it.waterToday + ml) } }

    fun onSteps(value: String) = _state.update { it.copy(steps = value.filter(Char::isDigit).take(6)) }
    fun saveSteps() {
        val steps = _state.value.steps.toIntOrNull()?.takeIf { it in 0..200_000 } ?: return
        act(Done.Steps) { api.steps(steps, key()); _state.update { it.copy(steps = "") } }
    }

    fun setEnergy(v: Int) = _state.update { it.copy(energy = v) }
    fun setSleep(v: Int) = _state.update { it.copy(sleep = v) }
    fun setStress(v: Int) = _state.update { it.copy(stress = v) }
    fun saveCheckin() = _state.value.let { s -> act(Done.Checkin) { api.checkin(s.energy, s.sleep, s.stress, key()) } }

    private fun key() = Uuid.random().toString()

    private fun act(done: Done, block: suspend () -> Unit) {
        if (_state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, done = null, failed = false) }
            val ok = runCatching { block() }.isSuccess
            _state.update { it.copy(busy = false, done = if (ok) done else null, failed = !ok) }
        }
    }
}
