import { describe, expect, test } from 'bun:test';

import {
  assertChecksum,
  parseChecksum,
  parseVersion,
  RELEASE_HOSTS,
  releaseUrl,
  sha256Of,
} from '../droid-release.ts';

const DIGEST = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('releaseUrl', () => {
  test('maps macOS on Apple silicon to the darwin/arm64 build', () => {
    expect(releaseUrl('0.228.0', 'darwin-arm64')).toBe(
      'https://downloads.factory.ai/factory-cli/releases/0.228.0/darwin/arm64/droid',
    );
  });

  test('maps Linux on x64 to the linux/x64 build', () => {
    expect(releaseUrl('0.228.0', 'linux-x64')).toBe(
      'https://downloads.factory.ai/factory-cli/releases/0.228.0/linux/x64/droid',
    );
  });

  test('refuses a host Factory has no build for here', () => {
    expect(() => releaseUrl('0.228.0', 'linux-arm64')).toThrow('no Droid build for linux-arm64');
    expect(() => releaseUrl('0.228.0', 'darwin-x64')).toThrow('no Droid build for darwin-x64');
  });
});

describe('RELEASE_HOSTS', () => {
  test('lists exactly the hosts releaseUrl has a build for', () => {
    expect([...RELEASE_HOSTS]).toEqual(['darwin-arm64', 'linux-x64']);
    for (const host of RELEASE_HOSTS) {
      expect(() => releaseUrl('0.228.0', host)).not.toThrow();
    }
  });
});

describe('parseVersion', () => {
  test('reads the release LATEST names, dropping its trailing newline', () => {
    expect(parseVersion('0.232.0\n')).toBe('0.232.0');
  });

  test('refuses a body that is not a release version, such as an error page', () => {
    expect(() => parseVersion('<Error>AccessDenied</Error>')).toThrow('not a Droid version');
    expect(() => parseVersion('')).toThrow('not a Droid version');
    expect(() => parseVersion('0.232')).toThrow('not a Droid version');
    expect(() => parseVersion('../0.232.0')).toThrow('not a Droid version');
  });
});

describe('sha256Of', () => {
  test('hashes bytes to the lowercase hex digest the checksum file carries', () => {
    expect(sha256Of(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('parseChecksum', () => {
  test('drops the trailing newline the checksum file ends with', () => {
    expect(parseChecksum(`${DIGEST}\n`)).toBe(DIGEST);
  });

  test('lowercases an uppercase digest so it compares with the hasher output', () => {
    expect(parseChecksum(DIGEST.toUpperCase())).toBe(DIGEST);
  });

  test('refuses a body that is not a sha256 digest, such as an error page', () => {
    expect(() => parseChecksum('<Error>AccessDenied</Error>')).toThrow(
      'checksum file is not a sha256 hex digest',
    );
    expect(() => parseChecksum('')).toThrow('checksum file is not a sha256 hex digest');
    expect(() => parseChecksum(DIGEST.slice(1))).toThrow(
      'checksum file is not a sha256 hex digest',
    );
  });
});

describe('assertChecksum', () => {
  test('accepts a digest that matches the checksum file', () => {
    expect(() => {
      assertChecksum(DIGEST, `${DIGEST}\n`);
    }).not.toThrow();
  });

  test('names both digests when they differ', () => {
    const other = 'f'.repeat(64);

    expect(() => {
      assertChecksum(other, `${DIGEST}\n`);
    }).toThrow(`downloaded Droid has sha256 ${other}, expected ${DIGEST}`);
  });
});
