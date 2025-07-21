const allData = this.getValues();
const self = this;
const page_status = this.getValue("page_status");

const processId = allData.default_dialog?.process_route_id;

const {
  plant_id,
  process_route_no,
  process_route_name,
  material_code,
  material_name,
  material_desc,
  is_main_process_route,
  bom_version,
  bom_base_qty,
  process_table,
  remark,
  mat_consumption_table,
} = allData;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

const addProcess = async () => {
  if (processId) {
    await db
      .collection("process_route")
      .where({ id: processId })
      .update({ is_main_process_route: 0 });
  }
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  await db.collection("process_route").add({
    plant_id,
    process_route_no,
    process_route_name,
    material_code,
    material_name,
    material_desc,
    is_main_process_route,
    bom_version,
    bom_base_qty,
    process_table,
    remark,
    mat_consumption_table,
    organization_id: organizationId,
  });
  closeDialog();
};

const editProcess = async () => {
  const existingProcessRouteId = this.getValue("id");
  const allData = this.getValues();
  await db
    .collection("process_route")
    .where({ id: existingProcessRouteId })
    .update({
      process_route_no: allData.process_route_no,
      process_route_name: allData.process_route_name,
      material_code: allData.material_code,
      is_main_process_route: allData.is_main_process_route,
      bom_version: allData.bom_version,
      bom_base_qty: allData.bom_base_qty,
      process_table: allData.process_table,
      remark: allData.remark,
      mat_consumption_table: allData.mat_consumption_table,
    })
    .then((res) => {
      console.log("response:", res);
    });
  closeDialog();
};

const init = async () => {
  await this.getData();
  if (page_status === "Add") {
    await addProcess();
    return;
  }
  if (page_status === "Edit") {
    await editProcess();
    return;
  }
};

init();
