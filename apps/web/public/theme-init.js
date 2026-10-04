// Apply the saved theme before first paint to avoid a flash (kept out of index.html so the CSP can forbid inline scripts).
try {
  var t = localStorage.getItem("emi-theme") || "system";
  if (t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");
} catch (e) {}
