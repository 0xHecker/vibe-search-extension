import React from "react";
import ReactDOM from "react-dom/client";
import { loadReactGrabInDevelopment } from "@src/lib/react-grab";
import Main from "./Main";

loadReactGrabInDevelopment();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Main />
  </React.StrictMode>
);
