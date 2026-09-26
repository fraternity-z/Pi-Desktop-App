interface MarkdownNode {
  type?: string;
  value?: string;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  data?: Record<string, unknown>;
  children?: MarkdownNode[];
}

export function prepareMarkdownMath(source: string) {
  // GFM splits table cells before parsing math. A source-absent, single UTF-16
  // character shields TeX pipes (including \|) without shifting positions.
  const usedCharacters = new Set(source);
  let pipeMarker: string | undefined;
  for (let code = 0xe000; code <= 0xf8ff; code++) {
    const candidate = String.fromCharCode(code);
    if (!usedCharacters.has(candidate)) {
      pipeMarker = candidate;
      break;
    }
  }
  return { source: normalizeMathSource(source, pipeMarker), pipeMarker };
}

// Match PI-Desktop's equal-width normalization: source offsets still identify
// bracket display math after remark-math parses the dollar delimiters.
export function normalizeLatexMathDelimiters(source: string): string {
  return normalizeMathSource(source);
}

function normalizeMathSource(source: string, pipeMarker?: string): string {
  const output = source.split("");
  let offset = 0;
  let codeTicks = 0;
  let fence: { char: string; length: number } | null = null;
  let math: { close: string; open: number; width: number } | null = null;

  function isEscaped(index: number): boolean {
    let precedingSlashes = 0;
    for (let i = index - 1; i >= 0 && source[i] === "\\"; i--) precedingSlashes++;
    return precedingSlashes % 2 !== 0;
  }

  function isDelimiter(index: number, bracket: string): boolean {
    return source[index] === "\\" && source[index + 1] === bracket && !isEscaped(index);
  }

  for (const line of source.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!line) continue;
    const fenceMatch = !codeTicks && !math
      ? /^( {0,3})(`{3,}|~{3,})(.*?)(?:\r)?(?:\n)?$/.exec(line)
      : null;
    if (fence) {
      if (fenceMatch?.[2][0] === fence.char &&
          fenceMatch[2].length >= fence.length && !fenceMatch[3].trim()) {
        fence = null;
      }
      offset += line.length;
      continue;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[2][0], length: fenceMatch[2].length };
      offset += line.length;
      continue;
    }
    if (!math && !codeTicks && /^(?: {4}|\t)/.test(line)) {
      offset += line.length;
      continue;
    }

    for (let i = 0; i < line.length;) {
      const index = offset + i;
      let dollarWidth = 0;
      if (line[i] === "$") {
        while (line[i + dollarWidth] === "$") dollarWidth++;
      }
      if (math) {
        const closes = math.close === "$"
          ? dollarWidth === math.width && !isEscaped(index)
          : isDelimiter(index, math.close);
        if (closes) {
          if (math.close !== "$") {
            output[math.open] = output[math.open + 1] = "$";
            output[index] = output[index + 1] = "$";
          }
          // Keep a bracket expression within its paragraph/table cell.
          // Only flatten line endings, not TeX's double-backslash row breaks.
          for (let j = math.open + math.width; j < index; j++) {
            if (math.close !== "$" && (output[j] === "\n" || output[j] === "\r")) output[j] = " ";
            if (pipeMarker && output[j] === "|") output[j] = pipeMarker;
          }
          i += math.width;
          math = null;
        } else {
          i += dollarWidth || 1;
        }
        continue;
      }
      if (line[i] === "`") {
        let length = 1;
        while (line[i + length] === "`") length++;
        if (!codeTicks) codeTicks = length;
        else if (codeTicks === length) codeTicks = 0;
        i += length;
        continue;
      }
      if (!codeTicks && (isDelimiter(index, "(") || isDelimiter(index, "["))) {
        math = { close: source[index + 1] === "(" ? ")" : "]", open: index, width: 2 };
        i += 2;
        continue;
      }
      if (!codeTicks && dollarWidth && !isEscaped(index)) {
        math = { close: "$", open: index, width: dollarWidth };
        i += dollarWidth;
        continue;
      }
      i++;
    }
    // GFM cells cannot span lines. Never let an unfinished dollar expression
    // shield another row's separators; remark-math handles multiline dollars
    // unchanged, without needing table protection.
    if (math?.close === "$") math = null;
    offset += line.length;
  }
  return output.join("");
}

export function remarkRestoreMathPipes(pipeMarker?: string) {
  return function restoreMathPipes() {
    return (tree: MarkdownNode) => {
      if (!pipeMarker) return;
      const marker = pipeMarker;
      function visit(node: MarkdownNode) {
        if (typeof node.value === "string") node.value = node.value.replaceAll(marker, "|");
        node.children?.forEach(visit);
        // remark-math also stores the rendered <code> text in hChildren.
        if (Array.isArray(node.data?.hChildren)) node.data.hChildren.forEach(visit);
      }
      visit(tree);
    };
  };
}

export function remarkLatexBracketDisplay(source: string) {
  return function latexBracketDisplay() {
    return (tree: MarkdownNode) => {
      function visit(node: MarkdownNode) {
        const start = node.position?.start?.offset;
        const end = node.position?.end?.offset;
        if (node.type === "inlineMath" && typeof start === "number" &&
            typeof end === "number" && source.slice(start, start + 2) === "\\[" &&
            source.slice(end - 2, end) === "\\]") {
          node.data = {
            ...node.data,
            hProperties: { className: ["language-math", "math-display"] },
          };
        }
        node.children?.forEach(visit);
      }
      visit(tree);
    };
  };
}
