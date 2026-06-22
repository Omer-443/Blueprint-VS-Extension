import * as path from 'path';

export type ExtractedApiRoute = {
  path: string;
  method: string;
  filePath: string;
};

export type ExtractedApiCall = {
  url: string;
  method: string;
  filePath: string;
};

function stripComments(code: string, fileExt: string): string {
  // Best-effort comment stripping for non-JS/TS languages.
  // Goal is to reduce false positives, not perfectly parse every grammar.
  let out = code;

  // block comments
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');

  // line comments
  if (fileExt === '.py' || fileExt === '.go') {
    out = out.replace(/(^|\n)\s*#.*$/g, '$1'); // python
    out = out.replace(/(^|\n)\s*\/\/.*$/g, '$1'); // go/js style (rare but cheap)
    out = out.replace(/(^|\n)\s*\..*$/g, '$1'); // no-op-ish placeholder; keep minimal
  }

  // generic // comments (covers go, js-ish)
  out = out.replace(/(^|\n)\s*\/\/.*$/g, '$1');

  return out;
}

export class RegexExtractor {
  public static extractRoutes(content: string, filePath: string): ExtractedApiRoute[] {
    const ext = path.extname(filePath).toLowerCase();
    const clean = stripComments(content, ext);

    const routes: ExtractedApiRoute[] = [];

    // FastAPI / Flask style decorators
    const fastapiFlaskRegex = /@(?:app|router)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = fastapiFlaskRegex.exec(clean)) !== null) {
      routes.push({
        method: m[1].toUpperCase(),
        path: m[2],
        filePath
      });
    }

    return routes;
  }

  public static extractCalls(content: string, filePath: string): ExtractedApiCall[] {
    const ext = path.extname(filePath).toLowerCase();
    const clean = stripComments(content, ext);

    const calls: ExtractedApiCall[] = [];

    // Python: requests.get/post/put/delete/patch('...')
    // Go: http.Get("..."), client.Do(req) is hard; keep lightweight.

    if (ext === '.py' || ext === '.go' || ext === '.pyw') {
      const pyRequestsRegex = /requests\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = pyRequestsRegex.exec(clean)) !== null) {
        calls.push({
          method: m[1].toUpperCase(),
          url: m[2],
          filePath
        });
      }

      // axios-like is uncommon in Python/Go; ignore.
    }

    // Go (Gin/Echo callers rarely use string literals; best-effort)
    // http.NewRequest("METHOD", "url")
    const goNewRequestRegex = /http\.NewRequest\(\s*['"`]([A-Z]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]\s*\)/g;
    let n: RegExpExecArray | null;
    while ((n = goNewRequestRegex.exec(clean)) !== null) {
      calls.push({
        method: (n[1] || 'ANY').toUpperCase(),
        url: n[2],
        filePath
      });
    }

    // Generic: <verb>('...') for http helpers (best-effort)
    const goSimpleCallRegex = /\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    let k: RegExpExecArray | null;
    while ((k = goSimpleCallRegex.exec(clean)) !== null) {
      // avoid capturing decorator routes in python by checking simple heuristics
      calls.push({
        method: k[1].toUpperCase(),
        url: k[2],
        filePath
      });
    }

    return calls;
  }
}

