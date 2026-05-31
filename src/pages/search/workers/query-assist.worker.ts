/// <reference lib="webworker" />
import { analyzeQuery } from "@src/search-core/query-language";
import type {
  AnalyzeQueryResponse,
  AnalyzeQueryWorkerMessage,
  QueryAssistCatalogs,
} from "@src/search-core/contracts";

const EMPTY_CATALOGS: QueryAssistCatalogs = {
  sources: [],
  spaces: [],
  folders: [],
  tags: [],
  domains: [],
  authors: [],
  recentQueries: [],
};

let catalogs: QueryAssistCatalogs = EMPTY_CATALOGS;

self.onmessage = (event: MessageEvent<AnalyzeQueryWorkerMessage>) => {
  const message = event.data;
  if (!message) return;

  if (message.type === "SET_CATALOGS") {
    catalogs = message.catalogs || EMPTY_CATALOGS;
    return;
  }

  if (message.type !== "ANALYZE_QUERY") return;

  const analysis = analyzeQuery({
    ...message,
    catalogs,
  });
  const response: AnalyzeQueryResponse = {
    type: "ANALYZE_QUERY_RESULT",
    payload: analysis,
  };
  self.postMessage(response);
};

export {};
