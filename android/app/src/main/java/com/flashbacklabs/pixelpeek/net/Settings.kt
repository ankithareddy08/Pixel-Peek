package com.flashbacklabs.pixelpeek.net

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "pixelpeek_prefs")

object PixelpeekPrefs {
    private val SERVER_URL = stringPreferencesKey("server_url")
    private val DEVICE_LABEL = stringPreferencesKey("device_label")

    fun serverUrl(context: Context): Flow<String> =
        context.dataStore.data.map { it[SERVER_URL] ?: DEFAULT_SERVER }

    fun deviceLabel(context: Context): Flow<String> =
        context.dataStore.data.map { it[DEVICE_LABEL] ?: "" }

    suspend fun setServerUrl(context: Context, value: String) {
        context.dataStore.edit { it[SERVER_URL] = value }
    }

    suspend fun setDeviceLabel(context: Context, value: String) {
        context.dataStore.edit { it[DEVICE_LABEL] = value }
    }

    const val DEFAULT_SERVER = "http://192.168.1.10:4000"
}
