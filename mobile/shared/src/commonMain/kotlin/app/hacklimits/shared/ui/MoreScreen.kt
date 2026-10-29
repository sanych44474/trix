package app.hacklimits.shared.ui

import app.hacklimits.shared.resources.tx_cardio_title
import app.hacklimits.shared.resources.tt_report_title
import app.hacklimits.shared.resources.tt_share_title
import app.hacklimits.shared.daily.ReminderHourSetting
import androidx.compose.runtime.key
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.hacklimits.shared.resources.Res
import app.hacklimits.shared.resources.ib_title
import app.hacklimits.shared.resources.ac_tool_owner
import app.hacklimits.shared.resources.pl_report_injury_title
import app.hacklimits.shared.resources.*
import app.hacklimits.shared.settings.AccountSection
import app.hacklimits.shared.settings.CompeteSection
import app.hacklimits.shared.settings.CycleSection
import app.hacklimits.shared.settings.DangerSection
import app.hacklimits.shared.settings.DisplaySection
import app.hacklimits.shared.settings.ExportSection
import app.hacklimits.shared.settings.FeedbackSection
import app.hacklimits.shared.settings.InviteSection
import app.hacklimits.shared.settings.LanguageSection
import app.hacklimits.shared.settings.LeaveTrainerSection
import app.hacklimits.shared.settings.MoreViewModel
import app.hacklimits.shared.settings.MoreViewModel.Message
import app.hacklimits.shared.settings.ProfileSection
import app.hacklimits.shared.settings.ProfileViewModel
import app.hacklimits.shared.settings.RemindersSection
import app.hacklimits.shared.settings.SettingsCard
import app.hacklimits.shared.settings.TrainerSection
import app.hacklimits.shared.settings.VacationSection
import app.hacklimits.shared.settings.WhatsNewSection
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

/** Where More can send the person; App maps these to routes. */
enum class MoreDestination { Coach, Social, Integrations, TrainerClients, TrainerBusiness }

/** Tools other slices own (and Choose a trainer, which is this slice's FindTrainerScreen). Kept apart from
 * [MoreDestination] so the App's exhaustive `when` does not have to change to build; the lead routes them via [onOpenTool]. */
enum class MoreTool { Owner, Cardio, TrainerReport, ProgramSharing, Inbox, Injuries, FindTrainer, Programs, Library, FormCheck, ImportCsv }

