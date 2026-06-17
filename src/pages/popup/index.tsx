import React from "react";
import ReactDOM from "react-dom/client";
import Popup from "./Popup";
import "@assets/styles/tailwind.css";

if (import.meta.env.DEV) {
  void import("react-grab");
}

ReactDOM.createRoot(document.getElementById("__root") as HTMLElement).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);
