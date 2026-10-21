package app.hacklimits.shared.plan

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource
import kotlin.math.floor
import kotlin.math.roundToInt

/** The profile answers onboarding no longer asks, asked one at a time: the server's profile field names. */
object FineTuneGap {
    const val SEX = "sex"
    const val AGE = "age"
    const val HEIGHT = "heightCm"
    const val WEIGHT = "weightKg"
    const val LIFESTYLE = "lifestyle"
    const val SESSION_MINUTES = "sessionMinutes"
    const val DIET = "dietPrefs"
}

private class Choice(val value: JsonPrimitive, val label: StringResource)
private class NumberInput(val min: Double, val max: Double, val step: Double, val unit: StringResource, val placeholder: String)

private val CHOICES: Map<String, List<Choice>> = mapOf(
    FineTuneGap.SEX to listOf(Choice(JsonPrimitive("male"), Res.string.ob_sex_male), Choice(JsonPrimitive("female"), Res.string.ob_sex_female)),
    FineTuneGap.LIFESTYLE to listOf(
        Choice(JsonPrimitive("sedentary"), Res.string.ob_obo_life_sedentary),
        Choice(JsonPrimitive("moderate"), Res.string.ob_obo_life_moderate),
        Choice(JsonPrimitive("active"), Res.string.ob_obo_life_active),
    ),
    FineTuneGap.SESSION_MINUTES to listOf(
        Choice(JsonPrimitive(30), Res.string.ob_obo_min_30),
        Choice(JsonPrimitive(45), Res.string.ob_obo_min_45),
        Choice(JsonPrimitive(60), Res.string.ob_obo_min_60),
        Choice(JsonPrimitive(90), Res.string.ob_obo_min_90),
    ),
    FineTuneGap.DIET to listOf(
        Choice(JsonPrimitive("none"), Res.string.ob_diet_everything),
        Choice(JsonPrimitive("vegetarian"), Res.string.ob_diet_vegetarian),
        Choice(JsonPrimitive("vegan"), Res.string.ob_diet_vegan),
    ),
)

private val NUMBERS: Map<String, NumberInput> = mapOf(
    FineTuneGap.AGE to NumberInput(13.0, 100.0, 1.0, Res.string.ob_obu_years, "30"),
    FineTuneGap.HEIGHT to NumberInput(100.0, 250.0, 1.0, Res.string.ob_obu_cm, "175"),
    FineTuneGap.WEIGHT to NumberInput(30.0, 300.0, 0.1, Res.string.ob_obu_kg, "75"),
)

private fun questionOf(gap: String): StringResource = when (gap) {
    FineTuneGap.SEX -> Res.string.ob_obq_sex
    FineTuneGap.AGE -> Res.string.ob_obq_age
    FineTuneGap.HEIGHT -> Res.string.ob_obq_height
    FineTuneGap.WEIGHT -> Res.string.ob_obq_weight
    FineTuneGap.LIFESTYLE -> Res.string.ob_obq_lifestyle
    FineTuneGap.SESSION_MINUTES -> Res.string.ob_obq_duration
    else -> Res.string.ob_obq_diet
}

/**
 * The fine-tune card: one profile question at a time for the gaps in [gaps], one tap or one number
 * each. [onSave] stores a single answer (see [FineTuneApi.save]) and returns whether it went through;
 * a failed answer keeps its question. "Later" hides the card for this visit only.
 */
@Composable
fun FineTuneCard(
    gaps: List<String>,
    onSave: suspend (field: String, value: JsonPrimitive) -> Boolean,
    onSaved: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var hidden by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf<List<String>>(emptyList()) }
    var value by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val left = gaps.filter { it !in done }
    val gap = left.firstOrNull()
    if (hidden || gap == null) return

    fun save(v: JsonPrimitive) {
        busy = true
        scope.launch {
            val ok = onSave(gap, v)
            busy = false
            if (ok) {
                done = done + gap
                value = ""
                if (left.size == 1) onSaved()
            }
        }
    }

    val num = NUMBERS[gap]
    val parsed = value.replace(',', '.').toDoubleOrNull()
    val valid = num != null && parsed != null && parsed >= num.min && parsed <= num.max

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(Res.string.pl_ft_eyebrow, left.size), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(stringResource(questionOf(gap)), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(stringResource(Res.string.pl_ft_why), color = MaterialTheme.colorScheme.onSurfaceVariant)
            CHOICES[gap]?.forEach { choice ->
                OutlinedButton(onClick = { save(choice.value) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(choice.label))
                }
            }
            if (num != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = value,
                        onValueChange = { value = it },
                        placeholder = { Text(num.placeholder) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.weight(1f),
                    )
                    Text(stringResource(num.unit), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(
                        onClick = {
                            val n = parsed ?: return@Button
                            save(if (gap == FineTuneGap.WEIGHT) JsonPrimitive(floor(n * 10 + 0.5) / 10.0) else JsonPrimitive(n.roundToInt()))
                        },
                        enabled = !busy && valid,
                    ) { Text(stringResource(Res.string.pl_ft_save)) }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { hidden = true }) { Text(stringResource(Res.string.pl_ft_later)) }
            }
        }
    }
}
