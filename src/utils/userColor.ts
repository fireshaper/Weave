// Curated palette of colors that look great on the dark background
const USER_COLORS = [
  "#e06c75", // rose
  "#e5c07b", // amber
  "#98c379", // sage green
  "#56b6c2", // teal
  "#61afef", // sky blue
  "#c678dd", // lavender
  "#d19a66", // peach
  "#be5046", // brick
  "#4ec9b0", // mint
  "#f0a500", // gold
  "#7fb3d3", // steel blue
  "#a9dc76", // lime
];

export function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return USER_COLORS[hash % USER_COLORS.length];
}
