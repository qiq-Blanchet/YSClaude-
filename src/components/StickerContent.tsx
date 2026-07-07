import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ImageSourcePropType, StyleProp, TextStyle } from 'react-native';
import Markdown from '@ronradtke/react-native-markdown-display';
import { lightColors, useThemeColors, type ThemeColors } from '../theme/colors';

import { fonts } from '../theme/fonts';
import { useSettingsStore } from '../stores/settings';
import { useChatStore } from '../stores/chat';
import { readConversationArtifact } from '../services/conversationArtifacts';
import { openHtmlArtifact } from '../services/webviewController';
import type { ConversationArtifact, ConversationArtifactVersion, GeneratedPicture } from '../types';
import { buildStickerDefinitions, getStickerByName, type StickerDefinition } from '../utils/stickers';


let colors = lightColors;
const STICKER_RENDER_SIZE = 112;
interface Props {
  content: string;
  variant: 'user' | 'assistant';
  userTextStyle?: StyleProp<TextStyle>;
  markdownStyle?: any;
  markdownRules?: any;
  stickers?: StickerDefinition[];
  generatedPics?: GeneratedPicture[];
  onPicturePress?: (picture: GeneratedPicture) => void;
  onPictureLongPress?: (picture: GeneratedPicture) => void;
}

type ContentChunk =
  | { type: 'text'; text: string }
  | { type: 'sticker'; sticker: StickerDefinition }
  | { type: 'picture'; picture: GeneratedPicture; prompt: string }
  | { type: 'file'; artifactId: string };

const RICH_TOKEN_PATTERN = /\[(Sticker|Pic|File):([^\]\r\n]+)\]/g;

function StickerImage({
  source,
  name,
}: {
  source: ImageSourcePropType;
  name: string;
}) {
  return (
    <Image
      source={source}
      style={styles.sticker}
      resizeMode="contain"
      accessibilityLabel={`表情包：${name}`}
    />
  );
}

