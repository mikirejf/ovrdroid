import { chmodSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { rm } from 'node:fs/promises';

import { reportedVersion } from './bun.ts';

export const DROID_VERSION = '0.228.0';

const RELEASES_URL = 'https://downloads.factory.ai/factory-cli/releases';
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;

const PLATFORMS = new Map([
  ['darwin-arm64', 'darwin/arm64'],
  ['linux-x64', 'linux/x64'],
]);

export const RELEASE_HOSTS = [...PLATFORMS.keys()];

export function releaseUrl(version: string, host: string): string {
  const platform = PLATFORMS.get(host);
  if (platform === undefined) {
    throw new Error(`no Droid build for ${host}`);
  }
  return `${RELEASES_URL}/${version}/${platform}/droid`;
}

export function sha256Of(bytes: Uint8Array | ArrayBuffer): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

export function parseChecksum(body: string): string {
  const checksum = body.trim().toLowerCase();
  if (!CHECKSUM_PATTERN.test(checksum)) {
    throw new Error(`checksum file is not a sha256 hex digest: ${JSON.stringify(body.trim())}`);
  }
  return checksum;
}

export function assertChecksum(actual: string, checksumBody: string): void {
  const expected = parseChecksum(checksumBody);
  if (actual !== expected) {
    throw new Error(`downloaded Droid has sha256 ${actual}, expected ${expected}`);
  }
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`downloading ${url} failed: ${response.status} ${response.statusText}`);
  }
  return response;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetchOk(url);
  return await response.arrayBuffer();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetchOk(url);
  return await response.text();
}

async function saveVerified(
  url: string,
  destination: string,
  checksumBody: Promise<string>,
): Promise<void> {
  const [binary, checksum] = await Promise.all([fetchBytes(url), checksumBody]);
  assertChecksum(sha256Of(binary), checksum);
  await Bun.write(destination, binary);
  chmodSync(destination, 0o755);
}

export async function downloadStock(
  version: string,
  host: string,
  destination: string,
): Promise<void> {
  const url = releaseUrl(version, host);
  await saveVerified(url, destination, fetchText(`${url}.sha256`));
}

export async function cacheStock(
  version: string,
  host: string,
  destination: string,
): Promise<'cached' | 'downloaded'> {
  const url = releaseUrl(version, host);
  const checksumBody = fetchText(`${url}.sha256`);
  const published = parseChecksum(await checksumBody);
  if (existsSync(destination) && sha256Of(readFileSync(destination)) === published) {
    return 'cached';
  }
  await saveVerified(url, destination, checksumBody);
  return 'downloaded';
}

export async function installStockDroid(target: string): Promise<void> {
  const download = `${target}.download`;
  try {
    await downloadStock(DROID_VERSION, `${process.platform}-${process.arch}`, download);

    const reported = reportedVersion(download);
    if (reported !== DROID_VERSION) {
      throw new Error(
        `downloaded Droid reports ${reported || 'nothing'}, expected ${DROID_VERSION}`,
      );
    }
    renameSync(download, target);
  } finally {
    await rm(download, { force: true });
  }
}
