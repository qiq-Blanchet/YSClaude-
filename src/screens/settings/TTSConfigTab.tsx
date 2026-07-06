import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSettingsPageColors } from '../../theme/colors';
import { type TTSConfig, useSettingsStore } from '../../stores/settings';
import { playTTS } from '../../services/tts';
import { createSettingsStyles } from './styles';

type TTSConfigTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

const TTS_MODELS = ['speech-02-hd', 'speech-02-turbo', 'speech-2.8-hd'];

export function TTSConfigTab({ showToast, keyboardBottomInset }: TTSConfigTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const { ttsConfig, setTTSConfig } = useSettingsStore();
  const [groupId, setGroupId] = useState(ttsConfig.groupId);
  const [apiKey, setApiKey] = useState(ttsConfig.apiKey);
  const [model, setModel] = useState(ttsConfig.model);
  const [voiceId, setVoiceId] = useState(ttsConfig.voiceId);
  const [speed, setSpeed] = useState(String(ttsConfig.speed));
  const [vol, setVol] = useState(String(ttsConfig.vol));
  const [pitch, setPitch] = useState(String(ttsConfig.pitch));
  const [testing, setTesting] = useState(false);

  function handleSave() {
    if (!groupId.trim() || !apiKey.trim()) {
      Alert.alert('提示', '请填写 Group ID 和 API Key');
      return;
    }
    if (!voiceId.trim()) {
      Alert.alert('提示', '请填写 Voice ID');
      return;
    }
    const s = parseFloat(speed) || 1;
    const v = parseFloat(vol) || 1;
    const p = parseFloat(pitch) || 0;
    setTTSConfig({ groupId: groupId.trim(), apiKey: apiKey.trim(), model, voiceId: voiceId.trim(), speed: s, vol: v, pitch: p });
    showToast('TTS 配置已保存');
  }

  async function handleTest() {
    if (!groupId.trim() || !apiKey.trim() || !voiceId.trim()) {
      Alert.alert('提示', '请先填写 Group ID、API Key 和 Voice ID');
      return;
    }
    setTesting(true);
    try {
      const testConfig: TTSConfig = {
        groupId: groupId.trim(),
        apiKey: apiKey.trim(),
        model,
        voiceId: voiceId.trim(),
        speed: parseFloat(speed) || 1,
        vol: parseFloat(vol) || 1,
        pitch: parseFloat(pitch) || 0,
      };
      await playTTS('你好，这是一段语音合成测试。', testConfig);
      showToast('TTS 配置有效');
    } catch (e: any) {
      Alert.alert('播放失败', e.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionTitle}>MiniMax TTS</Text>
      <Text style={styles.hint}>使用 MiniMax 语音合成服务，需要 Group ID 和 API Key</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Group ID</Text>
        <TextInput style={styles.input} value={groupId} onChangeText={setGroupId}
          placeholder="MiniMax Group ID" placeholderTextColor={colors.textTertiary}
          autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>API Key</Text>
        <TextInput style={styles.input} value={apiKey} onChangeText={setApiKey}
          placeholder="MiniMax API Key" placeholderTextColor={colors.textTertiary}
          secureTextEntry autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Voice ID</Text>
        <TextInput style={styles.input} value={voiceId} onChangeText={setVoiceId}
          placeholder="例如：male-qn-qingse" placeholderTextColor={colors.textTertiary}
          autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>模型</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.configList}>
          {TTS_MODELS.map((m) => (
            <Pressable key={m}
              style={[styles.configChip, m === model && styles.configChipActive]}
              onPress={() => setModel(m)}
            >
              <Text style={[styles.configChipText, m === model && styles.configChipTextActive]}>{m}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>语速（0.5 ~ 2.0）</Text>
        <TextInput style={styles.input} value={speed} onChangeText={setSpeed}
          keyboardType="decimal-pad" placeholder="1" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>音量（0.1 ~ 10）</Text>
        <TextInput style={styles.input} value={vol} onChangeText={setVol}
          keyboardType="decimal-pad" placeholder="1" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>音调（-12 ~ 12）</Text>
        <TextInput style={styles.input} value={pitch} onChangeText={setPitch}
          keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleTest} disabled={testing}>
          {testing ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试播放</Text>}
        </Pressable>
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
