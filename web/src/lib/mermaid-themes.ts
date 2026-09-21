// Mermaid 图表主题：与正文 Markdown 主题（md-themes.ts）是两套独立体系，互不影响。
// 在「设置」里切换，持久化到 localStorage（键 MERMAID_THEME_KEY）。

export const MERMAID_THEME_KEY = 'md-mermaid-theme';

/** 特殊值：跟随应用明暗模式（亮色 default / 暗色 dark） */
export const AUTO_MERMAID_THEME = 'auto';

/** mermaid v11 内置主题 */
export const MERMAID_THEME_IDS = ['default', 'base', 'dark', 'forest', 'neutral', 'null'] as const;
export type MermaidThemeId = (typeof MERMAID_THEME_IDS)[number];
export type MermaidThemeSetting = MermaidThemeId | typeof AUTO_MERMAID_THEME;

export interface MermaidThemeOption {
  id: MermaidThemeSetting;
  name: string;
  description: string;
}

export const MERMAID_THEMES: MermaidThemeOption[] = [
  { id: 'auto', name: '跟随明暗（默认）', description: '亮色 default / 暗色 dark' },
  { id: 'default', name: 'Default', description: '彩色经典款（紫/蓝/橙/灰）' },
  { id: 'neutral', name: 'Neutral', description: '中性灰阶，去彩色' },
  { id: 'forest', name: 'Forest', description: '森林绿/青色调' },
  { id: 'dark', name: 'Dark', description: '深色底 + 浅色文字' },
  { id: 'base', name: 'Base', description: '极简黑白，几乎不上色' },
  { id: 'null', name: 'Null', description: '无主题，裸结构线' },
];

export function isMermaidThemeId(v: string | null | undefined): v is MermaidThemeId {
  return !!v && (MERMAID_THEME_IDS as readonly string[]).includes(v);
}

/** 读取持久化的 mermaid 主题设置（无效值回退到「跟随明暗」）。 */
export function getStoredMermaidTheme(): MermaidThemeSetting {
  if (typeof localStorage === 'undefined') return AUTO_MERMAID_THEME;
  try {
    const v = localStorage.getItem(MERMAID_THEME_KEY);
    return isMermaidThemeId(v) ? v : AUTO_MERMAID_THEME;
  } catch {
    return AUTO_MERMAID_THEME;
  }
}
