#!/usr/bin/env node
/**
 * Regenerates `docs/openapi.json` from the route table in
 * `server/src/public-api-routes.js`:  pnpm run openapi
 * `test/openapi.test.js` fails when the committed file is stale.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCOPES } from '../src/api-keys.js';
import { buildOpenApiSpec } from '../src/public-api-routes.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/openapi.json');
writeFileSync(out, JSON.stringify(buildOpenApiSpec(SCOPES), null, 2) + '\n');
console.log(`Wrote ${out}`);
