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
            {telemetry ? `${gb(telemetry.memUsed)}/${gb(telemetry.memTotal)}G` : '—'}
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

      <div className="rail__foot">
        <Sparkline values={telemetry?.cores ?? []} />
        <div className="rail__meters">
          <span>
            <span className="rail__mlabel">CPU</span>{' '}
            <span className="rail__mval">{Math.round(telemetry?.cpu ?? 0)}%</span>
          </span>
          <span>
            <span className="rail__mlabel">MEM</span>{' '}
            <span className="rail__mval">
              {telemetry ? `${gb(telemetry.memUsed)}/${gb(telemetry.memTotal)}G` : '—'}
            </span>
          </span>
        </div>
        <div className="rail__net">
          ↓{rate(telemetry?.netDown ?? 0)} ↑{rate(telemetry?.netUp ?? 0)} ·{' '}
          {new Date().toTimeString().slice(0, 8)}
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

  if (!session) return null
  const count = session.blocks.length

  return (
    <button
      className="rail__row"
      data-active={active}
      onClick={() => activateSession(focus, index)}
      type="button"
    >
      <span
        className="dot"
        style={{ color: session.host === 'local' ? 'var(--ac)' : 'var(--warn)' }}
      />
      <span className="rail__name">{session.name}</span>
      <span className="rail__badge">
        {count > 0 ? (
          <>
            <span className="rail__count">{count}</span>↵
          </>
        ) : (
          '—'
        )}
      </span>
    </button>
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

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1)
}

function rate(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 ** 2) return `${(bytesPerSec / 1024 ** 2).toFixed(1)}MB/s`
  if (bytesPerSec >= 1024) return `${Math.round(bytesPerSec / 1024)}KB/s`
  return `${Math.round(bytesPerSec)}B/s`
}
