package com.flashbacklabs.pixelpeek.capture

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Captures the device screen via MediaProjection and emits each frame as a base64-encoded JPEG.
 * Throttles to ~10 FPS to keep bandwidth and CPU reasonable.
 */
class ScreenStreamer(
    private val context: Context,
    private val resultCode: Int,
    private val permissionData: Intent,
    private val width: Int,
    private val height: Int,
    private val dpi: Int,
    private val onFrame: (String) -> Unit,
    private val onStopped: () -> Unit,
) {
    private val thread = HandlerThread("PixelpeekStreamer").also { it.start() }
    private val handler = Handler(thread.looper)
    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private val stopped = AtomicBoolean(false)
    private var lastFrameAt = 0L
    private val minFrameIntervalMs = 100L // ~10 FPS cap

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            if (!stopped.get()) onStopped()
        }
    }

    fun start() {
        val mgr = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val p = mgr.getMediaProjection(resultCode, permissionData)
        projection = p
        p.registerCallback(projectionCallback, handler)

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2).also { reader ->
            reader.setOnImageAvailableListener(::onImageAvailable, handler)
        }

        virtualDisplay = p.createVirtualDisplay(
            "Pixelpeek-stream",
            width,
            height,
            dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader!!.surface,
            null,
            handler,
        )
    }

    private fun onImageAvailable(reader: ImageReader) {
        if (stopped.get()) return
        val now = System.currentTimeMillis()
        if (now - lastFrameAt < minFrameIntervalMs) {
            runCatching { reader.acquireLatestImage()?.close() }
            return
        }
        val image = runCatching { reader.acquireLatestImage() }.getOrNull() ?: return
        lastFrameAt = now
        try {
            val base64 = imageToJpegBase64(image)
            onFrame(base64)
        } catch (_: Throwable) {
            // skip bad frame
        } finally {
            runCatching { image.close() }
        }
    }

    private fun imageToJpegBase64(image: Image): String {
        val plane = image.planes[0]
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * width
        val paddedWidth = width + rowPadding / pixelStride

        val bitmap = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
        bitmap.copyPixelsFromBuffer(buffer)

        val cropped = if (rowPadding == 0) bitmap else Bitmap.createBitmap(bitmap, 0, 0, width, height)
        val out = ByteArrayOutputStream(64 * 1024)
        cropped.compress(Bitmap.CompressFormat.JPEG, 45, out)
        if (cropped !== bitmap) cropped.recycle()
        bitmap.recycle()
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    fun stop() {
        if (!stopped.compareAndSet(false, true)) return
        runCatching { projection?.unregisterCallback(projectionCallback) }
        runCatching { virtualDisplay?.release() }
        virtualDisplay = null
        runCatching { imageReader?.close() }
        imageReader = null
        runCatching { projection?.stop() }
        projection = null
        runCatching { thread.quitSafely() }
    }
}