@Composable
fun MoreScreen(
    vm: MoreViewModel,
    privacyUrl: String?,
    onSignOut: () -> Unit,
    beforeSignOut: suspend () -> Unit,
    onOpen: (MoreDestination) -> Unit,
    onOpenTool: (MoreTool) -> Unit = {},
    /** Only the bot owner sees the console entry (the server answers 404 to everyone else). */
    isOwner: Boolean = false,
    profile: ProfileViewModel = koinViewModel(),
) {
    val s by vm.state.collectAsStateWithLifecycle()
    val p by profile.state.collectAsStateWithLifecycle()
    val uri = LocalUriHandler.current
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(Res.string.more_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        s.message?.let { msg ->
            val text = when (msg) {
                Message.Saved -> Res.string.ac_saved
                Message.Exported -> Res.string.more_exported
                Message.ExportEmpty -> Res.string.ac_export_error
                Message.EmailLinked -> Res.string.ac_auth_email_linked
                Message.GoogleLinked -> Res.string.ac_auth_google_linked
                Message.FeedbackSent -> Res.string.ac_feedback_sent
                Message.TrainerLeft -> Res.string.ac_leave_done
                Message.Error -> Res.string.ac_generic_error
                Message.NetworkError -> Res.string.err_network
            }
            val failed = msg == Message.Error || msg == Message.NetworkError || msg == Message.ExportEmpty
            Text(stringResource(text), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
        }

        val settings = s.settings
        SettingsCard(stringResource(Res.string.more_group_training)) {
            Entry(stringResource(Res.string.more_coach)) { onOpen(MoreDestination.Coach) }
            Entry(stringResource(Res.string.ac_tool_programs)) { onOpenTool(MoreTool.Programs) }
            Entry(stringResource(Res.string.ac_tool_library)) { onOpenTool(MoreTool.Library) }
            Entry(stringResource(Res.string.ac_tool_formcheck)) { onOpenTool(MoreTool.FormCheck) }
            Entry(stringResource(Res.string.tx_cardio_title)) { onOpenTool(MoreTool.Cardio) }
            Entry(stringResource(Res.string.pl_report_injury_title)) { onOpenTool(MoreTool.Injuries) }
            if (settings?.role == "trainer") {
                Entry(stringResource(Res.string.tt_share_title)) { onOpenTool(MoreTool.ProgramSharing) }
            }
        }

        SettingsCard(stringResource(Res.string.more_group_people)) {
            Entry(stringResource(Res.string.more_social)) { onOpen(MoreDestination.Social) }
            if (settings?.role == "solo") {
                Entry(stringResource(Res.string.ex_find_btn)) { onOpenTool(MoreTool.FindTrainer) }
            }
            Entry(stringResource(Res.string.ib_title)) { onOpenTool(MoreTool.Inbox) }
            if (settings?.role == "trainer") {
                Entry(stringResource(Res.string.more_trainer_clients)) { onOpen(MoreDestination.TrainerClients) }
                Entry(stringResource(Res.string.more_trainer_business)) { onOpen(MoreDestination.TrainerBusiness) }
                Entry(stringResource(Res.string.tt_report_title)) { onOpenTool(MoreTool.TrainerReport) }
            }
        }

        if (p.referralLink.isNotBlank()) InviteSection(p.referralLink, p.referredCount)

        if (p.role == "solo" || p.trainer != null) {
            TrainerSection(
                role = p.role,
                trainer = p.trainer,
                form = p.trainerForm,
                busy = p.trainerBusy,
                sent = p.trainerSent,
                error = p.trainerError,
                onForm = profile::onTrainerForm,
                onSubmit = profile::submitTrainer,
            )
        }

        SettingsCard(stringResource(Res.string.more_group_app)) {
            Entry(stringResource(Res.string.more_integrations)) { onOpen(MoreDestination.Integrations) }
            if (isOwner) Entry(stringResource(Res.string.ac_tool_owner)) { onOpenTool(MoreTool.Owner) }
            Entry(stringResource(Res.string.ac_tool_import)) { onOpenTool(MoreTool.ImportCsv) }
        }

        p.whatsNew?.let { note -> WhatsNewSection(note.version, note.items) }

        FeedbackSection(s.feedback, s.busy, vm::onFeedback, vm::sendFeedback)

        ProfileSection(profile)

        AccountSection(
            session = s.session,
            linkEmail = s.linkEmail,
            linkChallengeId = s.linkChallengeId,
            linkCode = s.linkCode,
            busy = s.busy,
            onLinkEmail = vm::onLinkEmail,
            onSendCode = vm::sendLinkCode,
            onLinkCode = vm::onLinkCode,
            onVerifyCode = vm::verifyLinkCode,
            onLinkGoogle = vm::linkGoogle,
            onSignOut = onSignOut,
        )

        DisplaySection(p.prefs, profile::setThemeMode, profile::setAccent, profile::setHighContrast, profile::setReducedMotion)

        if (settings == null) {
            if (s.message == null) CircularProgressIndicator()
            else OutlinedButton(onClick = vm::load) { Text(stringResource(Res.string.ac_retry)) }
        } else {
            LanguageSection(settings.lang, s.busy, vm::setLanguage)
            RemindersSection(settings, s.busy, vm::toggleReminder)
            p.reminderHour?.let { hour -> key(hour) { ReminderHourSetting(initialHour = hour) } }
            VacationSection(
                settings = settings,
                dateText = s.vacationDate,
                busy = s.busy,
                onDays = { vm.vacation(it) },
                onDate = vm::onVacationDate,
                onStartDate = vm::vacationUntilDate,
                onEnd = { vm.vacation(null) },
            )
            settings.cycle?.let { cycle ->
                CycleSection(
                    cycle = cycle,
                    start = s.cycleStart,
                    len = s.cycleLen,
                    busy = s.busy,
                    onToggle = vm::toggleCycle,
                    onStart = vm::onCycleStart,
                    onLen = vm::onCycleLen,
                    onSave = vm::saveCycle,
                )
            }
            CompeteSection(
                compete = settings.compete,
                alias = s.alias,
                busy = s.busy,
                onToggle = vm::toggleCompete,
                onAlias = vm::onAlias,
                onSave = vm::saveAlias,
            )
            if (settings.role == "client" && !s.trainerLeft) {
                LeaveTrainerSection(busy = s.busy, onLeave = vm::leaveTrainer)
            }
        }

        ExportSection(s.busy, onMarkdown = { vm.export(false) }, onJson = { vm.export(true) })

        privacyUrl?.let { url -> TextButton(onClick = { uri.openUri(url) }) { Text(stringResource(Res.string.more_privacy)) } }

        DangerSection(busy = s.busy, onDelete = { vm.deleteAccount(beforeSignOut) })
    }
}

@Composable
private fun Entry(label: String, onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(label, Modifier.fillMaxWidth()) }
}
