import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { fonts } from '../theme/fonts';
import { useThemeColors, type ThemeColors } from '../theme/colors';
import { openHtmlArtifact } from '../services/webviewController';

const COLLAPSED_LINE_COUNT = 14;
const LONG_CODE_LINE_COUNT = 18;
const LONG_CODE_LENGTH = 1200;

function trimTrailingFenceNewline(content: string): string {
  return content.endsWith('\n') ? content.slice(0, -1) : content;
}

function getLanguageLabel(language?: string): string {
  const label = (language || '').trim().split(/\s+/)[0] || 'code';
  return label.toLowerCase();
}

function isHtmlLanguage(language?: string): boolean {
  const label = getLanguageLabel(language);
  return label === 'html' || label === 'htm' || label === 'xhtml';
}

function lineCountOf(content: string): number {
  if (!content) return 0;
  return content.split(/\r\n|\r|\n/).length;
}

function buildPreviewHtml(rawHtml: string): string {
  if (/<(?:!doctype|html|head|body)\b/i.test(rawHtml)) {
    return rawHtml;
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body {
      min-height: 100%;
      margin: 0;
      background: #ffffff;
      color: #111111;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      padding: 16px;
      box-sizing: border-box;
    }
  </style>
</head>
<body>
${rawHtml}
</body>
</html>`;
}

interface Props {
  content: string;
  language?: string;
  inheritedStyle?: TextStyle;
  codeStyle?: TextStyle;
  containerStyle?: any;
  messageId?: string;
  htmlBlockIndex?: number;
}

export function MarkdownCodeBlock({
  content,
  language,
  inheritedStyle,
  codeStyle,
  containerStyle,
  messageId,
  htmlBlockIndex,
}: Props) {
  const colors = useThemeColors();
  const dimensions = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);

  const code = trimTrailingFenceNewline(content);
  const languageLabel = getLanguageLabel(language);
  const htmlBlock = isHtmlLanguage(language);
  const lineCount = lineCountOf(code);
  const longCode = lineCount > LONG_CODE_LINE_COUNT || code.length > LONG_CODE_LENGTH;
  const previewHtml = useMemo(() => buildPreviewHtml(code), [code]);
  const modalFrameStyle = [
    styles.previewFrame,
    {
      width: Math.min(dimensions.width - 24, 980),
      height: Math.min(dimensions.height - 48, 760),
    },
  ];

  const handleRenderHtml = async () => {
    if (!messageId || htmlBlockIndex === undefined) {
      setPreviewVisible(true);
      return;
    }

    try {
      await openHtmlArtifact({
        messageId,
        htmlBlockIndex,
        html: code,
        title: `${languageLabel.toUpperCase()} 预览`,
      });
    } catch (err: any) {
      Alert.alert('打开 HTML 失败', err?.message || '无法打开 HTML 预览');
    }
  };

  return (
    <View style={[styles.container, containerStyle]}>
      <View style={styles.header}>
        <Text style={styles.language} numberOfLines={1}>
          {languageLabel}
        </Text>
        <View style={styles.headerActions}>
          {longCode && (
            <Pressable style={styles.headerButton} onPress={() => setExpanded((value) => !value)}>
              <Text style={styles.headerButtonText}>{expanded ? '收起' : '展开'}</Text>
            </Pressable>
          )}
          {htmlBlock && (
            <Pressable style={[styles.headerButton, styles.renderButton]} onPress={handleRenderHtml}>
              <Text style={[styles.headerButtonText, styles.renderButtonText]}>渲染</Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={styles.codeScroll}
        contentContainerStyle={styles.codeScrollContent}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <Text
          selectable
          numberOfLines={!expanded && longCode ? COLLAPSED_LINE_COUNT : undefined}
          style={[inheritedStyle, styles.codeText, codeStyle]}
        >
          {code}
        </Text>
      </ScrollView>

      {longCode && !expanded && (
        <View style={styles.fadeHint}>
          <Text style={styles.fadeHintText}>{lineCount} 行，已折叠</Text>
        </View>
      )}

      <Modal
        transparent
        visible={previewVisible}
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={styles.previewOverlay}>
          <View style={modalFrameStyle}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle} numberOfLines={1}>
                HTML 预览
              </Text>
              <Pressable style={styles.previewClose} onPress={() => setPreviewVisible(false)}>
                <Text style={styles.previewCloseText}>关闭</Text>
              </Pressable>
            </View>
            <WebView
              originWhitelist={['*']}
              source={{ html: previewHtml, baseUrl: 'https://ysclaude.local/' }}
              style={styles.webview}
              javaScriptEnabled
              domStorageEnabled={false}
              setSupportMultipleWindows={false}
              nestedScrollEnabled
              scalesPageToFit
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: colors.codeBlock,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: 10,
  },
  header: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  language: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.mono,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerButton: {
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  renderButton: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  headerButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  renderButtonText: {
    color: '#FFFFFF',
  },
  codeScroll: {
    alignSelf: 'stretch',
    maxWidth: '100%',
  },
  codeScrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  codeText: {
    color: colors.codeText,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fonts.mono,
  },
  fadeHint: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  fadeHintText: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  previewOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  previewFrame: {
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  previewTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  previewClose: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  previewCloseText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  webview: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});
