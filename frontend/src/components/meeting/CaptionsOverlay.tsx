import { HandWaving } from "@phosphor-icons/react";
import type { CaptionItem } from "../../hooks/useMeetingSession";
import type { DisplayLanguage } from "../../lib/types";

interface CaptionsOverlayProps {
  captions: CaptionItem[];
  language: DisplayLanguage;
}

export function CaptionsOverlay({ captions, language }: CaptionsOverlayProps) {
  if (captions.length === 0) return null;

  const visible = captions.slice(-2);

  return (
    <div className="captions" aria-live="polite" aria-label="Live sign language captions">
      <div className="captions__icon" aria-hidden="true">
        <HandWaving size={20} weight="fill" />
      </div>
      <div className="captions__list">
        {visible.map((c) => (
          <div key={c.id} className="captions__item">
            <span className="captions__who">{c.userName || "Sign caption"}</span>
            <span className="captions__text">
              {language === "ta" && c.translated ? c.translated : c.original}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
