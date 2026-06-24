package com.flashbacklabs.pixelpeek.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush

private val PixelpeekDarkScheme = darkColorScheme(
    primary = PixelpeekPalette.Accent,
    onPrimary = androidx.compose.ui.graphics.Color.White,
    primaryContainer = PixelpeekPalette.AccentBright,
    onPrimaryContainer = androidx.compose.ui.graphics.Color.White,
    secondary = PixelpeekPalette.AccentBright,
    onSecondary = androidx.compose.ui.graphics.Color.White,
    background = PixelpeekPalette.Bg0,
    onBackground = PixelpeekPalette.Text,
    surface = PixelpeekPalette.Bg2,
    onSurface = PixelpeekPalette.Text,
    surfaceVariant = PixelpeekPalette.Bg3,
    onSurfaceVariant = PixelpeekPalette.TextMuted,
    outline = PixelpeekPalette.Border,
    outlineVariant = PixelpeekPalette.BorderStrong,
    error = PixelpeekPalette.Danger,
    onError = androidx.compose.ui.graphics.Color.White,
)

@Composable
fun PixelpeekTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = PixelpeekDarkScheme,
        typography = PixelpeekTypography,
        content = content,
    )
}

@Composable
fun PixelpeekBackdrop(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PixelpeekPalette.Bg0)
            .background(
                Brush.radialGradient(
                    colors = listOf(PixelpeekPalette.AccentSoft, androidx.compose.ui.graphics.Color.Transparent),
                    radius = 1400f,
                ),
            ),
    ) {
        content()
    }
}
