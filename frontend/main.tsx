import { createRoot } from "react-dom/client";
import "./app/globals.css";
import Home from "./app/page";

window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement | null;
  const editable =
    !!t &&
    (t.isContentEditable ||
      t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA");
  if (!editable) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(<Home />);
