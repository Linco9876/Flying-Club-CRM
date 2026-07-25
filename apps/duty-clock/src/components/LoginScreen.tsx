import { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { type AppColours, useAppTheme } from '../theme';
import { ACCOUNT_DELETION_URL, PRIVACY_URL, SUPPORT_URL } from '../config';
import { PrimaryButton } from './PrimaryButton';
import { AppearanceSelector } from './AppearanceSelector';
import { InstallPwaButton } from './InstallPwaButton';

export const LoginScreen = () => {
  const { colours } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const emailRef = useRef('');
  const passwordRef = useRef('');
  const loginInFlightRef = useRef(false);

  const login = async () => {
    if (loginInFlightRef.current) return;
    const currentEmail = emailRef.current.trim();
    const currentPassword = passwordRef.current;
    if (!currentEmail || !currentPassword) {
      setErrorMessage('Enter the same email address and password you use for the club portal.');
      return;
    }
    loginInFlightRef.current = true;
    setErrorMessage(undefined);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: currentEmail,
        password: currentPassword,
      });
      if (error) {
        setErrorMessage(
          error.code === 'invalid_credentials'
            ? 'That email address or password is not correct. Use the same login as the club portal.'
            : 'Sign-in could not be completed. Check your connection and try again.',
        );
      }
    } catch {
      setErrorMessage('The Duty Clock could not reach the login service. Check your connection and try again.');
    } finally {
      loginInFlightRef.current = false;
      setLoading(false);
    }
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
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={value => {
              emailRef.current = value;
              setEmail(value);
              if (errorMessage) setErrorMessage(undefined);
            }}
            placeholder="you@example.com"
            placeholderTextColor={colours.placeholder}
            style={styles.input}
          />
          <Text style={[styles.label, styles.passwordLabel]}>Password</Text>
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoComplete="current-password"
            secureTextEntry
            value={password}
            onChangeText={value => {
              passwordRef.current = value;
              setPassword(value);
              if (errorMessage) setErrorMessage(undefined);
            }}
            placeholder="Your password"
            placeholderTextColor={colours.placeholder}
            style={styles.input}
            onSubmitEditing={() => void login()}
          />
          {errorMessage ? (
            <View style={styles.error} accessibilityLiveRegion="polite">
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}
          <View style={styles.buttonGap}>
            <PrimaryButton loading={loading} onPress={() => void login()}>Sign in</PrimaryButton>
          </View>
        </View>
        <Text style={styles.help}>Use the same account as the Flight Management System.</Text>
        <InstallPwaButton />
        <View style={styles.appearance}><AppearanceSelector /></View>
        <View style={styles.links}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Privacy"
            onPress={() => void Linking.openURL(PRIVACY_URL)}
          >
            <Text style={styles.link}>Privacy</Text>
          </Pressable>
          <Text style={styles.linkDot}>·</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Support"
            onPress={() => void Linking.openURL(SUPPORT_URL)}
          >
            <Text style={styles.link}>Support</Text>
          </Pressable>
          <Text style={styles.linkDot}>·</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Account deletion"
            onPress={() => void Linking.openURL(ACCOUNT_DELETION_URL)}
          >
            <Text style={styles.link}>Account deletion</Text>
          </Pressable>
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
  error: { marginTop: 14, borderRadius: 12, borderWidth: 1, borderColor: colours.red, backgroundColor: colours.redLight, paddingHorizontal: 12, paddingVertical: 10 },
  errorText: { color: colours.red, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  buttonGap: { marginTop: 22 },
  help: { textAlign: 'center', color: colours.muted, fontSize: 12, marginTop: 18 },
  appearance: { marginTop: 14 },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12 },
  link: { color: colours.blue, fontSize: 12, fontWeight: '700' },
  linkDot: { color: colours.muted, fontSize: 12 },
});
