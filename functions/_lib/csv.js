// CSV RFC 4180, com BOM UTF-8 para compatibilidade com Excel/LibreOffice.
export function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvResponse(rows, columns, filename) {
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(',')).join('\r\n');
  const csv = `\uFEFF${header}${body ? `\r\n${body}` : ''}`;
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  });
}

export function intParam(url, name, fallback, min, max) {
  const n = Number(url.searchParams.get(name));
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
