import { useMemo } from 'react';
import { View } from 'react-native';
import { useAppTheme } from '../theme';
import type { DutyTimePickerProps } from './DutyTimePicker';

const timeValue = (value: Date) => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;

export const DutyTimePicker = ({ value, minimumDate, maximumDate, onChange }: DutyTimePickerProps) => {
  const { colours } = useAppTheme();
  const inputStyle = useMemo(() => ({
    width: '100%', boxSizing: 'border-box' as const, border: `1px solid ${colours.inputBorder}`,
    borderRadius: 13, padding: '13px 14px', fontSize: 18, fontWeight: 700,
    color: colours.ink, backgroundColor: colours.input, colorScheme: colours.background === '#0D151C' ? 'dark' : 'light',
  }), [colours]);

  return (
    <View>
      <input
        aria-label="Duty time"
        type="time"
        value={timeValue(value)}
        min={minimumDate ? timeValue(minimumDate) : undefined}
        max={maximumDate ? timeValue(maximumDate) : undefined}
        style={inputStyle}
        onChange={event => {
          const [hours, minutes] = event.currentTarget.value.split(':').map(Number);
          if (hours === undefined || minutes === undefined || !Number.isFinite(hours) || !Number.isFinite(minutes)) return;
          const selected = new Date(value);
          selected.setHours(hours, minutes, 0, 0);
          onChange(selected);
        }}
      />
    </View>
  );
};
