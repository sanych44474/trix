package app.hacklimits.shared.workout.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.clickable
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.hacklimits.shared.workout.logic.softTones

/** Soft-look corner radius for set fields and buttons (14 px in the Mini App). */
val SoftShape = RoundedCornerShape(14.dp)

/**
 * Pressed into the card: a darker fill, the shade on the top-left edge and the highlight on the
 * bottom-right (light falls from the top-left). Compose has no inner shadow; the gradient edge reads
 * the same at set-row size.
 */
@Composable
fun Modifier.softInset(shape: Shape = SoftShape): Modifier {
    val tones = softTones(MaterialTheme.colorScheme.surface)
    return this
        .clip(shape)
        .background(tones.insetFill, shape)
        .border(1.5.dp, Brush.linearGradient(listOf(tones.shade, tones.highlight), start = Offset.Zero, end = Offset.Infinite), shape)
}

/** Standing out of the card: a soft drop shadow and the highlight on the top-left edge. */
@Composable
fun Modifier.softRaised(shape: Shape = SoftShape): Modifier {
    val tones = softTones(MaterialTheme.colorScheme.surface)
    return this
        .shadow(4.dp, shape, ambientColor = tones.shade, spotColor = tones.shade)
        .background(MaterialTheme.colorScheme.surface, shape)
        .border(1.dp, Brush.linearGradient(listOf(tones.highlight, tones.shade), start = Offset.Zero, end = Offset.Infinite), shape)
}

/** A round raised ✕ (remove a set). [label] is what a screen reader says. */
@Composable
fun SoftCloseButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(40.dp)
            .softRaised(CircleShape)
            .clip(CircleShape)
            .clickable(onClick = onClick)
            .semantics {
                contentDescription = label
                role = Role.Button
            },
        contentAlignment = Alignment.Center,
    ) {
        Text("✕", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold)
    }
}
