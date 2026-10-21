package app.hacklimits.shared.plan

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.data.Plan
import app.hacklimits.shared.data.ReplanStatus
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

/** The equipment the server accepts for a profile (fitkit / onboarding), with its label. */
internal val EQUIPMENT_CHOICES: List<Pair<String, StringResource>> = listOf(
    "full gym" to Res.string.ob_equip_full_gym,
    "home basics (dumbbells, bands)" to Res.string.ob_equip_home_basics,
    "dumbbells only" to Res.string.ob_equip_dumbbells_only,
    "bodyweight only" to Res.string.ob_equip_bodyweight_only,
)

internal fun equipmentLabelOf(value: String): StringResource? = EQUIPMENT_CHOICES.firstOrNull { it.first == value }?.second

/** "Rebuild my plan": two taps replace the plan from the current profile; it builds in the background. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RebuildPlanCard(status: ReplanStatus, error: Boolean, onStart: () -> Unit) {
    var confirming by remember { mutableStateOf(false) }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(Res.string.pl_rebuild_eyebrow), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(stringResource(Res.string.pl_rebuild_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (status.pending) {
                Text("⏳ " + stringResource(Res.string.pl_rebuild_pending), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Text(stringResource(Res.string.pl_rebuild_detail), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (status.failed) Text(stringResource(Res.string.pl_rebuild_failed), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (confirming) {
                        Button(onClick = { confirming = false; onStart() }) { Text(stringResource(Res.string.pl_rebuild_confirm_btn)) }
                        TextButton(onClick = { confirming = false }) { Text(stringResource(Res.string.pl_close)) }
                    } else {
                        OutlinedButton(onClick = { confirming = true }) { Text(stringResource(Res.string.pl_rebuild_btn)) }
                    }
                }
            }
            if (error) Text(stringResource(Res.string.pl_generic_error), color = MaterialTheme.colorScheme.error)
        }
    }
}

/** "Fit my plan to my equipment": exercises needing gear the owner does not have. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun KitFitCard(kit: Plan.Kit, busy: Boolean, onFit: (equipment: String?) -> Unit) {
    val current = kit.equipment
    var choice by remember(current) { mutableStateOf(if (EQUIPMENT_CHOICES.any { it.first == current }) current else "dumbbells only") }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(Res.string.pl_kitfit_eyebrow), style = MaterialTheme.typography.labelLarge)
            Text(stringResource(Res.string.pl_kitfit_title, kit.mismatches), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            val currentLabel = equipmentLabelOf(current)?.let { stringResource(it) } ?: current
            Text(stringResource(Res.string.pl_kitfit_body, currentLabel))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                EQUIPMENT_CHOICES.forEach { (value, label) ->
                    FilterChip(selected = choice == value, onClick = { choice = value }, label = { Text(stringResource(label)) })
                }
            }
            Button(
                onClick = { onFit(choice.takeIf { it != current }) },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(if (busy) Res.string.pl_saving_ellipsis else Res.string.pl_kitfit_btn))
            }
        }
    }
}

/** Block periodization: start or stop the phases overlay. */
@Composable
fun MesocycleCard(meso: Plan.Mesocycle?, busy: Boolean, onToggle: (on: Boolean) -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    stringResource(if (meso != null) mesoPhaseLabel(meso.phase) else Res.string.pl_meso_start_btn),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                if (meso != null) {
                    val total = if (meso.phase == "deload") 1 else meso.blockLength
                    Text(stringResource(Res.string.pl_meso_week, meso.weekInBlock, total), color = MaterialTheme.colorScheme.primary)
                }
            }
            if (meso != null) {
                val g = mesoGuidance(meso.phase)
                Text(stringResource(Res.string.pl_meso_target_line, g.reps, g.intensity), color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedButton(onClick = { onToggle(false) }, enabled = !busy) {
                    Text(stringResource(if (busy) Res.string.pl_saving_ellipsis else Res.string.pl_meso_stop_btn))
                }
            } else {
                Text(stringResource(Res.string.pl_meso_intro), color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedButton(onClick = { onToggle(true) }, enabled = !busy) {
                    Text(stringResource(if (busy) Res.string.pl_saving_ellipsis else Res.string.pl_meso_start_btn))
                }
            }
        }
    }
}

/** "Balance" card: muscles the plan leaves out or lopsided, each with one exercise to add. */
@Composable
internal fun BalanceCard(issues: List<BalanceIssue>, busy: Boolean, onAdd: (weekday: Int, name: String) -> Unit) {
    val isUk = stringResource(Res.string.pl_exlib_lang) == "uk"
    fun sets(n: Double): String = if (n % 1.0 == 0.0) n.toInt().toString() else n.toString().let { if (isUk) it.replace('.', ',') else it }
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(Res.string.pl_plan_balance_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            issues.forEach { issue ->
                val muscle = stringResource(muscleLabel(issue.slug))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(muscle, fontWeight = FontWeight.SemiBold)
                        val detail = if (issue.kind == BalanceKind.IMBALANCE && issue.otherSlug != null) {
                            stringResource(
                                Res.string.pl_plan_balance_imbalance,
                                sets(issue.sets),
                                sets(issue.otherSets),
                                stringResource(muscleLabel(issue.otherSlug)),
                            )
                        } else {
                            stringResource(Res.string.pl_plan_balance_missing)
                        }
                        Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    issue.suggestion?.let { s ->
                        val name = if (isUk) s.uk else s.en
                        val day = stringResource(weekdayLabel(s.weekday))
                        OutlinedButton(onClick = { onAdd(s.weekday, name) }, enabled = !busy) {
                            Text(stringResource(Res.string.pl_plan_balance_add, name, day))
                        }
                    }
                }
            }
        }
    }
}

private fun mesoPhaseLabel(phase: String): StringResource = when (phase) {
    "hypertrophy" -> Res.string.pl_meso_phase_hypertrophy
    "strength" -> Res.string.pl_meso_phase_strength
    "peak" -> Res.string.pl_meso_phase_peak
    else -> Res.string.pl_meso_phase_deload
}
