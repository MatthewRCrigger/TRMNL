/** Session rail — expanded (208px) and collapsed (54px), with live telemetry. */

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

import { useStore } from '../state/store'

interface Telemetry {
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

const SPARK_BARS = 30

export function Rail() {
  const railOpen = useStore((s) => s.railOpen)
  const setRailOpen = useStore((s) => s.setRailOpen)
  const panes = useStore((s) => s.panes)
  const sessions = useStore((s) => s.sessions)
  const focus = useStore((s) => s.focus)
  const activateSession = useStore((s) => s.activateSession)
  const openSettings = useStore((s) => s.openSettings)

  const ids = panes[focus].sessions
  const activeIdx = panes[focus].active

  const local = ids.filter((id) => sessions[id]?.host === 'local')
  const remote = ids.filter((id) => sessions[id]?.host !== 'local')

  const telemetry = useTelemetry()
  const clock = useClock()

  if (!railOpen) {
    return (
      <aside className="rail rail--collapsed">
        <div className="rail__tiles">
          {ids.map((id, i) => {
            const session = sessions[id]
            if (!session) return null
            return (
              <button
                className="rail__tile"
                data-active={i === activeIdx}
                key={id}
                onClick={() => activateSession(focus, i)}
                title={session.name}
                type="button"
              >
                {session.name.slice(0, 2).toUpperCase()}
                <span
                  className="rail__tiledot"
                  style={{ background: session.host === 'local' ? 'var(--ac)' : 'var(--warn)' }}
                />
              </button>
            )
          })}
          <button
            className="rail__tile rail__tile--new"
            onClick={() => openSettings('profiles')}
            title="New session"
            type="button"
          >
            +
          </button>
        </div>

        <div className="rail__footc">
          <span className="rail__footcpu">{Math.round(telemetry?.cpu ?? 0)}%</span>
          <span className="rail__footmem">
            {telemetry ? `${formatGb(telemetry.memUsed)}/${formatGb(telemetry.memTotal)}G` : '—'}
          </span>
        </div>

        <button className="rail__toggle" onClick={() => setRailOpen(true)} type="button">
          ›
        </button>
      </aside>
    )
  }

  return (
    <aside className="rail">
      <div className="rail__list">
        {local.length > 0 && <div className="rail__group micro">LOCAL</div>}
        {local.map((id) => (
          <SessionRow
            key={id}
            id={id}
            index={ids.indexOf(id)}
            active={ids.indexOf(id) === activeIdx}
          />
        ))}

        {remote.length > 0 && <div className="rail__group micro">REMOTE</div>}
        {remote.map((id) => (
          <SessionRow
            key={id}
            id={id}
            index={ids.indexOf(id)}
            active={ids.indexOf(id) === activeIdx}
          />
        ))}

        <button className="rail__new" onClick={() => openSettings('profiles')} type="button">
          + NEW SESSION
        </button>
      </div>

      {/* Every value sits in a fixed grid cell and is right-aligned with tabular
          numerals, so nothing reflows as numbers change width — `9%` and `27%`
          occupy the same space. Values are padded to their widest form rather
          than sized to their current content. */}
      <div className="rail__foot">
        <Sparkline values={telemetry?.cores ?? []} />

        <div className="rail__stats">
          <Stat label="CPU" value={formatPct(telemetry?.cpu)} bar={telemetry?.cpu} />
          <Stat
            label="MEM"
            value={telemetry ? `${formatGb(telemetry.memUsed)}/${formatGb(telemetry.memTotal)}G` : '—'}
            bar={telemetry?.memPercent}
          />
          <Stat label="LOAD" value={formatLoad(telemetry?.load)} />
          {/* Free space is the actionable number; the full used/total pair is
              too wide for a 208px rail and reads worse at 10px. */}
          <Stat
            label="DISK"
            value={
              telemetry && telemetry.diskTotal > 0
                ? `${formatGb(telemetry.diskTotal - telemetry.diskUsed)}G free`
                : '—'
            }
            bar={
              telemetry && telemetry.diskTotal > 0
                ? (telemetry.diskUsed / telemetry.diskTotal) * 100
                : undefined
            }
          />
        </div>

        <div className="rail__net">
          <span className="rail__netpair">
            <span className="rail__netarrow">↓</span>
            <span className="rail__netval">{formatRate(telemetry?.netDown ?? 0)}</span>
          </span>
          <span className="rail__netpair">
            <span className="rail__netarrow">↑</span>
            <span className="rail__netval">{formatRate(telemetry?.netUp ?? 0)}</span>
          </span>
          <span className="rail__clock">{clock}</span>
        </div>
      </div>

      <button className="rail__toggle" onClick={() => setRailOpen(false)} type="button">
        ‹ COLLAPSE RAIL
      </button>
    </aside>
  )
}

function SessionRow({ id, index, active }: { id: string; index: number; active: boolean }) {
  const session = useStore((s) => s.sessions[id])
  const focus = useStore((s) => s.focus)
  const activateSession = useStore((s) => s.activateSession)
  const closeSession = useStore((s) => s.closeSession)

  if (!session) return null
  const count = session.blocks.length

  return (
    // A row is a div rather than a button so the close control can nest inside it
    // without an invalid button-in-button.
    <div
      className="rail__row"
      data-active={active}
      onClick={() => activateSession(focus, index)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          activateSession(focus, index)
        }
      }}
      role="tab"
      aria-selected={active}
      tabIndex={0}
    >
      <span
        className="dot"
        style={{ color: session.host === 'local' ? 'var(--ac)' : 'var(--warn)' }}
      />
      <span className="rail__name">{session.name}</span>

