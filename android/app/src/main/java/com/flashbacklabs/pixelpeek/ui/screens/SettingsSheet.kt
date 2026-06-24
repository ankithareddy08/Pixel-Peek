package com.flashbacklabs.pixelpeek.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.flashbacklabs.pixelpeek.ui.theme.PixelpeekPalette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(
    serverUrl: String,
    label: String,
    onServerChange: (String) -> Unit,
    onLabelChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onApply: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = PixelpeekPalette.Bg2,
        contentColor = PixelpeekPalette.Text,
        dragHandle = null,
        shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 22.dp, vertical = 22.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Device settings", style = MaterialTheme.typography.titleLarge, color = PixelpeekPalette.Text)
            Text(
                "Configure where this device connects and what the host should call it.",
                style = MaterialTheme.typography.bodySmall,
                color = PixelpeekPalette.TextMuted,
            )

            FieldLabel("Server URL")
            OutlinedTextField(
                value = serverUrl,
                onValueChange = onServerChange,
                singleLine = true,
                placeholder = { Text("http://192.168.x.x:4000", color = PixelpeekPalette.TextFaint) },
                modifier = Modifier.fillMaxWidth(),
                colors = pixelpeekFieldColors(),
                shape = RoundedCornerShape(12.dp),
            )

            FieldLabel("Device label")
            OutlinedTextField(
                value = label,
                onValueChange = onLabelChange,
                singleLine = true,
                placeholder = { Text("My phone", color = PixelpeekPalette.TextFaint) },
                modifier = Modifier.fillMaxWidth(),
                colors = pixelpeekFieldColors(),
                shape = RoundedCornerShape(12.dp),
            )

            Button(
                onClick = onApply,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = PixelpeekPalette.Accent,
                    contentColor = Color.White,
                ),
            ) { Text("Save & connect", style = MaterialTheme.typography.titleMedium) }
        }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = PixelpeekPalette.TextMuted,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun pixelpeekFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = PixelpeekPalette.Text,
    unfocusedTextColor = PixelpeekPalette.Text,
    cursorColor = PixelpeekPalette.Accent,
    focusedBorderColor = PixelpeekPalette.Accent,
    unfocusedBorderColor = PixelpeekPalette.Border,
    focusedContainerColor = PixelpeekPalette.Bg1,
    unfocusedContainerColor = PixelpeekPalette.Bg1,
)
