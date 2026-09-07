import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

/* 字体：随包提供（本地自托管，离线可用） */
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/manrope";
import "@fontsource-variable/jetbrains-mono";

import "./index.css";
import App from "./App";
import { ToastProvider } from "@/components/ui/toast";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
