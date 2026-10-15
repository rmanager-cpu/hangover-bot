// The owner's marks, as shipped in assets/brand (made from docs/brand by the restyle; see
// docs/brand/README.md). Each image carries its width:height so a screen can size it by
// width alone. The two robots are cut out against the brand navy and only look right on
// Midnight: never put one on a white card.

export const LOCKUP = { source: require("../assets/brand/hangoverbot-roster-protection.png"), aspect: 2.9557 } as const;
export const WORDMARK = { source: require("../assets/brand/hangoverbot-by-turbolabs.png"), aspect: 3.3088 } as const;
export const ROBOT_PEEK = { source: require("../assets/brand/robot-peek.png"), aspect: 1.5464 } as const;
export const ROBOT_FLYING = { source: require("../assets/brand/robot-flying.png"), aspect: 1.0187 } as const;
