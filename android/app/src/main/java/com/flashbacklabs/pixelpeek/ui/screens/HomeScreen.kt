package com.flashbacklabs.pixelpeek.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.flashbacklabs.pixelpeek.net.ConnState
import com.flashbacklabs.pixelpeek.ui.theme.PixelpeekMono
import com.flashbacklabs.pixelpeek.ui.theme.PixelpeekPalette

@Composable
fun HomeScreen(
    conn: ConnState,
    serverUrl: String,
    runCode: String,
    joinMessage: String,
    onRunCodeChange: (String) -> Unit,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onScanQr: () -> Unit,
    onSettings: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        HeroCard(conn)
        JoinCard(
            runCode = runCode,
            joinMessage = joinMessage,
            conn = conn,
            onRunCodeChange = onRunCodeChange,
            onConnect = onConnect,
            onDisconnect = onDisconnect,
            onScanQr = onScanQr,
        )
        ServerCard(serverUrl, onSettings)
        HelpCard()
    }
}

@Composable
private fun HeroCard(conn: ConnState) {
    Surface(
        color = PixelpeekPalette.Bg2,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, PixelpeekPalette.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(52.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Brush.linearGradient(listOf(PixelpeekPalette.Accent, PixelpeekPalette.AccentBright))),
                contentAlignment = Alignment.Center,
            ) {
                Text("P", color = Color.White, style = MaterialTheme.typography.displayLarge)
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = when (conn) {
                        ConnState.Connected -> "Client connected"
                        ConnState.Connecting -> "Joining host run"
                        ConnState.Disconnected -> "Join a host run"
                    },
                    style = MaterialTheme.typography.titleLarge,
                    color = PixelpeekPalette.Text,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = when (conn) {
                        ConnState.Connected -> "Waiting for the host to push a URL."
                        ConnState.Connecting -> "Checking the run code on the local network."
                        ConnState.Disconnected -> "Scan the host QR or enter the displayed code."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = PixelpeekPalette.TextMuted,
                )
            }
        }
    }
}

@Composable
private fun JoinCard(
    runCode: String,
    joinMessage: String,
    conn: ConnState,
    onRunCodeChange: (String) -> Unit,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onScanQr: () -> Unit,
) {
    Surface(
        color = PixelpeekPalette.Bg2,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, PixelpeekPalette.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("RUN CODE", style = MaterialTheme.typography.labelSmall, color = PixelpeekPalette.TextMuted)
            OutlinedTextField(
                value = runCode,
                onValueChange = onRunCodeChange,
                singleLine = true,
                placeholder = { Text("ABC123", color = PixelpeekPalette.TextFaint) },
                textStyle = MaterialTheme.typography.headlineMedium.copy(
                    color = PixelpeekPalette.Text,
                    fontFamily = PixelpeekMono,
                    fontWeight = FontWeight.Bold,
                ),
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    keyboardType = KeyboardType.Ascii,
                ),
                colors = pixelpeekFieldColors(),
                shape = RoundedCornerShape(12.dp),
            )
            Text(joinMessage, style = MaterialTheme.typography.bodySmall, color = PixelpeekPalette.TextMuted)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedButton(
                    onClick = onScanQr,
                    modifier = Modifier
                        .weight(1f)
                        .height(50.dp),
                    shape = RoundedCornerShape(14.dp),
                    border = BorderStroke(1.dp, PixelpeekPalette.BorderStrong),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = PixelpeekPalette.AccentSoftStrong),
                ) {
                    Icon(Icons.Default.QrCodeScanner, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Scan QR", style = MaterialTheme.typography.titleMedium)
                }
                if (conn == ConnState.Connected) {
                    Button(
                        onClick = onDisconnect,
                        modifier = Modifier
                            .weight(1f)
                            .height(50.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = PixelpeekPalette.Bg3,
                            contentColor = PixelpeekPalette.Text,
                        ),
                    ) {
                        Icon(Icons.Default.Stop, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Disconnect", style = MaterialTheme.typography.titleMedium)
                    }
                } else {
                    Button(
                        onClick = onConnect,
                        modifier = Modifier
                            .weight(1f)
                            .height(50.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = PixelpeekPalette.Accent,
                            contentColor = Color.White,
                        ),
                    ) {
                        Icon(Icons.Default.PlayArrow, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = if (conn == ConnState.Connecting) "Joining" else "Connect",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ServerCard(serverUrl: String, onSettings: () -> Unit) {
    Surface(
        color = PixelpeekPalette.Bg2,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, PixelpeekPalette.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Text("SERVER", style = MaterialTheme.typography.labelSmall, color = PixelpeekPalette.TextMuted)
            Spacer(Modifier.height(6.dp))
            Text(
                text = serverUrl,
                style = MaterialTheme.typography.bodyLarge.copy(fontFamily = PixelpeekMono),
                color = PixelpeekPalette.Text,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(12.dp))
            TextButton(
                onClick = onSettings,
                colors = ButtonDefaults.textButtonColors(contentColor = PixelpeekPalette.AccentSoftStrong),
            ) {
                Icon(Icons.Default.Settings, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text("Connection settings")
            }
        }
    }
}

@Composable
private fun HelpCard() {
    Surface(
        color = Color.Transparent,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, PixelpeekPalette.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text("Same network", style = MaterialTheme.typography.labelSmall, color = PixelpeekPalette.AccentSoftStrong)
            Spacer(Modifier.height(4.dp))
            Text(
                "Open the host screen on the PC, then scan its QR code or type the displayed code here. The phone and host need to be on the same network.",
                style = MaterialTheme.typography.bodySmall,
                color = PixelpeekPalette.TextMuted,
            )
        }
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
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
