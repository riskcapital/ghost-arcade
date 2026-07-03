export interface WgslSourceRecord {
  file: string;
  name: string;
  source: string;
  interpolated: boolean;
}

export interface WgslModuleUseRecord {
  file: string;
  line: number;
  sourceArg: string;
  labelArg: string;
}

const WGSL_TEMPLATE_RE = /\b(?:const|let)\s+([A-Za-z0-9_]*WGSL)\s*=\s*\/\*\s*wgsl\s*\*\/\s*`([\s\S]*?)`/g;
const WGSL_MODULE_CALL_RE = /\bcreate(?:AndWarm)?WgslShaderModule\s*\(([\s\S]*?)\)/g;

function lineNumberForIndex(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function splitTopLevelArgs(source: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(source.slice(start).trim());
  return args;
}

export function extractWgslSources(file: string, source: string): WgslSourceRecord[] {
  const records: WgslSourceRecord[] = [];
  for (const match of source.matchAll(WGSL_TEMPLATE_RE)) {
    const name = match[1];
    const body = match[2] ?? '';
    records.push({
      file,
      name,
      source: body,
      interpolated: body.includes('${'),
    });
  }
  return records;
}

export function extractWgslModuleUses(file: string, source: string): WgslModuleUseRecord[] {
  const records: WgslModuleUseRecord[] = [];
  for (const match of source.matchAll(WGSL_MODULE_CALL_RE)) {
    const args = splitTopLevelArgs(match[1] ?? '');
    records.push({
      file,
      line: lineNumberForIndex(source, match.index ?? 0),
      sourceArg: args[1] ?? '',
      labelArg: args[2] ?? '',
    });
  }
  return records;
}

