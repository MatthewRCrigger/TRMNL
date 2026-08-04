/** toggleMaximizePane is meaningless while solo, and closePane always clears
 *  it — a maximized view of a pane that no longer has a sibling is nonsense. */

import { beforeEach, describe, expect, it } from 'vitest'

import { useStore } from './store'

beforeEach(() => {
  useStore.setState({ split: false, paneMaximized: false, focus: 'a' })
})

describe('toggleMaximizePane', () => {
  it('is a no-op while solo', () => {
    useStore.getState().toggleMaximizePane()
    expect(useStore.getState().paneMaximized).toBe(false)
  })

  it('toggles on and off while split', () => {
    useStore.setState({ split: true })

    useStore.getState().toggleMaximizePane()
    expect(useStore.getState().paneMaximized).toBe(true)

    useStore.getState().toggleMaximizePane()
    expect(useStore.getState().paneMaximized).toBe(false)
  })

  it('resets when the split closes', () => {
    useStore.setState({
      split: true,
      paneMaximized: true,
      panes: { a: { sessions: [], active: 0 }, b: { sessions: [], active: 0 } },
    })

    useStore.getState().closePane()

    expect(useStore.getState().paneMaximized).toBe(false)
    expect(useStore.getState().split).toBe(false)
  })
})
