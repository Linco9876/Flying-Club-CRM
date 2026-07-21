import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';

export type DutyTimePickerProps = {
  value: Date;
  minimumDate?: Date;
  maximumDate?: Date;
  isDark: boolean;
  onChange: (selected?: Date) => void;
};

export const DutyTimePicker = ({ value, minimumDate, maximumDate, isDark, onChange }: DutyTimePickerProps) => (
  <DateTimePicker
    value={value}
    mode="time"
    display={Platform.OS === 'ios' ? 'spinner' : 'clock'}
    themeVariant={isDark ? 'dark' : 'light'}
    minimumDate={minimumDate}
    maximumDate={maximumDate}
    onChange={(_event, selected) => onChange(selected)}
  />
);
