export function camelize(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
      value,
    ]),
  );
}

export const firstRow = ({ rows }) => (rows[0] ? camelize(rows[0]) : undefined);
export const allRows = ({ rows }) => rows.map(camelize);
