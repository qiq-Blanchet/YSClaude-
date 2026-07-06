import { useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { copyAsync } from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';
import { useSettingsPageColors } from '../../theme/colors';
import { useSettingsStore } from '../../stores/settings';
import { createSettingsStyles } from './styles';

type WelcomePageTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

const CUSTOM_TOP_BAR_ICON_MAX_BYTES = 2 * 1024 * 1024;
const CUSTOM_TOP_BAR_ICON_MIN_SIDE = 48;
const CUSTOM_TOP_BAR_ICON_MAX_SIDE = 2048;

function appearanceImageExtension(asset: ImagePicker.ImagePickerAsset): string {
  const mimeType = asset.mimeType?.toLowerCase();
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg';

  const cleanUri = asset.uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.png')) return '.png';
  if (cleanUri.endsWith('.webp')) return '.webp';
  if (cleanUri.endsWith('.gif')) return '.gif';
  if (cleanUri.endsWith('.jpeg')) return '.jpg';
  if (cleanUri.endsWith('.jpg')) return '.jpg';
  return '.png';
}

async function copyWelcomeLogo(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const dir = new Directory(Paths.document, 'welcome-logos');
  dir.create({ intermediates: true, idempotent: true });

  const destination = new File(dir, `welcome-logo-${randomUUID()}${appearanceImageExtension(asset)}`);
  await copyAsync({ from: asset.uri, to: destination.uri });
  return destination.uri;
}

function validateWelcomeLogoAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  if (asset.fileSize && asset.fileSize > CUSTOM_TOP_BAR_ICON_MAX_BYTES) {
    return '图片不能超过 2MB';
  }
  if (
    asset.width < CUSTOM_TOP_BAR_ICON_MIN_SIDE ||
    asset.height < CUSTOM_TOP_BAR_ICON_MIN_SIDE
  ) {
    return `图片边长至少 ${CUSTOM_TOP_BAR_ICON_MIN_SIDE}px`;
  }
  if (
    asset.width > CUSTOM_TOP_BAR_ICON_MAX_SIDE ||
    asset.height > CUSTOM_TOP_BAR_ICON_MAX_SIDE
  ) {
    return `图片边长不能超过 ${CUSTOM_TOP_BAR_ICON_MAX_SIDE}px`;
  }
  return null;
}

export function WelcomePageTab({ showToast, keyboardBottomInset }: WelcomePageTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const { appearanceConfig, setAppearanceConfig } = useSettingsStore();
  const [pickingWelcomeLogo, setPickingWelcomeLogo] = useState(false);
  const customGreetings = appearanceConfig?.customGreetings || '';
  const welcomeLogoImageUri = appearanceConfig?.welcomeLogoImageUri;
  const useDefaultGreetings = !!appearanceConfig?.useDefaultGreetings;
  const defaultGreetingName = appearanceConfig?.defaultGreetingName || '';

  function handleDefaultGreetingToggle(value: boolean) {
    if (value && !defaultGreetingName.trim()) {
      Alert.alert('需要填写名字', '请先填写你的名字，用于替换内置欢迎语里的 user。');
      return;
    }
    setAppearanceConfig({ useDefaultGreetings: value });
    showToast(value ? '系统默认欢迎语已开启' : '系统默认欢迎语已关闭');
  }

  async function handlePickWelcomeLogo() {
    if (pickingWelcomeLogo) return;
    setPickingWelcomeLogo(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]?.uri) return;

      const asset = result.assets[0];
      const validationError = validateWelcomeLogoAsset(asset);
      if (validationError) {
        Alert.alert('图片不适合作为欢迎页 Logo', validationError);
        return;
      }

      const uri = await copyWelcomeLogo(asset);
      setAppearanceConfig({ welcomeLogoImageUri: uri });
      showToast('欢迎页 Logo 已更新');
    } catch (error: any) {
      Alert.alert('选择欢迎页 Logo 失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingWelcomeLogo(false);
    }
  }

  function handleClearWelcomeLogo() {
    setAppearanceConfig({ welcomeLogoImageUri: undefined });
    showToast('已恢复默认欢迎页 Logo');
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionTitle}>中心 Logo</Text>
      <View style={styles.appearanceAssetRow}>
        <View style={styles.welcomeLogoPreview}>
          <Image
            source={welcomeLogoImageUri ? { uri: welcomeLogoImageUri } : require('../../../assets/claudelogo.png')}
            style={styles.welcomeLogoImage}
            resizeMode="contain"
          />
        </View>
        <View style={styles.appearanceIconText}>
          <Text style={styles.label}>欢迎页中心 Logo</Text>
          <Text style={styles.hint}>显示在聊天页空状态欢迎语上方，建议使用正方形透明 PNG。</Text>
        </View>
        <View style={styles.appearanceIconActions}>
          <Pressable
            style={[styles.smallActionButton, pickingWelcomeLogo && styles.smallActionButtonDisabled]}
            onPress={handlePickWelcomeLogo}
            disabled={pickingWelcomeLogo}
          >
            <Text style={[styles.smallActionText, pickingWelcomeLogo && styles.smallActionTextDisabled]}>
              {pickingWelcomeLogo ? '选择中' : '上传'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.smallActionButton, !welcomeLogoImageUri && styles.smallActionButtonDisabled]}
            onPress={handleClearWelcomeLogo}
            disabled={!welcomeLogoImageUri}
          >
            <Text style={[styles.smallActionText, !welcomeLogoImageUri && styles.smallActionTextDisabled]}>默认</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>系统默认欢迎语</Text>
          <Text style={styles.hint}>开启后，内置欢迎语会和用户自定义欢迎语一起随机抽取。</Text>
        </View>
        <Switch
          value={useDefaultGreetings}
          onValueChange={handleDefaultGreetingToggle}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>你的名字</Text>
        <TextInput
          style={styles.input}
          value={defaultGreetingName}
          onChangeText={(value) => setAppearanceConfig({ defaultGreetingName: value })}
          placeholder="user"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
        />
        <Text style={styles.hint}>用于替换内置欢迎语里的 user，例如 Welcome,user。</Text>
      </View>

      <Text style={styles.sectionTitle}>欢迎语池</Text>
      <Text style={styles.hint}>每行一条，聊天页空状态刷新时会随机抽取一条。留空时显示 What shall we think through?</Text>
      <TextInput
        style={[styles.input, styles.multilineInput, styles.greetingInput]}
        value={customGreetings}
        onChangeText={(value) => setAppearanceConfig({ customGreetings: value })}
        multiline
        placeholder={'What shall we think through?\n今天想拆哪件事？'}
        placeholderTextColor={colors.textTertiary}
        textAlignVertical="top"
      />
    </ScrollView>
  );
}
