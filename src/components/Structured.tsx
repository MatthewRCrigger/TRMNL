/** Structured output renderers — the UI half.
 *
 * Parsing lives in term/renderers.ts and is unchanged; the governing rule there
 * stays *parse, never fabricate* — an ambiguous shape returns null and falls
 * back to plain text. This module only draws what was parsed.
 *
 * Each renderer composes GRID components rather than styling its own markup, so
 * a route table and a directory listing are the same Table with different
 * columns instead of two hand-built grids that drift apart.
 */

import { openUrl } from '@tauri-apps/plugin-opener'

import type { Structured as StructuredData } from '../term/types'
import { Alert, Button, Icon, KeyCap, PanelWell, Table, type TableColumn } from './grid'

interface Props {
  data: StructuredData
  onRun: (cmd: string) => void
}

export function Structured({ data, onRun }: Props) {
  switch (data.kind) {
    case 'build':
      return <BuildTable data={data} />
    case 'git':
      return <GitStatus data={data} onRun={onRun} />
    case 'serve':
      return <ServeCard data={data} />
    case 'err':
      return <ErrorOutput data={data} onRun={onRun} />
    case 'list':
      return <ListTable data={data} onRun={onRun} />
    case 'test':
      return <TestSummary data={data} />
  }
}

/* --- build ---------------------------------------------------------------
 * A summary line with a green check, then the route table. An over-budget
 * first load is the ONLY amber cell in the renderer — amber here means "look at
 * this number", and a second amber cell would spend that.
 */

function BuildTable({ data }: { data: Extract<StructuredData, { kind: 'build' }> }) {
  type Route = (typeof data.routes)[number]

  const columns: readonly TableColumn<Route>[] = [
    {
      key: 'route',
      label: 'ROUTE',
      render: (route) => (
        <span className="sx-route">
          {/* ○ static / ƒ dynamic are characters in the real build output, not
              icons we chose — they stay as type. */}
          <span className="sx-marker">{route.marker === 'dynamic' ? 'ƒ' : '○'}</span>
          {route.path}
        </span>
      ),
    },
    { key: 'size', label: 'SIZE', align: 'right', render: (route) => route.size },
    {
      key: 'load',
      label: 'FIRST LOAD',
      align: 'right',
      render: (route) => (
        <span style={route.overBudget ? { color: 'var(--signal-amber)' } : undefined}>
          {route.firstLoad}
        </span>
      ),
    },
  ]

  return (
    <div className="sx">
      {data.summary && (
        <div className="sx__summary">
          <span className="sx__ok">
            <Icon name="check" size={14} />
          </span>
          {data.summary}
        </div>
      )}

      <Table columns={columns} rows={data.routes} rowKey={(route) => route.path} />

      <div className="sx__foot">
        {data.sharedChunks && <>shared chunks {data.sharedChunks} · </>}○ static · ƒ dynamic
      </div>
    </div>
  )
}

/* --- list ---------------------------------------------------------------- */

const MARKERS: Record<string, string> = {
  dir: '▸',
  file: '○',
  link: '↗',
  exec: '▪',
}

function ListTable({
  data,
  onRun,
}: {
  data: Extract<StructuredData, { kind: 'list' }>
  onRun: (cmd: string) => void
}) {
  type Entry = (typeof data.entries)[number]

  const dirs = data.entries.filter((e) => e.kind === 'dir').length
  const files = data.entries.length - dirs

  const columns: readonly TableColumn<Entry>[] = [
    {
      key: 'name',
      label: 'NAME',
      render: (entry) => (
        <span className="sx-route" data-hidden={entry.hidden || undefined}>
          <span className="sx-marker">{MARKERS[entry.kind]}</span>
          {/* Directories stay clickable: the obvious next action on a listing
              is to go into one. */}
          {entry.kind === 'dir' ? (
            <button
              className="sx-list__link"
              onClick={() => onRun(`cd ${quote(entry.name)}`)}
              title={`cd ${entry.name}`}
              type="button"
            >
              {entry.name}
            </button>
          ) : (
            <span>{entry.name}</span>
          )}
          {entry.target && <span className="sx-list__target">→ {entry.target}</span>}
        </span>
      ),
    },
    { key: 'owner', label: 'OWNER', tone: 'meta', render: (entry) => entry.owner },
    { key: 'size', label: 'SIZE', align: 'right', render: (entry) => entry.size },
    { key: 'modified', label: 'MODIFIED', tone: 'meta', align: 'right', render: (entry) => entry.modified },
  ]

  return (
    <div className="sx">
      <Table columns={columns} rows={data.entries} rowKey={(entry) => entry.name} zebra />
      <div className="sx__foot">
        {dirs} {dirs === 1 ? 'directory' : 'directories'} · {files}{' '}
        {files === 1 ? 'file' : 'files'} · ▸ dir · ○ file · ↗ link · ▪ exec
      </div>
    </div>
  )
}

