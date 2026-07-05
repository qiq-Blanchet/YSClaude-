package com.ysclaude.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage
import java.nio.charset.StandardCharsets

internal object YSClaudeUnifiedPushPrefs {
  const val PREFS_NAME = "ysclaude_unifiedpush"
  const val KEY_ENDPOINT = "endpoint"
  const val KEY_P256DH = "p256dh"
  const val KEY_AUTH = "auth"
  const val EVENT_ENDPOINT = "YSClaudeUnifiedPushEndpoint"
  const val EVENT_MESSAGE = "YSClaudeUnifiedPushMessage"
  private const val CHANNEL_ID = "keepalive-push-v1"
  private const val CHANNEL_NAME = "YSClaude 保活推送"

  fun saveEndpoint(context: Context, endpoint: PushEndpoint) {
    val pubKeySet = endpoint.pubKeySet ?: return
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_ENDPOINT, endpoint.url)
      .putString(KEY_P256DH, pubKeySet.pubKey)
      .putString(KEY_AUTH, pubKeySet.auth)
      .apply()
  }

  fun clearEndpoint(context: Context) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY_ENDPOINT)
      .remove(KEY_P256DH)
      .remove(KEY_AUTH)
      .apply()
  }

  fun readEndpointMap(context: Context): WritableMap? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val endpoint = prefs.getString(KEY_ENDPOINT, null)?.trim().orEmpty()
    val p256dh = prefs.getString(KEY_P256DH, null)?.trim().orEmpty()
    val auth = prefs.getString(KEY_AUTH, null)?.trim().orEmpty()
    if (endpoint.isEmpty() || p256dh.isEmpty() || auth.isEmpty()) return null
    return WritableNativeMap().apply {
      putString("endpoint", endpoint)
      putString("p256dh", p256dh)
      putString("auth", auth)
    }
  }

  fun emit(context: Context, event: String, payload: WritableMap) {
    val reactContext = (context.applicationContext as? ReactApplication)
      ?.reactHost
      ?.currentReactContext as? ReactContext
      ?: return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, payload)
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_HIGH
    )
    manager.createNotificationChannel(channel)
  }

  fun channelId(): String = CHANNEL_ID
}

class YSClaudePushService : PushService() {
  override fun onMessage(message: PushMessage, instance: String) {
    val text = String(message.content, StandardCharsets.UTF_8)
    val json = runCatching { JSONObject(text) }.getOrNull()
    val conversationId = json?.optString("conversationId")?.trim().orEmpty()
    val body = json?.optString("message")?.trim()?.takeIf { it.isNotEmpty() } ?: "（空消息）"

    showNotification(conversationId, body)

    YSClaudeUnifiedPushPrefs.emit(this, YSClaudeUnifiedPushPrefs.EVENT_MESSAGE, WritableNativeMap().apply {
      putString("conversationId", conversationId)
      putString("message", body)
      putBoolean("decrypted", message.decrypted)
      putString("instance", instance)
    })
  }

  override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
    YSClaudeUnifiedPushPrefs.saveEndpoint(this, endpoint)
    val payload = YSClaudeUnifiedPushPrefs.readEndpointMap(this) ?: WritableNativeMap()
    payload.putString("status", "registered")
    payload.putString("instance", instance)
    YSClaudeUnifiedPushPrefs.emit(this, YSClaudeUnifiedPushPrefs.EVENT_ENDPOINT, payload)
  }

  override fun onUnregistered(instance: String) {
    YSClaudeUnifiedPushPrefs.clearEndpoint(this)
    YSClaudeUnifiedPushPrefs.emit(this, YSClaudeUnifiedPushPrefs.EVENT_ENDPOINT, WritableNativeMap().apply {
      putString("status", "unregistered")
      putString("instance", instance)
    })
  }

  override fun onRegistrationFailed(reason: FailedReason, instance: String) {
    YSClaudeUnifiedPushPrefs.emit(this, YSClaudeUnifiedPushPrefs.EVENT_ENDPOINT, WritableNativeMap().apply {
      putString("status", "failed")
      putString("reason", reason.toString())
      putString("instance", instance)
    })
  }

  private fun showNotification(conversationId: String, body: String) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return
    }

    YSClaudeUnifiedPushPrefs.ensureChannel(this)
    val uri = if (conversationId.isNotEmpty()) {
      Uri.parse("ysclaude://chat/${Uri.encode(conversationId)}")
    } else {
      Uri.parse("ysclaude://")
    }
    val intent = Intent(Intent.ACTION_VIEW, uri).apply {
      setPackage(packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      conversationId.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      android.app.Notification.Builder(this, YSClaudeUnifiedPushPrefs.channelId())
    } else {
      android.app.Notification.Builder(this)
    }
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("Claude在呼叫你……")
      .setContentText(body)
      .setStyle(android.app.Notification.BigTextStyle().bigText(body))
      .setContentIntent(pendingIntent)
      .setAutoCancel(true)
      .build()

    val manager = getSystemService(NotificationManager::class.java) ?: return
    manager.notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), notification)
  }
}
