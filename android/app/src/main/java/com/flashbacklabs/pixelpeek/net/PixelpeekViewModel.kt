package com.flashbacklabs.pixelpeek.net

import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.IBinder
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.flashbacklabs.pixelpeek.capture.ScreenCaptureService
import com.flashbacklabs.pixelpeek.capture.ScreenStreamer
import java.net.URI
import java.net.URLDecoder
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

enum class ShareState { Idle, Requested, Active }

data class UiState(
    val serverUrl: String = PixelpeekPrefs.DEFAULT_SERVER,
    val runCode: String = "",
    val deviceLabel: String = defaultLabel(),
    val currentUrl: String = "",
    val width: Int = 0,
    val height: Int = 0,
    val shareState: ShareState = ShareState.Idle,
    val pendingHostId: String = "",
    val joinMessage: String = "Enter the host code or scan the QR to join this test run.",
) {
    companion object {
        fun defaultLabel(): String = "${Build.MANUFACTURER} ${Build.MODEL}"
    }
}

class PixelpeekViewModel(app: Application) : AndroidViewModel(app) {
    private data class ScannedConnection(val serverUrl: String?, val runCode: String)

    private val socket = PixelpeekSocket()

    val connectionState: StateFlow<ConnState> = socket.state

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private val _controlCommands = MutableSharedFlow<ControlCommand>(extraBufferCapacity = 64)
    val controlCommands: SharedFlow<ControlCommand> = _controlCommands.asSharedFlow()

    private var streamer: ScreenStreamer? = null
    private var pendingResultCode: Int = 0
    private var pendingPermissionData: Intent? = null
    private var serviceBound = false
    private var currentShareProfile = ShareProfile()

