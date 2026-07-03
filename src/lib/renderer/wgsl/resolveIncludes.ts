export interface ResolveWgslIncludeOptions {
  modules: Readonly<Record<string, string>>;
  sourceName?: string;
}

const INCLUDE_RE = /^[ \t]*#include\s+(?:<([^>\r\n]+)>|"([^"\r\n]+)")\s*$/gm;

function normalizeIncludeName(raw: string): string {
  return raw.trim().replace(/^\.?\//, '').replace(/\.wgsl$/i, '');
}

function lookupModule(modules: Readonly<Record<string, string>>, rawName: string): string | undefined {
  const normalized = normalizeIncludeName(rawName);
  return modules[normalized] ?? modules[`${normalized}.wgsl`];
}

export function resolveWgslIncludes(source: string, options: ResolveWgslIncludeOptions): string {
  const modules = options.modules;
  const rootName = options.sourceName ?? 'inline';
  const emitted = new Set<string>();

  function visit(code: string, sourceName: string, stack: string[]): string {
    return code.replace(INCLUDE_RE, (_match, angleName: string | undefined, quoteName: string | undefined) => {
      const rawName = angleName ?? quoteName ?? '';
      const name = normalizeIncludeName(rawName);
      if (!name) {
        throw new Error(`Empty WGSL include in ${sourceName}`);
      }
      if (stack.includes(name)) {
        throw new Error(`Circular WGSL include: ${[...stack, name].join(' -> ')}`);
      }
      if (emitted.has(name)) {
        return `// SKIP duplicate #include <${name}>`;
      }
      const moduleSource = lookupModule(modules, name);
      if (moduleSource === undefined) {
        throw new Error(`Unknown WGSL include "${name}" in ${sourceName}`);
      }
      emitted.add(name);
      const resolved = visit(moduleSource, name, [...stack, name]);
      return `// BEGIN #include <${name}>\n${resolved}\n// END #include <${name}>`;
    });
  }

  return visit(source, rootName, [rootName]);
}
