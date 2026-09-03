/** Table — tabular machine output.
 *
 * Headers are Rajdhani caps (the app naming the columns), cells are mono (the
 * machine filling them). Gridlines run the brightness ladder: --line-200 under
 * the header, --line-400 between rows, so the header separates more strongly
 * than the rows do without ever getting thicker.
 *
 * Right-aligned columns take tabular figures, which is what keeps a size column
 * readable as a column rather than as ragged text.
 */

export interface TableColumn<Row> {
  key: string
  label: string
  align?: 'left' | 'right'
  /** Renders the cell at --ink-300 — for columns that are context, not data. */
  tone?: 'default' | 'meta'
  render: (row: Row) => React.ReactNode
}

interface Props<Row> {
  columns: readonly TableColumn<Row>[]
  rows: readonly Row[]
  rowKey: (row: Row, index: number) => string
  dense?: boolean
  /** --surface-2 on odd rows. */
  zebra?: boolean
  selectedIndex?: number
  onRowClick?: (row: Row, index: number) => void
  /** Replaces the default centred `NO RECORDS`. */
  empty?: React.ReactNode
  className?: string
}

export function Table<Row>({
  columns,
  rows,
  rowKey,
  dense = false,
  zebra = false,
  selectedIndex,
  onRowClick,
  empty,
  className,
}: Props<Row>) {
  if (rows.length === 0) {
    return <div className="gtable__empty">{empty ?? 'NO RECORDS'}</div>
  }

  return (
    <table
      className={['gtable', className].filter(Boolean).join(' ')}
      data-dense={dense || undefined}
      data-zebra={zebra || undefined}
      data-clickable={onRowClick ? true : undefined}
    >
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} data-align={col.align ?? 'left'}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={rowKey(row, i)}
            data-selected={i === selectedIndex || undefined}
            onClick={onRowClick ? () => onRowClick(row, i) : undefined}
          >
            {columns.map((col, ci) => (
              <td
                key={col.key}
                data-align={col.align ?? 'left'}
                data-tone={col.tone ?? 'default'}
                // The selected row's 2px amber edge lands on the first cell
                // only, so it reads as one marker on the row rather than as a
                // border drawn around every cell in it.
                data-first={ci === 0 || undefined}
              >
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
