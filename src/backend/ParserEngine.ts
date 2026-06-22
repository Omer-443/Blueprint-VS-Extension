import * as vscode from 'vscode';
import { parse } from '@babel/parser';
import * as babelTraverse from '@babel/traverse';
const traverse = typeof babelTraverse === 'function' ? babelTraverse : (babelTraverse as any).default;
import * as path from 'path';
import * as fs from 'fs';
import * as ts from 'typescript';
import JSON5 from 'json5';
import { FileASTData, ImportNode, FileMetadata } from '../types';
import { RegexExtractor } from './RegexExtractor';

type ParseCacheEntry = {
  hash: string;
  data: FileASTData;
};

export type PathAliasConfig = {
  rootPath: string;
  baseUrl?: string;
  paths: Record<string, string[]>;
};

export class ParserEngine {
  private cache: Map<string, ParseCacheEntry> = new Map();
  private readonly maxCacheSize = 500;
  private aliasConfigs: PathAliasConfig[] = [];

  public setAliasConfigs(configs: PathAliasConfig[]) {
    this.aliasConfigs = configs;
  }

  public clearCache() {
    this.cache.clear();
  }

  private computeContentHash(content: string): string {
    // Fast, dependency-free hash. Collisions are acceptable for skipping re-parses.
    let h = 2166136261;
    for (let i = 0; i < content.length; i++) {
      h ^= content.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  private async readFileUtf8(fileUri: vscode.Uri, contentOverride?: string): Promise<string> {
    if (contentOverride !== undefined) return contentOverride;
    const contentBuffer = await vscode.workspace.fs.readFile(fileUri);
    return new TextDecoder('utf-8').decode(contentBuffer);
  }

  public async parseFile(filePath: string, contentOverride?: string): Promise<FileASTData> {
    try {
      const fileUri = vscode.Uri.file(filePath);
      const content = await this.readFileUtf8(fileUri, contentOverride);

      const contentHash = this.computeContentHash(content);
      const cached = this.cache.get(filePath);
      if (cached && cached.hash === contentHash) {
        // LRU refresh
        this.cache.delete(filePath);
        this.cache.set(filePath, cached);
        return cached.data;
      }

      const lineCount = content.split('\n').length;
      let isReactComponent = false;

      let ast: any;
      try {
        ast = parse(content, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx', 'decorators-legacy']
        });
      } catch (e) {
        console.error(`[ParserEngine] Failed to parse ${filePath}:`, e);
        ast = null;
      }

      const imports: ImportNode[] = [];

      if (ast) {
        imports.push(...this.extractImports(ast));
        isReactComponent = this.detectReactComponent(ast, content);
      }

      const resolvedImports = imports
        .map(imp => {
          try {
            imp.resolvedPath = this.resolveImportPath(imp.source, filePath);
          } catch (resolutionError) {
            console.warn(`[ParserEngine] Failed to resolve import ${imp.source} in ${filePath}:`, resolutionError);
            imp.resolvedPath = null;
          }
          return imp;
        })
        .filter(imp => imp.resolvedPath !== null);

      const stats = await vscode.workspace.fs.stat(fileUri);

      const metadata: FileMetadata = {
        filePath,
        lineCount,
        isEntryFile: false,
        isReactComponent,
        lastModified: stats.mtime
      };

      const apiRoutes = this.extractApiRoutes(content, filePath);
      const apiCalls = this.extractApiCalls(content, filePath);

      const parsed: FileASTData = {
        filePath,
        metadata,
        imports: resolvedImports,
        apiRoutes,
        apiCalls
      };

      this.cache.set(filePath, { hash: contentHash, data: parsed });
      if (this.cache.size > this.maxCacheSize) {
        // Evict oldest (first inserted)
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
          this.cache.delete(firstKey);
        }
      }
      return parsed;
    } catch (error) {
      console.error(`[ParserEngine] Safe fallback for ${filePath}:`, error);
      return {
        filePath,
        metadata: {
          filePath,
          lineCount: 0,
          isEntryFile: false,
          isReactComponent: false,
          lastModified: Date.now()
        },
        imports: [],
        apiRoutes: [],
        apiCalls: []
      };
    }
  }

  private stripComments(content: string, filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.py' || ext === '.go') return content;
    
    // EXT-08: Tokenizer-Based Comment Stripping using TypeScript Scanner
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false);
    scanner.setText(content);
    
    let result = '';
    let lastPos = 0;
    
