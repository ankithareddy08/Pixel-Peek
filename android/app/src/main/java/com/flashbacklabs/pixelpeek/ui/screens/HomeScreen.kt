package com.flashbacklabs.pixelpeek.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashbacklabs.pixelpeek.net.ConnState
import com.flashbacklabs.pixelpeek.ui.theme.PixelpeekPalette

@Composable
fun HomeScreen(
    conn: ConnState,
    serverUrl: String,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onSettings: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        HeroCard(conn)
        ServerCard(serverUrl, onSettings)
        ActionRow(conn = conn, onConnect = onConnect, onDisconnect = onDisconnect)
        Spacer(Modifier.weight(1f))
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
                Text("•", color = Color.White, style = MaterialTheme.typography.displayLarge)
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = when (conn) {
                        ConnState.Connected -> "Ready for testing"
                        ConnState.Connecting -> "Connecting to host…"
                        ConnState.Disconnected -> "Not connected"
                    },
                    style = MaterialTheme.typography.titleLarge,
                    color = PixelpeekPalette.Text,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = when (conn) {
                        ConnState.Connected -> "Waiting for the host to push a URL."
                        ConnState.Connecting -> "Reaching the orchestrator…"
                        ConnState.Disconnected -> "Tap Connect once the server URL is correct."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = PixelpeekPalette.TextMuted,
                )
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
            Text("ORCHESTRATOR", style = MaterialTheme.typography.labelSmall, color = PixelpeekPalette.TextMuted)
            Spacer(Modifier.height(6.dp))
            Text(
                text = serverUrl,
                style = MaterialTheme.typography.bodyLarge,
                color = PixelpeekPalette.Text,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(12.dp))
            TextButton(
                onClick = onSettings,
                colors = ButtonDefaults.textButtonColors(contentColor = PixelpeekPalette.AccentSoftStrong),
            ) { Text("Change server URL") }
        }
    }
}

@Composable
private fun ActionRow(conn: ConnState, onConnect: () -> Unit, onDisconnect: () -> Unit) {
    if (conn == ConnState.Connected) {
        Button(
            onClick = onDisconnect,
            modifier = Modifier
                .fillMaxWidth()
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
                .fillMaxWidth()
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
                text = if (conn == ConnState.Connecting) "Connecting…" else "Connect",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
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
            Text("Tip", style = MaterialTheme.typography.labelSmall, color = PixelpeekPalette.AccentSoftStrong)
            Spacer(Modifier.height(4.dp))
            Text(
                "Find your PC's LAN IP (e.g. http://192.168.x.x:4000) and paste it into the server URL above. Both devices must share the same Wi-Fi network.",
                style = MaterialTheme.typography.bodySmall,
                color = PixelpeekPalette.TextMuted,
            )
        }
    }
}

