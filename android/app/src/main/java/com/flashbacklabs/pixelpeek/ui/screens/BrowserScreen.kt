package com.flashbacklabs.pixelpeek.ui.screens

import android.annotation.SuppressLint
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.flashbacklabs.pixelpeek.ui.theme.PixelpeekMono
import com.flashbacklabs.pixelpeek.ui.theme.PixelpeekPalette

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BrowserScreen(
    url: String,
    onSizeChanged: (Int, Int) -> Unit,
    onConsoleMessage: (level: String, message: String, source: String, line: Int) -> Unit = { _, _, _, _ -> },
    isFullscreen: Boolean = false,
    onToggleFullscreen: () -> Unit = {},
    isSharing: Boolean = false,
) {
    val density = LocalDensity.current
    val horizontalPad = if (isFullscreen) 0.dp else 12.dp
    val verticalPad = if (isFullscreen) 0.dp else 8.dp
    val cornerRadius = if (isFullscreen) 0.dp else 14.dp

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = horizontalPad, vertical = verticalPad),
        verticalArrangement = Arrangement.spacedBy(if (isFullscreen) 0.dp else 8.dp),
    ) {
        UrlBar(
            url = url,
            isFullscreen = isFullscreen,
            onToggleFullscreen = onToggleFullscreen,
            showShareDot = isSharing && isFullscreen,
        )
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(cornerRadius))
                .background(PixelpeekPalette.Bg2)
                .onSizeChanged { size ->
                    val w = with(density) { size.width.toDp().value.toInt() }
                    val h = with(density) { size.height.toDp().value.toInt() }
                    onSizeChanged(w, h)
                },
        ) {
            AndroidView(
                modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(cornerRadius)),
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.useWideViewPort = true
                        settings.loadWithOverviewMode = true
                        webViewClient = WebViewClient()
                        webChromeClient = object : WebChromeClient() {
                            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                                onConsoleMessage(
                                    message.messageLevel().name,
                                    message.message() ?: "",
                                    message.sourceId() ?: "",
                                    message.lineNumber(),
                                )
                                return true
                            }
                        }
                    }
                },
                update = { webView ->
                    if (webView.url != url) webView.loadUrl(url)
                },
            )
        }
    }
}

@Composable
private fun UrlBar(
    url: String,
    isFullscreen: Boolean,
    onToggleFullscreen: () -> Unit,
    showShareDot: Boolean = false,
) {
    Surface(
        color = PixelpeekPalette.Bg2,
        shape = RoundedCornerShape(if (isFullscreen) 0.dp else 10.dp),
        border = if (isFullscreen) null else BorderStroke(1.dp, PixelpeekPalette.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(RoundedCornerShape(50))
                    .background(PixelpeekPalette.Success),
            )
            Text(
                text = url,
                color = PixelpeekPalette.TextMuted,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = PixelpeekMono),
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
            if (showShareDot) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .clip(RoundedCornerShape(50))
                        .background(PixelpeekPalette.Danger),
                )
            }
            IconButton(
                onClick = onToggleFullscreen,
                modifier = Modifier.size(32.dp),
            ) {
                Icon(
                    imageVector = if (isFullscreen) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen,
                    contentDescription = if (isFullscreen) "Exit fullscreen" else "Enter fullscreen",
                    tint = PixelpeekPalette.Text,
                )
            }
        }
    }
}
