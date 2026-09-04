/** SideNav — the settings rail.
 *
 * 200px, sections separated by 20px, each labelled and followed by a dotted
 * leader. The active item takes a 2px amber left edge and the amber tint fill;
 * an inactive one reserves the same 2px in transparent so selecting a row never
 * shifts its label sideways.
 *
 * Counts are zero-padded to three in mono — machine truth beside a Rajdhani
 * label, the same split the whole system runs on.
 */

export interface SideNavItem<T extends string = string> {
  id: T
  label: string
  count?: number
}

export interface SideNavSection<T extends string = string> {
  label: string
  items: readonly SideNavItem<T>[]
}

interface Props<T extends string> {
  sections: readonly SideNavSection<T>[]
  active: T
  onSelect: (id: T) => void
  className?: string
}

export function SideNav<T extends string>({ sections, active, onSelect, className }: Props<T>) {
  return (
    <nav className={['gnav', className].filter(Boolean).join(' ')}>
      {sections.map((section) => (
        <div className="gnav__section" key={section.label}>
          <div className="gnav__seclabel">
            <span>{section.label}</span>
            <span className="leader" />
          </div>
          {section.items.map((item) => (
            <button
              key={item.id}
              className="gnav__item"
              data-active={item.id === active || undefined}
              onClick={() => onSelect(item.id)}
              type="button"
            >
              <span className="gnav__label">{item.label}</span>
              {item.count !== undefined && (
                <span className="gnav__count">{String(item.count).padStart(3, '0')}</span>
              )}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
