import { siteSettings } from "./site-settings.js?v=20261026-1";

for (const avatar of document.querySelectorAll("[data-site-avatar]")) {
  avatar.src = siteSettings.avatarUrl;
}
