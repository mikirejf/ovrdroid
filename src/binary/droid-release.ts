import { chmodSync, existsSync, readFileSync } from 'node:fs';

import { cacheDir } from '../paths.ts';

const DOWNLOADS_URL = 'https://downloads.factory.ai/factory-cli';
const RELEASES_URL = `${DOWNLOADS_URL}/releases`;
const LATEST_URL = `${DOWNLOADS_URL}/LATEST`;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

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

export function parseVersion(body: string): string {
  const version = body.trim();
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`not a Droid version: ${JSON.stringify(version)}`);
  }
  return version;
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

export async function latestVersion(): Promise<string> {
  return parseVersion(await fetchText(LATEST_URL));
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

export interface CachedStock {
  binary: string;
  outcome: 'cached' | 'downloaded';
}

export async function cacheStock(version: string, host: string): Promise<CachedStock> {
  const binary = cacheDir(`droid-${version}`, host, 'droid');
  const url = releaseUrl(version, host);
  const checksumBody = fetchText(`${url}.sha256`);
  const published = parseChecksum(await checksumBody);
  if (existsSync(binary) && sha256Of(readFileSync(binary)) === published) {
    return { binary, outcome: 'cached' };
  }
  await saveVerified(url, binary, checksumBody);
  return { binary, outcome: 'downloaded' };
}
