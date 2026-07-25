import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import https from 'node:https';
import browserStackLocal from 'browserstack-local';
import selenium from 'selenium-webdriver';

const { Builder, By } = selenium;
const credentials = JSON.parse(process.env.ACCEPTANCE_USERS_JSON || '{}');
const username = process.env.BROWSERSTACK_USERNAME;
const accessKey = process.env.BROWSERSTACK_ACCESS_KEY;
const roles = ['admin', 'cfi', 'senior_instructor', 'instructor', 'pilot', 'student'];
const staffRoles = new Set(['admin', 'cfi', 'senior_instructor', 'instructor']);
const baseUrl = 'http://bs-local.com:4178';
const localIdentifier = `bfc-${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || 'local'}`;
const logoutLocator = By.css('button[aria-label="Logout"]');
const mfaCodeLocator = By.css('input[aria-label="Six-digit authenticator code"]');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const withTimeout = async (promise, timeoutMs, description) => {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${description} timed out after ${timeoutMs / 1_000} seconds.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const expectedMenuItems = {
  admin: ['Members', 'Club Membership', 'Aircraft', 'Duty', 'Maintenance', 'Training Courses', 'Financial Dashboard', 'Settings'],
  cfi: ['Members', 'Club Membership', 'Aircraft', 'Duty', 'Maintenance', 'Training Courses', 'Outstanding Records', 'Safety', 'Settings'],
  senior_instructor: ['Club Membership', 'Aircraft', 'Duty', 'Training Courses', 'Learning Centre', 'Pilot File', 'Settings'],
  instructor: ['Members', 'Club Membership', 'Aircraft', 'Duty', 'Maintenance', 'Training Courses', 'Outstanding Records', 'Safety', 'Settings'],
  pilot: ['Club Membership', 'Aircraft', 'Learning Centre', 'Pilot File', 'Documents', 'My Logbook', 'Settings'],
  student: ['Club Membership', 'Aircraft', 'Learning Centre', 'Pilot File', 'Documents', 'My Logbook', 'Safety', 'Settings'],
};

const devices = [
  {
    key: 'real-iphone',
    browserName: 'safari',
    deviceName: 'iPhone 16',
    osVersion: '18',
  },
  {
    key: 'real-android',
    browserName: 'chrome',
    deviceName: 'Samsung Galaxy S23 Ultra',
    osVersion: '13.0',
  },
];

if (!username || !accessKey) {
  throw new Error('BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY are required.');
}
for (const device of devices) {
  for (const role of roles) {
    if (!credentials[`${device.key}:${role}`]) {
      throw new Error(`Missing disposable acceptance credentials for ${device.key}:${role}.`);
    }
  }
}

const decodeBase32 = (value) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = '';
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error(`Invalid base32 character: ${character}`);
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
};

const totp = (secret, now = Date.now()) => {
  const counter = Math.floor(now / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  ) % 1_000_000;
  return number.toString().padStart(6, '0');
};

const freshTotp = async (secret) => {
  const remainingMs = 30_000 - (Date.now() % 30_000);
  if (remainingMs < 10_000) await delay(remainingMs + 500);
  return totp(secret);
};

const waitForHttp = async (url, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server is still starting.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}.`);
};

const startLocal = (instance) => withTimeout(
  new Promise((resolve, reject) => {
    instance.start(
      {
        key: accessKey,
        localIdentifier,
        onlyAutomate: true,
      },
      (error) => (error ? reject(error) : resolve()),
    );
  }),
  120_000,
  'BrowserStack Local startup',
);

const stopLocal = (instance) => withTimeout(new Promise((resolve) => {
  if (!instance?.isRunning()) {
    resolve();
    return;
  }
  instance.stop(() => resolve());
}), 30_000, 'BrowserStack Local shutdown').catch((error) => {
  console.error(error.message);
  instance?.tunnel?.kill?.('SIGKILL');
});

const stopRemoteSession = async (sessionId) => {
  if (!sessionId) return;
  const authorization = Buffer.from(`${username}:${accessKey}`).toString('base64');
  try {
    const response = await fetch(
      `https://hub.browserstack.com/wd/hub/session/${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Basic ${authorization}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`BrowserStack returned HTTP ${response.status}.`);
    }
  } catch (error) {
    console.error(`BrowserStack session ${sessionId} shutdown failed:`, error);
  }
};

