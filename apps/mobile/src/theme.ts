// Brand from the handoff, section 24. Purple is the interactive and protection accent.
// Orange is kept for warnings and decisive actions, so it still means something when it
// shows up.

export const color = {
  midnight: "#070A24",
  navy: "#0C102F",
  purple: "#6726E8",
  electric: "#7B2FF7",
  orange: "#FF7A00",
  blue: "#2962F3",
  paper: "#F6F7FB",

  text: "#F6F7FB",
  muted: "rgba(246, 247, 251, 0.68)",
  faint: "rgba(246, 247, 251, 0.45)",
  line: "rgba(246, 247, 251, 0.10)",
  raised: "#141A44",
  purpleSoft: "rgba(123, 47, 247, 0.16)",
  orangeSoft: "rgba(255, 122, 0, 0.13)",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;
export const font = { hero: 34, title: 24, h2: 18, body: 16, small: 14, tiny: 12 } as const;
