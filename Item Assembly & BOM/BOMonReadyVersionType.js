const params = this.getComponent("parent_mat_bom_version");
const { options } = params;

if (options?.canManualInput) {
  setTimeout(async () => {
    const maxRetries = 10;
    const interval = 500;
    for (let i = 0; i < maxRetries; i++) {
      const op = await this.onDropdownVisible(
        "parent_mat_bom_version_type",
        true
      );
      if (op != null) break;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    const optionsData = this.getOptionData("parent_mat_bom_version_type") || [];
    if (optionsData.some((option) => option.value === -9999)) return;

    this.setOptionData("parent_mat_bom_version_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
  }, 200);
}
