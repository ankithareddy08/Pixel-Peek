package com.flashbacklabs.pixelpeek.ui.screens

import android.annotation.SuppressLint
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.flashbacklabs.pixelpeek.net.ControlCommand
import com.flashbacklabs.pixelpeek.ui.theme.PixelpeekMono
import com.flashbacklabs.pixelpeek.ui.theme.PixelpeekPalette
import kotlinx.coroutines.flow.SharedFlow

private const val CONSOLE_BRIDGE_NAME = "__PixelpeekBridge"

/**
 * Reliable console capture: a JavaScript shim wraps `console.log/warn/error/...` and pipes every
 * call through a JS interface to native code. WebChromeClient.onConsoleMessage stays as a fallback
 * for messages emitted before our shim is installed (or by sources that bypass `console`).
 */
private const val CONSOLE_SHIM_JS = """
(function() {
  if (window.__pixelpeekShimInstalled) return;
  window.__pixelpeekShimInstalled = true;
  function send(level, args) {
    try {
      var parts = [];
      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        if (a == null) parts.push(String(a));
        else if (typeof a === 'string') parts.push(a);
        else if (a instanceof Error) parts.push(a.stack || (a.name + ': ' + a.message));
        else {
          try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); }
        }
      }
      if (typeof $CONSOLE_BRIDGE_NAME !== 'undefined' && $CONSOLE_BRIDGE_NAME && $CONSOLE_BRIDGE_NAME.postLog) {
        $CONSOLE_BRIDGE_NAME.postLog(level, parts.join(' '), location.href || '', 0);
      }
    } catch (e) {}
  }
  var orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  console.log = function() { send('LOG', arguments); return orig.log.apply(console, arguments); };
  console.info = function() { send('LOG', arguments); return orig.info.apply(console, arguments); };
  console.warn = function() { send('WARNING', arguments); return orig.warn.apply(console, arguments); };
  console.error = function() { send('ERROR', arguments); return orig.error.apply(console, arguments); };
  console.debug = function() { send('DEBUG', arguments); return orig.debug.apply(console, arguments); };
  window.addEventListener('error', function(e) {
    send('ERROR', [(e.message || 'Error') + (e.filename ? ' at ' + e.filename + ':' + e.lineno : '')]);
  });
  window.addEventListener('unhandledrejection', function(e) {
    var r = e.reason;
    send('ERROR', ['Unhandled rejection: ' + (r && r.stack ? r.stack : String(r))]);
  });
  // Self-test so the host can confirm the pipeline is working.
  send('LOG', ['[Pixelpeek] console bridge attached on ' + (location.href || 'page')]);
})();
"""

