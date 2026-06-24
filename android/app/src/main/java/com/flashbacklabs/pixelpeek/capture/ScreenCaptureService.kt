package com.flashbacklabs.pixelpeek.capture

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/** Foreground shell required by Android 10+ before MediaProjection can be obtained. */
class ScreenCaptureService : Service() {

    inner class LocalBinder : Binder() {
        fun getService(): ScreenCaptureService = this@ScreenCaptureService
    }

    private val binder = LocalBinder()

    override fun onBind(intent: Intent): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createNotificationChannel()
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Pixelpeek — Screen sharing")
            .setContentText("Streaming your screen to the orchestrator")
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build()
        ServiceCompat.startForeground(
            this, NOTIF_ID, notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
        )
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        val ch = NotificationChannel(
            CHANNEL_ID,
            "Screen Capture",
            NotificationManager.IMPORTANCE_LOW,
        ).apply { description = "Active while sharing screen with Pixelpeek orchestrator" }
        getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    companion object {
        const val CHANNEL_ID = "pixelpeek_capture"
        const val NOTIF_ID = 1001

        fun startIntent(context: Context) =
            Intent(context, ScreenCaptureService::class.java)
    }
}
