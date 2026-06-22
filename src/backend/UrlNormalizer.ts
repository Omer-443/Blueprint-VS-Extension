export class UrlNormalizer {
  /**
   * Normalizes a URL by removing protocol, domain, query string, and hash.
   * e.g. "http://localhost:3000/api/users/?sort=desc#top" -> "/api/users"
   */
  public static normalizePath(url: string): string {
    try {
      // If it's a full URL, parse it
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const parsed = new URL(url);
        url = parsed.pathname;
      } else {
        // Strip query string and hash manually
        url = url.split('?')[0].split('#')[0];
      }
    } catch {
      // Fallback if URL parsing fails
      url = url.split('?')[0].split('#')[0];
    }

    // Decode URI components
    try {
      url = decodeURIComponent(url);
    } catch {}

    // Ensure leading slash
    if (!url.startsWith('/')) {
      url = '/' + url;
    }

    // Remove trailing slash if present (except for root "/")
    if (url.length > 1 && url.endsWith('/')) {
      url = url.slice(0, -1);
    }

    return url;
  }

  /**
   * Converts an Express/Next.js route pattern with :params to a RegExp
   * e.g. "/api/users/:id" -> "^/api/users/[^/]+$"
   */
  public static patternToRegex(pattern: string): RegExp {
    const normalized = this.normalizePath(pattern);
    
    // Replace :paramName or {paramName} with [^/]+
    const regexStr = normalized
      .replace(/:[a-zA-Z0-9_]+/g, '[^/]+')
      .replace(/\{[a-zA-Z0-9_]+\}/g, '[^/]+')
      .replace(/\*/g, '.*');
      
    return new RegExp(`^${regexStr}$`);
  }
}
