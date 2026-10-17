export interface AIRoute {
  dx: number;
  dy: number;
  dz: number;
  fbSpin: number;
  powerFactor: number;
  priority: number;
}

export interface CachedRoute extends AIRoute {
  pkIndex: number;
  ballBIndex: number;
}

// PCOL L2497-2535
export class RouteCache {
  private readonly routes: CachedRoute[] = Array.from({ length: 20 }, () => RouteCache.makeRoute());
  length = 0;

  getAtIndex(index: number): CachedRoute { return this.routes[index]; }

  next(dx: number, dy: number, dz: number, fbSpin: number, powerFactor: number, priority: number): CachedRoute {
    let route = this.routes[this.length++];
    if (!route) {
      route = RouteCache.makeRoute();
      this.routes.push(route);
    }
    Object.assign(route, { pkIndex: -1, ballBIndex: -1, dx, dy, dz, fbSpin, powerFactor, priority });
    return route;
  }

  clear(): void { this.length = 0; }

  private static makeRoute(): CachedRoute {
    return { pkIndex: -1, ballBIndex: -1, dx: 0, dy: 0, dz: 0, fbSpin: 0, powerFactor: 0, priority: 0 };
  }
}

export const sharedRouteCache = new RouteCache();
