export function bytes(n) {
  if (n == null) return "–";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}
export const speed = (bps) => (bps ? `${bytes(bps)}/s` : "–");
export function clock(ts) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
export function clockSec(ts) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour12: false });
}
export function uptime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}
export const initials = (name = "?") => name.trim().slice(0, 2).toUpperCase();
export function hue(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}
