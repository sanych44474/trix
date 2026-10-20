package app.hacklimits.shared.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.account.ReleaseItem
import app.hacklimits.shared.account.ReleaseItems
import app.hacklimits.shared.account.TrainerProfile
import app.hacklimits.shared.data.AuthSession
import app.hacklimits.shared.data.SettingsState
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.*
import org.jetbrains.compose.resources.stringResource

/** A titled More section: a card with a heading and its controls. */
@Composable
internal fun SettingsCard(title: String, eyebrow: String? = null, content: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            eyebrow?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

@Composable
internal fun MutedText(text: String) = Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
internal fun ErrorText(text: String) = Text(text, color = MaterialTheme.colorScheme.error)

// ---- Profile: personal details, weekly rhythm, consent (ProfileView.tsx) ----

@Composable
internal fun ProfileSection(profile: ProfileViewModel) {
    val s by profile.state.collectAsStateWithLifecycle()
    val form = s.form
    SettingsCard(stringResource(Res.string.ac_personal_title), stringResource(Res.string.ac_identity_eyebrow)) {
        when {
            s.loading -> CircularProgressIndicator()
            s.loadError || form == null -> {
                ErrorText(stringResource(Res.string.ac_profile_load_error))
                OutlinedButton(onClick = profile::load) { Text(stringResource(Res.string.ac_retry)) }
            }
            else -> {
                OutlinedTextField(form.name, profile::onName, label = { Text(stringResource(Res.string.ac_field_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(form.goalWeight, profile::onGoalWeight, label = { Text(stringResource(Res.string.ac_field_goal_weight)) },
                    placeholder = { Text(stringResource(Res.string.ac_optional)) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Decimal))
                OutlinedTextField(form.waterGoalMl, profile::onWaterGoal, label = { Text(stringResource(Res.string.ac_field_water_goal)) },
                    placeholder = { Text(stringResource(Res.string.ac_auto)) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number))
                OutlinedTextField(form.stepsGoal, profile::onStepsGoal, label = { Text(stringResource(Res.string.ac_field_steps_goal)) },
                    placeholder = { Text("8000") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number))

                ChoiceRow(stringResource(Res.string.ac_field_goal), s.options.goal, form.goal, profile::onGoal)
                ChoiceRow(stringResource(Res.string.ac_field_experience), s.options.level, form.level, profile::onLevel)

                Text(stringResource(Res.string.ac_weekly_rhythm), style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    s.weekdays.forEach { day ->
                        FilterChip(
                            selected = day.value in form.trainingWeekdays,
                            onClick = { profile.toggleWeekday(day.value) },
                            label = { Text(day.label.take(3)) },
                        )
                    }
                }

                form.share?.let { share ->
                    Text(stringResource(Res.string.ac_trainer_visibility), style = MaterialTheme.typography.labelLarge)
                    CheckRow(stringResource(Res.string.ac_share_body), share.body, profile::onShareBody)
                    CheckRow(stringResource(Res.string.ac_share_health), share.health, profile::onShareHealth)
                }

                if (s.saveError) ErrorText(stringResource(Res.string.ac_save_error))
                if (s.saved) MutedText(stringResource(Res.string.ac_saved))
                Button(onClick = profile::saveProfile, enabled = !s.saving, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(if (s.saving) Res.string.ac_saving else Res.string.ac_save_profile))
                }
            }
        }
    }
}

/** A row of single-choice chips for the server's localized options. */
@Composable
private fun ChoiceRow(label: String, options: List<ProfileResponse.Option>, selected: String, onPick: (String) -> Unit) {
    if (options.isEmpty()) return
    Text(label, style = MaterialTheme.typography.labelLarge)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        options.forEach { option ->
            FilterChip(selected = option.value == selected, onClick = { onPick(option.value) }, label = { Text(option.label) })
        }
    }
}

@Composable
internal fun CheckRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
        Text(label, Modifier.fillMaxWidth(0.85f))
    }
}

// ---- Account: sign-in methods (AuthMethodsCard.tsx) ----

@Composable
internal fun AccountSection(
    session: AuthSession?,
    linkEmail: String,
    linkChallengeId: String?,
    linkCode: String,
    busy: Boolean,
    onLinkEmail: (String) -> Unit,
    onSendCode: () -> Unit,
    onLinkCode: (String) -> Unit,
    onVerifyCode: () -> Unit,
    onLinkGoogle: () -> Unit,
    onSignOut: () -> Unit,
) {
    SettingsCard(stringResource(Res.string.ac_auth_title), stringResource(Res.string.ac_account_eyebrow)) {
        MutedText(stringResource(Res.string.ac_auth_detail))
        if (session?.googleLinked == true) MutedText(stringResource(Res.string.ac_auth_google_linked))
        else OutlinedButton(onClick = onLinkGoogle, enabled = !busy) { Text(stringResource(Res.string.more_link_google)) }

        val email = session?.email
        if (session?.method == "email") {
            Text(stringResource(Res.string.ac_auth_signed_in_with_email) + ": " + email.orEmpty())
        } else if (email != null) {
            MutedText(stringResource(Res.string.ac_auth_email_linked) + " " + email)
        } else {
            OutlinedTextField(linkEmail, onLinkEmail, label = { Text(stringResource(Res.string.ac_auth_email)) }, singleLine = true,
                modifier = Modifier.fillMaxWidth(), keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Email))
            if (linkChallengeId == null) {
                OutlinedButton(onClick = onSendCode, enabled = !busy && linkEmail.contains('@')) { Text(stringResource(Res.string.ac_auth_send)) }
            } else {
                MutedText(stringResource(Res.string.ac_auth_expires))
                OutlinedTextField(linkCode, onLinkCode, label = { Text(stringResource(Res.string.ac_auth_code)) }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                Button(onClick = onVerifyCode, enabled = !busy && linkCode.length == 6) { Text(stringResource(Res.string.ac_auth_verify)) }
            }
        }
        TextButton(onClick = onSignOut) { Text(stringResource(Res.string.ac_auth_sign_out)) }
    }
}

// ---- Display: theme, accent, high contrast (theme.ts) ----

@Composable
internal fun DisplaySection(prefs: DisplayPrefs, onMode: (ThemeMode) -> Unit, onAccent: (Accent) -> Unit, onContrast: (Boolean) -> Unit) {
    SettingsCard(stringResource(Res.string.ac_display_title), stringResource(Res.string.ac_display_eyebrow)) {
        Text(stringResource(Res.string.ac_theme_label), style = MaterialTheme.typography.labelLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FilterChip(prefs.mode == ThemeMode.SYSTEM, { onMode(ThemeMode.SYSTEM) }, label = { Text(stringResource(Res.string.ac_theme_system)) })
            FilterChip(prefs.mode == ThemeMode.LIGHT, { onMode(ThemeMode.LIGHT) }, label = { Text(stringResource(Res.string.ac_theme_light)) })
            FilterChip(prefs.mode == ThemeMode.DARK, { onMode(ThemeMode.DARK) }, label = { Text(stringResource(Res.string.ac_theme_dark)) })
        }
        Text(stringResource(Res.string.ac_accent_label), style = MaterialTheme.typography.labelLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FilterChip(prefs.accent == Accent.GREEN, { onAccent(Accent.GREEN) }, enabled = !prefs.highContrast, label = { Text(stringResource(Res.string.ac_accent_green)) })
            FilterChip(prefs.accent == Accent.RED, { onAccent(Accent.RED) }, enabled = !prefs.highContrast, label = { Text(stringResource(Res.string.ac_accent_red)) })
        }
        if (prefs.highContrast) MutedText(stringResource(Res.string.ac_accent_contrast_note))
        CheckRow(stringResource(Res.string.ac_contrast_toggle), prefs.highContrast, onContrast)
        MutedText(stringResource(Res.string.ac_contrast_hint))
    }
}

// ---- Language, reminders, vacation, cycle, leaderboard (settingsApi.ts actions) ----

@Composable
internal fun LanguageSection(current: String, busy: Boolean, onPick: (String) -> Unit) {
    SettingsCard(stringResource(Res.string.ac_language_title), stringResource(Res.string.ac_language_eyebrow)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(current == "uk", { if (!busy) onPick("uk") }, label = { Text(stringResource(Res.string.ac_lang_uk)) })
            FilterChip(current == "en", { if (!busy) onPick("en") }, label = { Text(stringResource(Res.string.ac_lang_en)) })
        }
    }
}