    private val serviceConn = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val data = pendingPermissionData ?: return
            val hostId = _ui.value.pendingHostId.takeIf { it.isNotBlank() } ?: return
            startStreaming(hostId, pendingResultCode, data)
        }
        override fun onServiceDisconnected(name: ComponentName?) { serviceBound = false }
    }

    init {
        viewModelScope.launch {
            val ctx = getApplication<Application>()
            val server = PixelpeekPrefs.serverUrl(ctx).first()
            val label = PixelpeekPrefs.deviceLabel(ctx).first().ifBlank { UiState.defaultLabel() }
            val runCode = PixelpeekPrefs.runCode(ctx).first()
            _ui.value = _ui.value.copy(serverUrl = server, deviceLabel = label, runCode = runCode)
        }
        viewModelScope.launch {
            socket.events.collect { event ->
                when (event) {
                    is SocketEvent.Joined -> {
                        _ui.value = _ui.value.copy(
                            runCode = event.runCode,
                            joinMessage = "Connected to run ${event.runCode}. Waiting for a pushed URL.",
                        )
                        PixelpeekPrefs.setRunCode(getApplication(), event.runCode)
                    }
                    is SocketEvent.JoinFailed -> {
                        _ui.value = _ui.value.copy(
                            joinMessage = "Could not join: ${event.reason}",
                            shareState = ShareState.Idle,
                            pendingHostId = "",
                        )
                    }
                    is SocketEvent.LoadUrl -> {
                        socket.emitDeviceLog("navigation", "info", "Host requested URL", event.url)
                        _ui.value = _ui.value.copy(currentUrl = event.url)
                    }
                    is SocketEvent.ShareRequest -> handleShareRequest(event.fromId, event.profile)
                    is SocketEvent.ShareProfileChanged -> updateShareProfile(event.fromId, event.profile)
                    is SocketEvent.ShareStop -> stopShare()
                    is SocketEvent.Control -> _controlCommands.tryEmit(event.command)
                }
            }
        }
    }

    fun setServerUrl(value: String) {
        val normalized = value.trim().trimEnd('/')
        _ui.value = _ui.value.copy(serverUrl = normalized)
        viewModelScope.launch { PixelpeekPrefs.setServerUrl(getApplication(), normalized) }
    }

    fun setRunCode(value: String) {
        val normalized = normalizeRunCode(value)
        _ui.value = _ui.value.copy(runCode = normalized)
        viewModelScope.launch { PixelpeekPrefs.setRunCode(getApplication(), normalized) }
    }

    fun setDeviceLabel(value: String) {
        _ui.value = _ui.value.copy(deviceLabel = value)
        viewModelScope.launch {
            PixelpeekPrefs.setDeviceLabel(getApplication(), value)
            socket.updateLabel(value)
        }
    }

    fun reportViewport(width: Int, height: Int) {
        _ui.value = _ui.value.copy(width = width, height = height)
        socket.reportViewport(width, height)
    }

    fun emitConsoleMessage(level: String, message: String, source: String, line: Int) {
        socket.emitConsoleLog(level, message, source, line)
    }

    fun emitPageEvent(kind: String, message: String, url: String) {
        socket.emitDeviceLog(kind, if (kind == "error") "error" else "info", message, url)
    }

    fun connect() {
        val s = _ui.value
        val code = normalizeRunCode(s.runCode)
        if (code.isBlank()) {
            _ui.value = s.copy(joinMessage = "Enter the code shown on the host before connecting.")
            return
        }
        if (!s.serverUrl.startsWith("http://") && !s.serverUrl.startsWith("https://")) {
            _ui.value = s.copy(joinMessage = "Server URL must start with http:// or https://.")
            return
        }
        _ui.value = s.copy(runCode = code, joinMessage = "Joining run $code...")
        viewModelScope.launch { PixelpeekPrefs.setRunCode(getApplication(), code) }
        val device = DeviceInfo(
            label = s.deviceLabel,
            width = s.width,
            height = s.height,
            runCode = code,
        )
        socket.connect(s.serverUrl, device)
    }

    fun disconnect() {
        socket.disconnect()
        _ui.value = _ui.value.copy(joinMessage = "Disconnected. Enter a host code to join again.")
    }

    fun applyScannedConnection(rawValue: String) {
        val scanned = parseScannedConnection(rawValue)
        if (scanned == null) {
            _ui.value = _ui.value.copy(joinMessage = "QR code did not contain a Pixelpeek run code.")
            return
        }
        scanned.serverUrl?.let { setServerUrl(it) }
        setRunCode(scanned.runCode)
        _ui.value = _ui.value.copy(joinMessage = "Scanned run ${scanned.runCode}. Connecting...")
        connect()
    }

    fun onQrScanCancelled() {
        _ui.value = _ui.value.copy(joinMessage = "QR scan cancelled.")
    }

    fun onQrScanFailed(message: String) {
        _ui.value = _ui.value.copy(joinMessage = "QR scan failed: $message")
    }

    private fun handleShareRequest(fromId: String, profile: ShareProfile) {
        currentShareProfile = profile.normalized()
        streamer?.updateProfile(currentShareProfile.toStreamerProfile())
        _ui.value = _ui.value.copy(shareState = ShareState.Requested, pendingHostId = fromId)
    }

    private fun updateShareProfile(fromId: String, profile: ShareProfile) {
        if (_ui.value.pendingHostId.isNotBlank() && _ui.value.pendingHostId != fromId) return
        currentShareProfile = profile.normalized()
        streamer?.updateProfile(currentShareProfile.toStreamerProfile())
        socket.emitDeviceLog(
            "screen-share",
            "info",
            "Share profile ${currentShareProfile.maxFrameDim}px @ ${currentShareProfile.fps}fps",
        )
    }

    fun onScreenCapturePermissionGranted(resultCode: Int, data: Intent) {
        pendingResultCode = resultCode
        pendingPermissionData = data
        val ctx = getApplication<Application>()
        val svcIntent = ScreenCaptureService.startIntent(ctx)
        ctx.startForegroundService(svcIntent)
        ctx.bindService(svcIntent, serviceConn, Context.BIND_AUTO_CREATE)
        serviceBound = true
    }

    fun onScreenCapturePermissionDenied() {
        val hostId = _ui.value.pendingHostId
        if (hostId.isNotBlank()) socket.emitShareFailed(hostId, "denied")
        _ui.value = _ui.value.copy(shareState = ShareState.Idle, pendingHostId = "")
        pendingPermissionData = null
    }

    private fun startStreaming(hostId: String, resultCode: Int, permissionData: Intent) {
        val ctx = getApplication<Application>()
        val dm = ctx.resources.displayMetrics
        val maxCaptureDim = 1440
        val scale = (maxCaptureDim.toFloat() / maxOf(dm.widthPixels, dm.heightPixels)).coerceAtMost(1f)
        val captureW = evenDimension((dm.widthPixels * scale).toInt())
        val captureH = evenDimension((dm.heightPixels * scale).toInt())

        streamer = ScreenStreamer(
            context = ctx,
            resultCode = resultCode,
            permissionData = permissionData,
            width = captureW,
            height = captureH,
            dpi = dm.densityDpi,
            profile = currentShareProfile.toStreamerProfile(),
            onFrame = { base64, frameW, frameH -> socket.emitShareFrame(hostId, base64, frameW, frameH) },
            onStopped = { stopShare() },
        ).also { runCatching { it.start() } }

        socket.emitDeviceLog("screen-share", "info", "Screen sharing started")
        _ui.value = _ui.value.copy(shareState = ShareState.Active)
    }

    fun stopShare() {
        val hostId = _ui.value.pendingHostId
        if (hostId.isNotBlank() && _ui.value.shareState == ShareState.Active) {
            runCatching { socket.emitShareEnded(hostId) }
        }
        runCatching { streamer?.stop() }
        streamer = null
        pendingPermissionData = null
        if (serviceBound) {
            runCatching { getApplication<Application>().unbindService(serviceConn) }
            serviceBound = false
        }
        val ctx = getApplication<Application>()
        runCatching { ctx.stopService(ScreenCaptureService.startIntent(ctx)) }
        _ui.value = _ui.value.copy(shareState = ShareState.Idle, pendingHostId = "")
    }

    override fun onCleared() {
        super.onCleared()
        runCatching { stopShare() }
        socket.disconnect()
    }

    private fun parseScannedConnection(rawValue: String): ScannedConnection? {
        val raw = rawValue.trim()
        if (raw.isBlank()) return null
        val rawCode = normalizeRunCode(raw)
        if (rawCode.length in 4..10 && raw == rawCode) {
            return ScannedConnection(serverUrl = null, runCode = rawCode)
        }
        val uri = runCatching { URI.create(raw) }.getOrNull() ?: return null
        val code = normalizeRunCode(queryParam(uri.rawQuery, "run") ?: queryParam(uri.rawQuery, "code") ?: "")
        if (code.isBlank()) return null
        val host = uri.host ?: return ScannedConnection(serverUrl = null, runCode = code)
        val scheme = (uri.scheme ?: "http").lowercase()
        val socketScheme = if (scheme == "https" && uri.port == 4443) "http" else scheme
        val port = when {
            scheme == "https" && uri.port == 4443 -> 4000
            uri.port > 0 -> uri.port
            socketScheme == "https" -> 443
            else -> 4000
        }
        return ScannedConnection(serverUrl = "$socketScheme://$host:$port", runCode = code)
    }

    private fun queryParam(rawQuery: String?, name: String): String? {
        if (rawQuery.isNullOrBlank()) return null
        return rawQuery.split('&')
            .firstNotNullOfOrNull { part ->
                val pieces = part.split('=', limit = 2)
                val key = runCatching { URLDecoder.decode(pieces[0], Charsets.UTF_8.name()) }.getOrDefault("")
                if (key != name) return@firstNotNullOfOrNull null
                runCatching { URLDecoder.decode(pieces.getOrElse(1) { "" }, Charsets.UTF_8.name()) }.getOrNull()
            }
    }

    private fun normalizeRunCode(value: String): String =
        value.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }.take(10)

    private fun evenDimension(value: Int): Int {
        val safe = value.coerceAtLeast(2)
        return if (safe % 2 == 0) safe else safe - 1
    }

    private fun ShareProfile.toStreamerProfile(): ScreenStreamer.Profile =
        ScreenStreamer.Profile(fps = fps, maxFrameDim = maxFrameDim, jpegQuality = jpegQuality)
}
