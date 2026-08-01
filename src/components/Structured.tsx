/** Structured output renderers — the UI half.
 *
 * Parsing lives in term/renderers.ts; this only draws what was parsed.
 */

import { openUrl } from '@tauri-apps/plugin-opener'

import type { Structured as StructuredData } from '../term/types'

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
      return <ErrorPanel data={data} onRun={onRun} />
    case 'list':
      return <ListTable data={data} onRun={onRun} />
  }
}

function BuildTable({ data }: { data: Extract<StructuredData, { kind: 'build' }> }) {
  return (
    <div className="sx">
      {data.summary && (
        <div className="sx__summary">
          <span className="sx__ok">✓</span> {data.summary}
        </div>
      )}
      <div className="sx-table">
        <div className="sx-table__head">
          <span className="sx-table__route micro">ROUTE</span>
          <span className="sx-table__size micro">SIZE</span>
          <span className="sx-table__load micro">FIRST LOAD</span>
        </div>
        {data.routes.map((route) => (
          <div className="sx-table__row" key={route.path}>
            <span className="sx-table__route">
              <span className="sx-table__marker">{route.marker === 'dynamic' ? 'ƒ' : '○'}</span>
              {route.path}
            </span>
            <span className="sx-table__size">{route.size}</span>
            <span
              className="sx-table__load"
              style={{ color: route.overBudget ? 'var(--warn)' : 'var(--fg)' }}
            >
              {route.firstLoad}
            </span>
          </div>
        ))}
      </div>
      <div className="sx__foot">
        {data.sharedChunks && <>shared chunks {data.sharedChunks} · </>}○ static · ƒ dynamic
      </div>
    </div>
  )
}

/** Directory listing, on the same hairline grid as the build route table. */
function ListTable({
  data,
  onRun,
}: {
  data: Extract<StructuredData, { kind: 'list' }>
  onRun: (cmd: string) => void
}) {
  const dirs = data.entries.filter((e) => e.kind === 'dir').length
  const files = data.entries.length - dirs

  return (
    <div className="sx">
      <div className="sx-table">
        <div className="sx-table__head">
          <span className="sx-table__route micro">NAME</span>
          <span className="sx-list__owner micro">OWNER</span>
          <span className="sx-table__size micro">SIZE</span>
          <span className="sx-list__mod micro">MODIFIED</span>
        </div>

        {data.entries.map((entry) => (
          <div className="sx-table__row" data-hidden={entry.hidden} key={entry.name}>
            <span className="sx-table__route">
              <span className="sx-table__marker" data-kind={entry.kind}>
                {MARKERS[entry.kind]}
              </span>
              {/* Directories are clickable: the obvious next action on a listing
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
                <span className="sx-list__name">{entry.name}</span>
              )}
              {entry.target && <span className="sx-list__target">→ {entry.target}</span>}
            </span>
            <span className="sx-list__owner">{entry.owner}</span>
            <span className="sx-table__size">{entry.size}</span>
            <span className="sx-list__mod">{entry.modified}</span>
          </div>
        ))}
      </div>

      <div className="sx__foot">
        {dirs} {dirs === 1 ? 'directory' : 'directories'} · {files}{' '}
        {files === 1 ? 'file' : 'files'} · ▸ dir · ○ file · ↗ link · ▪ exec
      </div>
    </div>
  )
}

const MARKERS: Record<string, string> = {
  dir: '▸',
  file: '○',
  link: '↗',
  exec: '▪',
}

/** Shell-quote a name only when it needs it. */
function quote(name: string): string {
  return /[\s'"$`\\!*?()[\]{}|;&<>]/.test(name) ? `'${name.replace(/'/g, `'\\''`)}'` : name
}

function GitStatus({
  data,
  onRun,
}: {
  data: Extract<StructuredData, { kind: 'git' }>
  onRun: (cmd: string) => void
}) {
  return (
    <div className="sx">
      {data.groups.map((group) => (
        <div className="sx-git__group" key={group.label}>
          <div
            className="sx-git__label micro"
            style={{ color: group.tone === 'err' ? 'var(--err)' : 'var(--warn)' }}
          >
            {group.label}
          </div>
          <div className="sx-git__files">
            {group.files.map((file) => (
              <span className="sx-git__chip" key={`${group.label}-${file.path}`}>
                <span
                  className="sx-git__marker"
                  style={{ color: group.tone === 'err' ? 'var(--err)' : 'var(--warn)' }}
                >
                  {file.marker}
                </span>
                {file.path}
                {file.added && <span className="sx-git__add">+{file.added}</span>}
                {file.removed && <span className="sx-git__del">-{file.removed}</span>}
              </span>
            ))}
          </div>
        </div>
      ))}
      <div className="sx-git__actions">
        <button className="sx__btn" onClick={() => onRun('git add -A')} type="button">
          STAGE ALL
        </button>
        <button className="sx__btn sx__btn--ghost" onClick={() => onRun('git diff')} type="button">
          DIFF
        </button>
        {data.branch && (
          <span className="sx-git__branch">
            branch {data.branch}
            {data.ahead ? ` · ${data.ahead}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}

function ServeCard({ data }: { data: Extract<StructuredData, { kind: 'serve' }> }) {
  // Opening a URL leaves the app, so it always goes through the OS handler
  // rather than navigating the webview.
  const open = (url: string) => {
    void openUrl(url).catch(() => {})
  }

  return (
    <div className="sx">
      <div className="sx-serve__title">
        <span className="dot" style={{ color: 'var(--ac)', animation: 'pul 2.4s ease-in-out infinite' }} />
        {data.title}
      </div>
      <div className="sx-serve__card">
        {data.links.map((link) => (
          <div className="sx-serve__row" key={link.label + link.url}>
            <span className="sx-serve__label micro">{link.label}</span>
            <span className="sx-serve__url">{link.url}</span>
            <button className="sx-serve__open" onClick={() => open(link.url)} type="button">
              OPEN ↗
            </button>
          </div>
        ))}
      </div>
      {data.hints.length > 0 && (
        <div className="sx-serve__hints">
          {data.hints.map((hint) => (
            <span key={hint.key}>
              <span className="sx-serve__key">{hint.key}</span> {hint.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ErrorPanel({
  data,
  onRun,
}: {
  data: Extract<StructuredData, { kind: 'err' }>
  onRun: (cmd: string) => void
}) {
  return (
    <div className="sx">
      <div className="sx-err">
        <div className="sx-err__msg">
          <span className="sx-err__x">✕</span> {data.message}
        </div>
        {data.detail && <div className="sx-err__detail">{data.detail}</div>}
      </div>
      {data.suggestion && (
        <div className="sx-err__suggest">
          <span className="micro">DID YOU MEAN</span>
          <button className="sx-err__chip" onClick={() => onRun(data.suggestion!)} type="button">
            {data.suggestion}
            <span className="kbd">↵</span>
          </button>
        </div>
      )}
    </div>
  )
}
