/** Tabs — the top-bar nav.
 *
 * The container carries a 1px baseline; each item carries a 2px bottom border
 * and `margin-bottom: -1px`. That negative margin is the whole trick: it lands
 * the 2px active marker *on* the 1px baseline rather than below it, so the
 * marker replaces the rule instead of thickening it.
 */

export interface TabItem<T extends string = string> {
  id: T
  label: string
}

interface Props<T extends string> {
  items: readonly TabItem<T>[]
  active: T
  onSelect: (id: T) => void
  className?: string
}

export function Tabs<T extends string>({ items, active, onSelect, className }: Props<T>) {
  return (
    <div className={['gtabs', className].filter(Boolean).join(' ')} role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          className="gtabs__item"
          data-active={item.id === active || undefined}
          role="tab"
          aria-selected={item.id === active}
          onClick={() => onSelect(item.id)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
