(async () => {
  const storageLocationId = arguments[0].value;
  const rowIndex = arguments[0].rowIndex;

  if (storageLocationId) {
    await this.disabled([`table_default_bin.${rowIndex}.bin_location`], false);
  }
})();
