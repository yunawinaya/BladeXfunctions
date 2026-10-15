const table = this.getComponent("table_po");

if (!table) return;

const rows = this.getValue("table_po") || [];

const allRowKeys = [];
const bundleParentKeys = [];

const collectRows = (list) => {
  for (const row of list || []) {
    if (row?.fm_key) {
      allRowKeys.push(row.fm_key);

      const isBundleParent =
        !!row.item_bundle_id && !row.parent_fm_key && !row.parent_id;

      if (isBundleParent) {
        bundleParentKeys.push(row.fm_key);
      }
    }

    if (Array.isArray(row?.children)) {
      collectRows(row.children);
    }
  }
};

collectRows(rows);

if (allRowKeys.length > 0) {
  table.hideChildRecord(allRowKeys, true, { deep: false });
}

if (!this.isView && bundleParentKeys.length > 0) {
 table.hideChildRecord(bundleParentKeys, false, { deep: false });
}