const findVisible = async (driver, locator, timeout = 20_000) => {
  return driver.wait(async () => {
    const elements = await driver.findElements(locator);
    for (const element of elements) {
      if (await element.isDisplayed()) return element;
    }
    return false;
  }, timeout, `No visible element found for ${locator}.`);
};

const clickButton = async (driver, name) => {
  const element = await findVisible(
    driver,
    By.xpath(`//button[normalize-space(.)="${name}"]`),
  );
  await element.click();
};

const optionalVisible = async (driver, locator, timeout = 1_500) => {
  try {
    return await findVisible(driver, locator, timeout);
  } catch {
    return null;
  }
};

const setSessionStatus = async (driver, status, reason) => {
  try {
    await driver.executeScript(
      `browserstack_executor: ${JSON.stringify({
        action: 'setSessionStatus',
        arguments: { status, reason },
      })}`,
    );
  } catch {
    // Preserve the original test result if BrowserStack status annotation fails.
  }
};

const resetBrowserState = async (driver) => {
  await driver.get(baseUrl);
  await driver.wait(
    async () => (await driver.executeScript('return document.readyState;')) === 'complete',
    30_000,
  );
  await driver.executeScript('window.localStorage.clear(); window.sessionStorage.clear();');
  await driver.manage().deleteAllCookies();
  await driver.get(baseUrl);
};

const reportBrowserState = async (driver, deviceName) => {
  try {
    const [url, title, bodyText] = await Promise.all([
      driver.getCurrentUrl(),
      driver.getTitle(),
      driver.executeScript('return document.body?.innerText || "";'),
    ]);
    const summary = String(bodyText).replace(/\s+/g, ' ').slice(0, 2_500);
    console.error(`${deviceName} browser state: URL=${url}; title=${title}; text=${summary}`);
  } catch (error) {
    console.error(`${deviceName} browser diagnostics failed:`, error);
  }
};

