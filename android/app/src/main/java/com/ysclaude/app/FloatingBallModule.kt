package com.ysclaude.app

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import com.bumptech.glide.Glide
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlin.math.abs
import kotlin.random.Random

class FloatingBallModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "FloatingBall"

  private val mainHandler = Handler(Looper.getMainLooper())
  private val windowManager = reactContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val ballSize = dp(96)
  private val toolSize = dp(46)
  private val expandedWidth = dp(292)
  private val expandedHeight = dp(264)
  private val bubbleWidth = dp(268)
  private val edgeVisible = dp(62)
  private val touchSlop = ViewConfiguration.get(reactContext).scaledTouchSlop
  private val toolColors = listOf(
    Color.rgb(255, 232, 238),
    Color.rgb(232, 241, 255),
    Color.rgb(232, 248, 238),
    Color.rgb(255, 244, 214)
  )

  private var rootView: FrameLayout? = null
  private var ballView: ImageView? = null
  private var bubbleView: TextView? = null
  private var bubbleParams: WindowManager.LayoutParams? = null
  private var toolbarViews: List<TextView> = emptyList()
  private var layoutParams: WindowManager.LayoutParams? = null
  private var isExpanded = false
  private var isEdgeHanging = false
  private var edgeSide = EdgeSide.RIGHT
  private var currentNormalIndex = -1
  private var lastDownRawX = 0f
  private var lastDownRawY = 0f
  private var downParamX = 0
  private var downParamY = 0
  private var didDrag = false
  private var didLongPress = false

  private val longPressRunnable = Runnable {
    didLongPress = true
    showToolbar()
  }

  private val returnToIdleRunnable = Runnable {
    loadState(if (isEdgeHanging) EDGE_IDLE else NORMAL_IDLE)
  }

  private val hideMessageRunnable = Runnable {
    hideMessageInternal()
  }

  private val randomStateRunnable = object : Runnable {
    override fun run() {
      if (rootView != null && !isExpanded) {
        val pool = if (isEdgeHanging) EDGE_RANDOM_STATES else NORMAL_RANDOM_STATES
        val next = pool.random()
        loadState(next)
        mainHandler.removeCallbacks(returnToIdleRunnable)
        mainHandler.postDelayed(returnToIdleRunnable, 2600)
      }
      scheduleRandomState()
    }
  }

  @ReactMethod
  fun canDrawOverlays(promise: Promise) {
    promise.resolve(canDrawOverlays())
  }

  @ReactMethod
  fun openOverlaySettings(promise: Promise) {
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${reactContext.packageName}")
      ).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("OPEN_OVERLAY_SETTINGS_FAILED", error)
    }
  }

  @ReactMethod
  fun show(promise: Promise) {
    mainHandler.post {
      try {
        if (!canDrawOverlays()) {
          promise.reject("OVERLAY_PERMISSION_REQUIRED", "Floating ball overlay permission is not granted")
          return@post
        }
        showInternal()
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("SHOW_FLOATING_BALL_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun hide(promise: Promise) {
    mainHandler.post {
      try {
        hideInternal()
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("HIDE_FLOATING_BALL_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun isShowing(promise: Promise) {
    promise.resolve(rootView != null)
  }

  @ReactMethod
  fun showMessage(text: String, promise: Promise) {
    mainHandler.post {
      try {
        showMessageInternal(text)
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("SHOW_FLOATING_MESSAGE_FAILED", error)
      }
    }
  }

  @ReactMethod
  fun hideMessage(promise: Promise) {
    mainHandler.post {
      try {
        hideMessageInternal()
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("HIDE_FLOATING_MESSAGE_FAILED", error)
      }
    }
  }

  private fun canDrawOverlays(): Boolean {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(reactContext)
  }

  private fun showInternal() {
    if (rootView != null) return

    val root = FrameLayout(reactContext).apply {
      clipChildren = false
      clipToPadding = false
      setBackgroundColor(Color.TRANSPARENT)
    }

    val image = ImageView(reactContext).apply {
      scaleType = ImageView.ScaleType.FIT_CENTER
      setOnTouchListener(::handleTouch)
    }
    root.addView(image, FrameLayout.LayoutParams(ballSize, ballSize))

    val tools = (1..4).map { index ->
      TextView(reactContext).apply {
        text = index.toString()
        textSize = 14f
        setTextColor(Color.rgb(86, 82, 92))
        gravity = Gravity.CENTER
        background = circleDrawable(toolColors[index - 1])
        elevation = dp(5).toFloat()
        alpha = 0.96f
        visibility = View.GONE
      }
    }
    tools.forEach { root.addView(it, FrameLayout.LayoutParams(toolSize, toolSize)) }

    rootView = root
    ballView = image
    toolbarViews = tools
    isExpanded = false
    isEdgeHanging = false
    edgeSide = EdgeSide.RIGHT

    layoutParams = WindowManager.LayoutParams(
      ballSize,
      ballSize,
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      android.graphics.PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = screenWidth() - ballSize - dp(18)
      y = screenHeight() / 2 - ballSize / 2
    }

    windowManager.addView(root, layoutParams)
    loadState(NORMAL_IDLE)
    scheduleRandomState()
  }

  private fun hideInternal() {
    mainHandler.removeCallbacks(longPressRunnable)
    mainHandler.removeCallbacks(returnToIdleRunnable)
    mainHandler.removeCallbacks(randomStateRunnable)
    mainHandler.removeCallbacks(hideMessageRunnable)
    hideMessageInternal()
    rootView?.let { view ->
      runCatching { windowManager.removeView(view) }
    }
    rootView = null
    ballView = null
    toolbarViews = emptyList()
    layoutParams = null
    isExpanded = false
    isEdgeHanging = false
  }

  private fun handleTouch(view: View, event: MotionEvent): Boolean {
    val params = layoutParams ?: return true
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        hideMessageInternal()
        lastDownRawX = event.rawX
        lastDownRawY = event.rawY
        downParamX = params.x
        downParamY = params.y
        didDrag = false
        didLongPress = false
        mainHandler.removeCallbacks(longPressRunnable)
        mainHandler.postDelayed(longPressRunnable, ViewConfiguration.getLongPressTimeout().toLong())
        return true
      }

      MotionEvent.ACTION_MOVE -> {
        val dx = event.rawX - lastDownRawX
        val dy = event.rawY - lastDownRawY
        if (!didDrag && (abs(dx) > touchSlop || abs(dy) > touchSlop)) {
          didDrag = true
          mainHandler.removeCallbacks(longPressRunnable)
          hideToolbar()
          isEdgeHanging = false
          loadState(NORMAL_IDLE)
        }
        if (didDrag) {
          params.x = (downParamX + dx).toInt()
          params.y = (downParamY + dy).toInt().coerceIn(0, screenHeight() - ballSize)
          rootView?.let { windowManager.updateViewLayout(it, params) }
        }
        return true
      }

      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        mainHandler.removeCallbacks(longPressRunnable)
        if (didDrag) {
          settleAfterDrag()
        } else if (!didLongPress && event.actionMasked == MotionEvent.ACTION_UP) {
          handleClick()
        }
        didDrag = false
        didLongPress = false
        return true
      }
    }
    return true
  }

  private fun handleClick() {
    hideMessageInternal()
    if (isExpanded) {
      hideToolbar()
      return
    }
    if (isEdgeHanging) {
      exitEdge()
      return
    }
    currentNormalIndex = (currentNormalIndex + 1).floorMod(NORMAL_CLICK_STATES.size)
    loadState(NORMAL_CLICK_STATES[currentNormalIndex])
    mainHandler.removeCallbacks(returnToIdleRunnable)
    mainHandler.postDelayed(returnToIdleRunnable, 3200)
  }

  private fun settleAfterDrag() {
    val root = rootView ?: return
    val params = layoutParams ?: return
    val width = screenWidth()
    val centerX = params.x + ballSize / 2
    edgeSide = if (centerX < width / 2) EdgeSide.LEFT else EdgeSide.RIGHT
    val nearLeft = params.x <= dp(20)
    val nearRight = params.x + ballSize >= width - dp(20)

    if (nearLeft || nearRight) {
      isEdgeHanging = true
      params.x = if (edgeSide == EdgeSide.LEFT) -ballSize + edgeVisible else width - edgeVisible
      params.y = params.y.coerceIn(0, screenHeight() - ballSize)
      windowManager.updateViewLayout(root, params)
      loadState(EDGE_IDLE)
      updateMessagePosition()
      return
    }

    isEdgeHanging = false
    params.x = params.x.coerceIn(0, width - ballSize)
    params.y = params.y.coerceIn(0, screenHeight() - ballSize)
    windowManager.updateViewLayout(root, params)
    loadState(NORMAL_IDLE)
    updateMessagePosition()
  }

  private fun exitEdge() {
    val root = rootView ?: return
    val params = layoutParams ?: return
    isEdgeHanging = false
    params.x = if (edgeSide == EdgeSide.LEFT) 0 else screenWidth() - ballSize
    params.y = params.y.coerceIn(0, screenHeight() - ballSize)
    windowManager.updateViewLayout(root, params)
    loadState(NORMAL_IDLE)
    updateMessagePosition()
  }

  private fun showToolbar() {
    hideMessageInternal()
    val root = rootView ?: return
    val params = layoutParams ?: return
    val oldCenterX = params.x + params.width / 2
    val oldCenterY = params.y + params.height / 2
    val openToRight = oldCenterX < screenWidth() / 2
    edgeSide = if (openToRight) EdgeSide.LEFT else EdgeSide.RIGHT

    isExpanded = true
    isEdgeHanging = false
    params.width = expandedWidth
    params.height = expandedHeight
    val ballLeft = expandedWidth / 2 - ballSize / 2
    val ballTop = expandedHeight - ballSize - dp(8)
    params.x = (oldCenterX - ballLeft - ballSize / 2)
      .coerceIn(0, screenWidth() - expandedWidth)
    params.y = (oldCenterY - ballTop - ballSize / 2)
      .coerceIn(0, screenHeight() - expandedHeight)
    windowManager.updateViewLayout(root, params)

    ballView?.layoutParams = FrameLayout.LayoutParams(ballSize, ballSize).apply {
      leftMargin = ballLeft
      topMargin = ballTop
    }

    val ballCenterX = ballLeft + ballSize / 2
    val ballCenterY = ballTop + ballSize / 2
    val positions = listOf(
      (ballCenterX - dp(102) - toolSize / 2) to (ballCenterY - dp(76) - toolSize / 2),
      (ballCenterX - dp(34) - toolSize / 2) to (ballCenterY - dp(120) - toolSize / 2),
      (ballCenterX + dp(34) - toolSize / 2) to (ballCenterY - dp(120) - toolSize / 2),
      (ballCenterX + dp(102) - toolSize / 2) to (ballCenterY - dp(76) - toolSize / 2)
    )
    toolbarViews.forEachIndexed { index, tool ->
      val (left, top) = positions[index]
      tool.layoutParams = FrameLayout.LayoutParams(toolSize, toolSize).apply {
        leftMargin = left
        topMargin = top
      }
      tool.visibility = View.VISIBLE
    }
    loadState(NORMAL_IDLE)
  }

  private fun hideToolbar() {
    if (!isExpanded) return
    val params = layoutParams ?: return
    val root = rootView ?: return
    val ballCenterX = params.x + (ballView?.left ?: 0) + ballSize / 2
    val ballCenterY = params.y + (ballView?.top ?: 0) + ballSize / 2

    isExpanded = false
    toolbarViews.forEach { it.visibility = View.GONE }
    ballView?.layoutParams = FrameLayout.LayoutParams(ballSize, ballSize)

    params.width = ballSize
    params.height = ballSize
    params.x = (ballCenterX - ballSize / 2).coerceIn(0, screenWidth() - ballSize)
    params.y = (ballCenterY - ballSize / 2).coerceIn(0, screenHeight() - ballSize)
    windowManager.updateViewLayout(root, params)
    loadState(NORMAL_IDLE)
    updateMessagePosition()
  }

  private fun showMessageInternal(rawText: String) {
    if (rootView == null || layoutParams == null || isExpanded) return
    val text = normalizeMessageText(rawText)
    if (text.isBlank()) return

    val bubble = bubbleView ?: TextView(reactContext).apply {
      textSize = 14f
      setTextColor(Color.rgb(58, 55, 62))
      setLineSpacing(dp(2).toFloat(), 1.0f)
      maxLines = 3
      ellipsize = TextUtils.TruncateAt.END
      includeFontPadding = true
      setPadding(dp(14), dp(10), dp(14), dp(10))
      background = messageBubbleDrawable()
      elevation = dp(8).toFloat()
    }.also {
      bubbleView = it
    }

    bubble.text = text
    if (bubble.parent == null) {
      bubbleParams = WindowManager.LayoutParams(
        bubbleWidth,
        WindowManager.LayoutParams.WRAP_CONTENT,
        overlayType(),
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
        android.graphics.PixelFormat.TRANSLUCENT
      ).apply {
        gravity = Gravity.TOP or Gravity.START
      }
      windowManager.addView(bubble, bubbleParams)
    }

    updateMessagePosition()
    mainHandler.removeCallbacks(hideMessageRunnable)
    mainHandler.postDelayed(hideMessageRunnable, 7200)
  }

  private fun hideMessageInternal() {
    mainHandler.removeCallbacks(hideMessageRunnable)
    bubbleView?.let { view ->
      if (view.parent != null) {
        runCatching { windowManager.removeView(view) }
      }
    }
    bubbleView = null
    bubbleParams = null
  }

  private fun updateMessagePosition() {
    val params = layoutParams ?: return
    val bubble = bubbleView ?: return
    val bubbleLayout = bubbleParams ?: return
    if (bubble.parent == null) return

    val ballCenterX = params.x + params.width / 2
    val desiredX = if (isEdgeHanging && edgeSide == EdgeSide.LEFT) {
      params.x + ballSize - dp(8)
    } else if (isEdgeHanging && edgeSide == EdgeSide.RIGHT) {
      params.x - bubbleWidth + dp(8)
    } else {
      ballCenterX - bubbleWidth / 2
    }
    bubbleLayout.x = desiredX.coerceIn(dp(8), screenWidth() - bubbleWidth - dp(8))
    bubbleLayout.y = (params.y - dp(86)).coerceAtLeast(dp(18))
    windowManager.updateViewLayout(bubble, bubbleLayout)
  }

  private fun normalizeMessageText(rawText: String): String {
    return rawText
      .replace(Regex("\\[/?[^\\]]{1,24}\\]"), "")
      .replace(Regex("\\n{3,}"), "\n\n")
      .trim()
      .let { text ->
        if (text.length > 180) text.take(180).trimEnd() + "..." else text
      }
  }

  private fun circleDrawable(color: Int): GradientDrawable {
    return GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(color)
      setStroke(dp(1), Color.argb(80, 255, 255, 255))
    }
  }

  private fun messageBubbleDrawable(): GradientDrawable {
    return GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      cornerRadius = dp(16).toFloat()
      setColor(Color.argb(244, 255, 252, 245))
      setStroke(dp(1), Color.argb(96, 224, 215, 198))
    }
  }

  private fun loadState(assetName: String) {
    val image = ballView ?: return
    val actualAsset = if (assetName.startsWith("clawd-edge-") && !EDGE_ALL_STATES.contains(assetName)) {
      EDGE_IDLE
    } else {
      assetName
    }
    image.scaleX = if (isEdgeHanging && edgeSide == EdgeSide.LEFT) -1f else 1f
    Glide.with(reactContext)
      .asGif()
      .load("file:///android_asset/$actualAsset.gif")
      .into(image)
  }

  private fun scheduleRandomState() {
    mainHandler.removeCallbacks(randomStateRunnable)
    mainHandler.postDelayed(randomStateRunnable, Random.nextLong(9000, 18000))
  }

  private fun overlayType(): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }
  }

  private fun screenWidth(): Int = reactContext.resources.displayMetrics.widthPixels

  private fun screenHeight(): Int = reactContext.resources.displayMetrics.heightPixels

  private fun dp(value: Int): Int = (value * reactContext.resources.displayMetrics.density).toInt()

  private fun Int.floorMod(other: Int): Int = ((this % other) + other) % other

  private enum class EdgeSide {
    LEFT,
    RIGHT
  }

  companion object {
    private const val NORMAL_IDLE = "clawd-idle"
    private const val EDGE_IDLE = "clawd-edge-idle"

    private val NORMAL_CLICK_STATES = listOf(
      "clawd-building",
      "clawd-bubble",
      "clawd-carrying",
      "clawd-conducting",
      "clawd-debugger",
      "clawd-error",
      "clawd-happy",
      "clawd-headphones-groove",
      "clawd-idle-reading",
      "clawd-juggling",
      "clawd-notification",
      "clawd-react-annoyed",
      "clawd-react-double-jump",
      "clawd-sleeping",
      "clawd-sweeping",
      "clawd-thinking",
      "clawd-typing"
    )

    private val NORMAL_RANDOM_STATES = NORMAL_CLICK_STATES

    private val EDGE_ALL_STATES = setOf(
      "clawd-edge-alert",
      "clawd-edge-crabwalk",
      "clawd-edge-enter",
      "clawd-edge-happy",
      "clawd-edge-idle",
      "clawd-edge-peek"
    )

    private val EDGE_RANDOM_STATES = listOf(
      "clawd-edge-alert",
      "clawd-edge-crabwalk",
      "clawd-edge-enter",
      "clawd-edge-happy",
      "clawd-edge-peek"
    )
  }
}
