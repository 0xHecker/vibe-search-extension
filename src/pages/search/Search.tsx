import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@src/components/ui/card";
import { Button } from "@src/components/ui/button";
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

const Search = () => {
  const [sentences] = useState<string[]>(initialSentences);
  const [vectors, setVectors] = useState<Float32Array | null>(null);
  const [status, setStatus] = useState("Initializing...");

  const sendMessageToOffscreen = (message: any, callback: (response: any) => void) => {
    chrome.runtime.sendMessage({ ...message, target: "offscreen" }, callback);
  };

  const handleOffscreenResponse = (response: any) => {
    if (!response || !response.success) {
      setStatus(`Error: ${response?.error || "Unknown error from offscreen document"}`);
      return;
    }

    const { type, payload, count } = response;

    switch (type) {
      case "GET_VECTOR_COUNT_COMPLETE":
        if (count === 0) {
          setStatus("No vectors found. Generating new embeddings...");
          sendMessageToOffscreen(
            { type: "GENERATE_EMBEDDINGS", payload: { sentences: initialSentences } },
            handleOffscreenResponse
          );
        } else {
          setStatus(`Found ${count} existing vectors. Loading...`);
          sendMessageToOffscreen({ type: "GET_ALL_VECTORS" }, handleOffscreenResponse);
        }
        break;
      case "ADD_VECTORS_COMPLETE":
        setStatus(`${count} vectors stored securely in OPFS. Loading...`);
        sendMessageToOffscreen({ type: "GET_ALL_VECTORS" }, handleOffscreenResponse);
        break;
      case "GET_ALL_VECTORS_COMPLETE":
        if (payload) {
          const buffer = base64ToArrayBuffer(payload);
          setVectors(new Float32Array(buffer));
          const vectorCount = buffer.byteLength / 4 / VECTOR_DIMENSION;
          setStatus(`Displaying ${vectorCount} vectors from OPFS.`);
        } else {
          setStatus("Could not load vectors.");
        }
        break;
      case "CLEAR_COMPLETE":
        setStatus("Storage cleared. Reloading...");
        window.location.reload();
        break;
      case "DOWNLOAD_COMPLETE":
        if (payload) {
          const blob = new Blob([payload], { type: "application/octet-stream" });
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
    // Start the process by checking the vector count
    sendMessageToOffscreen({ type: "GET_VECTOR_COUNT" }, handleOffscreenResponse);
  }, []);

  const handleClear = () => {
    setStatus("Clearing storage...");
    sendMessageToOffscreen({ type: "CLEAR_STORAGE" }, handleOffscreenResponse);
  };

  const handleDownload = () => {
    setStatus("Requesting file for download...");
    sendMessageToOffscreen({ type: "DOWNLOAD_FILE" }, handleOffscreenResponse);
  };

  const renderVectorList = () => {
    if (!vectors || vectors.length === 0) {
      return <p className="text-white/60">No vectors to display.</p>;
    }
    const numVectors = vectors.length / VECTOR_DIMENSION;
    return (
      <ul className="mt-4 space-y-2">
        {Array.from({ length: numVectors }).map((_, i) => {
          const sentence = sentences[i] || `Vector ${i + 1}`;
          const vectorSlice = vectors.subarray(i * VECTOR_DIMENSION, (i + 1) * VECTOR_DIMENSION);
          return (
            <li key={i} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="font-bold text-white">{sentence}</p>
              <p className="truncate text-sm text-white/50">
                [{Array.from(vectorSlice.slice(0, 10)).join(", ")}...]
              </p>
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
          <CardTitle>OPFS Vector Store</CardTitle>
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
          <div className="max-h-[60vh] overflow-y-auto pr-2">{renderVectorList()}</div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Search;
