(async () => {
  const plantId = this.getValue("plant_id");

  if (!plantId) return;

  this.disabled(["repack_type"], false);

  if (!arguments[0].fieldModel) return;

  const existingRepack = this.getValue("table_repack") || [];
  const hasData = existingRepack.some(
    (row) =>
      row &&
      (row.handling_unit_id ||
        row.target_hu_id ||
        row.source_temp_data ||
        row.target_temp_data ||
        row.items_temp_data ||
        row.item_details),
  );

  if (hasData) {
    this.$alert(
      "Changing the plant has <strong>reset all repack lines</strong>.",
      "Plant Changed",
      {
        confirmButtonText: "OK",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    );
  }

  this.setData({
    repack_type: "",
    table_repack: [],
    user_assignees: [],
    work_group_assignees: "",
  });
})();
