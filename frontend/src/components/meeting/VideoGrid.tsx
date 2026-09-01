import { motion, AnimatePresence } from "motion/react";
import type { Participant } from "../../lib/session";
import { VideoTile } from "./VideoTile";

interface VideoGridProps {
  participants: Participant[];
  localName: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  isHost?: boolean;
}

export function VideoGrid({
  participants,
  localName,
  micEnabled,
  cameraEnabled,
  isHost = false,
}: VideoGridProps) {
  const count = participants.length;

  // Responsive auto-fit grid; max 9 visible. No featured/rail stage.
  return (
    <div
      className={[
        "vgrid",
        `vgrid--n${Math.min(Math.max(count, 1), 9)}`,
      ].join(" ")}
    >
      <AnimatePresence initial={false}>
        {participants.map((p) => {
          const isLocal = p.isLocal;
          const cameraOff = isLocal ? !cameraEnabled : !p.cameraEnabled;
          const micMuted = isLocal ? !micEnabled : !p.micEnabled;
          return (
            <motion.div
              key={isLocal ? "local" : p.socketId}
              className="vgrid__cell"
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <VideoTile
                stream={p.stream}
                name={isLocal ? localName : p.userName}
                isLocal={isLocal}
                host={isLocal && isHost}
                micMuted={micMuted}
                cameraOff={cameraOff}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
