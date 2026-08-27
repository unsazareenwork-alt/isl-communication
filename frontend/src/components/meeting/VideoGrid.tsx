import type { RemoteTile } from "../../lib/session";
import { VideoTile } from "./VideoTile";

interface VideoGridProps {
  localStream: MediaStream | null;
  localName: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  remoteTiles: RemoteTile[];
}

export function VideoGrid({
  localStream,
  localName,
  micEnabled,
  cameraEnabled,
  remoteTiles,
}: VideoGridProps) {
  const count = remoteTiles.length + 1; // include self
  const layoutClass =
    count <= 1 ? "vg vg--1" : count === 2 ? "vg vg--2" : count <= 4 ? "vg vg--4" : "vg vg--many";

  // No local stream (media denied/unavailable) is presented as camera+mic off.
  const noLocalMedia = !localStream;

  return (
    <div className={layoutClass}>
      <VideoTile
        stream={localStream}
        name={localName}
        isLocal
        micMuted={!micEnabled || noLocalMedia}
        cameraOff={!cameraEnabled || noLocalMedia}
      />
      {remoteTiles.map((tile) => (
        <VideoTile key={tile.socketId} stream={tile.stream} name={tile.userName} />
      ))}
    </div>
  );
}
