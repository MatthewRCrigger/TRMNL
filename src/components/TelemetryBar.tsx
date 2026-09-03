/** The bottom telemetry strip — a GRID StatusBar.
 *
 * Left segment carries the machine's vitals, centre names the session, right is
 * the clock, with dash fill eating the space between.
 *
 * The short rate form (`1.2M`, `340K`) is kept deliberately: the fixed-width
 * cells are what stop the clock drifting sideways as the rates tick, and a
 * full-precision number would resize its cell every second.
 */

import { formatGb, formatLoad, formatPct, formatRate, useClock, useTelemetry } from '../lib/telemetry'
import { useStore } from '../state/store'
import { StatusBar } from './grid'

export function TelemetryBar() {
  const telemetry = useTelemetry()
  const clock = useClock()

  // The focused pane's position in its own strip — "which of this pane's
  // sessions am I in", which is what the number means to the person reading it.
  const sessionNo = useStore((s) => s.panes[s.focus].active + 1)

  return (
    <StatusBar
      tone="accent"
      left={
        <>
          <Stat label="CPU" value={formatPct(telemetry?.cpu)} />
          <Stat
            label="MEM"
            value={telemetry ? `${formatGb(telemetry.memUsed)}/${formatGb(telemetry.memTotal)}G` : '—'}
          />
          <Stat label="LOAD" value={formatLoad(telemetry?.load)} />
          <Stat
            label="DISK"
            value={
              telemetry && telemetry.diskTotal > 0
                ? `${formatGb(telemetry.diskTotal - telemetry.diskUsed)}G`
                : '—'
            }
          />
          <Stat label="NET" value={`↓${formatRate(telemetry?.netDown ?? 0)} ↑${formatRate(telemetry?.netUp ?? 0)}`} />
        </>
      }
      center={`SESSION ${String(sessionNo).padStart(2, '0')}`}
      right={clock}
    />
  )
}

/** A label/value pair. Numbers are always real and always qualified. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="telemetry__stat">
      <span className="telemetry__label">{label}</span>
      <span className="telemetry__value">{value}</span>
    </span>
  )
}
