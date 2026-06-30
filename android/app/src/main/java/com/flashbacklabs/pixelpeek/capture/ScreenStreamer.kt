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

class ScreenStreamer(
    private val context: Context,
    private val resultCode: Int,
    private val permissionData: Intent,
    private val width: Int,
    private val height: Int,
    private val dpi: Int,
    profile: Profile,
    private val onFrame: (String, Int, Int) -> Unit,
    private val onStopped: () -> Unit,
) {
    data class Profile(
        val fps: Int = 8,
        val maxFrameDim: Int = 720,
        val jpegQuality: Int = 68,
    ) {
        fun normalized(): Profile = copy(
            fps = fps.coerceIn(2, 30),
            maxFrameDim = maxFrameDim.coerceIn(320, 1440),
            jpegQuality = jpegQuality.coerceIn(35, 90),
        )
    }

    private data class EncodedFrame(
        val base64: String,
        val width: Int,
        val height: Int,
    )

    private val thread = HandlerThread("PixelpeekStreamer").also { it.start() }
    private val handler = Handler(thread.looper)
    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private val stopped = AtomicBoolean(false)
    private var lastFrameAt = 0L

    @Volatile
    private var activeProfile: Profile = profile.normalized()

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

    fun updateProfile(profile: Profile) {
        activeProfile = profile.normalized()
    }

    private fun onImageAvailable(reader: ImageReader) {
        if (stopped.get()) return
        val profile = activeProfile
        val minFrameIntervalMs = (1000L / profile.fps.coerceAtLeast(1)).coerceAtLeast(33L)
        val now = System.currentTimeMillis()
        if (now - lastFrameAt < minFrameIntervalMs) {
            runCatching { reader.acquireLatestImage()?.close() }
            return
        }
        val image = runCatching { reader.acquireLatestImage() }.getOrNull() ?: return
        lastFrameAt = now
        try {
            val frame = imageToJpegBase64(image, profile)
            onFrame(frame.base64, frame.width, frame.height)
        } catch (_: Throwable) {
            // Skip malformed frames; the next ImageReader callback will retry.
        } finally {
            runCatching { image.close() }
        }
    }

    private fun imageToJpegBase64(image: Image, profile: Profile): EncodedFrame {
        val plane = image.planes[0]
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * width
        val paddedWidth = width + rowPadding / pixelStride

        val bitmap = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
        bitmap.copyPixelsFromBuffer(buffer)

        val cropped = if (rowPadding == 0) bitmap else Bitmap.createBitmap(bitmap, 0, 0, width, height)
        val maxDim = maxOf(width, height).coerceAtLeast(1)
        val scale = (profile.maxFrameDim.toFloat() / maxDim).coerceAtMost(1f)
        val outputW = (width * scale).toInt().coerceAtLeast(1)
        val outputH = (height * scale).toInt().coerceAtLeast(1)
        val output = if (scale < 0.999f) {
            Bitmap.createScaledBitmap(cropped, outputW, outputH, true)
        } else {
            cropped
        }

        val out = ByteArrayOutputStream(128 * 1024)
        output.compress(Bitmap.CompressFormat.JPEG, profile.jpegQuality, out)
        if (output !== cropped) output.recycle()
        if (cropped !== bitmap) cropped.recycle()
        bitmap.recycle()
        return EncodedFrame(
            base64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP),
            width = outputW,
            height = outputH,
        )
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
