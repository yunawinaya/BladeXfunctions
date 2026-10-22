// RES-01 Created (BA, 10-22): the Created button saves through the Draft path with ia_target_status 'Created'; a Draft save of an
// IA stored Created (an Edit: an older tab, mobile) keeps it Created. A Completed save completes as before.
const iaCreated = saveAs === 'Draft' && (allData.ia_target_status === 'Created' ||
  (pageStatus === 'Edit' && [{{node:code_node_IAguardStored.data.stored}}][0] === 'Created'));
allData.item_assembly_status = iaCreated ? 'Created' : saveAs;
