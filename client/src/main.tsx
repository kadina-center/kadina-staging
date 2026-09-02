import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import "./index.css";

function isPrivacyPolicyPath(): boolean {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/privacy-policy";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isPrivacyPolicyPath() ? <PrivacyPolicy /> : <App />}
  </React.StrictMode>
);
