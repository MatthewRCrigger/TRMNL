/** A visual harness for the GRID surfaces.
 *
 * Development-only, and deliberately not reachable from the app: it mounts the
 * real components against fixture data so the panel states, renderers and
 * overlays can be checked in a plain browser, where Tauri's IPC bridge does not
 * exist and the store's `init()` cannot run.
 *
 * It is a rendering check, not a test — behaviour is covered by vitest. What it
 * catches is the class of thing a type checker cannot: a header that reflows, a
 * filled header whose leader disappeared into its own fill, a hairline that
 * vanished against the page.
 */

import { useEffect, useState } from 'react'

import {
  Alert,
  Badge,
  Button,
  Dialog,
  Field,
  Frame,
  Icon,
  IndexCounter,
  KeyCap,
  Pagination,
  Panel,
  PanelWell,
  Prompt,
  Select,
  SideNav,
  StatusBar,
  Stepper,
  Switch,
  Tabs,
  TerminalLine,
  Wordmark,
} from '../components/grid'
import { Block } from '../components/Block'
import { Settings } from '../components/Settings'
import { Structured } from '../components/Structured'
import { useStore } from '../state/store'
import type { Block as BlockModel, Structured as StructuredData } from '../term/types'

const noop = () => {}

export function Harness() {
  // Read the live panel settings, not the frozen defaults: the point of having
  // Settings in here is that changing a toggle visibly redraws the blocks
  // behind it, and a constant would quietly break that.
  const panel = useStore((s) => s.settingsValues.panel)
  const [checked, setChecked] = useState(true)
  const [stepper, setStepper] = useState(4)
  const [dialog, setDialog] = useState(false)
  const [settings, setSettings] = useState(false)
  const [tab, setTab] = useState('stream')
  const [nav, setNav] = useState('panels')

  return (
    <div className="hx">
      <Frame color="var(--line-100)" className="hx__frame">
        <div className="hx__bar">
          <Wordmark size={20} />
          <span className="leader" />
          <Tabs
            items={[
              { id: 'stream', label: 'STREAM' },
              { id: 'history', label: 'HISTORY' },
              { id: 'settings', label: 'SETTINGS' },
            ]}
            active={tab}
            onSelect={setTab}
          />
          <span className="hx__count">SESSIONS · 3</span>
        </div>

        <div className="hx__scroll">
          <Section title="01 — BLOCK STATES">
            {/* The five rows of the block-state table, in order. */}
            <Panel
              heading="SESSION .INIT"
              index={{ current: 0, total: 47 }}
              contentBorder={false}
              headerRight={<Badge tone="success" dot>ATTACHED</Badge>}
            >
              <div className="hx__grid">
                <span className="hx__k">PATH</span>
                <span className="hx__v">~/dev/crggr-ops</span>
                <span className="hx__k">BRANCH</span>
                <span className="hx__v">⑂ main</span>
                <span className="hx__k">DETECTED</span>
                <span className="hx__v">node · npm</span>
                <span className="hx__k">SHELL</span>
                <span className="hx__v">zsh · local</span>
              </div>
            </Panel>

            <Panel
              heading="SHELL .STREAM"
              index={{ current: 12 }}
              headerRight={<Badge tone="success" dot>EXIT 0</Badge>}
            >
              <Prompt
                user="matt"
                host="crggr-08"
                path="~/dev/crggr-ops"
                command="git status --short"
                meta={<><span>240ms</span><span>12:04:11</span></>}
              />
              <PanelWell style={{ marginTop: 12 }}>
                <TerminalLine>nothing to commit, working tree clean</TerminalLine>
              </PanelWell>
            </Panel>

            <Panel
              heading="BUILD .OUTPUT"
              index={{ current: 46 }}
              panelColor="var(--line-100)"
              headerFilled
              headerRight={<Badge tone="neutral">LATEST</Badge>}
            >
              <Prompt
                user="matt"
                host="crggr-08"
                path="~/dev/crggr-ops"
                command="npm run build"
                meta={<><span>12.4s</span><span>12:06:02</span></>}
              />
              <div style={{ marginTop: 12 }}>
                <Structured data={BUILD} onRun={noop} />
              </div>
            </Panel>

            <Panel
              heading="ERROR .OUTPUT"
              index={{ current: 47 }}
              panelColor="var(--signal-red)"
              headerFilled
              headerRight={<Badge tone="danger">EXIT 1</Badge>}
            >
              <Prompt
                user="matt"
                host="crggr-08"
                path="~/dev/crggr-ops"
                command="npm run tset"
                tone="danger"
                meta={<><span>90ms</span><span>12:07:44</span></>}
              />
              <div style={{ marginTop: 12 }}>
                <Structured data={ERR} onRun={noop} />
              </div>
            </Panel>

            <Panel
              heading="SERVE .LIVE"
              index={{ current: 48 }}
              panelColor="var(--signal-cyan)"
              headerRight={<Badge tone="live" dot filled>LIVE</Badge>}
            >
              <Prompt
                user="matt"
                host="crggr-08"
                path="~/dev/crggr-ops"
                command="npm run dev"
                tone="live"
                meta={<span>2:41</span>}
              />
              <div style={{ marginTop: 12 }}>
                <Structured data={SERVE} onRun={noop} />
              </div>
            </Panel>

            {/* Raw dump: show_panel false. No border, no fill, no header. */}
            <Panel showPanel={false}>
              <TerminalLine tone="meta" gutter="9998">…</TerminalLine>
              <TerminalLine gutter="9999">a ten-thousand-line scrollback dump gets no frame</TerminalLine>
              <TerminalLine gutter="10000">at all, rather than a frame per block.</TerminalLine>
            </Panel>
          </Section>

          {/* The real <Block>, driven by the real blockPanel mapping — so the
              state → panel derivation is exercised rather than restated. */}
          <Section title="01b — REAL BLOCK COMPONENT">
            {BLOCKS.map((b, i) => (
              <Block
                key={b.id}
                block={b}
                foldThreshold={9}
                isLatest={i === BLOCKS.length - 1}
                panel={panel}
                rawDumpThreshold={10_000}
                cwd="~/dev/crggr-ops"
                user="matt"
                host="crggr-08"
                onCancel={noop}
                onRerun={noop}
                onToggleFold={noop}
              />
            ))}
          </Section>

          <Section title="02 — RENDERERS">
            <Panel heading="GIT .STATUS" index={{ current: 21 }}>
              <Structured data={GIT} onRun={noop} />
            </Panel>
            <Panel heading="TEST .RESULT" index={{ current: 22 }}>
              <Structured data={TEST} onRun={noop} />
            </Panel>
            <Panel heading="LIST .OUTPUT" index={{ current: 23 }}>
              <Structured data={LIST} onRun={noop} />
            </Panel>
          </Section>

          <Section title="03 — CONTROLS">
            <Panel heading="CONTROL .SET">
              <div className="hx__row">
                <Button variant="primary">PRIMARY</Button>
                <Button variant="secondary">SECONDARY</Button>
                <Button variant="ghost">GHOST</Button>
                <Button variant="signal" tone="danger">SIGNAL</Button>
                <Button variant="primary" disabled>DISABLED</Button>
              </div>
              <div className="hx__row">
                <Button size="sm" variant="secondary">SM 28</Button>
                <Button size="md" variant="secondary">MD 36</Button>
                <Button size="lg" variant="primary">LG 44</Button>
              </div>
              <div className="hx__row">
                <Badge tone="success" dot>EXIT 0</Badge>
                <Badge tone="danger">EXIT 1</Badge>
                <Badge tone="live" dot filled>LIVE</Badge>
                <Badge tone="accent" variant="solid">SOLID</Badge>
                <Badge tone="neutral">LATEST</Badge>
              </div>
              <div className="hx__row">
                <KeyCap>⌘</KeyCap>
                <KeyCap>⇥</KeyCap>
                <KeyCap>⌘⇧F</KeyCap>
                <KeyCap active>↵</KeyCap>
                <IndexCounter current={7} total={24} />
                <Pagination label="MATCH" current={7} total={24} onPrev={noop} onNext={noop} />
              </div>
              <div className="hx__row">
                <Switch checked={checked} onChange={setChecked} label="Demo" />
                <Stepper value={stepper} min={0} max={12} onChange={setStepper} unit="px" ariaLabel="Gap" />
                <Select
                  value="round"
                  options={[
                    { value: 'round', label: 'ROUND — 8px' },
                    { value: 'sharp', label: 'SHARP — 0px' },
                  ]}
                  onChange={noop}
                  ariaLabel="Corner"
                />
                <Button variant="secondary" onClick={() => setDialog(true)}>OPEN DIALOG</Button>
                <Button variant="secondary" onClick={() => setSettings(true)}>OPEN SETTINGS</Button>
              </div>
              <div className="hx__row">
                {(['x', 'check', 'plus', 'minus', 'globe', 'external-link', 'triangle-alert', 'power'] as const).map(
                  (name) => (
                    <span className="hx__icon" key={name}>
                      <Icon name={name} size={16} />
                    </span>
                  ),
                )}
              </div>
              <div className="hx__row">
                <Field label="BORDER WIDTH" hint="applied set ships 2px">
                  <input className="ginput" defaultValue="2" aria-label="demo" />
                </Field>
                <Field label="INVALID" error="that is not a colour">
                  <input className="ginput" defaultValue="chartreuse" aria-label="demo2" />
                </Field>
              </div>
            </Panel>
          </Section>

          <Section title="04 — COMPOSER, SEARCH &amp; TAKEOVER">
            {/* The composer: prompt inside the field, ghost in --ink-300 (never
                --ink-400), a 44/20 primary RUN, and the keycap hint row. */}
            <div className="hx__composer">
              <div className="composer">
                <div className="composer__row">
                  <div className="composer__field">
                    <span className="composer__user">matt</span>
                    <span className="composer__host">@crggr-08</span>
                    <span className="composer__path">~/dev/crggr-ops</span>
                    <span className="composer__sigil">$</span>
                    <span className="composer__entry">
                      <span className="composer__ghosts">
                        <span className="composer__spacer">npm run b</span>
                        <span className="composer__ghost">uild</span>
                      </span>
                      <input className="composer__input" defaultValue="npm run b" aria-label="demo" />
                    </span>
                  </div>
                  <Button variant="primary" size="lg">RUN ↵</Button>
                </div>
                <div className="composer__meta">
                  <span className="composer__hints">
                    <span className="composer__hint"><KeyCap size="sm">⇥</KeyCap> COMPLETE</span>
                    <span className="composer__hint"><KeyCap size="sm">⌘K</KeyCap> PALETTE</span>
                    <span className="composer__hint"><KeyCap size="sm">⌘⇧F</KeyCap> FIND</span>
                  </span>
                  <span className="leader" />
                  <span className="composer__resolved">/opt/homebrew/bin/npm</span>
                </div>
              </div>
            </div>

            {/* COMPLETE .PATH — a panel above the composer, not a dropdown. */}
            <Panel heading="COMPLETE .PATH" index={{ current: 5 }} contentBorder={false} className="completions">
              <div className="completions__list">
                {['src/', 'src-tauri/', 'scripts/', 'styles.css', 'settings.json'].map((c) => (
                  <span className="completions__item" key={c}>{c}</span>
                ))}
              </div>
              <div className="completions__foot">delegated to the real shell — never guessed</div>
            </Panel>

            {/* SCROLLBACK .FIND — a panel, not a dialog: non-modal and anchored. */}
            <Panel
              heading="SCROLLBACK .FIND"
              panelColor="var(--line-100)"
              contentBorder={false}
              className="hx__search"
              headerMeta={<span className="search__echo">tokens</span>}
            >
              <div className="search__bar">
                <div className="search__field">
                  <input className="search__input" defaultValue="tokens" aria-label="find" />
                </div>
                <Pagination label="MATCH" current={7} total={24} onPrev={noop} onNext={noop} />
              </div>
              <div className="search__results">
                {[
                  { seq: 12, before: 'rewrote ', hit: 'tokens', after: '.css against GRID' },
                  { seq: 31, before: 'src/styles/', hit: 'tokens', after: '.css | 240 ++++' },
                ].map((h, i) => (
                  <button className="search__hit" data-active={i === 0 || undefined} key={h.seq} type="button">
                    <span className="search__seq">{String(h.seq).padStart(3, '0')}</span>
                    <span className="search__line">
                      {h.before}
                      <mark className="search__mark">{h.hit}</mark>
                      {h.after}
                    </span>
                  </button>
                ))}
              </div>
            </Panel>

            {/* The takeover: cyan panel, hairline double frame around the grid. */}
            <Panel
              heading="INTERACTIVE .SESSION"
              panelColor="var(--signal-cyan)"
              contentBorder={false}
              headerMeta={<span className="takeover__cmd">shopify app dev</span>}
              headerRight={
                <>
                  <Badge tone="live" dot filled>ATTACHED</Badge>
                  <Button size="sm" variant="signal" tone="danger">⌃C EXIT</Button>
                </>
              }
            >
              <Frame weight="hairline" color="var(--live)" pad="var(--space-3)">
                <div className="hx__grid-lines">
                  <TerminalLine gutter="1">Shopify app dev</TerminalLine>
                  <TerminalLine gutter="2" tone="meta">Preview URL: https://example.myshopify.com</TerminalLine>
                  <TerminalLine gutter="3" tone="live">GraphiQL URL: http://localhost:3457</TerminalLine>
                  <TerminalLine gutter="4">&nbsp;</TerminalLine>
                </div>
                <StatusBar tone="accent" left="p preview" center="q quit" right="12:09:04" />
              </Frame>
            </Panel>
          </Section>

          <Section title="05 — SPLIT PANES">
            {/* Depth does the work: the focused pane on --void with an amber
                label and --ink-100 command, the unfocused one on --surface-1
                with everything a step dimmer. The divider is ONE 1px line. */}
            <div className="hx__panes">
              <div className="pane" data-focused="true">
                <header className="pane__head">
                  <span className="pane__label">PANE .FOCUS</span>
                  <span className="pane__cwd">~/dev/crggr-ops</span>
                  <span className="pane__meta">⑂ main</span>
                  <span className="leader" />
                  <Badge tone="accent">FOCUSED</Badge>
                </header>
                <div className="hx__panebody">
                  <Prompt user="matt" host="crggr-08" path="~" command="npm run dev" caret />
                </div>
              </div>

              <div className="divider" data-dir="row" />

              <div className="pane" data-focused="false">
                <header className="pane__head">
                  <span className="pane__label">PANE .IDLE</span>
                  <span className="pane__cwd">~/dev/crggr-ops/docs</span>
                  <span className="pane__meta pane__meta--remote">
                    <Icon name="globe" size={12} />
                    build-01
                  </span>
                  <span className="leader" />
                  <Badge tone="neutral">IDLE</Badge>
                </header>
                <div className="hx__panebody">
                  <Prompt user="matt" host="build-01" path="~" command="tail -f app.log" tone="live" />
                </div>
              </div>
            </div>
          </Section>

          <Section title="06 — CONTEXT MENU">
            {/* Width 260, 2px --line-100, 8px radius, rows at 36px with the
                chord right-aligned in mono. Separators are a top rule on the
                first row of each group, not a dedicated element. */}
            <div className="hx__ctx">
              <div className="ctxmenu" style={{ position: 'static' }}>
                {[
                  { label: 'New Session', kbd: '⌘T' },
                  { label: 'Clone Session' },
                  { label: 'Split Right', kbd: '⌘D', group: true },
                  { label: 'Split Down', kbd: '⇧⌘D' },
                  { label: 'Command Palette', kbd: '⌘K', group: true },
                  { label: 'Clear Buffer', kbd: '⌘⌫' },
                  { label: 'Close Session', kbd: '⌘W', group: true, danger: true },
                ].map((e) => (
                  <button
                    key={e.label}
                    className="ctxmenu__item"
                    data-group={e.group || undefined}
                    data-danger={e.danger || undefined}
                    type="button"
                  >
                    <span className="ctxmenu__label">{e.label}</span>
                    {e.kbd && <span className="ctxmenu__kbd">{e.kbd}</span>}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="07 — ALERTS &amp; NAV">
            <Alert
              tone="danger"
              title="SHELL NOT RUNNING"
              icon="triangle-alert"
              action={<Button size="sm" variant="primary" tone="danger">NEW SESSION</Button>}
            >
              spawn /bin/zsh: no such file or directory
            </Alert>

            {/* A clean exit is NOT an error. Neutral, not danger. */}
            <Alert
              tone="neutral"
              title="PROCESS EXITED (CODE 0)"
              icon="power"
              action={<Button size="sm" variant="secondary">NEW SESSION</Button>}
            />

            <Panel heading="SETTINGS .PANELS" flush>
              <div className="hx__nav">
                <SideNav
                  sections={[
                    { label: 'SESSION', items: [{ id: 'profiles', label: 'PROFILES', count: 4 }, { id: 'shell', label: 'SHELL' }] },
                    { label: 'DISPLAY', items: [{ id: 'panels', label: 'PANELS' }, { id: 'type', label: 'TYPE' }, { id: 'renderers', label: 'RENDERERS', count: 6 }] },
                    { label: 'INPUT', items: [{ id: 'keybindings', label: 'KEYBINDINGS', count: 18 }] },
                  ]}
                  active={nav}
                  onSelect={setNav}
                />
                <div className="hx__navbody">
                  <span className="hx__k">SELECTED</span>
                  <span className="hx__v">{nav}</span>
                </div>
              </div>
            </Panel>
          </Section>
        </div>

        <StatusBar
          tone="accent"
          left="CPU 34%    MEM 11.2/32G    LOAD 2.14    DISK 412G"
          center="SESSION 03"
          right="12:08:31"
        />
      </Frame>

      {/* The real Settings dialog, driven through the real store. It reads
          nothing from Tauri, so it renders here as it does in the app. */}
      {settings && <SettingsHost onClose={() => setSettings(false)} />}

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="CLOSE .SESSION"
        tone="danger"
        width={480}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(false)}>CANCEL</Button>
            <Button variant="primary" tone="danger" onClick={() => setDialog(false)}>CLOSE ANYWAY</Button>
          </>
        }
      >
        <p style={{ margin: '0 0 12px' }}>
          <span className="hx__subject">crggr-ops</span> still has a live process.
        </p>
        <Alert tone="danger" title="STILL RUNNING">npm run dev</Alert>
      </Dialog>
    </div>
  )
}

/** Opens the real Settings dialog by writing the store, and closes on unmount. */
function SettingsHost({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const store = useStore.getState()
    store.openSettings('panels')
    // The dialog closes itself through the store; mirror that back to the
    // harness so the button state and the store cannot disagree.
    const unsub = useStore.subscribe((s) => {
      if (!s.settings.open) onClose()
    })
    return () => {
      unsub()
      useStore.getState().closeSettings()
    }
  }, [onClose])

  return <Settings />
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="hx__section">
      <div className="hx__sechead">
        <span className="hx__seclabel">{title}</span>
        <span className="leader" />
      </div>
      {children}
    </section>
  )
}

