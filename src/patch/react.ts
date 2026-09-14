import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

import { extract, fetchArchive } from '../download.ts';
import { cacheDir } from '../paths.ts';
import { withTempDir } from '../temp.ts';
import type { Patch } from './patches.ts';

interface Package {
  name: string;
  version: string;
  files: readonly string[];
}

const REACT: Package = {
  name: 'react',
  version: '19.2.3',
  files: ['react.production.js', 'react-jsx-runtime.production.js'],
};
const SCHEDULER: Package = {
  name: 'scheduler',
  version: '0.27.0',
  files: ['scheduler.production.js'],
};
const RECONCILER: Package = {
  name: 'react-reconciler',
  version: '0.33.0',
  files: ['react-reconciler.production.js'],
};

const CACHE_DIR = cacheDir('react');

function cachePath(pkg: Package, file: string): string {
  return path.join(CACHE_DIR, `${pkg.name}-${pkg.version}-${file}`);
}

async function fetchInto(pkg: Package, dir: string): Promise<string[]> {
  const tarball = await fetchArchive(
    `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`,
    dir,
  );
  await extract([
    'tar',
    '-xzf',
    tarball,
    '-C',
    dir,
    ...pkg.files.map((file) => `package/cjs/${file}`),
  ]);

  await mkdir(CACHE_DIR, { recursive: true });
  return await Promise.all(
    pkg.files.map(async (file) => {
      const text = await Bun.file(path.join(dir, 'package', 'cjs', file)).text();
      if (text.length === 0) {
        throw new Error(`${pkg.name}@${pkg.version} ${file} extracted empty`);
      }
      const destination = cachePath(pkg, file);
      const partial = `${destination}.${process.pid}.partial`;
      await Bun.write(partial, text);
      await rename(partial, destination);
      return text;
    }),
  );
}

async function productionSources(pkg: Package): Promise<string[]> {
  const cached = await Promise.all(
    pkg.files.map(
      async (file) =>
        await Bun.file(cachePath(pkg, file))
          .text()
          .catch(() => ''),
    ),
  );
  if (cached.every((text) => text.length > 0)) {
    return cached;
  }
  return await withTempDir(`react-${pkg.name}`, async (dir) => await fetchInto(pkg, dir));
}

function swapRequire(source: string, request: string, expression: string): string {
  const needle = `require("${request}")`;
  const out = source.replaceAll(needle, expression);
  if (out === source) {
    throw new Error(`production build has no ${needle}`);
  }
  return out;
}

export async function reactProductionPatches(): Promise<readonly Patch[]> {
  const [[react = '', jsx = ''], [scheduler = ''], [rawReconciler = '']] = await Promise.all([
    productionSources(REACT),
    productionSources(SCHEDULER),
    productionSources(RECONCILER),
  ]);
  const reconciler = swapRequire(
    swapRequire(rawReconciler, 'react', 'cT(HA())'),
    'scheduler',
    'cT(uHh())',
  );

  return [
    {
      name: 'react-production',
      find: 'var HA=yT((Wnu,X5H)=>{',
      until: 'p(Error())})()});var b7n=yT(',
      replace: `var HA=yT((exports,module)=>{${react}\n});var b7n=yT(`,
    },
    {
      name: 'react-reconciler-production',
      find: 'var uHh=yT((teC)=>{',
      until:
        ',XAH.exports.default=XAH.exports,Object.defineProperty(XAH.exports,"__esModule",{value:!0})});var _eC=(T)=>{',
      replace: `var uHh=yT((exports,module)=>{${scheduler}\n});var Woi=yT((exports,module)=>{${reconciler}\n});var _eC=(T)=>{`,
    },
    {
      name: 'react-jsx-runtime-production',
      find: 'var PR=yT((XYC)=>{',
      until: ',PT?RT(A(GT)):hT)}})()});function SYC(T)',
      replace: `var PR=yT((exports,module)=>{${jsx}\nexports.jsxDEV=exports.jsx;\n});function SYC(T)`,
    },
  ];
}
