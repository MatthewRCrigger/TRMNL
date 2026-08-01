/** The rail footer updates twice a second, so its formatters must produce
 * constant-width output — otherwise every sample nudges the layout. These test
 * the formatting contract that the fixed-width CSS grid depends on. */

import { describe, expect, it } from 'vitest'

import { formatPct, formatLoad, formatRate, formatGb } from './Rail'

describe('telemetry formatters', () => {
  it('keeps percentages within a predictable width', () => {
    // 0–100% spans at most four characters, which the value column reserves.
    for (const v of [0, 5, 9, 21, 99, 100]) {
      expect(formatPct(v).length).toBeLessThanOrEqual(4)
    }
    expect(formatPct(21)).toBe('21%')
    expect(formatPct(9.6)).toBe('10%')
  })

  it('formats load average to a fixed two decimals', () => {
    // Every load value renders the same width, so the column never reflows.
    const widths = new Set([0.5, 5.43, 12.1, 100].map((v) => formatLoad([v, 0, 0]).length))
    expect(formatLoad([5.43, 1, 1])).toBe('5.43')
    expect(formatLoad([0.5, 1, 1])).toBe('0.50')
    // Only a three-digit load would widen it, which is not a realistic steady state.
    expect(Math.max(...widths)).toBeLessThanOrEqual(6)
  })

  it('caps transfer rates at a constant width', () => {
    // The rate cell is 38px; anything wider than five characters would overflow
    // and drag the clock. Unit is a single letter for exactly this reason.
    for (const v of [0, 999, 1024, 1048576, 1073741824, 9999999999]) {
      expect(formatRate(v).length).toBeLessThanOrEqual(6)
    }
    expect(formatRate(0)).toBe('0B')
    expect(formatRate(11 * 1024)).toBe('11K')
    expect(formatRate(1.5 * 1024 ** 2)).toBe('1.5M')
  })

  it('formats gigabytes to one decimal', () => {
    expect(formatGb(17 * 1024 ** 3)).toBe('17.0')
    expect(formatGb(1024 ** 3)).toBe('1.0')
  })

  it('handles missing telemetry without collapsing the cell', () => {
    // An em dash still occupies the column, so the grid does not jump on the
    // first paint before the first sample lands.
    expect(formatPct(undefined)).toBe('—')
    expect(formatLoad(undefined)).toBe('—')
  })
})