/** Shell-quote a name only when it needs it. */
function quote(name: string): string {
  return /[\s'"$`\\!*?()[\]{}|;&<>]/.test(name) ? `'${name.replace(/'/g, `'\\''`)}'` : name
}

/* --- git -----------------------------------------------------------------
 * Groups labelled in their own signal, files as rows carrying a 2px left edge
 * in the group colour — the edge is what ties a run of paths to the label above
 * them without indenting them into ambiguity.
 */

function GitStatus({
  data,
  onRun,
}: {
  data: Extract<StructuredData, { kind: 'git' }>
  onRun: (cmd: string) => void
}) {
  return (
    <div className="sx">
      {data.groups.map((group) => {
        const color = group.tone === 'err' ? 'var(--signal-red)' : 'var(--signal-amber)'
        return (
          <div className="sx-git__group" key={group.label}>
            <div className="sx-git__label" style={{ color }}>
              {group.label}
            </div>
            <div className="sx-git__files">
              {group.files.map((file) => (
                <div
                  className="sx-git__row"
                  style={{ borderLeftColor: color }}
                  key={`${group.label}-${file.path}`}
                >
                  <span className="sx-git__marker" style={{ color }}>
                    {file.marker}
                  </span>
                  <span className="sx-git__path">{file.path}</span>
                  {file.added && <span className="sx-git__add">+{file.added}</span>}
                  {file.removed && <span className="sx-git__del">-{file.removed}</span>}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      <div className="sx-git__actions">
        <Button size="sm" variant="primary" onClick={() => onRun('git add -A')}>
          STAGE ALL
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onRun('git diff')}>
          DIFF
        </Button>
        <span className="leader" />
        {data.branch && (
          <span className="sx-git__branch">
            {/* ⑂ stays as type: no equivalent exists in the 48-icon set. */}⑂ {data.branch}
            {data.ahead ? ` · ${data.ahead}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}

/* --- serve --------------------------------------------------------------- */

function ServeCard({ data }: { data: Extract<StructuredData, { kind: 'serve' }> }) {
  // Opening a URL leaves the app, so it always goes through the OS handler
  // rather than navigating the webview.
  const open = (url: string) => {
    void openUrl(url).catch(() => {})
  }

  return (
    <div className="sx">
      <div className="sx-serve__title">{data.title}</div>

      <PanelWell>
        {data.links.map((link) => (
          <div className="sx-serve__row" key={link.label + link.url}>
            <span className="sx-serve__label">{link.label}</span>
            <span className="sx-serve__url">{link.url}</span>
            <Button size="sm" variant="ghost" tone="live" onClick={() => open(link.url)}>
              OPEN
              <Icon name="external-link" size={12} />
            </Button>
          </div>
        ))}
      </PanelWell>

      {data.hints.length > 0 && (
        <div className="sx-serve__hints">
          {data.hints.map((hint) => (
            <span className="sx-serve__hint" key={hint.key}>
              <KeyCap size="sm">{hint.key}</KeyCap>
              {hint.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* --- test ---------------------------------------------------------------- */

function TestSummary({ data }: { data: Extract<StructuredData, { kind: 'test' }> }) {
  const failed = data.failed > 0

  return (
    <div className="sx">
      <div className="sx-test__stats">
        {data.passed > 0 && (
          <span className="sx-test__stat" style={{ color: 'var(--signal-green)' }}>
            {data.passed} PASSED
          </span>
        )}
        {data.failed > 0 && (
          <span className="sx-test__stat" style={{ color: 'var(--signal-red)' }}>
            {data.failed} FAILED
          </span>
        )}
        {data.skipped > 0 && (
          <span className="sx-test__stat" style={{ color: 'var(--ink-300)' }}>
            {data.skipped} SKIPPED
          </span>
        )}
        <span className="leader" />
        {data.duration && <span className="sx-test__duration">{data.duration}</span>}
      </div>

      {data.failures.length > 0 && (
        // The well goes red when anything failed: the failures are the content,
        // so the container that holds them carries the signal rather than each
        // row repeating it.
        <PanelWell
          tone={failed ? { border: 'var(--signal-red)', fill: 'var(--red-fill)' } : undefined}
        >
          {data.failures.map((failure, i) => (
            <div className="sx-test__row" key={`${failure.name}-${i}`}>
              <span className="sx-test__x">
                <Icon name="x" size={12} />
              </span>
              {failure.suite && <span className="sx-test__suite">{failure.suite} ›</span>}
              <span className="sx-test__name">{failure.name}</span>
            </div>
          ))}
        </PanelWell>
      )}
    </div>
  )
}

/* --- err ----------------------------------------------------------------- */

function ErrorOutput({
  data,
  onRun,
}: {
  data: Extract<StructuredData, { kind: 'err' }>
  onRun: (cmd: string) => void
}) {
  return (
    <div className="sx">
      {/* The title is the app naming the condition — `COMMAND FAILED`, in the
          chrome's uppercase voice. The parsed message is the *shell's* words
          and belongs in the body with the detail, lowercase and in mono.
          Passing it as the title uppercased it into Rajdhani, which put the
          shell's own sentence in the app's voice: `UNKNOWN SCRIPT "TSET"`. */}
      <Alert tone="danger" title="COMMAND FAILED" icon="triangle-alert">
        {data.message}
        {data.detail && (
          <>
            {'\n'}
            {data.detail}
          </>
        )}
      </Alert>

      {data.suggestion && (
        <div className="sx-err__suggest">
          <span className="sx-err__did">DID YOU MEAN</span>
          <span className="leader" />
          {/* Not a Button: it carries the suggested command in mono, which is
              shell truth rather than an imperative uppercase label, so it takes
              the amber-outlined form the handoff specifies instead. */}
          <button
            className="sx-err__chip"
            onClick={() => onRun(data.suggestion!)}
            type="button"
          >
            {data.suggestion}
            <KeyCap size="sm">↵</KeyCap>
          </button>
        </div>
      )}
    </div>
  )
}
