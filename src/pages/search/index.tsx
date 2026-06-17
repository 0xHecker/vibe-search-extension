import React from "react";
import ReactDOM from "react-dom/client";
import "@src/assets/styles/tailwind.css";
import Search from "./Search";

if (import.meta.env.DEV) {
  void import("react-grab");
}

const rootElement = document.getElementById("search-results");
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <Search />
    </React.StrictMode>
  );
}
