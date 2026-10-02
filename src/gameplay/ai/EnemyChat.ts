import type { MoodName } from "./ConnectomeBrain";

export type ChatEventType = "hit" | "miss" | "spawn" | "death" | "idle";

/**
 * Curated English lines, picked by the enemy's learned mood plus what just
 * happened. English only for now, by design -- no generative text, no
 * network call, so it's free, instant, and works identically on every
 * deployment (static hosting included).
 */
const PHRASE_BANK: Record<ChatEventType, Record<MoodName, readonly string[]>> = {
  hit: {
    confident: ["Got you!", "Right on target.", "Too easy."],
    mocking: ["Ha! Didn't see that coming, did you?", "Direct hit. Pathetic dodge.", "That one's gonna leave a mark."],
    frustrated: ["Finally!", "About time that landed.", "There we go!"],
    determined: ["Target hit. Continuing.", "One down.", "Pressing the advantage."],
  },
  miss: {
    confident: ["Just a warm-up shot.", "I'll get the next one.", "Minor miscalculation."],
    mocking: ["Oops. Try to hold still.", "Even a miss looks good on me.", "Lucky dodge."],
    frustrated: ["Tch -- missed.", "Ugh, come on!", "Darn it, so close."],
    determined: ["Recalculating trajectory.", "Adjusting aim.", "Not giving up."],
  },
  spawn: {
    confident: ["I've got this.", "Ready when you are.", "This'll be quick."],
    mocking: ["Oh, you again?", "Back for more punishment?", "Let's see what you've got."],
    frustrated: ["Ugh, back to work.", "Here we go again.", "Not this guy again..."],
    determined: ["Target acquired.", "Moving in.", "Engaging."],
  },
  death: {
    confident: ["Lucky shot...", "I'll be back.", "This isn't over."],
    mocking: ["...worth it.", "Heh, nice try.", "Tell my CPU I said hi."],
    frustrated: ["No fair!", "This is garbage!", "That's not right..."],
    determined: ["Mission... incomplete.", "Someone else will finish this.", "Hold the line..."],
  },
  idle: {
    confident: ["Just waiting for my shot.", "Patience is a weapon too.", "I could do this all day."],
    mocking: ["Take your time. Really.", "Not scared, just bored.", "You call that evasive maneuvers?"],
    frustrated: ["Come on, hold still.", "Why do you keep moving...", "Is this thing even working?"],
    determined: ["Holding position.", "Watching your every move.", "Scanning for an opening."],
  },
};

/** Picks a random line from the pool matching this event and mood. */
export function pickChatLine(eventType: ChatEventType, mood: MoodName, rng: () => number = Math.random): string {
  const pool = PHRASE_BANK[eventType][mood];
  return pool[Math.floor(rng() * pool.length)];
}
