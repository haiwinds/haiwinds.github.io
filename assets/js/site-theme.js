const themeStorageKey = "haiwind-theme";
const root = document.documentElement;

function applyTheme(theme) {
  const isDark = theme === "dark";
  root.dataset.theme = isDark ? "dark" : "light";

  for (const button of document.querySelectorAll("[data-theme-toggle]")) {
    button.setAttribute("aria-pressed", String(isDark));
    button.setAttribute("aria-label", `切换到${isDark ? "日间" : "夜间"}模式`);
  }
}

applyTheme(localStorage.getItem(themeStorageKey));

document.addEventListener("DOMContentLoaded", () => {
  applyTheme(root.dataset.theme);

  for (const button of document.querySelectorAll("[data-theme-toggle]")) {
    button.addEventListener("click", () => {
      const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem(themeStorageKey, nextTheme);
      applyTheme(nextTheme);
    });
  }
});
