import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@src/components/ui/card";

interface Embedding {
  sentence: string;
  vector: number[];
}

const Search = () => {
  const [generatedEmbeddings, setGeneratedEmbeddings] = useState<Embedding[]>([]);
  const [opfsEmbeddings, setOpfsEmbeddings] = useState<Embedding[]>([]);
  const [status, setStatus] = useState("Initializing...");
  const [isProcessing, setIsProcessing] = useState(true);
  const opfsWorker = useRef<Worker | null>(null);

  useEffect(() => {
    // Initialize the OPFS worker
    opfsWorker.current = new Worker(new URL("@src/workers/opfs.worker.ts", import.meta.url), {
      type: "module",
    });

    const handleWorkerMessage = (event: MessageEvent) => {
      const { success, type, payload, error } = event.data;
      if (success) {
        if (type === "WRITE_COMPLETE") {
          setStatus("Embeddings written to OPFS. Reading back...");
          opfsWorker.current?.postMessage({ type: "READ" });
        } else if (type === "READ_COMPLETE") {
          setOpfsEmbeddings(payload);
          setStatus("Embeddings loaded from OPFS.");
          setIsProcessing(false);
        }
      } else {
        setStatus(`Worker error: ${error}`);
        setIsProcessing(false);
      }
    };

    opfsWorker.current.onmessage = handleWorkerMessage;

    // Handle the response from the offscreen document
    const handleOffscreenResponse = (response: any) => {
      if (!response) {
        setStatus("Failed to get response from background script.");
        setIsProcessing(false);
        return;
      }

      const { type, payload, success, error } = response;
      if (type === "INITIALIZED") {
        if (success) {
          setGeneratedEmbeddings(payload);
          setStatus("Embeddings generated. Writing to OPFS...");
          // Now, send the generated embeddings to the worker to be written
          opfsWorker.current?.postMessage({ type: "WRITE", payload });
        } else {
          setStatus(`Initialization failed: ${error || "Unknown error"}`);
          setIsProcessing(false);
        }
      }
    };

    // Send initialization message to the offscreen document
    chrome.runtime.sendMessage(
      { type: "INITIALIZE", target: "offscreen" },
      handleOffscreenResponse
    );

    // Cleanup worker on component unmount
    return () => {
      opfsWorker.current?.terminate();
    };
  }, []);

  const renderEmbeddingList = (title: string, embeddings: Embedding[]) => (
    <div className="mt-6">
      <h2 className="text-2xl font-bold tracking-tight text-white">{title}</h2>
      <ul className="mt-4">
        {embeddings.map((embedding, index) => (
          <li key={index} className="border-b p-2">
            <p className="font-bold">{embedding.sentence}</p>
            <p className="text-sm text-gray-500 truncate">
              Vector (first 100): [{embedding.vector.slice(0, 100).join(", ")}]
            </p>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="container mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Sentence Embeddings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4">{status}</p>
          {isProcessing ? (
            <p>Loading...</p>
          ) : (
            <div>
              {renderEmbeddingList("Generated Embeddings", generatedEmbeddings)}
              {renderEmbeddingList("Embeddings from OPFS", opfsEmbeddings)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Search;
