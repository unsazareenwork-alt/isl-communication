import type { RemoteTile } from "../../lib/session";

interface ParticipantsPanelProps {
  localName: string;
  remoteTiles: RemoteTile[];
  meetingCode: string;
}

export function ParticipantsPanel({ localName, remoteTiles, meetingCode }: ParticipantsPanelProps) {
  return (
    <section className="panel" aria-label="Participants">
      <header className="panel__header">
        <h2 className="panel__title">
          Participants{" "}
          <span className="panel__count">{remoteTiles.length + 1}</span>
        </h2>
      </header>

      <ul className="panel__list">
        <li className="panel__item">
          <span className="panel__avatar">{initials(localName || "You")}</span>
          <span className="panel__pname">
            {localName || "You"} <span className="panel__you">(you)</span>
          </span>
        </li>
        {remoteTiles.map((tile) => (
          <li key={tile.socketId || tile.userName} className="panel__item">
            <span className="panel__avatar">{initials(tile.userName)}</span>
            <span className="panel__pname">{tile.userName}</span>
          </li>
        ))}
      </ul>

      <footer className="panel__footer">
        <span className="panel__meta">Meeting code</span>
        <code className="panel__code">{meetingCode}</code>
      </footer>
    </section>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