    while (true) {
      const token = scanner.scan();
      if (token === ts.SyntaxKind.EndOfFileToken) {
        result += content.substring(lastPos);
        break;
      }
      
      if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
        const start = scanner.getTokenPos();
        const end = scanner.getTextPos();
        result += content.substring(lastPos, start);
        // Replace with equivalent whitespace to maintain line numbers/offsets
        result += content.substring(start, end).replace(/[^\n\r]/g, ' ');
        lastPos = end;
      }
    }
    
    return result;
  }

  private detectReactComponent(ast: any, content: string): boolean {
    let isComponent = false;
    let hasReactImport = false;
    let hasPascalCaseExport = false;

    traverse(ast, {
      JSXElement(path: any) {
        isComponent = true;
      },
      JSXFragment(path: any) {
        isComponent = true;
      },
      ImportDeclaration(path: any) {
        if (path.node.source.value === 'react') {
          hasReactImport = true;
        }
      },
      ExportDefaultDeclaration(path: any) {
        if (path.node.declaration.type === 'Identifier') {
          const name = path.node.declaration.name;
          if (/^[A-Z]/.test(name)) hasPascalCaseExport = true;
        } else if (path.node.declaration.type === 'FunctionDeclaration' && path.node.declaration.id) {
          const name = path.node.declaration.id.name;
          if (/^[A-Z]/.test(name)) hasPascalCaseExport = true;
        }
      },
      ExportNamedDeclaration(path: any) {
        if (path.node.declaration && path.node.declaration.type === 'FunctionDeclaration' && path.node.declaration.id) {
          const name = path.node.declaration.id.name;
          if (/^[A-Z]/.test(name)) hasPascalCaseExport = true;
        } else if (path.node.declaration && path.node.declaration.type === 'VariableDeclaration') {
          path.node.declaration.declarations.forEach((decl: any) => {
            if (decl.id.type === 'Identifier' && /^[A-Z]/.test(decl.id.name)) {
              hasPascalCaseExport = true;
            }
          });
        }
      }
    });

    return isComponent || (hasReactImport && hasPascalCaseExport);
  }

  private resolveStaticStringExpression(expr: any, scope: any, depth = 0): string | null {
    if (!expr || depth > 4) return null;

    if (expr.type === 'StringLiteral') return expr.value;
    if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0) {
      return expr.quasis.map((q: any) => q.value.cooked ?? q.value.raw ?? '').join('');
    }
    if (expr.type === 'BinaryExpression' && expr.operator === '+') {
      const left = this.resolveStaticStringExpression(expr.left, scope, depth + 1);
      const right = this.resolveStaticStringExpression(expr.right, scope, depth + 1);
      return left !== null && right !== null ? left + right : null;
    }
    if (expr.type === 'Identifier' && scope) {
      const binding = scope.getBinding(expr.name);
      if (!binding || !binding.path) return null;
      const bindingPath = binding.path;
      if (bindingPath.node?.init) {
        return this.resolveStaticStringExpression(bindingPath.node.init, bindingPath.scope ?? scope, depth + 1);
      }
      if (bindingPath.node?.type === 'AssignmentExpression') {
        return this.resolveStaticStringExpression(bindingPath.node.right, bindingPath.scope ?? scope, depth + 1);
      }
    }
    return null;
  }

  private resolveAliasImport(source: string, currentFilePath: string): string | null {
    try {
      const normalizedCurrentFilePath = currentFilePath.toLowerCase();
      const currentConfig = this.aliasConfigs
        .filter(cfg => normalizedCurrentFilePath.startsWith(cfg.rootPath.toLowerCase()))
        .sort((a, b) => b.rootPath.length - a.rootPath.length)[0];

      const configsToTry = currentConfig ? [currentConfig, ...this.aliasConfigs.filter(cfg => cfg !== currentConfig)] : this.aliasConfigs;

      const tryResolveCandidate = (candidate: string, rootPath: string): string | null => {
        const normalized = path.resolve(rootPath, candidate);
        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];

        for (const ext of ['', ...extensions]) {
          const checkPath = normalized + ext;
          try {
            if (fs.existsSync(checkPath) && fs.statSync(checkPath).isFile()) {
              return checkPath;
            }
          } catch {
            continue;
          }
        }

        try {
          if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
            for (const ext of extensions) {
              const indexFile = path.join(normalized, `index${ext}`);
              try {
                if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
                  return indexFile;
                }
              } catch {
                continue;
              }
            }
          }
        } catch {
          return null;
        }

        return null;
      };

      for (const config of configsToTry) {
        const baseDir = config.baseUrl ? path.resolve(config.rootPath, config.baseUrl) : config.rootPath;
        const pathEntries = Object.entries(config.paths ?? {});

        for (const [aliasPattern, targets] of pathEntries) {
          const wildcardIndex = aliasPattern.indexOf('*');
          const matchesAlias = wildcardIndex >= 0
            ? (() => {
                const prefix = aliasPattern.slice(0, wildcardIndex);
                const suffix = aliasPattern.slice(wildcardIndex + 1);
                return source.startsWith(prefix) && source.endsWith(suffix) && source.length >= prefix.length + suffix.length;
              })()
            : source === aliasPattern;

          if (!matchesAlias) continue;

          const wildcardValue = wildcardIndex >= 0
            ? source.slice(aliasPattern.slice(0, wildcardIndex).length, source.length - aliasPattern.slice(wildcardIndex + 1).length)
            : '';

          for (const target of targets) {
            const replaced = wildcardIndex >= 0 ? target.replace('*', wildcardValue) : target;
            const resolved = tryResolveCandidate(replaced, baseDir);
            if (resolved) return resolved;
          }
        }
      }
    } catch (error) {
      console.warn(`[ParserEngine] Alias resolution fallback for ${source} from ${currentFilePath}:`, error);
    }

    return null;
  }

  private extractApiRoutes(content: string, filePath: string): import('../types').ApiRoute[] {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.py' || ext === '.go') {
      return RegexExtractor.extractRoutes(content, filePath) as any;
    }

    if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) return [];

    const cleanContent = this.stripComments(content, filePath);
    let ast: any;
    try {
      ast = parse(cleanContent, { sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy'] });
    } catch {
      return [];
    }

    const routes: import('../types').ApiRoute[] = [];
    traverse(ast, {
      CallExpression: (pathNode: any) => {
        const callee = pathNode.node.callee;
        if (
          callee?.type === 'MemberExpression' &&
          callee.object?.type === 'Identifier' &&
          (callee.object.name === 'app' || callee.object.name === 'router') &&
          callee.property?.type === 'Identifier'
        ) {
          const method = callee.property.name.toUpperCase();
          if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) return;
          const firstArg = pathNode.node.arguments?.[0];
          const resolved = this.resolveStaticStringExpression(firstArg, pathNode.scope);
          if (resolved) {
            routes.push({ method, path: resolved, filePath });
          }
        }
      }
    });

    return routes;
  }

  private extractApiCalls(content: string, filePath: string): import('../types').ApiCall[] {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.py' || ext === '.go') {
      return RegexExtractor.extractCalls(content, filePath) as any;
    }

    const isBackendFile = (filePath.endsWith('.js') || filePath.endsWith('.ts')) &&
      !filePath.endsWith('.tsx') && !filePath.endsWith('.jsx');

    const cleanContent = this.stripComments(content, filePath);
    let ast: any;
    try {
      ast = parse(cleanContent, { sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy'] });
    } catch {
      return [];
    }

    const calls: import('../types').ApiCall[] = [];
    traverse(ast, {
      CallExpression: (pathNode: any) => {
        const callee = pathNode.node.callee;

        const isFetch =
          callee?.type === 'Identifier' && callee.name === 'fetch';
        const isAxiosMethod =
          callee?.type === 'MemberExpression' &&
          callee.object?.type === 'Identifier' &&
          callee.object.name === 'axios' &&
          callee.property?.type === 'Identifier' &&
          ['get', 'post', 'put', 'delete', 'patch'].includes(callee.property.name);

        if (!isFetch && !isAxiosMethod) return;

        const firstArg = pathNode.node.arguments?.[0];
        const resolved = this.resolveStaticStringExpression(firstArg, pathNode.scope);
        if (resolved) {
          calls.push({ method: 'ANY', url: resolved, filePath });
        } else {
          calls.push({ method: 'ANY', url: 'DynamicRoute', filePath });
        }
      }
    });

    return calls;
  }

  private extractImports(ast: any): ImportNode[] {
    const imports: ImportNode[] = [];
    traverse(ast, {
      ImportDeclaration(path: any) {
        if (path.node.source && path.node.source.value) {
          imports.push({ source: path.node.source.value, resolvedPath: null });
        }
      },
      ExportNamedDeclaration(path: any) {
        if (path.node.source && path.node.source.value) {
          imports.push({ source: path.node.source.value, resolvedPath: null });
        }
      },
      ExportAllDeclaration(path: any) {
        if (path.node.source && path.node.source.value) {
          imports.push({ source: path.node.source.value, resolvedPath: null });
        }
      },
      CallExpression(path: any) {
        if (
          path.node.callee &&
          path.node.callee.type === 'Identifier' &&
          path.node.callee.name === 'require' &&
          path.node.arguments &&
          path.node.arguments.length > 0 &&
          path.node.arguments[0].type === 'StringLiteral'
        ) {
          imports.push({ source: path.node.arguments[0].value, resolvedPath: null });
        }
      }
    });
    return imports;
  }

  private resolveImportPath(source: string, currentFilePath: string): string | null {
    try {
      if (!source.startsWith('.')) {
        const aliasResolved = this.resolveAliasImport(source, currentFilePath);
        if (aliasResolved) {
          return aliasResolved;
        }
        return null;
      }

      const currentDir = path.dirname(currentFilePath);
      const targetPath = path.resolve(currentDir, source);

      const extensions = ['.ts', '.tsx', '.js', '.jsx'];

      for (const ext of ['', ...extensions]) {
        const checkPath = targetPath + ext;
        try {
          if (fs.existsSync(checkPath) && fs.statSync(checkPath).isFile()) {
            return checkPath;
          }
        } catch {
          continue;
        }
      }

      try {
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
          for (const ext of extensions) {
            const indexFile = path.join(targetPath, `index${ext}`);
            try {
              if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
                return indexFile;
              }
            } catch {
              continue;
            }
          }
        }
      } catch {
        return null;
      }

      return null;
    } catch (error) {
      console.warn(`[ParserEngine] Safe import resolution fallback for ${source} in ${currentFilePath}:`, error);
      return null;
    }
  }
}
