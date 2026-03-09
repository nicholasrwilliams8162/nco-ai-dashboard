import { useEffect, useRef } from 'react';
import DTLib from 'datatables.net-dt';
import 'datatables.net-dt/css/dataTables.dataTables.css';

// NetSuite always injects a 'links' column — strip it entirely
const NS_HIDDEN = new Set(['links', 'Links']);

export function DataTable({ data, hiddenColumns = [] }) {
  const tableRef = useRef(null);
  const dtRef = useRef(null);

  useEffect(() => {
    if (!tableRef.current || !data || data.length === 0) return;

    const hidden = new Set([...NS_HIDDEN, ...hiddenColumns]);
    const keys = Object.keys(data[0]).filter(k => !hidden.has(k));
    const columns = keys.map(key => ({ title: key, data: key, defaultContent: '' }));
    const rows = data.map(row => Object.fromEntries(keys.map(k => [k, row[k] ?? ''])));

    // Destroy any existing instance — including stale HMR ones not tracked by dtRef
    if (DTLib.isDataTable(tableRef.current)) {
      new DTLib(tableRef.current).destroy();
    }
    dtRef.current = null;

    dtRef.current = new DTLib(tableRef.current, {
      data: rows,
      columns,
      responsive: false,
      scrollX: true,
      paging: rows.length > 10,
      pageLength: 10,
      searching: rows.length > 5,
      ordering: true,
      info: false,
      autoWidth: true,
      scrollCollapse: true,
    });

    return () => {
      if (dtRef.current) {
        dtRef.current.destroy();
        dtRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hiddenColumns.join(',')]);

  if (!data || data.length === 0) {
    return <div className="flex items-center justify-center h-full text-gray-500 text-sm">No data</div>;
  }

  return (
    <div className="dt-wrapper h-full overflow-auto">
      <table ref={tableRef} className="display w-full" />
    </div>
  );
}
