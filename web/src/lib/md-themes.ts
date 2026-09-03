export interface MdTheme {
  id: string;
  name: string;
  description: string;
  /** 设置面板里的背景色预览色块 */
  swatch: string;
}

export const MD_THEMES: MdTheme[] = [
  {
    id: 'prose',
    name: 'Tailwind Typography',
    description: '简洁中性，标题无下划线',
    swatch: '#ffffff',
  },
  {
    id: 'claude',
    name: 'Claude-like',
    description: '暖纸色底 + 陶土色点缀',
    swatch: '#f7f4ee',
  },
  {
    id: 'clear-ink',
    name: 'Clear Ink Bilingual',
    description: '墨色文字，链接带下划线',
    swatch: '#fdfdfb',
  },
  {
    id: 'esther',
    name: 'Esther Inspired',
    description: '暖纸底 + 蓝色标题 + 引用卡片',
    swatch: '#fbf6ee',
  },
];

export const DEFAULT_MD_THEME = 'prose';