      {/* The badge and the close control share one cell so swapping between them
          on hover cannot change the row's width. */}
      <span className="rail__trail">
        <span className="rail__badge">
          {count > 0 ? (
            <>
              <span className="rail__count">{count}</span>↵
            </>
          ) : (
            '—'
          )}
        </span>
        <button
          className="rail__close"
          onClick={(e) => {
            // Otherwise the row's own click would re-activate what we just closed.
            e.stopPropagation()
            void closeSession(id)
          }}
          title={`Close ${session.name}`}
          aria-label={`Close ${session.name}`}
          type="button"
        >
          ✕
        </button>
      </span>
    </div>
  )
}

/**
 * One metric: label and right-aligned value on a row, utilisation bar beneath.
 *
 * The label column is a fixed width and the value is right-aligned against the
 * rail's inner edge, so a value growing from `9%` to `100%` never moves the
 * label — and the bar spans the full width regardless of either.
 */
function Stat({ label, value, bar }: { label: string; value: string; bar?: number }) {
  return (
    <div className="rail__stat">
      <span className="rail__slabel">{label}</span>
      <span className="rail__sbar" aria-hidden>
        {bar !== undefined && (
          <span
            className="rail__sfill"
            style={{
              width: `${Math.min(100, Math.max(0, bar))}%`,
              // Utilisation reads as caution past 80%, which is the point at
              // which it is worth noticing.
              background: bar >= 80 ? 'var(--warn)' : 'var(--ac)',
            }}
          />
        )}
      </span>
      <span className="rail__sval">{value}</span>
    </div>
  )
}

/** 30 bars; the last 6 at full accent, the rest washed back. */
function Sparkline({ values }: { values: number[] }) {
  const bars = Array.from({ length: SPARK_BARS }, (_, i) => {
    if (values.length === 0) return 0
    // Sample the core list across the bar count so the shape reflects real load.
    const idx = Math.floor((i / SPARK_BARS) * values.length)
    return values[idx] ?? 0
  })

  return (
    <div className="spark" aria-hidden>
      {bars.map((v, i) => (
        <span
          className="spark__bar"
          key={i}
          style={{
            height: `${Math.max(6, Math.min(100, v))}%`,
            background:
              i >= SPARK_BARS - 6
                ? 'var(--ac)'
                : 'color-mix(in oklch, var(--ac) 34%, transparent)',
          }}
        />
      ))}
    </div>
  )
}

function useTelemetry(): Telemetry | null {
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
function useClock(): string {
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
