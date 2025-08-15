(async () => {
  try {
    console.log("🚀 Starting update...");

    const ids = this.getValue("transfer_item");
    console.log("📋 IDs:", ids);

    const serial_no_generation_rule =
      this.getValue("serial_no_generate_rule") ?? "";
    console.log("🔢 Rule:", serial_no_generation_rule);

    const entries = ids.map((id) => {
      return {
        id,
        serial_no_generate_rule: serial_no_generation_rule,
      };
    });
    console.log("📦 Entries:", entries);

    for (const entry of entries) {
      console.log("🔄 Updating entry:", entry);

      const result = await db
        .collection("Item")
        .doc(entry.id)
        .update({ serial_no_generate_rule: serial_no_generation_rule });
      console.log("✅ Update result:", result);
    }

    console.log("👨‍👩‍👧‍👦 Handling parent form...");
    const self = this;
    if (self.parentGenerateForm) {
      console.log("🚪 Hiding dialog...");
      self.parentGenerateForm.$refs.SuPageDialogRef.hide();
      console.log("🔄 Refreshing...");
      self.parentGenerateForm.refresh();
    }

    console.log("🎉 Success!");
    this.$message.success("Update Successfully");
  } catch (error) {
    console.error("💥 Error:", error);
    this.$message.error(`Update failed: ${error.message}`);
  }
})();
