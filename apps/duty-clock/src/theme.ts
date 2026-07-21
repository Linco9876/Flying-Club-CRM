import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { appStorage } from './storage';

export type ThemeMode = 'light' | 'auto' | 'dark';

const lightColours = {
  navy: '#0F2942', blue: '#1769AA', blueLight: '#EAF4FB', sky: '#72C7E7',
  green: '#16865C', greenLight: '#E8F7F0', amber: '#B86A08', amberLight: '#FFF5E5',
  red: '#C43D3D', redLight: '#FDECEC', ink: '#17202A', muted: '#65717E',
  border: '#DCE3E9', surface: '#FFFFFF', background: '#F4F7F9', input: '#FFFFFF',
  placeholder: '#98A3AD', subtle: '#E8EDF1', subtleText: '#52606B',
  greenBorder: '#ACDEC9', amberBorder: '#E9C588', inputBorder: '#C7D0D8',
};

const darkColours: typeof lightColours = {
  navy: '#DDEFFF', blue: '#62B7F3', blueLight: '#152B3D', sky: '#78D4F2',
  green: '#48C995', greenLight: '#102F27', amber: '#F2B45F', amberLight: '#352714',
  red: '#FF8585', redLight: '#381C22', ink: '#EEF5FA', muted: '#A8B7C3',
  border: '#334552', surface: '#17232D', background: '#0D151C', input: '#111D26',
  placeholder: '#738491', subtle: '#23323D', subtleText: '#C1CED7',
  greenBorder: '#286B55', amberBorder: '#75542B', inputBorder: '#415461',
};

export type AppColours = typeof lightColours;
export const colours = lightColours;

type ThemeContextValue = {
  colours: AppColours;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
};

const STORAGE_KEY = 'bfc-duty-clock-theme';
const ThemeContext = createContext<ThemeContextValue>({ colours: lightColours, mode: 'auto', setMode: () => undefined, isDark: false });

export const AppThemeProvider = ({ children }: { children: ReactNode }) => {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('auto');

  useEffect(() => {
    const saved = appStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'auto' || saved === 'dark') setModeState(saved);
  }, []);

  const setMode = (nextMode: ThemeMode) => {
    setModeState(nextMode);
    appStorage.setItem(STORAGE_KEY, nextMode);
  };
  const isDark = mode === 'dark' || (mode === 'auto' && systemScheme === 'dark');
  const value = useMemo(() => ({ colours: isDark ? darkColours : lightColours, mode, setMode, isDark }), [isDark, mode]);

  return createElement(ThemeContext.Provider, { value }, children);
};

export const useAppTheme = () => useContext(ThemeContext);
