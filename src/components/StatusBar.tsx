/** Full-width telemetry strip along the bottom of the frame.
 *
 * Was a vertical rail footer; moving it here after the rail's removal gave it
 * back the horizontal room to show everything that footer did, just laid out
 * as one row of label/value pairs instead of stacked stat blocks.
 */

import { formatGb, formatLoad, formatPct, formatRate, useClock, useTelemetry } from '../lib/telemetry'

export function StatusBar() {
  const telemetry = useTelemetry()
  const clock = useClock()

  return (
    <div className="statusbar" aria-hidden>
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
            ? `${formatGb(telemetry.diskTotal - telemetry.diskUsed)}G free`
            : '—'
        }
      />
      <span className="statusbar__net">
        <span className="statusbar__netarrow">↓</span>
        <span className="statusbar__netval">{formatRate(telemetry?.netDown ?? 0)}</span>
        <span className="statusbar__netarrow">↑</span>
        <span className="statusbar__netval">{formatRate(telemetry?.netUp ?? 0)}</span>
      </span>

      <span className="statusbar__clock">{clock}</span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="statusbar__stat">
      <span className="statusbar__label">{label}</span>
      <span className="statusbar__value">{value}</span>
    </span>
  )
}
