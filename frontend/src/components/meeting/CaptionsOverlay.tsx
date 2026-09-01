import type { CaptionItem } from "../../hooks/useMeetingSession";
import type { DisplayLanguage } from "../../lib/types";
import { languageLabel } from "../../lib/text";
import { motion, AnimatePresence } from "motion/react";

interface CaptionsOverlayProps {
  captions: CaptionItem[];
  language: DisplayLanguage;
}

export function CaptionsOverlay({ captions, language }: CaptionsOverlayProps) {
  if (captions.length === 0) return null;

  const current = captions[captions.length - 1];
  const translated = current.translated ?? current.original;

  return (
    <div
      className="captions"
      aria-live="polite"
      aria-label={`Live sign language captions in ${languageLabel(language)}`}
    >
      <AnimatePresence mode="wait">
        <motion.div
          className="captions__card"
          key={current.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <div className="captions__head">
            <span className="captions__live">
              <span className="captions__pulse" aria-hidden="true" />
              ISL Active
            </span>
            <span className="captions__lang">
              Live Translation · {language === "en" ? "English" : "Tamil"}
            </span>
          </div>
          <div className="captions__lines">
            <p className="captions__english">
              {current.userName && <span className="captions__who">{current.userName}:</span>}{" "}
              <span>{current.original}</span>
            </p>
            <p className="captions__tamil">
              <span>"{translated}"</span>
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
