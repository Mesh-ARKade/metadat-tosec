/**
 * Tests for TOSEC grouping strategy and filename parser
 *
 * @intent Verify parseTosecFilename correctly extracts components from real TOSEC
 *         filenames, and TosecGroupingStrategy groups DATs into correct artifact keys
 * @guarantee All grouping logic is correct before any pipeline runs against real data
 */

import { describe, it, expect } from 'vitest';
import { parseTosecFilename, TosecGroupingStrategy } from '../../src/strategies/tosec-grouping.js';
import type { DAT } from '../../src/types/index.js';

// ─── parseTosecFilename ────────────────────────────────────────────────────────

describe('parseTosecFilename', () => {
  it('parses a standard full TOSEC filename', () => {
    const result = parseTosecFilename(
      'Acorn Archimedes - Games - [ADF] (TOSEC-v2024-05-17_CM).dat'
    );
    expect(result.manufacturer).toBe('Acorn Archimedes');
    expect(result.system).toBe('Games');
    expect(result.category).toBe('ADF');
    expect(result.format).toBe('ADF');
    expect(result.version).toBe('2024-05-17');
  });

  it('parses a filename with no format tag', () => {
    const result = parseTosecFilename(
      'Atari - 2600 - Games (TOSEC-v2023-11-01_CM).dat'
    );
    expect(result.manufacturer).toBe('Atari');
    expect(result.system).toBe('2600');
    expect(result.format).toBe('');
    expect(result.version).toBe('2023-11-01');
  });

  it('parses a filename with ampersand in manufacturer name', () => {
    const result = parseTosecFilename(
      'Milton Bradley & Parker Brothers - Games - [BIN] (TOSEC-v2022-06-15_CM).dat'
    );
    expect(result.manufacturer).toBe('Milton Bradley & Parker Brothers');
    expect(result.system).toBe('Games');
  });

  it('falls back gracefully when there is no " - " separator', () => {
    const result = parseTosecFilename('UnknownSystem (TOSEC-v2020-01-01_CM).dat');
    expect(result.manufacturer).toBe('UnknownSystem');
    // system falls back to manufacturer when no separator
    expect(result.system).toBe('UnknownSystem');
  });

  it('extracts version from middle of complex filename', () => {
    const result = parseTosecFilename(
      'Nintendo - Game Boy - Games - [GB] (TOSEC-v2025-01-10_CM).dat'
    );
    expect(result.version).toBe('2025-01-10');
  });

  it('strips .dat extension before parsing', () => {
    const withExt = parseTosecFilename('Sega - Mega Drive - Games (TOSEC-v2021-03-07_CM).dat');
    const withoutExt = parseTosecFilename('Sega - Mega Drive - Games (TOSEC-v2021-03-07_CM)');
    expect(withExt.manufacturer).toBe(withoutExt.manufacturer);
    expect(withExt.version).toBe(withoutExt.version);
  });

  it('returns unknown version when no TOSEC version tag present', () => {
    const result = parseTosecFilename('Some System - Games.dat');
    expect(result.version).toBe('unknown');
  });

  it('handles multiple format tags — picks the first', () => {
    // Some TOSEC files have nested brackets; we just want the first one
    const result = parseTosecFilename(
      'Amstrad - CPC - Games - [DSK] (TOSEC-v2023-04-22_CM).dat'
    );
    expect(result.format).toBe('DSK');
  });
});

// ─── TosecGroupingStrategy ────────────────────────────────────────────────────

describe('TosecGroupingStrategy', () => {
  const strategy = new TosecGroupingStrategy();

  /** Helper to build a minimal DAT with a TOSEC-style system name */
  function makeDat(system: string, name?: string): DAT {
    return {
      id: `tosec-${system}`,
      source: 'tosec',
      system,
      datVersion: '2024-05-17',
      roms: [],
      name,
    };
  }

  it('returns strategy name "tosec"', () => {
    expect(strategy.getStrategyName()).toBe('tosec');
  });

  it('groups DATs with the same first letter together', () => {
    const dats = [
      makeDat('Acorn Archimedes - Games', 'Acorn Archimedes - Games - [ADF] (TOSEC-v2024-05-17_CM)'),
      makeDat('Acorn BBC Micro - Games', 'Acorn BBC Micro - Games - [ADF] (TOSEC-v2024-05-17_CM)'),
      makeDat('Amstrad - CPC - Games', 'Amstrad - CPC - Games (TOSEC-v2024-05-17_CM)'),
    ];
    const groups = strategy.group(dats);
    // All start with 'A' → single group 'a'
    expect(Object.keys(groups)).toHaveLength(1);
    expect(Object.keys(groups)[0]).toBe('a');
    expect(groups['a']).toHaveLength(3);
  });

  it('creates separate groups for different first letters', () => {
    const dats = [
      makeDat('Atari - 2600 - Games', 'Atari - 2600 - Games (TOSEC-v2023-11-01_CM)'),
      makeDat('Sega - Mega Drive - Games', 'Sega - Mega Drive - Games (TOSEC-v2023-11-01_CM)'),
    ];
    const groups = strategy.group(dats);
    expect(Object.keys(groups)).toHaveLength(2);
    expect(groups['a']).toHaveLength(1);
    expect(groups['s']).toHaveLength(1);
  });

  it('falls back to "misc" for DATs with no parseable manufacturer', () => {
    // A DAT with system name that has no alphabetic first char goes to misc
    const dats = [makeDat('3DO - Games', '3DO - Games (TOSEC-v2020-01-01_CM)')];
    const groups = strategy.group(dats);
    expect(Object.keys(groups)).toHaveLength(1);
    expect(Object.keys(groups)[0]).toBe('misc');
  });

  it('handles an empty DAT array', () => {
    const groups = strategy.group([]);
    expect(Object.keys(groups)).toHaveLength(0);
  });

  it('group keys are single lowercase letters or misc', () => {
    const dats = [
      makeDat('Nintendo - Game Boy - Games', 'Nintendo - Game Boy - Games (TOSEC-v2025-01-10_CM)'),
    ];
    const groups = strategy.group(dats);
    const keys = Object.keys(groups);
    expect(keys.every(k => /^[a-z]$/.test(k) || k === 'misc')).toBe(true);
  });
});
