import DOMPurify from 'dompurify';

const NORMALISED_BLOCK_TAGS = ['div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'ul', 'ol', 'li', 'a', ...NORMALISED_BLOCK_TAGS];
const ALLOWED_ATTRIBUTES = ['href', 'target', 'rel'];

const plainTextToHtml = (value: string) => {
  const container = document.createElement('div');
  for (const paragraphText of value.split(/\n{2,}/)) {
    const paragraph = document.createElement('p');
    paragraphText.split('\n').forEach((line, index) => {
      if (index > 0) paragraph.append(document.createElement('br'));
      paragraph.append(document.createTextNode(line));
    });
    container.append(paragraph);
  }
  return container.innerHTML;
};

export const sanitizeRichText = (value: string) => {
  const clean = DOMPurify.sanitize(value, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const parsed = new DOMParser().parseFromString(`<body>${String(clean)}</body>`, 'text/html');
  parsed.querySelectorAll('b, i').forEach((element) => {
    const replacement = parsed.createElement(element.tagName.toLowerCase() === 'b' ? 'strong' : 'em');
    replacement.append(...Array.from(element.childNodes));
    element.replaceWith(replacement);
  });
  parsed.querySelectorAll(NORMALISED_BLOCK_TAGS.join(',')).forEach((element) => {
    const paragraph = parsed.createElement('p');
    paragraph.append(...Array.from(element.childNodes));
    element.replaceWith(paragraph);
  });
  parsed.querySelectorAll('a').forEach((anchor) => {
    try {
      const url = new URL(anchor.getAttribute('href') || '');
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported link protocol');
      anchor.setAttribute('href', url.toString());
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    } catch {
      anchor.replaceWith(...Array.from(anchor.childNodes));
    }
  });
  return parsed.body.innerHTML;
};

export const formatRichTextContent = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const source = /<\/?[a-z][\s\S]*>/i.test(trimmed) ? trimmed : plainTextToHtml(trimmed);
  return sanitizeRichText(source);
};

const richTextToPlainTextWithoutDom = (value: string) => String(value || '')
  .replace(/<\s*br\s*\/?\s*>/gi, '\n')
  .replace(/<\s*\/\s*(p|li|div|section|article|h[1-6]|ul|ol)\s*>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
  .replace(/\n{3,}/g, '\n\n')
  .trim();

export const richTextToPlainText = (value: string) => {
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
    return richTextToPlainTextWithoutDom(value);
  }
  const clean = formatRichTextContent(value);
  if (!clean) return '';
  const parsed = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html');
  parsed.querySelectorAll('br').forEach((element) => element.replaceWith('\n'));
  parsed.querySelectorAll('p, li, div, ul, ol').forEach((element) => element.append('\n'));
  return (parsed.body.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
