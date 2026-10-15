(async () => {
  const event = arguments[0] || {};

  const childKey = event.rowKey ?? event.rowkey;
  const parentKey = event.fromKey ?? event.fromkey;

  if (!childKey || !parentKey) {
    console.warn("[Add Child Record] missing keys", event);
    return;
  }

  const findRow = (list, key) => {
    for (const row of list || []) {
      if (row?.fm_key === key) {
        return row;
      }

      if (Array.isArray(row?.children)) {
        const found = findRow(row.children, key);

        if (found) return found;
      }
    }

    return null;
  };

  setTimeout(async () => {
    const rows = this.getValue("table_po") || [];
    const parentRow = findRow(rows, parentKey);

    if (!parentRow?.item_bundle_id) {
      return;
    }

    await this.triggerEvent("syncBundleChildButtons");
  }, 50);
})();
