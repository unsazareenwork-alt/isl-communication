import type { DisplayLanguage, Message } from "./types";

/**
 * Given a message (which always carries both an English `original_text` and a
 * Tamil `translated_text`), pick which side to display for the chosen language.
 */
export function messageDisplayText(message: Pick<Message, "original_text" | "translated_text">, language: DisplayLanguage): string {
  if (language === "ta" && message.translated_text) {
    return message.translated_text;
  }
  return message.original_text;
}

export function languageLabel(language: DisplayLanguage): string {
  return language === "en" ? "English" : "Tamil";
}
