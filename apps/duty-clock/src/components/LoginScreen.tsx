import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { type AppColours, useAppTheme } from '../theme';
import { ACCOUNT_DELETION_URL, PRIVACY_URL, SUPPORT_URL } from '../config';
import { PrimaryButton } from './PrimaryButton';
import { AppearanceSelector } from './AppearanceSelector';

export const LoginScreen = () => {
  const { colours } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);
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
            placeholderTextColor={colours.placeholder}
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
            placeholderTextColor={colours.placeholder}
            style={styles.input}
            onSubmitEditing={() => void login()}
          />
          <View style={styles.buttonGap}>
            <PrimaryButton loading={loading} onPress={() => void login()}>Sign in</PrimaryButton>
          </View>
        </View>
        <Text style={styles.help}>Use the same account as the Flight Management System.</Text>
        <View style={styles.appearance}><AppearanceSelector /></View>
        <View style={styles.links}>
          <Pressable onPress={() => void Linking.openURL(PRIVACY_URL)}><Text style={styles.link}>Privacy</Text></Pressable>
          <Text style={styles.linkDot}>·</Text>
          <Pressable onPress={() => void Linking.openURL(SUPPORT_URL)}><Text style={styles.link}>Support</Text></Pressable>
          <Text style={styles.linkDot}>·</Text>
          <Pressable onPress={() => void Linking.openURL(ACCOUNT_DELETION_URL)}><Text style={styles.link}>Account deletion</Text></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const createStyles = (colours: AppColours) => StyleSheet.create({
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
  input: { height: 52, borderWidth: 1, borderColor: colours.inputBorder, borderRadius: 14, paddingHorizontal: 14, fontSize: 16, color: colours.ink, backgroundColor: colours.input },
  buttonGap: { marginTop: 22 },
  help: { textAlign: 'center', color: colours.muted, fontSize: 12, marginTop: 18 },
  appearance: { marginTop: 14 },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12 },
  link: { color: colours.blue, fontSize: 12, fontWeight: '700' },
  linkDot: { color: colours.muted, fontSize: 12 },
});
