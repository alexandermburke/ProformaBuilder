import type { JSX, ReactNode } from 'react';

export type TableColumn<T> = {
  header: string;
  accessor: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
};

type SimpleTableProps<T> = {
  columns: Array<TableColumn<T>>;
  rows: T[];
  emptyMessage?: string;
  rowKey?: (row: T, index: number) => string;
};

export function SimpleTable<T>({
  columns,
  rows,
  emptyMessage = 'No data yet.',
  rowKey,
}: SimpleTableProps<T>): JSX.Element {
  return (
    <div className="overflow-hidden rounded-[20px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] shadow-inner">
      <table className="ios-table text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.header}
                className={`px-3 py-2 ${
                  column.align === 'right'
                    ? 'text-right'
                    : column.align === 'center'
                      ? 'text-center'
                      : 'text-left'
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-4 py-6 text-center text-[color:var(--text-secondary)]" colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={rowKey ? rowKey(row, index) : index}
                className="transition-colors duration-300 hover:bg-[color:var(--surface-subtle)]"
              >
                {columns.map((column, colIndex) => (
                  <td
                    key={`${index}-${colIndex}`}
                    className={`px-3 py-2 ${
                      column.align === 'right'
                        ? 'text-right'
                        : column.align === 'center'
                          ? 'text-center'
                          : 'text-left'
                    } ${column.className ?? ''}`}
                  >
                    {column.accessor(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
