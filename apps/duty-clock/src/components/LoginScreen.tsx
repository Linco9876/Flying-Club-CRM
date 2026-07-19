import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { colours } from '../theme';
import { PrimaryButton } from './PrimaryButton';

export const LoginScreen = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Enter your login', 'Use the same email and password as the club portal.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) Alert.alert('Could not sign in', error.message);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.brandMark}><Text style={styles.plane}>✈</Text></View>
        <Text style={styles.eyebrow}>BENDIGO FLYING CLUB</Text>
        <Text style={styles.title}>Duty Clock</Text>
        <Text style={styles.subtitle}>A quick clock-in for instructors.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#98A3AD"
            style={styles.input}
          />
          <Text style={[styles.label, styles.passwordLabel]}>Password</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="current-password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            placeholderTextColor="#98A3AD"
            style={styles.input}
            onSubmitEditing={() => void login()}
          />
          <View style={styles.buttonGap}>
            <PrimaryButton loading={loading} onPress={() => void login()}>Sign in</PrimaryButton>
          </View>
        </View>
        <Text style={styles.help}>Use the same account as the Flight Management System.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.background },
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  brandMark: { width: 64, height: 64, borderRadius: 20, backgroundColor: colours.navy, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  plane: { color: '#fff', fontSize: 30 },
  eyebrow: { color: colours.blue, fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  title: { color: colours.navy, fontSize: 38, fontWeight: '900', marginTop: 5 },
  subtitle: { color: colours.muted, fontSize: 16, marginTop: 6, marginBottom: 28 },
  card: { backgroundColor: colours.surface, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: colours.border },
  label: { color: colours.ink, fontSize: 13, fontWeight: '800', marginBottom: 7 },
  passwordLabel: { marginTop: 16 },
  input: { height: 52, borderWidth: 1, borderColor: '#C7D0D8', borderRadius: 14, paddingHorizontal: 14, fontSize: 16, color: colours.ink, backgroundColor: '#fff' },
  buttonGap: { marginTop: 22 },
  help: { textAlign: 'center', color: colours.muted, fontSize: 12, marginTop: 18 },
});
