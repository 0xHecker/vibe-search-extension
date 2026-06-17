import React from "react";
import ReactDOM from "react-dom/client";
import Main from "./Main";

if (import.meta.env.DEV) {
  void import("react-grab");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Main />
  </React.StrictMode>
);