/* --- fixtures ------------------------------------------------------------- */

const BUILD: StructuredData = {
  kind: 'build',
  summary: 'compiled successfully in 12.4s',
  sharedChunks: '184 kB',
  routes: [
    { path: '/', marker: 'static', size: '4.2 kB', firstLoad: '96.1 kB' },
    { path: '/dashboard', marker: 'dynamic', size: '18.7 kB', firstLoad: '241 kB', overBudget: true },
    { path: '/orders/[id]', marker: 'dynamic', size: '6.1 kB', firstLoad: '112 kB' },
  ],
}

const GIT: StructuredData = {
  kind: 'git',
  branch: 'main',
  ahead: '2 ahead',
  groups: [
    {
      label: 'STAGED',
      tone: 'warn',
      files: [
        { marker: 'M', path: 'src/styles/tokens.css', added: '184', removed: '96' },
        { marker: 'M', path: 'src/components/Block.tsx', added: '71', removed: '120' },
      ],
    },
    {
      label: 'UNTRACKED',
      tone: 'err',
      files: [{ marker: 'U', path: 'src/components/grid/Panel.tsx' }],
    },
  ],
}

const SERVE: StructuredData = {
  kind: 'serve',
  title: 'vite v8.2.0 ready in 412 ms',
  links: [
    { label: 'LOCAL', url: 'http://localhost:1420/' },
    { label: 'NETWORK', url: 'http://192.168.1.24:1420/' },
  ],
  hints: [
    { key: 'r', label: 'RESTART' },
    { key: 'q', label: 'QUIT' },
  ],
}

