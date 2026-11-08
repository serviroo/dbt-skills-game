export function lineStarts(text) {
  const starts = [0];
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
}

export function lineOf(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

export function rangePieces(text, starts, start, end) {
  const first = lineOf(starts, start);
  return text
    .slice(start, end)
    .split('\n')
    .map((part, i) => ({ line: first + i, text: part.replace(/\r$/, '') }));
}

export const shifted = (pieces, firstLine) => pieces.map((p) => ({ ...p, line: p.line + firstLine - 1 }));

export function wholeLinePieces(text, pattern) {
  return text
    .split('\n')
    .map((line, i) => ({ line: i + 1, text: line.replace(/\r$/, '') }))
    .filter((p) => pattern.test(p.text));
}

const TEXT_COMMENT = /^[ \t]*(\/\/|\/\*|<!--)([ \t]|$)/;

export const textTemplatePieces = (text) => wholeLinePieces(text, TEXT_COMMENT);


export function clikePieces(text) {
  const starts = lineStarts(text);
  const pieces = [];
  let at = 0;
  while (at < text.length) {
    const two = text.slice(at, at + 2);
    const close = two === '//' ? text.indexOf('\n', at) : two === '/*' ? text.indexOf('*/', at + 2) : -2;
    if (close === -2 && (text[at] === '"' || text[at] === "'")) {
      const quote = text[at++];
      while (at < text.length && text[at] !== quote && text[at] !== '\n') at += text[at] === '\\' ? 2 : 1;
      at++;
    } else if (close === -2) {
      at++;
    } else {
      const stop = close < 0 ? text.length : two === '/*' ? close + 2 : close;
      pieces.push(...rangePieces(text, starts, at, stop));
      at = stop;
    }
  }
  return pieces;
}
