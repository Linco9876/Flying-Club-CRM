import { readFile, writeFile } from 'node:fs/promises';

const buildGradlePath = new URL('../android/app/build.gradle', import.meta.url);
let buildGradle = await readFile(buildGradlePath, 'utf8');

const signingConfigsStart = '    signingConfigs {\n        debug {';
const releaseSigningConfig = `    signingConfigs {
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            storeType "PKCS12"
        }
        debug {`;

if (!buildGradle.includes(signingConfigsStart)) {
  throw new Error('Could not locate the generated Android signingConfigs block');
}

buildGradle = buildGradle.replace(signingConfigsStart, releaseSigningConfig);

const releaseBlockStart = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;
const signedReleaseBlockStart = `        release {
            signingConfig signingConfigs.release`;

if (!buildGradle.includes(releaseBlockStart)) {
  throw new Error('Could not locate the generated Android release signing configuration');
}

buildGradle = buildGradle.replace(releaseBlockStart, signedReleaseBlockStart);
await writeFile(buildGradlePath, buildGradle);
