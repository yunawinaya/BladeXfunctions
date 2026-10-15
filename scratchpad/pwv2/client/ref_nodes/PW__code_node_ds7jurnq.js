const allData = {{workflowparams:allData}};
const currentToStatus = {{node:code_node_KbJLkjP8.data.toStatus}};
const putawaySetup = {{node:get_node_ca2032Ub.data.data}};
const otherPutawayTOs = {{node:search_node_SVMdNd3K.data.data}} || [];
const qiLots = {{node:search_node_T5BGLPpK.data.data}} || [];

const currentToId = String(allData.id);
const grNo = allData.gr_no;

// Check if auto_completed_gr is enabled
const isAutoCompleteGR = putawaySetup && putawaySetup.auto_completed_gr === 1 ? 1 : 0;

// Check if ALL putaway TOs are completed
let allTOsCompleted = 1;

// Current TO status (use the calculated status, not database status)
if (currentToStatus !== 'Completed') {
  allTOsCompleted = 0;
}

// Check other TOs (excluding current one by ID comparison)
for (const to of otherPutawayTOs) {
  // Skip current TO - use String() to ensure consistent comparison
  if (String(to.id) === currentToId) {
    continue;
  }
  
  // Check if this other TO is not completed
  if (to.to_status !== 'Completed') {
    allTOsCompleted = 0;
    break;
  }
}

// Check if ALL QI lots are completed
let allQICompleted = 1;
if (qiLots.length > 0) {
  for (const qi of qiLots) {
    if (qi.receiving_insp_status !== 'Completed') {
      allQICompleted = 0;
      break;
    }
  }
}

// Determine GR putaway status and gr_status
let grPutawayStatus;
let grStatus = "Received";
let isGRCompleted = 0;

if (allTOsCompleted === 1 && allQICompleted === 1) {
  grPutawayStatus = 'Completed';
  if (isAutoCompleteGR === 1) {
    grStatus = 'Completed';
    isGRCompleted = 1;
  }
} else {
  grPutawayStatus = 'In Progress';
}

return {
  grNo: grNo,
  grPutawayStatus: grPutawayStatus,
  grStatus: grStatus,
  allTOsCompleted: allTOsCompleted,
  allQICompleted: allQICompleted,
  isAutoCompleteGR: isAutoCompleteGR,
  isGRCompleted: isGRCompleted
};
