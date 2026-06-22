import { ApiRoute, ApiCall } from '../types';
import { UrlNormalizer } from './UrlNormalizer';

export interface MatchedContract {
  id: string;
  source: string; // frontend file
  target: string; // backend file
  endpoint: string;
}

export interface BrokenContract {
  id: string;
  source: string;
  endpoint: string;
}

export class ContractMatcher {
  public matchContracts(routes: ApiRoute[], calls: ApiCall[]): { matched: MatchedContract[], broken: BrokenContract[] } {
    const matched: MatchedContract[] = [];
    const broken: BrokenContract[] = [];
    const routeBuckets = this.buildRouteBuckets(routes);

    for (const call of calls) {
      const normalizedCallUrl = UrlNormalizer.normalizePath(call.url);
      const matchingRoute = this.findMatchingRoute(normalizedCallUrl, routes, routeBuckets);

      const contractId = `contract-${call.filePath}-${call.url}`;
      
      if (matchingRoute) {
        matched.push({
          id: `${contractId}-matched`,
          source: call.filePath,
          target: matchingRoute.filePath,
          endpoint: call.url
        });
      } else {
        broken.push({
          id: `${contractId}-broken`,
          source: call.filePath,
          endpoint: call.url
        });
      }
    }

    return { matched, broken };
  }

  private buildRouteBuckets(routes: ApiRoute[]) {
    const buckets = new Map<string, ApiRoute[]>();

    routes.forEach(route => {
      const normalized = UrlNormalizer.normalizePath(route.path);
      const bucketKey = this.routeBucketKey(normalized);
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey)!.push(route);
    });

    return buckets;
  }

  private routeBucketKey(routePath: string) {
    const parts = routePath.split('/').filter(Boolean);
    const prefix = parts.slice(0, 2).join('/');
    return prefix || '*';
  }

  private candidateBucketKeys(normalizedCallUrl: string) {
    const parts = normalizedCallUrl.split('/').filter(Boolean);
    const buckets: string[] = [];

    for (let i = Math.min(parts.length, 2); i >= 0; i--) {
      const prefix = parts.slice(0, i).join('/');
      buckets.push(prefix || '*');
    }

    return buckets;
  }

  private findMatchingRoute(
    normalizedCallUrl: string,
    routes: ApiRoute[],
    routeBuckets: Map<string, ApiRoute[]>
  ) {
    const candidateKeys = this.candidateBucketKeys(normalizedCallUrl);
    const seen = new Set<string>();

    for (const key of candidateKeys) {
      const bucket = routeBuckets.get(key);
      if (!bucket) continue;
      for (const route of bucket) {
        if (seen.has(route.path)) continue;
        seen.add(route.path);
        const regex = UrlNormalizer.patternToRegex(route.path);
        if (regex.test(normalizedCallUrl)) {
          return route;
        }
      }
    }

    // Fallback to full scan for correctness when bucket heuristics miss.
    return routes.find(r => {
      const regex = UrlNormalizer.patternToRegex(r.path);
      return regex.test(normalizedCallUrl);
    });
  }
}
