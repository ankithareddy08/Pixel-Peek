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
    val deviceLabel: String = defaultLabel(),
    val currentUrl: String = "",
    val width: Int = 0,
    val height: Int = 0,
    val shareState: ShareState = ShareState.Idle,
    val pendingHostId: String = "",
) {
    companion object {
        fun defaultLabel(): String = "${Build.MANUFACTURER} ${Build.MODEL}"
    }
}

class PixelpeekViewModel(app: Application) : AndroidViewModel(app) {
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
            _ui.value = _ui.value.copy(serverUrl = server, deviceLabel = label)
        }
        viewModelScope.launch {
            socket.events.collect { event ->
                when (event) {
                    is SocketEvent.LoadUrl -> _ui.value = _ui.value.copy(currentUrl = event.url)
                    is SocketEvent.ShareRequest -> handleShareRequest(event.fromId)
                    is SocketEvent.ShareStop -> stopShare()
                    is SocketEvent.Control -> _controlCommands.tryEmit(event.command)
                }
            }
        }
    }

    fun setServerUrl(value: String) {
        _ui.value = _ui.value.copy(serverUrl = value)
        viewModelScope.launch { PixelpeekPrefs.setServerUrl(getApplication(), value) }
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

    fun connect() {
        val s = _ui.value
        val device = DeviceInfo(label = s.deviceLabel, width = s.width, height = s.height)
        socket.connect(s.serverUrl, device)
    }

    fun disconnect() = socket.disconnect()

    private fun handleShareRequest(fromId: String) {
        _ui.value = _ui.value.copy(shareState = ShareState.Requested, pendingHostId = fromId)
        // MainActivity observes ShareState.Requested and launches the permission dialog
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
        // Downscale aggressively to keep frames small and bandwidth low
        val maxDim = 540
        val scale = (maxDim.toFloat() / maxOf(dm.widthPixels, dm.heightPixels)).coerceAtMost(1f)
        val captureW = (dm.widthPixels * scale).toInt().let { if (it % 2 == 0) it else it - 1 }
        val captureH = (dm.heightPixels * scale).toInt().let { if (it % 2 == 0) it else it - 1 }

        streamer = ScreenStreamer(
            context = ctx,
            resultCode = resultCode,
            permissionData = permissionData,
            width = captureW,
            height = captureH,
            dpi = dm.densityDpi,
            onFrame = { base64 -> socket.emitShareFrame(hostId, base64, captureW, captureH) },
            onStopped = { stopShare() },
        ).also { runCatching { it.start() } }

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
}
