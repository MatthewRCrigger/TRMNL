/** System telemetry: sampled from Rust every 2s, plus a 1s wall clock. */

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface Telemetry {
  cpu: number
  memPercent: number
  memUsed: number
  memTotal: number
  netDown: number
  netUp: number
  cores: number[]
  load: number[]
  diskUsed: number
  diskTotal: number
}

export function useTelemetry(): Telemetry | null {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)

  useEffect(() => {
    let cancelled = false
    const sample = () => {
      invoke<Telemetry>('sample_telemetry')
        .then((t) => {
          if (!cancelled) setTelemetry(t)
        })
        .catch(() => {})
    }
    sample()
    const timer = window.setInterval(sample, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return telemetry
}

/** Ticks once a second, independent of the slower telemetry poll. */
export function useClock(): string {
  const [now, setNow] = useState(() => new Date().toTimeString().slice(0, 8))

  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(new Date().toTimeString().slice(0, 8)),
      1000,
    )
    return () => clearInterval(timer)
  }, [])

  return now
}

export function formatGb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1)
}

export function formatPct(value?: number): string {
  if (value === undefined) return '—'
  return `${Math.round(value)}%`
}

/** 1-minute load average, the figure that actually indicates pressure. */
export function formatLoad(values?: number[]): string {
  const one = values?.[0]
  return one === undefined ? '—' : one.toFixed(2)
}

/**
 * Transfer rate at a constant width.
 *
 * Always two significant-ish digits and a fixed unit width, so the string does
 * not jump between `9B/s` and `1.2MB/s` and drag the clock around with it.
 */
export function formatRate(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 ** 3) return `${(bytesPerSec / 1024 ** 3).toFixed(1)}G`
  if (bytesPerSec >= 1024 ** 2) return `${(bytesPerSec / 1024 ** 2).toFixed(1)}M`
  if (bytesPerSec >= 1024) return `${Math.round(bytesPerSec / 1024)}K`
  return `${Math.round(bytesPerSec)}B`
}
