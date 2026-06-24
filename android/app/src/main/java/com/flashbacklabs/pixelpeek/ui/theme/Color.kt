package com.flashbacklabs.pixelpeek.ui.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

object PixelpeekPalette {
    val Bg0 = Color(0xFF0A0B10)
    val Bg1 = Color(0xFF0F1117)
    val Bg2 = Color(0xFF14171F)
    val Bg3 = Color(0xFF1B1F2A)
    val Border = Color(0xFF232936)
    val BorderStrong = Color(0xFF2F3646)

    val Text = Color(0xFFE8EAF0)
    val TextMuted = Color(0xFF8B94A8)
    val TextFaint = Color(0xFF5A6377)

    val Accent = Color(0xFF6366F1)
    val AccentBright = Color(0xFF8B5CF6)
    val AccentSoft = Color(0x266366F1)
    val AccentSoftStrong = Color(0xFFC7D2FE)

    val Success = Color(0xFF10B981)
    val SuccessGlow = Color(0xFF6EE7B7)
    val Warn = Color(0xFFF59E0B)
    val WarnGlow = Color(0xFFFCD34D)
    val Danger = Color(0xFFEF4444)
    val DangerGlow = Color(0xFFFCA5A5)
}

val PixelpeekAccentGradient: Brush
    get() = Brush.linearGradient(
        colors = listOf(PixelpeekPalette.Accent, PixelpeekPalette.AccentBright),
    )