@Composable
internal fun RemindersSection(settings: SettingsState, busy: Boolean, onToggle: (String) -> Unit) {
    SettingsCard(stringResource(Res.string.ac_reminders_title), stringResource(Res.string.ac_reminders_eyebrow)) {
        // The "all" row is the master switch: while it is off, the per-type rows don't apply.
        val masterOff = settings.reminders.any { it.key == "all" && !it.on }
        settings.reminders.forEach { r ->
            val muted = r.key != "all" && masterOff
            CheckRow(r.label, checked = r.on, onChange = { onToggle(r.key) }, enabled = !muted && !busy)
        }
    }
}

@Composable
internal fun VacationSection(settings: SettingsState, dateText: String, busy: Boolean, onDays: (Int) -> Unit, onDate: (String) -> Unit, onStartDate: () -> Unit, onEnd: () -> Unit) {
    SettingsCard(stringResource(Res.string.ac_vacation_title), stringResource(Res.string.ac_vacation_eyebrow)) {
        val until = settings.vacationUntil
        if (until != null) {
            MutedText(stringResource(Res.string.ac_vacation_active, until))
            OutlinedButton(onClick = onEnd, enabled = !busy) { Text(stringResource(Res.string.ac_vacation_end)) }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { onDays(7) }, enabled = !busy) { Text(stringResource(Res.string.ac_vacation_1w)) }
                OutlinedButton(onClick = { onDays(14) }, enabled = !busy) { Text(stringResource(Res.string.ac_vacation_2w)) }
                OutlinedButton(onClick = { onDays(28) }, enabled = !busy) { Text(stringResource(Res.string.ac_vacation_4w)) }
            }
            OutlinedTextField(dateText, onDate, label = { Text(stringResource(Res.string.ac_vacation_custom)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Button(onClick = onStartDate, enabled = !busy && dateText.isNotBlank()) { Text(stringResource(Res.string.ac_vacation_start)) }
        }
    }
}

@Composable
internal fun CycleSection(cycle: SettingsState.Cycle, start: String, len: String, busy: Boolean,
    onToggle: (Boolean) -> Unit, onStart: (String) -> Unit, onLen: (String) -> Unit, onSave: () -> Unit) {
    SettingsCard(stringResource(Res.string.ac_cycle_title), stringResource(Res.string.ac_cycle_eyebrow)) {
        CheckRow(stringResource(Res.string.ac_cycle_toggle), cycle.on, onToggle, enabled = !busy)
        OutlinedTextField(start, onStart, label = { Text(stringResource(Res.string.ac_cycle_last_start)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(len, onLen, label = { Text(stringResource(Res.string.ac_cycle_length)) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number))
        OutlinedButton(onClick = onSave, enabled = !busy) { Text(stringResource(Res.string.ac_cycle_save)) }
    }
}

@Composable
internal fun CompeteSection(compete: SettingsState.Compete, alias: String, busy: Boolean,
    onToggle: (Boolean) -> Unit, onAlias: (String) -> Unit, onSave: () -> Unit) {
    SettingsCard(stringResource(Res.string.ac_compete_title), stringResource(Res.string.ac_compete_eyebrow)) {
        CheckRow(stringResource(Res.string.ac_compete_toggle), compete.on, onToggle, enabled = !busy)
        OutlinedTextField(alias, onAlias, placeholder = { Text(stringResource(Res.string.ac_alias_hint)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedButton(onClick = onSave, enabled = !busy) { Text(stringResource(Res.string.ac_compete_save)) }
    }
}

// ---- Trainer: invite, become a trainer, disconnect (BecomeTrainer.tsx, ExtrasView.tsx) ----

@Composable
internal fun InviteSection(link: String, referredCount: Int) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    SettingsCard(stringResource(Res.string.ex_invite_title)) {
        MutedText(stringResource(Res.string.ex_invite_detail))
        if (referredCount > 0) MutedText(stringResource(Res.string.ex_invite_count, referredCount.toString()))
        if (link.isNotBlank()) {
            Button(onClick = {
                clipboard.setText(AnnotatedString(link))
                copied = true
            }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(if (copied) Res.string.ex_invite_copied else Res.string.ex_invite_copy))
            }
        }
    }
}

@Composable
internal fun TrainerSection(role: String, trainer: TrainerProfile?, form: ProfileViewModel.TrainerForm, busy: Boolean, sent: Boolean, error: Boolean,
    onForm: ((ProfileViewModel.TrainerForm) -> ProfileViewModel.TrainerForm) -> Unit, onSubmit: () -> Unit) {
    SettingsCard(
        stringResource(if (trainer != null) Res.string.ac_trainer_edit_title else Res.string.ac_trainer_apply_title),
        stringResource(Res.string.ac_trainer_eyebrow),
    ) {
        if (trainer != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(statusTitle(trainer.status)), fontWeight = FontWeight.SemiBold)
                Text(stringResource(Res.string.ac_trainer_clients, trainer.clients.toString()), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            MutedText(stringResource(statusBody(trainer.status)))
        } else {
            MutedText(stringResource(Res.string.ac_trainer_detail))
        }
        if (sent && trainer == null) {
            MutedText(stringResource(Res.string.ac_trainer_pending_note))
        } else {
            OutlinedTextField(form.name, { v -> onForm { it.copy(name = v.take(60)) } }, label = { Text(stringResource(Res.string.ac_field_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(form.specialization, { v -> onForm { it.copy(specialization = v.take(120)) } }, label = { Text(stringResource(Res.string.ac_trainer_field_specialization)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(form.city, { v -> onForm { it.copy(city = v.take(60)) } }, label = { Text(stringResource(Res.string.ac_trainer_field_city)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(form.contact, { v -> onForm { it.copy(contact = v.take(120)) } }, label = { Text(stringResource(Res.string.ac_trainer_field_contact)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(form.bio, { v -> onForm { it.copy(bio = v.take(600)) } }, label = { Text(stringResource(Res.string.ac_trainer_field_bio)) }, modifier = Modifier.fillMaxWidth())
            Button(onClick = onSubmit, enabled = !busy && form.name.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(if (trainer != null) Res.string.ac_save_profile else Res.string.ac_trainer_submit))
            }
            if (sent && trainer != null) MutedText(stringResource(Res.string.ac_profile_updated))
        }
        if (error) ErrorText(stringResource(Res.string.ac_generic_error))
    }
}

private fun statusTitle(status: String) = when (status) {
    "approved" -> Res.string.ac_trainer_status_approved_title
    "rejected" -> Res.string.ac_trainer_status_rejected_title
    else -> Res.string.ac_trainer_status_pending_title
}

private fun statusBody(status: String) = when (status) {
    "approved" -> Res.string.ac_trainer_status_approved_body
    "rejected" -> Res.string.ac_trainer_status_rejected_body
    else -> Res.string.ac_trainer_status_pending_body
}

@Composable
internal fun LeaveTrainerSection(busy: Boolean, onLeave: () -> Unit) {
    var confirm by remember { mutableStateOf(false) }
    SettingsCard(stringResource(Res.string.ac_leave_title), stringResource(Res.string.ac_leave_eyebrow)) {
        MutedText(stringResource(Res.string.ac_leave_detail))
        if (!confirm) {
            OutlinedButton(onClick = { confirm = true }) { Text(stringResource(Res.string.ac_leave_btn)) }
        } else {
            Text(stringResource(Res.string.ac_leave_confirm_title), fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onLeave, enabled = !busy) { Text(stringResource(Res.string.ac_leave_confirm_btn)) }
                TextButton(onClick = { confirm = false }) { Text(stringResource(Res.string.ac_cancel)) }
            }
        }
    }
}

// ---- What's new (permanent copy; the Today card is separate) ----

@Composable
internal fun WhatsNewSection(version: String, items: List<ReleaseItem>) {
    SettingsCard(stringResource(Res.string.ex_whatsnew_title), "${stringResource(Res.string.ex_whatsnew_eyebrow)} · $version") {
        ReleaseItems(items)
    }
}

// ---- Feedback, export, privacy, deletion ----

@Composable
internal fun FeedbackSection(text: String, busy: Boolean, onText: (String) -> Unit, onSend: () -> Unit) {
    SettingsCard(stringResource(Res.string.ac_feedback_title), stringResource(Res.string.ac_feedback_eyebrow)) {
        OutlinedTextField(text, onText, placeholder = { Text(stringResource(Res.string.ac_feedback_hint)) }, modifier = Modifier.fillMaxWidth(), minLines = 3)
        OutlinedButton(onClick = onSend, enabled = !busy && text.trim().length >= 2) { Text(stringResource(Res.string.ac_feedback_send)) }
    }
}

@Composable
internal fun ExportSection(busy: Boolean, onMarkdown: () -> Unit, onJson: () -> Unit) {
    SettingsCard(stringResource(Res.string.ac_export_title), stringResource(Res.string.ac_export_eyebrow)) {
        MutedText(stringResource(Res.string.ac_export_detail))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onMarkdown, enabled = !busy) { Text(stringResource(Res.string.ac_export_md)) }
            OutlinedButton(onClick = onJson, enabled = !busy) { Text(stringResource(Res.string.ac_export_json)) }
        }
    }
}

@Composable
internal fun DangerSection(busy: Boolean, onDelete: () -> Unit) {
    var step by remember { mutableStateOf(0) }
    SettingsCard(stringResource(Res.string.ac_delete_title), stringResource(Res.string.ac_danger_eyebrow)) {
        MutedText(stringResource(Res.string.ac_delete_detail))
        if (step == 0) {
            TextButton(onClick = { step = 1 }) { Text(stringResource(Res.string.ac_delete_btn), color = MaterialTheme.colorScheme.error) }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = onDelete,
                    enabled = !busy,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(Res.string.ac_delete_confirm_btn)) }
                TextButton(onClick = { step = 0 }) { Text(stringResource(Res.string.ac_cancel)) }
            }
        }
    }
}
