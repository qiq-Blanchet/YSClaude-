import { useColorScheme, type ColorSchemeName } from 'react-native';

export const lightColors = {
  background: '#faf9f5',
  surface: '#F0EBE4',
  surfaceHover: '#f1eee7',
  border: '#E5E0D8',
  text: '#141413',
  textSecondary: '#6B6B6B',
  textTertiary: '#9B9B9B',
  primary: '#D97706',
  primaryLight: '#FEF3C7',
  userBubble: '#f1eee7',
  assistantBubble: 'transparent',
  codeBlock: '#ffffff',
  codeText: '#73726e',
  inputBackground: '#FFFFFF',
  inputBorder: '#f8f8f6',
  danger: '#DC2626',
  dangerSurface: '#FEF2F2',
  success: '#16A34A',
  iconGray: '#8B8B8B',
  disclaimer: '#787773',
};

export const darkColors = {
  background: '#12100D',
  surface: '#211C17',
  surfaceHover: '#2B241D',
  border: '#3A3027',
  text: '#F7F2EA',
  textSecondary: '#C9BFB2',
  textTertiary: '#8F8478',
  primary: '#D97706',
  primaryLight: '#3A2511',
  userBubble: '#2B241D',
  assistantBubble: 'transparent',
  codeBlock: '#1B1713',
  codeText: '#D8CEC0',
  inputBackground: '#1A1612',
  inputBorder: '#332A22',
  danger: '#F87171',
  dangerSurface: '#351818',
  success: '#4ADE80',
  iconGray: '#A69A8E',
  disclaimer: '#9B9084',
};

export type ThemeColors = typeof lightColors;

export function createSettingsPageColors(base: ThemeColors): ThemeColors {
  return {
    ...base,
    surface: '#FFFCF7',
    surfaceHover: '#F7F1EA',
    border: '#E9E1D8',
    text: '#25221F',
    textSecondary: '#77706A',
    textTertiary: '#A59C94',
    primary: '#C2553F',
    primaryLight: '#F5E1DB',
    userBubble: '#FFFCF7',
    assistantBubble: 'transparent',
    codeBlock: '#F7F1EA',
    codeText: '#6F6760',
    inputBackground: '#F8F3ED',
    inputBorder: '#E7DED4',
    danger: '#C2412D',
    dangerSurface: '#FBEAE6',
    success: '#2F8F5B',
    iconGray: '#8F8780',
    disclaimer: '#8A8179',
  };
}

export const settingsPageColors: ThemeColors = createSettingsPageColors(lightColors);

export function getThemeColors(colorScheme: ColorSchemeName | null | undefined): ThemeColors {
  return colorScheme === 'dark' ? darkColors : lightColors;
}

export function useThemeColors(): ThemeColors {
  return getThemeColors(useColorScheme());
}

export function useSettingsPageColors(): ThemeColors {
  return createSettingsPageColors(useThemeColors());
}

export const colors = lightColors;
