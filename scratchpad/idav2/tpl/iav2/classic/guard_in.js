// IA V2 guard: only an Edit reads the stored status (a desktop Clone keeps the source id); the pick cap applies to every page
const iaGuardIn = { allData: [{{workflowparams:allData}}][0], saveAs: [{{workflowparams:saveAs}}][0], pageStatus: [{{workflowparams:pageStatus}}][0],
  tenantId: [{{system:tenantId}}][0] };
let iaGuardDoc = iaGuardIn.allData;
if (typeof iaGuardDoc === "string") iaGuardDoc = iaParseJ(iaGuardDoc);
if (!iaGuardDoc || typeof iaGuardDoc !== "object" || Array.isArray(iaGuardDoc)) iaGuardDoc = {};
const iaGuardSaveAs = iaS(iaGuardIn.saveAs);
let iaGuardId = "";
let iaGuardTenant = "";
try {
  iaGuardId = iaIdStr(iaGuardDoc.id);
  iaGuardTenant = iaS(iaGuardIn.tenantId);
} catch (e) {
  iaGuardId = "";
}
const iaGuardCheck = iaS(iaGuardIn.pageStatus) === "Edit" && iaDigits(iaGuardId) && iaDigits(iaGuardTenant);
let iaGuardPicks = 0;
try {
  iaGuardPicks = iaPickCount(Array.isArray(iaGuardDoc.stock_movement) ? iaGuardDoc.stock_movement : []);
} catch (e) {
  iaGuardPicks = 0;
}
const iaGuardBig = iaGuardSaveAs !== "Draft" && iaGuardPicks > IA_CLASSIC_MAX_PICKS;
return {
  check: iaGuardCheck ? "YES" : "NO",
  iaId: iaGuardCheck ? iaGuardId : "0",
  tenantId: iaGuardCheck ? iaGuardTenant : "0",
  saveAs: iaGuardSaveAs,
  picks: String(iaGuardPicks),
  big: iaGuardBig ? "YES" : "NO",
  bigNoRead: iaGuardBig && !iaGuardCheck ? "YES" : "NO",
  bigMessage: iaGuardBig ? IA_TEXT.classicTooBig(iaGuardPicks, IA_CLASSIC_MAX_PICKS) : "",
};
