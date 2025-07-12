import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@src/components/ui/card";
import { Button } from "@src/components/ui/button";
import { Input } from "@src/components/ui/input";
import { VECTOR_DIMENSION } from "@src/common/constants";

// --- Base64 Conversion Utility ---
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

const initialSentences = [
  "The quick brown fox jumps over the lazy dog.",
  "A stitch in time saves nine.",
  "Actions speak louder than words.",
  "All that glitters is not gold.",
  "The early bird catches the worm.",
  "An apple a day keeps the doctor away.",
  "Beauty is in the eye of the beholder.",
  "Don't count your chickens before they hatch.",
  "Every cloud has a silver lining.",
  "Fortune favors the bold.",
  "Honesty is the best policy.",
  "If it ain't broke, don't fix it.",
  "Laughter is the best medicine.",
  "The pen is mightier than the sword.",
  "There's no place like home.",
  "Two heads are better than one.",
  "When in Rome, do as the Romans do.",
  "You can't judge a book by its cover.",
  "Practice makes perfect.",
  "Where there's a will, there's a way.",
];

interface SearchResult {
  index: number;
  score: number;
}

const Search = () => {
  const [sentences] = useState<string[]>(initialSentences);
  const [vectors, setVectors] = useState<Float32Array | null>(null);
  const [status, setStatus] = useState("Initializing...");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const callService = (service: string, type: string, payload?: any) => {
    chrome.runtime.sendMessage(
      { service, type, payload, target: "offscreen" },
      handleOffscreenResponse
    );
  };

  const handleOffscreenResponse = (response: any) => {
    if (!response || !response.success) {
      setStatus(`Error: ${response?.error || "Unknown error from offscreen document"}`);
      return;
    }

    const { type, payload } = response;

    switch (type) {
      case "vectorStore_getVectorCount_COMPLETE":
        if (payload === 0) {
          setStatus("No vectors found. Generating new embeddings...");
          callService("vectorStore", "generateAndStoreEmbeddings", { sentences: initialSentences });
        } else {
          setStatus(`Found ${payload} existing vectors. Loading...`);
          callService("vectorStore", "getAllVectors");
        }
        break;
      case "vectorStore_generateAndStoreEmbeddings_COMPLETE":
        setStatus(`${payload} vectors stored securely in OPFS. Loading...`);
        callService("vectorStore", "getAllVectors");
        break;
      case "vectorStore_getAllVectors_COMPLETE":
        if (payload) {
          const buffer = base64ToArrayBuffer(payload);
          setVectors(new Float32Array(buffer));
          const vectorCount = buffer.byteLength / 4 / VECTOR_DIMENSION;
          setStatus(`Displaying ${vectorCount} vectors from OPFS.`);
        } else {
          setStatus("Could not load vectors.");
        }
        break;
      case "vectorStore_search_COMPLETE":
        setSearchResults(payload);
        break;
      case "vectorStore_clearStorage_COMPLETE":
        setStatus("Storage cleared. Reloading...");
        window.location.reload();
        break;
      case "vectorStore_downloadFile_COMPLETE":
        if (payload) {
          const buffer = base64ToArrayBuffer(payload);
          const blob = new Blob([buffer], { type: "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "vectors.bin";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setStatus("Download complete.");
        } else {
          setStatus("No file to download.");
        }
        break;
    }
  };

  useEffect(() => {
    callService("vectorStore", "getVectorCount");
  }, []);

  // Debounced search effect
  useEffect(() => {
    if (!vectors || !searchQuery) {
      setSearchResults([]);
      return;
    }
    const handler = setTimeout(() => {
      callService("vectorStore", "search", { query: searchQuery, topK: 5 });
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery, vectors]);

  const handleClear = () => {
    setStatus("Clearing storage...");
    callService("vectorStore", "clearStorage");
  };

  const handleDownload = () => {
    setStatus("Requesting file for download...");
    callService("vectorStore", "downloadFile");
  };

  const renderResults = () => {
    const items = searchQuery
      ? searchResults
      : vectors
      ? initialSentences.map((_, i) => ({ index: i, score: 1 }))
      : [];

    if (items.length === 0) {
      return (
        <p className="text-white/60">
          {searchQuery ? `No results for "${searchQuery}"` : "Loading vectors..."}
        </p>
      );
    }

    return (
      <ul className="mt-4 space-y-2">
        {items.map((result) => {
          const sentence = sentences[result.index];
          return (
            <li key={result.index} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="font-bold text-white">{sentence}</p>
              {searchQuery && (
                <p className="text-sm text-green-400">Score: {result.score.toFixed(4)}</p>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="container mx-auto p-4">
      <Card className="border-white/10 bg-transparent text-white">
        <CardHeader>
          <CardTitle>Semantic Search</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-white/80">{status}</p>
            <div className="flex gap-2">
              <Button onClick={handleDownload}>Download .bin</Button>
              <Button variant="destructive" onClick={handleClear}>
                Clear Storage
              </Button>
            </div>
          </div>
          <div className="relative">
            <Input
              type="search"
              placeholder="Search for a concept..."
              className="h-12 w-full text-lg"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={!vectors}
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto pr-2">{renderResults()}</div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Search;