const testRole = async (driver, deviceKey, role) => {
  const credential = credentials[`${deviceKey}:${role}`];
  await resetBrowserState(driver);
  await driver.executeScript(
    'window.sessionStorage.setItem(arguments[0], "true");',
    `safety-login-warning-dismissed:${credential.id}`,
  );

  const email = await findVisible(
    driver,
    By.xpath('//label[contains(normalize-space(.),"Email Address")]/following::input[1]'),
  );
  await email.clear();
  await email.sendKeys(credential.email);
  const password = await findVisible(driver, By.css('#password'));
  await password.clear();
  await password.sendKeys(credential.password);
  const [enteredEmail, enteredPassword] = await Promise.all([
    email.getAttribute('value'),
    password.getAttribute('value'),
  ]);
  if (enteredEmail !== credential.email || enteredPassword !== credential.password) {
    throw new Error(`${deviceKey}:${role} credentials were not entered exactly on the mobile keyboard.`);
  }
  const loginForm = await email.findElement(By.xpath('ancestor::form[1]'));
  await driver.executeScript('arguments[0].requestSubmit();', loginForm);

  if (staffRoles.has(role)) {
    await findVisible(
      driver,
      By.xpath('//*[self::h1 or self::h2][normalize-space(.)="Protect your staff account"]'),
      60_000,
    );
    await clickButton(driver, 'Set up authenticator');
    const reveal = await findVisible(
      driver,
      By.xpath('//summary[contains(normalize-space(.),"scan it")]'),
    );
    await reveal.click();
    const secret = await (await findVisible(driver, By.css('details code'))).getText();
    const submitEnrollmentCode = async () => {
      const code = await freshTotp(secret.trim());
      const codeInput = await findVisible(driver, mfaCodeLocator, 60_000);
      await codeInput.clear();
      await codeInput.sendKeys(code);
      if ((await codeInput.getAttribute('value')) !== code) {
        throw new Error(`${deviceKey}:${role} MFA code was not entered exactly on the mobile keyboard.`);
      }
      await driver.executeScript('document.activeElement?.blur();');
      const verifyButton = await findVisible(
        driver,
        By.xpath('//button[normalize-space(.)="Verify and finish"]'),
      );
      await driver.executeScript('arguments[0].click();', verifyButton);
    };
    await submitEnrollmentCode();
    let authenticated = await optionalVisible(driver, logoutLocator, 30_000);
    if (!authenticated) {
      const retryButton = await optionalVisible(
        driver,
        By.xpath('//button[normalize-space(.)="Verify and finish"]'),
        2_000,
      );
      if (retryButton) {
        await submitEnrollmentCode();
        authenticated = await optionalVisible(driver, logoutLocator, 60_000);
      }
    }
    if (!authenticated) {
      throw new Error(`${deviceKey}:${role} did not leave MFA enrollment after two fresh codes.`);
    }
  }

  await findVisible(driver, logoutLocator);
  await findVisible(driver, By.xpath('//*[self::h1 or self::h2][normalize-space(.)="Bendigo Flying Club"]'));

  const later = await optionalVisible(driver, By.xpath('//button[normalize-space(.)="Later"]'));
  if (later) await later.click();

  const openMenu = await findVisible(driver, By.css('button[aria-label="Open navigation menu"]'));
  await openMenu.click();
  const sidebar = await findVisible(driver, By.css('.app-sidebar'));
  for (const item of expectedMenuItems[role]) {
    const menuItem = await sidebar.findElement(By.xpath(`.//button[normalize-space(.)="${item}"]`));
    if (!(await menuItem.isDisplayed())) {
      throw new Error(`${role} menu item is hidden: ${item}`);
    }
  }
  if (role !== 'admin') {
    const forbidden = await sidebar.findElements(By.xpath('.//button[normalize-space(.)="Financial Dashboard"]'));
    if (forbidden.length > 0) throw new Error(`${role} can see the admin Financial Dashboard.`);
  }
  const closeMenu = await sidebar.findElement(By.css('button[aria-label="Close navigation menu"]'));
  await closeMenu.click();

  const calendar = await findVisible(driver, By.css('header button[aria-label="Calendar"]'));
  await calendar.click();
  await driver.wait(async () => (await driver.getCurrentUrl()).endsWith('/calendar'), 20_000);
  await findVisible(driver, logoutLocator);

  const profile = await findVisible(driver, By.css('header button[aria-label="Profile"]'));
  await profile.click();
  await driver.wait(async () => new URL(await driver.getCurrentUrl()).pathname === '/', 20_000);
  await findVisible(driver, logoutLocator);

  const hasHorizontalOverflow = await driver.executeScript(
    'return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;',
  );
  if (hasHorizontalOverflow) throw new Error(`${role} portal has horizontal overflow.`);
};

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const vite = spawn(
  npmExecutable,
  ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '4178'],
  {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
vite.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
vite.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));

const local = new browserStackLocal.Local();
let failed = false;
try {
  await waitForHttp('http://127.0.0.1:4178');
  await startLocal(local);

  for (const device of devices) {
    let driver;
    let sessionId;
    const seleniumAgent = new https.Agent({ keepAlive: true, timeout: 60_000 });
    try {
      driver = await new Builder()
        .usingServer('https://hub.browserstack.com/wd/hub')
        .usingHttpAgent(seleniumAgent)
        .withCapabilities({
          browserName: device.browserName,
          'bstack:options': {
            userName: username,
            accessKey,
            deviceName: device.deviceName,
            osVersion: device.osVersion,
            realMobile: true,
            deviceOrientation: 'portrait',
            projectName: 'Bendigo Flying Club CRM',
            buildName: `Authenticated real-device acceptance ${process.env.GITHUB_SHA || 'local'}`,
            sessionName: `${device.deviceName}: all six roles`,
            local: true,
            localIdentifier,
            debug: true,
            video: true,
            networkLogs: true,
            consoleLogs: 'errors',
            idleTimeout: 60,
          },
        })
        .build();
      sessionId = (await driver.getSession()).getId();

      for (const role of roles) {
        process.stdout.write(`Testing ${role} on ${device.deviceName}...\n`);
        await testRole(driver, device.key, role);
      }
      await setSessionStatus(driver, 'passed', 'All six authenticated role journeys passed.');
    } catch (error) {
      failed = true;
      if (driver) await setSessionStatus(driver, 'failed', error instanceof Error ? error.message : String(error));
      if (driver) await reportBrowserState(driver, device.deviceName);
      console.error(`${device.deviceName} failed:`, error);
    } finally {
      await stopRemoteSession(sessionId);
      seleniumAgent.destroy();
    }
  }
} finally {
  await stopLocal(local);
  vite.kill();
}

process.exit(failed ? 1 : 0);
