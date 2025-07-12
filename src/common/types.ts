// Shared types (SearchQuery, SearchResult, etc.)
export interface SearchQuery {
  filters: any;
  has_text: boolean;
  text?: string;
  has_vector: boolean;
  vector?: Float32Array;
  topK: number;
}

export interface SearchResult {
  id: string;
  score: number;
}
