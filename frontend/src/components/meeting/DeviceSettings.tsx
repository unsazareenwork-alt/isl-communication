import { useMemo } from "react";
import { VideoCamera, Microphone } from "@phosphor-icons/react";
import type { DeviceInfo } from "../../lib/session";

interface DeviceSettingsProps {
  devices: DeviceInfo[];
  selectedCameraId: string | null | undefined;
  selectedMicrophoneId: string | null | undefined;
  onCameraChange: (deviceId: string) => void;
  onMicrophoneChange: (deviceId: string) => void;
  cameraError?: string | null;
  micBusy?: boolean;
}

function deviceLabel(d: DeviceInfo, fallback: string): string {
  return d.label && d.label.trim() ? d.label : fallback;
}

export function DeviceSettings({
  devices,
  selectedCameraId,
  selectedMicrophoneId,
  onCameraChange,
  onMicrophoneChange,
  cameraError,
  micBusy,
}: DeviceSettingsProps) {
  const cameras = useMemo(
    () => devices.filter((d) => d.kind === "videoinput"),
    [devices],
  );
  const microphones = useMemo(
    () => devices.filter((d) => d.kind === "audioinput"),
    [devices],
  );

  const camLabel = useMemo(
    () => cameras.find((c) => c.deviceId === selectedCameraId)?.label ?? "",
    [cameras, selectedCameraId],
  );
  const micLabel = useMemo(
    () => microphones.find((m) => m.deviceId === selectedMicrophoneId)?.label ?? "",
    [microphones, selectedMicrophoneId],
  );
  // A default-camera entry when there is no explicit device selection.
  const hasExplicitCam = selectedCameraId != null && cameras.some((c) => c.deviceId === selectedCameraId);

  return (
    <div className="devices">
      <div className="devices__row">
        <span className="devices__label">
          <VideoCamera size={18} weight="fill" aria-hidden="true" />
          Camera
        </span>
        <select
          className="devices__select"
          value={selectedCameraId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (id) onCameraChange(id);
          }}
          aria-label="Select camera"
        >
          {!hasExplicitCam && (
            <option value="">Default camera{camLabel ? ` (${camLabel})` : ""}</option>
          )}
          {cameras.map((c) => (
            <option key={c.deviceId} value={c.deviceId}>
              {deviceLabel(c, "Camera")}
            </option>
          ))}
          {cameras.length === 0 && <option value="">No camera available</option>}
        </select>
      </div>

      {cameraError && <p className="devices__error">{cameraError}</p>}

      <div className="devices__row">
        <span className="devices__label">
          <Microphone size={18} weight="fill" aria-hidden="true" />
          Microphone
        </span>
        <select
          className="devices__select"
          value={selectedMicrophoneId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (id) onMicrophoneChange(id);
          }}
          aria-label="Select microphone"
        >
          {!selectedMicrophoneId && (
            <option value="">Default microphone{micLabel ? ` (${micLabel})` : ""}</option>
          )}
          {microphones.map((m) => (
            <option key={m.deviceId} value={m.deviceId}>
              {deviceLabel(m, "Microphone")}
            </option>
          ))}
          {microphones.length === 0 && <option value="">No microphone available</option>}
        </select>
      </div>

      {micBusy && <p className="devices__error">Microphone is already in use by another application.</p>}
    </div>
  );
}