function hasMarkdownSyntax(text: string): boolean {
  return (
    /(^|\n)\s*(```|~~~)/.test(text) ||
    /(^|\n)\s{0,3}(?:[-*_][ \t]*){3,}(?=\r?\n|$)/.test(text) ||
    /(^|\n)\s{0,3}(#{1,6}\s|>\s|[-*+]\s|\d+\.\s)/.test(text) ||
    /\[[^\]\n]+\]\([^)]+\)/.test(text) ||
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/.test(text)
  );
}

function splitRichContent(
  content: string,
  stickers: StickerDefinition[],
  generatedPics: GeneratedPicture[] | undefined
): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  const pictureByIndex = new Map((generatedPics || []).map((picture) => [picture.tokenIndex, picture]));
  const pattern = new RegExp(RICH_TOKEN_PATTERN);
  let lastIndex = 0;
  let pictureIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      chunks.push({ type: 'text', text: content.slice(lastIndex, match.index) });
    }

    const rawToken = match[0];
    const kind = match[1];
    const value = match[2];

    if (kind === 'Sticker') {
      const sticker = getStickerByName(value, stickers);
      chunks.push(sticker ? { type: 'sticker', sticker } : { type: 'text', text: rawToken });
    } else if (kind === 'Pic') {
      const picture = pictureByIndex.get(pictureIndex);
      chunks.push(picture ? { type: 'picture', picture, prompt: value.trim() } : { type: 'text', text: rawToken });
      pictureIndex += 1;
    } else {
      const artifactId = value.trim();
      chunks.push(artifactId ? { type: 'file', artifactId } : { type: 'text', text: rawToken });
    }

    lastIndex = match.index + rawToken.length;
  }

  if (lastIndex < content.length) {
    chunks.push({ type: 'text', text: content.slice(lastIndex) });
  }

  return chunks.length > 0 ? chunks : [{ type: 'text', text: content }];
}

function formatArtifactKind(kind?: ConversationArtifact['kind']): string {
  switch (kind) {
    case 'markdown':
      return 'Markdown';
    case 'html':
      return 'HTML';
    case 'css':
      return 'CSS';
    case 'javascript':
      return 'JavaScript';
    case 'typescript':
      return 'TypeScript';
    case 'json':
      return 'JSON';
    case 'csv':
      return 'CSV';
    default:
      return 'Text';
  }
}

function formatFileSize(size?: number): string {
  if (!Number.isFinite(size)) return '';
  const value = size || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function ConversationFileCard({ artifactId }: { artifactId: string }) {
  const conversationId = useChatStore((state) => state.conversationId);
  const [artifact, setArtifact] = useState<ConversationArtifact | null>(null);
  const [version, setVersion] = useState<ConversationArtifactVersion | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadArtifact = useCallback(async () => {
    if (!conversationId) {
      throw new Error('当前没有可读取文件的对话窗口');
    }
    const result = await readConversationArtifact(conversationId, artifactId);
    setArtifact(result.artifact);
    setVersion(result.version);
    setError(null);
    return result;
  }, [artifactId, conversationId]);

  useEffect(() => {
    let alive = true;
    if (!conversationId) return;
    readConversationArtifact(conversationId, artifactId)
      .then((result) => {
        if (!alive) return;
        setArtifact(result.artifact);
        setVersion(result.version);
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.message || '文件读取失败');
      });
    return () => {
      alive = false;
    };
  }, [artifactId, conversationId]);

  const handlePress = useCallback(async (event?: any) => {
    event?.stopPropagation?.();
    setLoading(true);
    try {
      const result = version && artifact ? { artifact, version } : await loadArtifact();
      if (result.artifact.kind === 'html') {
        await openHtmlArtifact({
          artifactId: result.artifact.id,
          artifactName: result.artifact.name,
          html: result.version.content,
          title: result.artifact.name,
        });
      } else {
        setPreviewVisible(true);
      }
    } catch (err: any) {
      Alert.alert('打开失败', err?.message || '无法打开当前对话文件');
    } finally {
      setLoading(false);
    }
  }, [artifact, loadArtifact, version]);

  const title = artifact?.name || `文件 ${artifactId.slice(0, 8)}`;
  const meta = artifact
    ? `${formatArtifactKind(artifact.kind)}${artifact.size !== undefined ? ` · ${formatFileSize(artifact.size)}` : ''}`
    : error || '当前对话文件';

  return (
    <>
      <Pressable
        style={styles.fileCard}
        onPress={handlePress}
        accessibilityLabel={`对话文件：${title}`}
      >
        <View style={styles.fileIcon}>
          <Text style={styles.fileIconText}>{formatArtifactKind(artifact?.kind).slice(0, 2).toUpperCase()}</Text>
        </View>
        <View style={styles.fileTextBlock}>
          <Text style={styles.fileTitle} numberOfLines={1}>{title}</Text>
          <Text style={[styles.fileMeta, error && styles.fileMetaError]} numberOfLines={1}>{meta}</Text>
        </View>
        {loading && <ActivityIndicator size="small" color={colors.primary} />}
      </Pressable>
      <Modal
        transparent
        visible={previewVisible}
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <Pressable style={styles.filePreviewOverlay} onPress={() => setPreviewVisible(false)}>
          <View style={styles.filePreviewPanel} onStartShouldSetResponder={() => true}>
            <Text style={styles.filePreviewTitle} numberOfLines={2}>{title}</Text>
            <Text style={styles.filePreviewMeta}>{meta}</Text>
            <ScrollView style={styles.filePreviewScroll}>
              <Text selectable style={styles.filePreviewText}>{version?.content || ''}</Text>
            </ScrollView>
            <Pressable style={styles.filePreviewClose} onPress={() => setPreviewVisible(false)}>
              <Text style={styles.filePreviewCloseText}>关闭</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function GeneratedPictureCard({
  picture,
  prompt,
  onPress,
  onLongPress,
}: {
  picture: GeneratedPicture;
  prompt: string;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const isDone = picture.status === 'done' && !!picture.imageUri;
  const label =
    picture.status === 'pending'
      ? picture.progressLabel || '生成中'
      : picture.status === 'deleted'
        ? '图片已删除'
        : picture.status === 'failed'
          ? picture.errorMessage || picture.progressLabel || '生成失败'
          : picture.progressLabel || '完成';

  return (
    <Pressable
      style={styles.pictureShell}
      onPress={isDone ? onPress : undefined}
      onLongPress={onLongPress}
      accessibilityLabel={`AI 生成图片：${picture.prompt || prompt}`}
    >
      {isDone ? (
        <View style={styles.generatedPictureWrap}>
          <Image source={{ uri: picture.imageUri! }} style={styles.generatedPicture} resizeMode="cover" />
          {!!label && (
            <View style={styles.pictureDoneBadge}>
              <Text style={styles.pictureDoneBadgeText}>{label}</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.pictureFallback}>
          {picture.status === 'pending' && <ActivityIndicator size="small" color={colors.primary} />}
          <Text style={styles.pictureFallbackText} numberOfLines={5}>
            {picture.prompt || prompt}
          </Text>
          {!!label && <Text style={styles.pictureStatusText} numberOfLines={3}>{label}</Text>}
        </View>
      )}
    </Pressable>
  );
}

export function StickerContent({
  content,
  variant,
  userTextStyle,
  markdownStyle,
  markdownRules,
  stickers,
  generatedPics,
  onPicturePress,
  onPictureLongPress,
}: Props) {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);

  const isUser = variant === 'user';
  const stickerConfig = useSettingsStore((state) => state.stickerConfig);
  const fallbackStickers = useMemo(
    () => buildStickerDefinitions(isUser ? stickerConfig?.userStickers : stickerConfig?.assistantStickers),
    [isUser, stickerConfig?.assistantStickers, stickerConfig?.userStickers]
  );
  const chunks = splitRichContent(content, stickers || fallbackStickers, generatedPics);
  const containsMarkdown = chunks.some((chunk) => chunk.type === 'text' && hasMarkdownSyntax(chunk.text));

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer, containsMarkdown && styles.markdownContainer]}>
      {chunks.map((chunk, index) => {
        if (chunk.type === 'sticker') {
          return (
            <StickerImage
              key={`sticker-${index}-${chunk.sticker.name}`}
              source={chunk.sticker.image}
              name={chunk.sticker.name}
            />
          );
        }

        if (chunk.type === 'picture') {
          return (
            <GeneratedPictureCard
              key={`picture-${index}-${chunk.picture.tokenIndex}`}
              picture={chunk.picture}
              prompt={chunk.prompt}
              onPress={() => onPicturePress?.(chunk.picture)}
              onLongPress={() => onPictureLongPress?.(chunk.picture)}
            />
          );
        }

        if (chunk.type === 'file') {
          return (
            <ConversationFileCard
              key={`file-${index}-${chunk.artifactId}`}
              artifactId={chunk.artifactId}
            />
          );
        }

        if (chunk.text.length === 0) return null;

        if (isUser) {
          if (markdownStyle && hasMarkdownSyntax(chunk.text)) {
            return (
              <View key={`text-${index}`} style={styles.userMarkdownFrame}>
                <Markdown style={markdownStyle} rules={markdownRules}>
                  {chunk.text}
                </Markdown>
              </View>
            );
          }

          return (
            <Text key={`text-${index}`} style={[styles.userText, userTextStyle]}>
              {chunk.text}
            </Text>
          );
        }

        return (
          <View key={`text-${index}`} style={styles.assistantMarkdownFrame}>
            <Markdown style={markdownStyle} rules={markdownRules}>
              {chunk.text}
            </Markdown>
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    gap: 6,
    maxWidth: '100%',
    minWidth: 0,
  },
  markdownContainer: {
    width: '100%',
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignItems: 'flex-start',
    width: '100%',
    maxWidth: '100%',
  },
  userMarkdownFrame: {
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    flexShrink: 1,
  },
  assistantMarkdownFrame: {
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    flexShrink: 1,
  },
  userText: {
    maxWidth: '100%',
    fontSize: 16,
    color: colors.text,
    lineHeight: 22,
    fontFamily: fonts.serifBold,
  },
  sticker: {
    width: STICKER_RENDER_SIZE,
    height: STICKER_RENDER_SIZE,
  },
  pictureShell: {
    width: 240,
    maxWidth: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
  },
  generatedPictureWrap: {
    width: '100%',
    height: '100%',
  },
  generatedPicture: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surface,
  },
  pictureDoneBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: '86%',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  pictureDoneBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  pictureFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    padding: 18,
    backgroundColor: '#FFFFFF',
  },
  pictureFallbackText: {
    fontSize: 15,
    lineHeight: 21,
    color: '#111827',
    textAlign: 'center',
    fontFamily: fonts.serifBold,
  },
  pictureStatusText: {
    fontSize: 12,
    lineHeight: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  fileCard: {
    width: 260,
    maxWidth: '100%',
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.inputBorder,
  },
  fileIconText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  fileTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  fileTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  fileMeta: {
    marginTop: 4,
    color: colors.textTertiary,
    fontSize: 12,
  },
  fileMetaError: {
    color: colors.danger,
  },
  filePreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  filePreviewPanel: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '84%',
    borderRadius: 12,
    padding: 16,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filePreviewTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  filePreviewMeta: {
    marginTop: 4,
    marginBottom: 10,
    color: colors.textTertiary,
    fontSize: 12,
  },
  filePreviewScroll: {
    maxHeight: 460,
    borderRadius: 8,
    backgroundColor: colors.codeBlock,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filePreviewText: {
    padding: 12,
    color: colors.codeText,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.mono,
  },
  filePreviewClose: {
    alignSelf: 'flex-end',
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  filePreviewCloseText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});

let styles = createStyles(colors);
