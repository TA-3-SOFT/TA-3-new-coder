import { ConfigDependentToolParams, Tool } from "..";
import { agentDevelopmentTool } from "./definitions/agentDevelopment";
import { codeChunkAnalysisTool } from "./definitions/codeChunkAnalysis";
// import { codeVectorAnalysisTool } from "./definitions/codeVectorAnalysis";
import { createNewFileTool } from "./definitions/createNewFile";
import { createRuleBlock } from "./definitions/createRuleBlock";
import { editFileTool } from "./definitions/editFile";
import { generateProjectMemoryTool } from "./definitions/generateProjectMemory";
import { getProjectMemoryTool } from "./definitions/getProjectMemory";
import { globSearchTool } from "./definitions/globSearch";
import { grepSearchTool } from "./definitions/grepSearch";
import { lsTool } from "./definitions/lsTool";
import { projectAnalysisTool } from "./definitions/projectAnalysis";
import { readCurrentlyOpenFileTool } from "./definitions/readCurrentlyOpenFile";
import { readFileTool } from "./definitions/readFile";
import { readFileRangeTool } from "./definitions/readFileRange";
import { requestRuleTool } from "./definitions/requestRule";
import { runTerminalCommandTool } from "./definitions/runTerminalCommand";
import { searchWebTool } from "./definitions/searchWeb";
import { viewDiffTool } from "./definitions/viewDiff";

export const baseToolDefinitions = [
  readFileTool,
  readFileRangeTool,
  editFileTool,
  createNewFileTool,
  runTerminalCommandTool,
  grepSearchTool,
  globSearchTool,
  searchWebTool,
  viewDiffTool,
  readCurrentlyOpenFileTool,
  lsTool,
  projectAnalysisTool,
  codeChunkAnalysisTool,
  // codeVectorAnalysisTool,
  agentDevelopmentTool,
  getProjectMemoryTool,
  generateProjectMemoryTool,
  createRuleBlock,
  // replacing with ls tool for now
  // viewSubdirectoryTool,
  // viewRepoMapTool,
];

export const getConfigDependentToolDefinitions = (
  params: ConfigDependentToolParams,
): Tool[] => [requestRuleTool(params)];
