export enum BuiltInToolNames {
  ReadFile = "builtin_read_file",
  EditExistingFile = "builtin_edit_existing_file",
  ReadCurrentlyOpenFile = "builtin_read_currently_open_file",
  CreateNewFile = "builtin_create_new_file",
  RunTerminalCommand = "builtin_run_terminal_command",
  GrepSearch = "builtin_grep_search",
  FileGlobSearch = "builtin_file_glob_search",
  SearchWeb = "builtin_search_web",
  ViewDiff = "builtin_view_diff",
  LSTool = "builtin_ls",
  ProjectAnalysis = "project_analysis",
  CodeChunkAnalysis = "code_chunk_analysis",
  // CodeVectorAnalysis = "code_vector_analysis",
  CreateRuleBlock = "builtin_create_rule_block",
  RequestRule = "builtin_request_rule",
  AgentDevelopment = "agent_development",
  GetProjectMemory = "get_project_memory",
  GenerateProjectMemory = "generate_project_memory",

  // excluded from allTools for now
  ViewRepoMap = "builtin_view_repo_map",
  ViewSubdirectory = "builtin_view_subdirectory",
}

export const BUILT_IN_GROUP_NAME = "基础工具";

export const CLIENT_TOOLS_IMPLS = [BuiltInToolNames.EditExistingFile];
