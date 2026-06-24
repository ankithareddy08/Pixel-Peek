package com.flashbacklabs.pixelpeek.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashbacklabs.pixelpeek.net.ConnState
import com.flashbacklabs.pixelpeek.net.PixelpeekViewModel
import com.flashbacklabs.pixelpeek.net.ShareState
import com.flashbacklabs.pixelpeek.ui.screens.BrowserScreen
import com.flashbacklabs.pixelpeek.ui.screens.HomeScreen
import com.flashbacklabs.pixelpeek.ui.screens.SettingsSheet
import com.flashbacklabs.pixelpeek.ui.theme.PixelpeekBackdrop
import com.flashbacklabs.pixelpeek.ui.theme.PixelpeekPalette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PixelpeekApp(viewModel: PixelpeekViewModel) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val conn by viewModel.connectionState.collectAsStateWithLifecycle()
    var settingsOpen by rememberSaveable { mutableStateOf(false) }
    var isFullscreen by rememberSaveable { mutableStateOf(false) }
    val showTopBar = !(isFullscreen && ui.currentUrl.isNotBlank())

    // Report initial viewport once we know the size.
    val view = LocalView.current
    val density = LocalDensity.current
    LaunchedEffect(Unit) {
        view.post {
            val w = (view.width / density.density).toInt()
            val h = (view.height / density.density).toInt()
            if (w > 0 && h > 0) viewModel.reportViewport(w, h)
        }
    }

    PixelpeekBackdrop {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                if (showTopBar) {
                    PixelpeekTopBar(
                        conn = conn,
                        label = ui.deviceLabel,
                        onSettings = { settingsOpen = true },
                    )
                }
            },
        ) { padding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                // Share banner: only when not in fullscreen (in fullscreen the URL bar shows a red dot instead)
                if (ui.shareState != ShareState.Idle && !isFullscreen) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        ShareBanner(
                            state = ui.shareState,
                            onStop = viewModel::stopShare,
                        )
                    }
                }

                Box(modifier = Modifier.fillMaxSize().weight(1f)) {
                    if (ui.currentUrl.isBlank()) {
                        HomeScreen(
                            conn = conn,
                            serverUrl = ui.serverUrl,
                            onConnect = viewModel::connect,
                            onDisconnect = viewModel::disconnect,
                            onSettings = { settingsOpen = true },
                        )
                    } else {
                        BrowserScreen(
                            url = ui.currentUrl,
                            onSizeChanged = viewModel::reportViewport,
                            onConsoleMessage = viewModel::emitConsoleMessage,
                            isFullscreen = isFullscreen,
                            onToggleFullscreen = { isFullscreen = !isFullscreen },
                            isSharing = ui.shareState == ShareState.Active,
                        )
                    }
                }
            }
        }
    }

    if (settingsOpen) {
        SettingsSheet(
            serverUrl = ui.serverUrl,
            label = ui.deviceLabel,
            onServerChange = viewModel::setServerUrl,
            onLabelChange = viewModel::setDeviceLabel,
            onDismiss = { settingsOpen = false },
            onApply = {
                settingsOpen = false
                viewModel.connect()
            },
        )
    }
}

@Composable
private fun ShareBanner(state: ShareState, onStop: () -> Unit, modifier: Modifier = Modifier) {
    val (text, color) = when (state) {
        ShareState.Requested -> "Waiting for screen share permission…" to PixelpeekPalette.Warn
        ShareState.Active -> "Sharing screen with host" to PixelpeekPalette.Success
        ShareState.Idle -> return
    }
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(PixelpeekPalette.Bg2)
            .border(1.dp, color, RoundedCornerShape(999.dp))
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(modifier = Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(color))
        Text(text, style = MaterialTheme.typography.bodySmall, color = color)
        if (state == ShareState.Active) {
            TextButton(
                onClick = onStop,
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
            ) {
                Text("Stop", style = MaterialTheme.typography.labelSmall, color = PixelpeekPalette.DangerGlow)
            }
        }
    }
}

@Composable
private fun PixelpeekTopBar(conn: ConnState, label: String, onSettings: () -> Unit) {
    Surface(color = Color.Transparent) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Brush.linearGradient(listOf(PixelpeekPalette.Accent, PixelpeekPalette.AccentBright))),
                contentAlignment = Alignment.Center,
            ) {
                Text("P", color = Color.White, style = MaterialTheme.typography.titleLarge)
            }
            Column(modifier = Modifier.weight(1f)) {
                Text("Pixelpeek", style = MaterialTheme.typography.titleMedium, color = PixelpeekPalette.Text)
                Text(label, style = MaterialTheme.typography.bodySmall, color = PixelpeekPalette.TextMuted)
            }
            ConnectionPill(conn)
            IconButton(
                onClick = onSettings,
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(PixelpeekPalette.Bg2)
                    .border(1.dp, PixelpeekPalette.Border, RoundedCornerShape(12.dp)),
            ) {
                Icon(Icons.Default.Settings, contentDescription = "Settings", tint = PixelpeekPalette.Text)
            }
        }
    }
}

@Composable
private fun ConnectionPill(conn: ConnState) {
    val (label, dot, fg) = when (conn) {
        ConnState.Connected -> Triple("connected", PixelpeekPalette.Success, PixelpeekPalette.SuccessGlow)
        ConnState.Connecting -> Triple("connecting", PixelpeekPalette.Warn, PixelpeekPalette.WarnGlow)
        ConnState.Disconnected -> Triple("offline", PixelpeekPalette.Danger, PixelpeekPalette.DangerGlow)
    }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(PixelpeekPalette.Bg2)
            .border(1.dp, PixelpeekPalette.Border, RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(RoundedCornerShape(50))
                .background(dot),
        )
        Text(label, style = MaterialTheme.typography.labelSmall, color = fg)
    }
}
