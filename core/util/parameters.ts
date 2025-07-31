import { TabAutocompleteOptions } from "../index.js";

export const DEFAULT_AUTOCOMPLETE_OPTS: TabAutocompleteOptions = {
  disable: false,
  maxPromptTokens: 4096,
  prefixPercentage: 0.5,
  maxSuffixPercentage: 0.5,
  debounceDelay: 350,
  modelTimeout: 10000,
  multilineCompletions: "auto",
  // @deprecated TO BE REMOVED
  slidingWindowPrefixPercentage: 0.75,
  // @deprecated TO BE REMOVED
  slidingWindowSize: 500,
  useCache: true,
  onlyMyCode: true,
  useRecentlyEdited: true,
  disableInFiles: undefined,
  useImports: true,
  transform: true,
  showWhateverWeHaveAtXMs: 8000,
  experimental_includeClipboard: true,
  experimental_includeRecentlyVisitedRanges: true,
  experimental_includeRecentlyEditedRanges: true,
  experimental_includeDiff: true,
};

export const COUNT_COMPLETION_REJECTED_AFTER = 10_000;
export const DO_NOT_COUNT_REJECTED_BEFORE = 250;

export const RETRIEVAL_PARAMS = {
  rerankThreshold: 0.3,
  nFinal: 20,
  nRetrieve: 50,
  bm25Threshold: -2.5,
  nResultsToExpandWithEmbeddings: 5,
  nEmbeddingsExpandTo: 5,
};