const TEST: StructuredData = {
  kind: 'test',
  passed: 184,
  failed: 2,
  skipped: 3,
  duration: '3.1s',
  failures: [
    { suite: 'blockPanel', name: 'lets a failure outrank being the latest block' },
    { suite: 'Panel', name: 'clears every border when bare' },
  ],
}

const ERR: StructuredData = {
  kind: 'err',
  message: 'unknown script "tset"',
  detail: 'npm ERR! Missing script: "tset"',
  suggestion: 'npm run test',
}

/** Blocks in every settled state, for the real <Block> component. */
const BLOCKS: BlockModel[] = [
  {
    id: 'b1', seq: 12, cmd: 'git status --short', cwd: '~/dev/crggr-ops',
    ts: '12:04:11', t0: 0, running: false, live: false, code: 0, ms: 240,
    lines: [{ text: 'nothing to commit, working tree clean', tone: 'dim' }],
    structured: null,
  },
  {
    id: 'b2', seq: 13, cmd: 'npm run tset', cwd: '~/dev/crggr-ops',
    ts: '12:07:44', t0: 0, running: false, live: false, code: 1, ms: 90,
    lines: [], structured: ERR,
  },
  {
    id: 'b3', seq: 14, cmd: 'npm run dev', cwd: '~/dev/crggr-ops',
    ts: '12:08:02', t0: Date.now() - 161_000, running: true, live: true,
    lines: [], structured: null,
  },
  {
    id: 'b4', seq: 15, cmd: 'npm run build', cwd: '~/dev/crggr-ops',
    ts: '12:06:02', t0: 0, running: false, live: false, code: 0, ms: 12_400,
    lines: [], structured: BUILD,
  },
]

const LIST: StructuredData = {
  kind: 'list',
  entries: [
    { name: 'src', kind: 'dir', size: '14 items', modified: '12:04', perms: 'drwxr-xr-x', owner: 'matt', hidden: false },
    { name: 'package.json', kind: 'file', size: '1.9 kB', modified: '11:52', perms: '-rw-r--r--', owner: 'matt', hidden: false },
    { name: 'node_modules', kind: 'link', size: '—', modified: '09:31', perms: 'lrwxr-xr-x', owner: 'matt', target: '../shared/nm', hidden: false },
    { name: 'release.sh', kind: 'exec', size: '4.1 kB', modified: 'Sep 01', perms: '-rwxr-xr-x', owner: 'matt', hidden: false },
    { name: '.env.local', kind: 'file', size: '212 B', modified: 'Aug 28', perms: '-rw-------', owner: 'matt', hidden: true },
  ],
}
