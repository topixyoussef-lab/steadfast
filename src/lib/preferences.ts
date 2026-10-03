import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { PreferenceType } from "@/lib/types";

/**
 * Presentation metadata for each recovery path.
 *
 * All member-facing copy lives in the dictionaries, so these are accessors that
 * take the dictionary rather than frozen English strings. `id` doubles as the
 * key into `dict.preferences`.
 */
export type PreferenceMeta = {
  id: PreferenceType;
  label: (dict: Dictionary) => string;
  tagline: (dict: Dictionary) => string;
  description: (dict: Dictionary) => string;
  /** Copy shown while the user picks this path, before committing. */
  sampleTasks: (dict: Dictionary) => readonly string[];
  accent: string;
  icon: "moon" | "cross" | "spark";
};

export const PREFERENCES: PreferenceMeta[] = [
  {
    id: "islamic",
    label: (d) => d.preferences.islamic,
    tagline: (d) => d.preferences.islamicTagline,
    description: (d) => d.preferences.islamicDescription,
    sampleTasks: (d) => d.preferences.islamicTasks,
    accent: "emerald",
    icon: "moon",
  },
  {
    id: "christian",
    label: (d) => d.preferences.christian,
    tagline: (d) => d.preferences.christianTagline,
    description: (d) => d.preferences.christianDescription,
    sampleTasks: (d) => d.preferences.christianTasks,
    accent: "sky",
    icon: "cross",
  },
  {
    id: "general",
    label: (d) => d.preferences.general,
    tagline: (d) => d.preferences.generalTagline,
    description: (d) => d.preferences.generalDescription,
    sampleTasks: (d) => d.preferences.generalTasks,
    accent: "violet",
    icon: "spark",
  },
];

export const PREFERENCE_IDS = PREFERENCES.map((p) => p.id);

export function getPreference(id: PreferenceType) {
  return PREFERENCES.find((p) => p.id === id) ?? PREFERENCES[2];
}