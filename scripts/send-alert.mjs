import fs from 'node:fs/promises';

function parseArgs() {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    const [key, ...valueParts] = arg.replace(/^--/, '').split('=');
    args.set(key, valueParts.join('=') || 'true');
  }
  return args;
}

async function loadEnv(filePath) {
  if (!filePath) return;
  const content = await fs.readFile(filePath, 'utf8').catch(() => '');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function buildMessage() {
  const title = process.env.ALERT_TITLE || 'Bendigo Flying Club CRM alert';
  const summary = process.env.ALERT_SUMMARY || 'A monitored CRM job needs attention.';
  const status = process.env.ALERT_STATUS || 'failure';
  const workflow = process.env.GITHUB_WORKFLOW || process.env.ALERT_WORKFLOW || '';
  const runUrl = process.env.ALERT_RUN_URL
    || (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '');

  const lines = [
    `*${title}*`,
    summary,
    workflow ? `Workflow: ${workflow}` : '',
    status ? `Status: ${status}` : '',
    runUrl ? `Run: ${runUrl}` : '',
  ].filter(Boolean);

  return {
    title,
    summary,
    status,
    workflow,
    runUrl,
    text: lines.join('\n'),
  };
}

function payloadFor(type, message) {
  switch ((type || 'generic').toLowerCase()) {
    case 'discord':
      return { content: message.text };
    case 'slack':
      return { text: message.text };
    case 'teams':
      return {
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: message.title,
        themeColor: 'D13438',
        title: message.title,
        text: message.text.replace(/\n/g, '<br>'),
      };
    default:
      return message;
  }
}

async function main() {
  const args = parseArgs();
  await loadEnv(args.get('env'));

  const webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl || webhookUrl.includes('replace-with')) {
    console.warn('ALERT_WEBHOOK_URL is not configured; alert was not sent.');
    return;
  }

  const message = buildMessage();
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadFor(process.env.ALERT_WEBHOOK_TYPE, message)),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Alert webhook failed with ${response.status}: ${body.slice(0, 500)}`);
  }

  console.log('Alert sent.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
