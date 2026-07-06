import { Pressable, Switch, Text, TextInput, View } from 'react-native';

export type BuiltInToolCard = {
  key: string;
  name: string;
  intro: string;
  enabled: boolean;
  onValueChange: (value: boolean) => void;
  meta: string;
};

type BuiltInToolsSectionProps = {
  styles: any;
  colors: any;
  expanded: boolean;
  tools: BuiltInToolCard[];
  onToggleExpanded: () => void;
  onSelectTool: (key: string) => void;
};

type McpToolsSectionProps = {
  styles: any;
  colors: any;
  expanded: boolean;
  mcpMaxCalls: string;
  mcpServerName: string;
  mcpServerUrl: string;
  mcpServerAuth: string;
  mcpServers: any[];
  onToggleExpanded: () => void;
  onChangeMaxCalls: (value: string) => void;
  onChangeServerName: (value: string) => void;
  onChangeServerUrl: (value: string) => void;
  onChangeServerAuth: (value: string) => void;
  onAddServer: () => void;
  onSelectServer: (id: string) => void;
  onUpdateServer: (id: string, patch: any) => void;
  onSave: () => void;
  getEnabledToolCount: (server: any) => number;
  getEnabledResourceCount: (server: any) => number;
};

export function BuiltInToolsSection({
  styles,
  colors,
  expanded,
  tools,
  onToggleExpanded,
  onSelectTool,
}: BuiltInToolsSectionProps) {
  return (
    <>
      <Pressable style={styles.toolGroupHeader} onPress={onToggleExpanded}>
        <View style={styles.switchText}>
          <Text style={styles.toolGroupTitle}>内置工具</Text>
          <Text style={styles.hint}>点击卡片查看和编辑详情；开关会先更新本页状态，保存后才写入配置。</Text>
        </View>
        <Text style={styles.platformToggleIcon}>{expanded ? '↑' : '↓'}</Text>
      </Pressable>
      {expanded && (
        <View style={styles.toolCardGrid}>
          {tools.map((tool) => (
            <Pressable
              key={tool.key}
              style={[styles.toolCard, tool.enabled && styles.toolCardEnabled]}
              onPress={() => onSelectTool(tool.key)}
            >
              <View style={styles.toolCardTop}>
                <View style={styles.toolCardText}>
                  <Text style={styles.toolCardName} numberOfLines={1}>{tool.name}</Text>
                  <Text style={styles.toolCardMeta}>{tool.meta}</Text>
                </View>
                <Switch
                  value={tool.enabled}
                  onValueChange={tool.onValueChange}
                  trackColor={{ false: colors.inputBorder, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <Text style={styles.toolCardIntro} numberOfLines={3}>{tool.intro}</Text>
              <Text style={[styles.toolCardStatus, tool.enabled && styles.toolCardStatusEnabled]}>
                {tool.enabled ? '已开启' : '已关闭'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}

export function McpToolsSection({
  styles,
  colors,
  expanded,
  mcpMaxCalls,
  mcpServerName,
  mcpServerUrl,
  mcpServerAuth,
  mcpServers,
  onToggleExpanded,
  onChangeMaxCalls,
  onChangeServerName,
  onChangeServerUrl,
  onChangeServerAuth,
  onAddServer,
  onSelectServer,
  onUpdateServer,
  onSave,
  getEnabledToolCount,
  getEnabledResourceCount,
}: McpToolsSectionProps) {
  return (
    <>
      <Pressable style={styles.toolGroupHeader} onPress={onToggleExpanded}>
        <View style={styles.switchText}>
          <Text style={styles.toolGroupTitle}>自定义 MCP</Text>
          <Text style={styles.hint}>每个远程 MCP 服务都单独用卡片展示，点开后可以同步、编辑或删除。</Text>
        </View>
        <Text style={styles.platformToggleIcon}>{expanded ? '↑' : '↓'}</Text>
      </Pressable>
      {expanded && (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>每轮最大调用次数</Text>
            <TextInput
              style={styles.input}
              value={mcpMaxCalls}
              onChangeText={onChangeMaxCalls}
              keyboardType="number-pad"
              placeholder="6"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
          <View style={styles.toolAddPanel}>
            <Text style={styles.sectionTitle}>添加 MCP 服务</Text>
            <TextInput style={styles.input} value={mcpServerName} onChangeText={onChangeServerName} placeholder="服务名称" placeholderTextColor={colors.textTertiary} />
            <TextInput style={styles.input} value={mcpServerUrl} onChangeText={onChangeServerUrl} placeholder="https://example.com/mcp" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
            <TextInput style={styles.input} value={mcpServerAuth} onChangeText={onChangeServerAuth} placeholder="授权信息，可选" placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" />
            <Pressable style={styles.addPathButton} onPress={onAddServer}>
              <Text style={styles.addPathButtonText}>添加服务</Text>
            </Pressable>
          </View>
          {mcpServers.length === 0 ? (
            <Text style={styles.emptyText}>尚未添加 MCP 服务</Text>
          ) : (
            <View style={styles.toolCardGrid}>
              {mcpServers.map((server) => (
                <Pressable
                  key={server.id}
                  style={[styles.toolCard, server.enabled && styles.toolCardEnabled]}
                  onPress={() => onSelectServer(server.id)}
                >
                  <View style={styles.toolCardTop}>
                    <View style={styles.toolCardText}>
                      <Text style={styles.toolCardName} numberOfLines={1}>{server.name}</Text>
                      <Text style={styles.toolCardMeta}>
                        工具 {getEnabledToolCount(server)}/{server.tools.length} · 资源 {getEnabledResourceCount(server)}/{(server.resources || []).length} · 提示词 {(server.prompts || []).length}
                      </Text>
                    </View>
                    <Switch
                      value={server.enabled}
                      onValueChange={(value) => onUpdateServer(server.id, { enabled: value })}
                      trackColor={{ false: colors.inputBorder, true: colors.primary }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                  <Text style={styles.toolCardIntro} numberOfLines={2}>{server.url}</Text>
                  <Text style={[styles.toolCardStatus, server.enabled && styles.toolCardStatusEnabled]}>
                    {server.enabled ? '已开启' : '已关闭'}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={styles.actions}>
            <Pressable style={styles.saveButton} onPress={onSave}>
              <Text style={styles.saveButtonText}>保存 MCP 能力</Text>
            </Pressable>
          </View>
        </>
      )}
    </>
  );
}
