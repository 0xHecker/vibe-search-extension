import React from "react";
import ReactDOM from "react-dom/client";
import { loadReactGrabInDevelopment } from "@src/lib/react-grab";
import Popup from "./Popup";
import "@assets/styles/tailwind.css";

loadReactGrabInDevelopment();

ReactDOM.createRoot(document.getElementById("__root") as HTMLElement).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);
