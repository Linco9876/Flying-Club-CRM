export type PdfTextMeasure = (text: string) => number;

const PDF_TEXT_REPLACEMENTS: Record<string, string> = {
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2022': '*',
  '\u2026': '...',
  '\u00a0': ' ',
};

export const normalisePdfText = (value: unknown) => {
  const replaced = String(value ?? '')
    .replace(/[\u2010-\u2015\u2018\u2019\u201c\u201d\u2022\u2026\u00a0]/g, character => PDF_TEXT_REPLACEMENTS[character] ?? character)
    .normalize('NFKD');
  let withoutControls = '';
  let replacedUnsupportedSequence = false;

  for (const character of replaced) {
    const code = character.codePointAt(0) ?? 0;
    const isWhitespace = /\s/.test(character);
    const isWinAnsiCharacter = (code >= 32 && code <= 126) || (code >= 160 && code <= 255);
    const isCombiningMark = code >= 0x0300 && code <= 0x036f;

    if (isWhitespace) {
      withoutControls += ' ';
      replacedUnsupportedSequence = false;
    } else if (isWinAnsiCharacter) {
      withoutControls += character;
      replacedUnsupportedSequence = false;
    } else if (!isCombiningMark && !replacedUnsupportedSequence) {
      // pdf-lib's built-in Helvetica font uses WinAnsi. Preserve the document
      // instead of allowing an unsupported pasted symbol to abort the export.
      withoutControls += '?';
      replacedUnsupportedSequence = true;
    }
  }

  return withoutControls.replace(/\s+/g, ' ').trim();
};

const splitTokenToWidth = (token: string, measure: PdfTextMeasure, maxWidth: number) => {
  const chunks: string[] = [];
  let chunk = '';

  for (const character of token) {
    const candidate = `${chunk}${character}`;
    if (chunk && measure(candidate) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }

  if (chunk) chunks.push(chunk);
  return chunks.length > 0 ? chunks : [''];
};

export const wrapPdfText = (
  value: unknown,
  measure: PdfTextMeasure,
  maxWidth: number,
) => {
  const text = normalisePdfText(value);
  if (!text) return [''];

  const tokens = text.split(' ').flatMap(token => (
    measure(token) <= maxWidth ? [token] : splitTokenToWidth(token, measure, maxWidth)
  ));
  const lines: string[] = [];
  let line = '';

  for (const token of tokens) {
    const candidate = line ? `${line} ${token}` : token;
    if (!line || measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }

    lines.push(line);
    line = token;
  }

  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
};

export const truncatePdfText = (
  value: unknown,
  measure: PdfTextMeasure,
  maxWidth: number,
  suffix = '...',
) => {
  const text = normalisePdfText(value);
  if (measure(text) <= maxWidth) return text;
  if (maxWidth <= 0 || measure(suffix) > maxWidth) return '';

  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(`${text.slice(0, middle).trimEnd()}${suffix}`) <= maxWidth) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return `${text.slice(0, low).trimEnd()}${suffix}`;
};

export const chunkPdfColumns = <T>(items: T[], size: number): T[][] => {
  if (size <= 0) throw new Error('PDF column chunk size must be greater than zero');
  if (items.length === 0) return [[]];

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};
