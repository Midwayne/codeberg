export interface Palette {
  background: string;
  foreground: string;
  surface: string;
  popover?: string;
  raised: string;
  mutedForeground: string;
  primary: string;
  destructive: string;
  border: string;
  primaryForeground?: string;
  secondaryForeground?: string;
  destructiveForeground?: string;
  accent?: string;
  input?: string;
  ring?: string;
}

export interface Theme {
  id: string;
  label: string;
  description: string;
  colorScheme: 'dark' | 'light';
  palette: Palette;
}

export const THEMES = [
  {
    id: 'dark',
    label: 'Dark',
    description: 'Codex · soft charcoal',
    colorScheme: 'dark',
    palette: {
      background: '#212121',
      foreground: '#dcdcdc',
      surface: '#181818',
      popover: '#303030',
      raised: '#303030',
      mutedForeground: '#afafaf',
      primary: '#dcdcdc',
      primaryForeground: '#212121',
      destructive: 'oklch(0.704 0.191 22.216)',
      border: '#ffffff14',
      input: '#ffffff26',
      ring: '#8f8f8f',
    },
  },
  {
    id: 'light',
    label: 'Light',
    description: 'Codex · soft grey',
    colorScheme: 'light',
    palette: {
      background: '#f5f5f5',
      foreground: '#282828',
      surface: '#ededed',
      popover: '#ffffff',
      raised: '#e8e8e8',
      mutedForeground: '#5d5d5d',
      primary: '#303030',
      primaryForeground: '#f5f5f5',
      destructive: 'oklch(0.577 0.245 27.325)',
      secondaryForeground: '#282828',
      destructiveForeground: '#ffffff',
      border: '#0d0d0d14',
      input: '#0d0d0d26',
      ring: '#767676',
    },
  },
  {
    id: 'kanagawa',
    label: 'Kanagawa',
    description: 'Warm ink · Wave',
    colorScheme: 'dark',
    palette: {
      background: '#1f1f28',
      foreground: '#dcd7ba',
      surface: '#2a2a37',
      raised: '#363646',
      mutedForeground: '#c8c093',
      primary: '#7e9cd8',
      destructive: '#e46876',
      border: '#54546d',
      accent: '#223249',
    },
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    description: 'Deep blue · Night',
    colorScheme: 'dark',
    palette: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      surface: '#16161e',
      raised: '#292e42',
      mutedForeground: '#a9b1d6',
      primary: '#7aa2f7',
      destructive: '#f7768e',
      border: '#414868',
      accent: '#283457',
    },
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    description: 'Soft pastel tones',
    colorScheme: 'dark',
    palette: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      surface: '#181825',
      raised: '#313244',
      mutedForeground: '#a6adc8',
      primary: '#cba6f7',
      destructive: '#f38ba8',
      border: '#45475a',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    description: 'Purple and vivid',
    colorScheme: 'dark',
    palette: {
      background: '#282a36',
      foreground: '#f8f8f2',
      surface: '#21222c',
      raised: '#44475a',
      mutedForeground: 'color-mix(in srgb, #6272a4 70%, #f8f8f2)',
      primary: '#bd93f9',
      destructive: '#ff5555',
      border: '#6272a4',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    description: 'Cool arctic blues',
    colorScheme: 'dark',
    palette: {
      background: '#2e3440',
      foreground: '#eceff4',
      surface: '#3b4252',
      raised: '#434c5e',
      mutedForeground: '#d8dee9',
      primary: '#88c0d0',
      destructive: '#bf616a',
      border: '#4c566a',
    },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    description: 'Warm retro colors',
    colorScheme: 'dark',
    palette: {
      background: '#282828',
      foreground: '#ebdbb2',
      surface: '#32302f',
      raised: '#3c3836',
      mutedForeground: '#bdae93',
      primary: '#fabd2f',
      destructive: '#fb4934',
      border: '#665c54',
    },
  },
] as const satisfies readonly Theme[];

export type ThemeId = (typeof THEMES)[number]['id'];
