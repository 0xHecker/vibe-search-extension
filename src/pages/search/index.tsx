import React from "react";
import ReactDOM from "react-dom/client";
import "@src/assets/styles/tailwind.css";
import { loadReactGrabInDevelopment } from "@src/lib/react-grab";
import Search from "./Search";

loadReactGrabInDevelopment();

const rootElement = document.getElementById("search-results");
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <Search />
    </React.StrictMode>
  );
}
