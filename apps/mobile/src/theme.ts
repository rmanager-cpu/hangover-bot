// The owner's brand (docs/brand/README.md). Midnight behind everything, white cards with
// big radii on it, orange for every primary action and every selected state. Text has two
// palettes, one per surface: white and lavender on Midnight, navy and slate on paper. The
// components in ui.tsx pick the right one from the surface they sit on.

export const color = {
  midnight: "#070A24",
  navy: "#0C102F",
  purple: "#6726E8",
  electric: "#7B2FF7",
  orange: "#FF7A00",
  paper: "#F6F7FB",
  white: "#FFFFFF",
  green: "#22C55E",
  amber: "#F59E0B",
  red: "#EF4444",

  // On Midnight.
  text: "#FFFFFF",
  muted: "#B6B9DB",
  faint: "rgba(182, 185, 219, 0.5)",
  line: "rgba(246, 247, 251, 0.10)",
  raised: "#141A44",
  glass: "rgba(255, 255, 255, 0.08)",

  // On paper.
  ink: "#0C102F",
  inkMuted: "#5D6187",
  inkFaint: "#9598BC",
  inkLine: "#E4E6F1",
  inkRaised: "#ECEEF6",

  // Pill text, dark enough to read on the tints below.
  greenInk: "#15803D",
  amberInk: "#B45309",
  redInk: "#B91C1C",
  orangeInk: "#C2410C",

  // Behind pills and notes, on paper.
  orangeSoft: "#FFEDDD",
  greenSoft: "#E1F7EA",
  amberSoft: "#FDF1D6",
  redSoft: "#FDE3E3",
  purpleSoft: "#ECE4FD",
  // Behind a selected option, on Midnight.
  orangeGlow: "rgba(255, 122, 0, 0.14)",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 24, pill: 999 } as const;
export const font = { hero: 36, title: 28, h2: 18, body: 16, small: 14, tiny: 12 } as const;
