import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SCOPES } from '../src/api-keys.js';
import { buildOpenApiSpec, matchRoute, routes } from '../src/public-api-routes.js';

describe('OpenAPI spec', () => {
    it('matches the committed docs/openapi.json (run `pnpm run openapi`)', () => {
        const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/openapi.json');
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(buildOpenApiSpec(SCOPES));
    });

    it('only references registered scopes, resolvable schemas, and routable paths', () => {
        const spec = buildOpenApiSpec(SCOPES);
        for (const route of routes) {
            expect(Object.keys(SCOPES)).toContain(route.scope);
            const sample = route.path.replace('{userId}', 'usr_00000000-0000-0000-0000-000000000001');
            expect(matchRoute(sample, route.method ?? 'GET')?.route).toBe(route);
        }
        for (const [, ref] of JSON.stringify(spec)
            .matchAll(/#\/components\/schemas\/(\w+)/g)
            .map((m) => m)) {
            expect(spec.components.schemas[ref]).toBeDefined();
        }
        expect(new Set(routes.map((r) => r.operationId)).size).toBe(routes.length);
        expect(new Set(routes.map((r) => `${r.method ?? 'GET'} ${r.path}`)).size).toBe(routes.length);
    });
});
