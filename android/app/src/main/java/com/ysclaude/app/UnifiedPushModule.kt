package com.ysclaude.app

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.unifiedpush.android.connector.UnifiedPush

class UnifiedPushModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "UnifiedPushConnector"

  @ReactMethod
  fun register(promise: Promise) {
    val activity = getCurrentActivity()
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "UnifiedPush 注册需要当前 Activity")
      return
    }
    UnifiedPush.tryUseCurrentOrDefaultDistributor(activity) { success ->
      if (!success) {
        promise.reject("NO_DISTRIBUTOR", "未找到可用的 UnifiedPush 分发器，请先安装 ntfy 等分发器 App")
        return@tryUseCurrentOrDefaultDistributor
      }
      runCatching {
        UnifiedPush.register(
          reactContext,
          messageForDistributor = "YSClaude",
          vapid = null
        )
      }
        .onSuccess { promise.resolve(true) }
        .onFailure { error -> promise.reject("REGISTER_FAILED", error.message, error) }
    }
  }

  @ReactMethod
  fun unregister(promise: Promise) {
    runCatching {
      UnifiedPush.unregister(reactContext)
      YSClaudeUnifiedPushPrefs.clearEndpoint(reactContext)
    }
      .onSuccess { promise.resolve(true) }
      .onFailure { error -> promise.reject("UNREGISTER_FAILED", error.message, error) }
  }

  @ReactMethod
  fun getEndpoint(promise: Promise) {
    promise.resolve(YSClaudeUnifiedPushPrefs.readEndpointMap(reactContext))
  }
}
