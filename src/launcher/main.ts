import { mountLauncher } from "./app.ts";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Launcher root is missing");
let unmount = mountLauncher(root);
window.addEventListener("pagehide", () => unmount());
window.addEventListener("pageshow", (event) => {
    if (event.persisted) unmount = mountLauncher(root);
});
