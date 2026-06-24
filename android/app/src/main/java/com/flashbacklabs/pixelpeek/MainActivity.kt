package com.flashbacklabs.pixelpeek

import android.app.Activity
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.lifecycle.lifecycleScope
import com.flashbacklabs.pixelpeek.net.PixelpeekViewModel
import com.flashbacklabs.pixelpeek.net.ShareState
import com.flashbacklabs.pixelpeek.ui.PixelpeekApp
import com.flashbacklabs.pixelpeek.ui.theme.PixelpeekTheme
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val viewModel: PixelpeekViewModel by viewModels()

    private val screenCaptureLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            viewModel.onScreenCapturePermissionGranted(result.resultCode, result.data!!)
        } else {
            viewModel.onScreenCapturePermissionDenied()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)

        // When the host requests a share, show the system permission dialog
        lifecycleScope.launch {
            viewModel.ui
                .distinctUntilChangedBy { it.shareState }
                .collect { state ->
                    if (state.shareState == ShareState.Requested) {
                        val mgr = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                        screenCaptureLauncher.launch(mgr.createScreenCaptureIntent())
                    }
                }
        }

        setContent {
            PixelpeekTheme {
                PixelpeekApp(viewModel)
            }
        }
    }
}
