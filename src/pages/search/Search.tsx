import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@src/components/ui/card";
import { Button } from "@src/components/ui/button";
import { VECTOR_DIMENSION } from "@src/common/constants";

interface EmbeddingInfo {
  sentence: string;
  vector: number[]; // As sent from offscreen.ts
}

const sentencesForDisplay = [
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
  const [sentences, setSentences] = useState<string[]>(sentencesForDisplay);
  const [vectors, setVectors] = useState<Float32Array | null>(null);
  const [status, setStatus] = useState("Initializing worker...");
  const opfsWorker = useRef<Worker | null>(null);

  useEffect(() => {
    opfsWorker.current = new Worker(new URL("@src/workers/opfs.worker.ts", import.meta.url), {
      type: "module",
    });

    const handleWorkerMessage = (event: MessageEvent) => {
      const { success, type, payload, error, count } = event.data;
      if (!success) {
        setStatus(`Worker error: ${error}`);
        return;
      }

      switch (type) {
        case "GET_VECTOR_COUNT_COMPLETE":
          if (count === 0) {
            setStatus("No vectors found. Generating new embeddings...");
            chrome.runtime.sendMessage(
              { type: "INITIALIZE", target: "offscreen" },
              handleOffscreenResponse
            );
          } else {
            setStatus(`Found ${count} existing vectors. Loading...`);
            opfsWorker.current?.postMessage({ type: "GET_ALL_VECTORS" });
          }
          break;
        case "ADD_VECTORS_COMPLETE":
          setStatus(`${count} vectors stored securely in OPFS. Loading...`);
          opfsWorker.current?.postMessage({ type: "GET_ALL_VECTORS" });
          break;
        case "GET_ALL_VECTORS_COMPLETE":
          setVectors(new Float32Array(payload));
          const vectorCount = payload.byteLength / 4 / VECTOR_DIMENSION;
          setStatus(`Displaying ${vectorCount} vectors from OPFS.`);
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
          } else {
            setStatus("No file to download.");
          }
          break;
      }
    };

    const handleOffscreenResponse = (response: any) => {
      if (!response || !response.success) {
        setStatus(`Initialization failed: ${response?.error || "Unknown error"}`);
        return;
      }
      const embeddingInfos: EmbeddingInfo[] = response.payload;
      const combinedVectorArray = new Float32Array(embeddingInfos.length * VECTOR_DIMENSION);
      embeddingInfos.forEach((info, i) => {
        combinedVectorArray.set(info.vector, i * VECTOR_DIMENSION);
      });
      setStatus("Embeddings generated. Writing to OPFS...");
      opfsWorker.current?.postMessage({ type: "ADD_VECTORS", payload: combinedVectorArray }, [
        combinedVectorArray.buffer,
      ]);
    };

    opfsWorker.current.onmessage = handleWorkerMessage;

    // Start the process by checking the vector count
    opfsWorker.current.postMessage({ type: "GET_VECTOR_COUNT" });

    return () => {
      opfsWorker.current?.terminate();
    };
  }, []);

  const handleClear = () => {
    setStatus("Clearing storage...");
    opfsWorker.current?.postMessage({ type: "CLEAR_STORAGE" });
  };

  const handleDownload = () => {
    opfsWorker.current?.postMessage({ type: "DOWNLOAD_FILE" });
  };

  const renderVectorList = () => {
    if (!vectors || vectors.length === 0) {
      return <p>No vectors to display.</p>;
    }
    const numVectors = vectors.length / VECTOR_DIMENSION;
    return (
      <ul className="mt-4">
        {Array.from({ length: numVectors }).map((_, i) => {
          const sentence = sentences[i] || `Vector ${i + 1}`;
          const vectorSlice = vectors.subarray(i * VECTOR_DIMENSION, (i + 1) * VECTOR_DIMENSION);
          return (
            <li key={i} className="border-b p-2">
              <p className="font-bold">{sentence}</p>
              <p className="text-sm text-gray-500 truncate">
                Vector (first 100): [{Array.from(vectorSlice.slice(0, 100)).join(", ")}]
              </p>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="container mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Binary Vector Store</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center mb-4">
            <p>{status}</p>
            <div className="flex gap-2">
              <Button onClick={handleDownload}>Download .bin File</Button>
              <Button variant="destructive" onClick={handleClear}>
                Clear Storage
              </Button>
            </div>
          </div>
          {renderVectorList()}
        </CardContent>
      </Card>
    </div>
  );
};

export default Search;
