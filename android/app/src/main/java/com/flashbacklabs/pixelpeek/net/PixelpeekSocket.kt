package com.flashbacklabs.pixelpeek.net

import android.os.Build
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.emitter.Emitter
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.net.URI

enum class ConnState { Disconnected, Connecting, Connected }

data class DeviceInfo(
    val label: String,
    val width: Int,
    val height: Int,
    val userAgent: String =
        "Pixelpeek/Android (${Build.MANUFACTURER} ${Build.MODEL}; Android ${Build.VERSION.RELEASE})",
)

sealed class SocketEvent {
    data class LoadUrl(val url: String) : SocketEvent()
    data class ShareRequest(val fromId: String) : SocketEvent()
    data class ShareStop(val fromId: String) : SocketEvent()
}

class PixelpeekSocket {
    private var socket: Socket? = null
    private val _state = MutableStateFlow(ConnState.Disconnected)
    val state: StateFlow<ConnState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<SocketEvent>(replay = 1, extraBufferCapacity = 32)
    val events: SharedFlow<SocketEvent> = _events.asSharedFlow()

    private var deviceInfo: DeviceInfo? = null

    private val loadUrlListener = Emitter.Listener { args ->
        val payload = args.firstOrNull() as? JSONObject ?: return@Listener
        val url = payload.optString("url", "")
        if (url.isNotBlank()) _events.tryEmit(SocketEvent.LoadUrl(url))
    }

    private val shareRequestListener = Emitter.Listener { args ->
        val fromId = (args.firstOrNull() as? JSONObject)?.optString("fromId", "") ?: return@Listener
        if (fromId.isNotBlank()) _events.tryEmit(SocketEvent.ShareRequest(fromId))
    }

    private val shareStopListener = Emitter.Listener { args ->
        val fromId = (args.firstOrNull() as? JSONObject)?.optString("fromId", "") ?: return@Listener
        _events.tryEmit(SocketEvent.ShareStop(fromId))
    }

    fun connect(serverUrl: String, device: DeviceInfo) {
        disconnect()
        deviceInfo = device
        val uri = runCatching { URI.create(serverUrl) }.getOrNull() ?: return
        val opts = IO.Options().apply {
            reconnection = true
            reconnectionDelay = 1500
            transports = arrayOf("websocket", "polling")
        }
        _state.value = ConnState.Connecting
        val s = IO.socket(uri, opts)
        socket = s
        s.on(Socket.EVENT_CONNECT) {
            _state.value = ConnState.Connected
            register()
        }
        s.on(Socket.EVENT_DISCONNECT) { _state.value = ConnState.Disconnected }
        s.on(Socket.EVENT_CONNECT_ERROR) { _state.value = ConnState.Disconnected }
        s.on("load-url", loadUrlListener)
        s.on("share-request", shareRequestListener)
        s.on("share-stop", shareStopListener)
        s.connect()
    }

    private fun register() {
        val info = deviceInfo ?: return
        val payload = JSONObject().apply {
            put("label", info.label)
            put("width", info.width)
            put("height", info.height)
            put("userAgent", info.userAgent)
        }
        socket?.emit("register-client", payload)
    }

    fun reportViewport(width: Int, height: Int) {
        val payload = JSONObject().apply {
            put("width", width)
            put("height", height)
        }
        socket?.emit("viewport-changed", payload)
        deviceInfo = deviceInfo?.copy(width = width, height = height)
    }

    fun updateLabel(label: String) {
        deviceInfo = deviceInfo?.copy(label = label)
        val payload = JSONObject().apply { put("label", label) }
        socket?.emit("relabel-client", payload)
    }

    fun emitConsoleLog(level: String, message: String, source: String, line: Int) {
        val payload = JSONObject().apply {
            put("level", level)
            put("message", message)
            put("source", source)
            put("line", line)
        }
        socket?.emit("console-log", payload)
    }

    fun emitShareFrame(targetId: String, base64Jpeg: String, width: Int, height: Int) {
        val payload = JSONObject().apply {
            put("targetId", targetId)
            put("frame", base64Jpeg)
            put("width", width)
            put("height", height)
        }
        socket?.emit("share-frame", payload)
    }

    fun emitShareFailed(targetId: String, reason: String) {
        val payload = JSONObject().apply {
            put("targetId", targetId)
            put("reason", reason)
        }
        socket?.emit("share-failed", payload)
    }

    fun emitShareEnded(targetId: String) {
        val payload = JSONObject().apply { put("targetId", targetId) }
        socket?.emit("share-ended", payload)
    }

    fun disconnect() {
        socket?.off("load-url", loadUrlListener)
        socket?.off("share-request", shareRequestListener)
        socket?.off("share-stop", shareStopListener)
        socket?.disconnect()
        socket?.off()
        socket = null
        _state.value = ConnState.Disconnected
    }
}