@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
@Composable
fun BrowserScreen(
    url: String,
    onSizeChanged: (Int, Int) -> Unit,
    onConsoleMessage: (level: String, message: String, source: String, line: Int) -> Unit = { _, _, _, _ -> },
    onPageEvent: (kind: String, message: String, url: String) -> Unit = { _, _, _ -> },
    controlCommands: SharedFlow<ControlCommand>? = null,
    isFullscreen: Boolean = false,
    onToggleFullscreen: () -> Unit = {},
    isSharing: Boolean = false,
) {
    val density = LocalDensity.current
    val horizontalPad = if (isFullscreen) 0.dp else 12.dp
    val verticalPad = if (isFullscreen) 0.dp else 8.dp
    val cornerRadius = if (isFullscreen) 0.dp else 14.dp

    val callback by rememberUpdatedState(onConsoleMessage)
    val pageCallback by rememberUpdatedState(onPageEvent)
    val webViewRef = remember { arrayOfNulls<WebView>(1) }

    // Drive remote scroll / click commands from the host into the WebView.
    LaunchedEffect(controlCommands) {
        controlCommands?.collect { cmd ->
            val web = webViewRef[0] ?: return@collect
            when (cmd) {
                is ControlCommand.Scroll -> web.post {
                    web.scrollBy(cmd.deltaX, cmd.deltaY)
                }
                is ControlCommand.ScrollTo -> web.post {
                    web.evaluateJavascript(
                        "window.scrollTo(${cmd.x}, ${cmd.y});",
                        null,
                    )
                }
                is ControlCommand.Click -> web.post {
                    // The host captures the entire device screen, but only the WebView
                    // should receive the synthetic touch. Map normalized image fraction
                    // → screen pixel → WebView-local pixel and reject taps outside.
                    val dm = web.context.resources.displayMetrics
                    val loc = IntArray(2).also(web::getLocationOnScreen)
                    val screenX = cmd.xPct * dm.widthPixels
                    val screenY = cmd.yPct * dm.heightPixels
                    val xInView = screenX - loc[0]
                    val yInView = screenY - loc[1]
                    if (xInView < 0f || yInView < 0f ||
                        xInView > web.width.toFloat() || yInView > web.height.toFloat()
                    ) return@post
                    val now = SystemClock.uptimeMillis()
                    val down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, xInView, yInView, 0)
                    val up = MotionEvent.obtain(now, now + 60, MotionEvent.ACTION_UP, xInView, yInView, 0)
                    web.dispatchTouchEvent(down)
                    web.dispatchTouchEvent(up)
                    down.recycle()
                    up.recycle()
                }
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = horizontalPad, vertical = verticalPad),
        verticalArrangement = Arrangement.spacedBy(if (isFullscreen) 0.dp else 8.dp),
    ) {
        UrlBar(
            url = url,
            isFullscreen = isFullscreen,
            onToggleFullscreen = onToggleFullscreen,
            showShareDot = isSharing && isFullscreen,
        )
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(cornerRadius))
                .background(PixelpeekPalette.Bg2)
                .onSizeChanged { size ->
                    val w = with(density) { size.width.toDp().value.toInt() }
                    val h = with(density) { size.height.toDp().value.toInt() }
                    onSizeChanged(w, h)
                },
        ) {
            AndroidView(
                modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(cornerRadius)),
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.useWideViewPort = true
                        settings.loadWithOverviewMode = true
                        addJavascriptInterface(
                            object {
                                @JavascriptInterface
                                fun postLog(level: String?, message: String?, source: String?, line: Int) {
                                    Log.d("PixelpeekBridge", "postLog level=$level msg=${message?.take(80)}")
                                    callback(
                                        level ?: "LOG",
                                        message ?: "",
                                        source ?: "",
                                        line,
                                    )
                                }
                            },
                            CONSOLE_BRIDGE_NAME,
                        )
                        webViewClient = object : WebViewClient() {
                            override fun onPageStarted(view: WebView, u: String?, favicon: android.graphics.Bitmap?) {
                                super.onPageStarted(view, u, favicon)
                                pageCallback("navigation", "Page started", u ?: url)
                                view.evaluateJavascript(CONSOLE_SHIM_JS, null)
                            }
                            override fun onPageFinished(view: WebView, u: String?) {
                                super.onPageFinished(view, u)
                                pageCallback("navigation", "Page finished", u ?: url)
                                view.evaluateJavascript(CONSOLE_SHIM_JS, null)
                            }
                            override fun onReceivedError(
                                view: WebView,
                                request: WebResourceRequest,
                                error: WebResourceError,
                            ) {
                                super.onReceivedError(view, request, error)
                                if (request.isForMainFrame) {
                                    pageCallback(
                                        "error",
                                        error.description?.toString() ?: "Page load failed",
                                        request.url?.toString() ?: url,
                                    )
                                }
                            }
                        }
                        webChromeClient = object : WebChromeClient() {
                            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                                callback(
                                    message.messageLevel().name,
                                    message.message() ?: "",
                                    message.sourceId() ?: "",
                                    message.lineNumber(),
                                )
                                return true
                            }
                        }
                        webViewRef[0] = this
                    }
                },
                update = { webView ->
                    if (webView.url != url) webView.loadUrl(url)
                },
            )
        }
    }
}

@Composable
private fun UrlBar(
    url: String,
    isFullscreen: Boolean,
    onToggleFullscreen: () -> Unit,
    showShareDot: Boolean = false,
) {
    Surface(
        color = PixelpeekPalette.Bg2,
        shape = RoundedCornerShape(if (isFullscreen) 0.dp else 10.dp),
        border = if (isFullscreen) null else BorderStroke(1.dp, PixelpeekPalette.Border),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(RoundedCornerShape(50))
                    .background(PixelpeekPalette.Success),
            )
            Text(
                text = url,
                color = PixelpeekPalette.TextMuted,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = PixelpeekMono),
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
            if (showShareDot) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .clip(RoundedCornerShape(50))
                        .background(PixelpeekPalette.Danger),
                )
            }
            IconButton(
                onClick = onToggleFullscreen,
                modifier = Modifier.size(32.dp),
            ) {
                Icon(
                    imageVector = if (isFullscreen) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen,
                    contentDescription = if (isFullscreen) "Exit fullscreen" else "Enter fullscreen",
                    tint = PixelpeekPalette.Text,
                )
            }
        }
    }
}
