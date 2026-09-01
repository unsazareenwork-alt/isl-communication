import {
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  VideoCameraSlash,
  UsersThree,
  ChatText,
  ClosedCaptioning,
  CaretDown,
  PhoneSlash,
  Square,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DisplayLanguage } from "../../lib/types";
import type { DeviceInfo } from "../../lib/session";

interface ControlBarProps {
  isHost: boolean;
  participantCount: number;
  micEnabled: boolean;
  cameraEnabled: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  activePanel: "chat" | "participants" | "transcript" | null;
  onOpenPanel: (panel: "chat" | "participants" | "transcript") => void;
  language: DisplayLanguage;
  onToggleLanguage: () => void;
  onLeave: () => void;
  onEnd: () => void;
  devices?: DeviceInfo[];
  selectedCameraId?: string | null;
  selectedMicrophoneId?: string | null;
  onSwitchCamera?: (deviceId: string) => void;
  onSwitchMicrophone?: (deviceId: string) => void;
  mediaError?: string | null;
}

type Panel = "chat" | "participants" | "transcript";
type Menu = "mic" | "camera" | "captions" | null;

interface MenuAnchor {
  menu: Menu;
  el: Element | null;
}

export function ControlBar({
  isHost,
  participantCount,
  micEnabled,
  cameraEnabled,
  onToggleMic,
  onToggleCamera,
  activePanel,
  onOpenPanel,
  language,
  onToggleLanguage,
  onLeave,
  onEnd,
  devices = [],
  selectedCameraId,
  selectedMicrophoneId,
  onSwitchCamera,
  onSwitchMicrophone,
  mediaError,
}: ControlBarProps) {
  const [openMenu, setOpenMenu] = useState<Menu>(null);
  const [anchor, setAnchor] = useState<MenuAnchor>({ menu: null, el: null });

  const closeMenu = useCallback(() => {
    setOpenMenu(null);
    setAnchor({ menu: null, el: null });
  }, []);

  const openMenuAt = useCallback((menu: Exclude<Menu, null>, el: Element | null) => {
    setAnchor({ menu, el });
    setOpenMenu(menu);
  }, []);

  const handleGroupToggle = useCallback(
    (menu: Exclude<Menu, null>, el: Element | null) => {
      if (openMenu === menu) {
        closeMenu();
      } else {
        openMenuAt(menu, el);
      }
    },
    [openMenu, closeMenu, openMenuAt],
  );

  const cameras = devices.filter((d) => d.kind === "videoinput");
  const microphones = devices.filter((d) => d.kind === "audioinput");

  return (
    <>
      {/* Desktop floating control bar */}
      <div className="controlbar-dock controlbar-dock--desktop" aria-label="Meeting controls">
        <div className="controlbar controlbar--pill">
          <div className="controlbar__group">
            <SplitMediaControl
              enabled={micEnabled}
              onToggle={onToggleMic}
              onOpenMenu={(el) => handleGroupToggle("mic", el)}
              menuOpen={openMenu === "mic"}
              onLabel={micEnabled ? "Turn off microphone" : "Turn on microphone"}
              menuLabel="Select microphone"
              data-testid-mic="ctrl-mic"
              data-testid-menu="ctrl-mic-menu"
            >
              {micEnabled ? (
                <Microphone size={24} weight="fill" aria-hidden="true" />
              ) : (
                <MicrophoneSlash size={24} weight="fill" aria-hidden="true" />
              )}
            </SplitMediaControl>

            <SplitMediaControl
              enabled={cameraEnabled}
              onToggle={onToggleCamera}
              onOpenMenu={(el) => handleGroupToggle("camera", el)}
              menuOpen={openMenu === "camera"}
              onLabel={cameraEnabled ? "Turn off camera" : "Turn on camera"}
              menuLabel="Select camera"
              data-testid-mic="ctrl-camera"
              data-testid-menu="ctrl-camera-menu"
            >
              {cameraEnabled ? (
                <VideoCamera size={24} weight="fill" aria-hidden="true" />
              ) : (
                <VideoCameraSlash size={24} weight="fill" aria-hidden="true" />
              )}
            </SplitMediaControl>
          </div>

          <span className="controlbar__divider" aria-hidden="true" />

          <div className="controlbar__group">
            <ControlButton
              label="Participants"
              panel="participants"
              activePanel={activePanel}
              onOpenPanel={onOpenPanel}
              badge={String(participantCount)}
              data-testid="ctrl-participants"
            >
              <UsersThree size={24} weight="fill" aria-hidden="true" />
            </ControlButton>

            <ControlButton
              label="Chat"
              panel="chat"
              activePanel={activePanel}
              onOpenPanel={onOpenPanel}
              data-testid="ctrl-chat"
            >
              <ChatText size={24} weight="fill" aria-hidden="true" />
            </ControlButton>

            <SplitMediaControl
              enabled={activePanel === "transcript"}
              onToggle={() => onOpenPanel("transcript")}
              onOpenMenu={(el) => handleGroupToggle("captions", el)}
              menuOpen={openMenu === "captions"}
              onLabel="Open transcript"
              menuLabel="Captions and transcript"
              data-testid-mic="ctrl-transcript"
              data-testid-menu="ctrl-captions-menu"
            >
              <ClosedCaptioning size={24} weight="fill" aria-hidden="true" />
            </SplitMediaControl>
          </div>

          <span className="controlbar__divider" aria-hidden="true" />

          <div className="controlbar__group controlbar__group--leave">
            <button type="button" className="ctl ctl--leave" onClick={onLeave} aria-label="Leave meeting" data-testid="ctrl-leave">
              <PhoneSlash size={20} weight="fill" aria-hidden="true" />
              <span className="ctl__label">Leave</span>
            </button>
            {isHost && (
              <button
                type="button"
                className="ctl ctl--end"
                onClick={onEnd}
                aria-label="End meeting for everyone"
                title="End meeting for everyone"
                data-testid="ctrl-end"
              >
                <Square size={18} weight="fill" aria-hidden="true" />
                <span className="ctl__label">End</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Anchored contextual menus */}
      <PositionedMenu
        open={openMenu === "mic"}
        anchor={anchor.menu === "mic" ? anchor.el : null}
        onClose={closeMenu}
        label="Microphone"
      >
        <DeviceMenu
          title="Microphone"
          devices={microphones}
          selectedId={selectedMicrophoneId}
          placeholder="Default microphone"
          error={mediaError}
          onSelect={(id) => onSwitchMicrophone?.(id)}
          onClose={closeMenu}
        />
      </PositionedMenu>

      <PositionedMenu
        open={openMenu === "camera"}
        anchor={anchor.menu === "camera" ? anchor.el : null}
        onClose={closeMenu}
        label="Camera"
      >
        <DeviceMenu
          title="Camera"
          devices={cameras}
          selectedId={selectedCameraId}
          placeholder="Default camera"
          error={mediaError}
          onSelect={(id) => onSwitchCamera?.(id)}
          onClose={closeMenu}
        />
      </PositionedMenu>

      <PositionedMenu
        open={openMenu === "captions"}
        anchor={anchor.menu === "captions" ? anchor.el : null}
        onClose={closeMenu}
        label="Captions and transcript"
      >
        <div className="ctl-menu__body">
          <p className="ctl-menu__group-title">Language</p>
          <MenuRadioItem
            label="English"
            checked={language === "en"}
            onClick={() => {
              if (language !== "en") onToggleLanguage();
              closeMenu();
            }}
          />
          <MenuRadioItem
            label="தமிழ் (Tamil)"
            checked={language === "ta"}
            onClick={() => {
              if (language !== "ta") onToggleLanguage();
              closeMenu();
            }}
          />

          <p className="ctl-menu__group-title">Transcript</p>
          <div className="ctl-menu__item ctl-menu__item--toggle">
            <span className="ctl-menu__text">Open transcript</span>
            <button
              type="button"
              className={["ctl-menu__switch", activePanel === "transcript" ? "ctl-menu__switch--on" : ""].join(" ")}
              role="switch"
              aria-checked={activePanel === "transcript"}
              aria-label="Toggle transcript"
              onClick={() => {
                onOpenPanel("transcript");
                closeMenu();
              }}
            >
              <span className="ctl-menu__knob" aria-hidden="true" />
            </button>
          </div>
        </div>
      </PositionedMenu>

      {/* Mobile bottom navigation */}
      <nav className="controlbar-mobile" aria-label="Meeting controls">
        <MobileAction
          label={micEnabled ? "Mic" : "Muted"}
          active={micEnabled}
          danger={!micEnabled}
          onClick={onToggleMic}
        >
          {micEnabled ? (
            <Microphone size={22} weight="fill" aria-hidden="true" />
          ) : (
            <MicrophoneSlash size={22} weight="fill" aria-hidden="true" />
          )}
        </MobileAction>

        <MobileAction
          label={cameraEnabled ? "Camera" : "Cam off"}
          active={cameraEnabled}
          danger={!cameraEnabled}
          onClick={onToggleCamera}
        >
          {cameraEnabled ? (
            <VideoCamera size={22} weight="fill" aria-hidden="true" />
          ) : (
            <VideoCameraSlash size={22} weight="fill" aria-hidden="true" />
          )}
        </MobileAction>

        <MobileTab
          label="Chat"
          panel="chat"
          activePanel={activePanel}
          onOpenPanel={onOpenPanel}
        >
          <ChatText size={22} weight="fill" aria-hidden="true" />
        </MobileTab>

        <MobileTab
          label="People"
          panel="participants"
          activePanel={activePanel}
          onOpenPanel={onOpenPanel}
        >
          <UsersThree size={22} weight="fill" aria-hidden="true" />
        </MobileTab>

        <button
          type="button"
          className="controlbar-mobile__leave"
          onClick={onLeave}
          aria-label="Leave meeting"
        >
          <PhoneSlash size={22} weight="fill" aria-hidden="true" />
          <span className="controlbar-mobile__label">Leave</span>
        </button>
      </nav>
    </>
  );
}

/* ===================== Split mic/camera/captions control ===================== */

function SplitMediaControl({
  enabled,
  onToggle,
  onOpenMenu,
  menuOpen,
  onLabel,
  menuLabel,
  children,
  ...rest
}: {
  enabled: boolean;
  onToggle: () => void;
  onOpenMenu: (el: Element | null) => void;
  menuOpen: boolean;
  onLabel: string;
  menuLabel: string;
  children: React.ReactNode;
  "data-testid-mic"?: string;
  "data-testid-menu"?: string;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className={["ctl-split", enabled ? "ctl-split--on" : "", menuOpen ? "ctl-split--menu-open" : ""].join(" ")}>
      <button
        ref={btnRef}
        type="button"
        className={["ctl ctl--round ctl-split__main", !enabled ? "ctl--danger" : ""].join(" ")}
        onClick={onToggle}
        aria-label={onLabel}
        aria-pressed={enabled}
        title={onLabel}
        data-testid={rest["data-testid-mic"]}
      >
        {children}
      </button>
      <button
        type="button"
        className="ctl ctl-split__chev"
        onClick={(e) => {
          e.preventDefault();
          onOpenMenu(btnRef.current);
        }}
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={menuLabel}
        data-testid={rest["data-testid-menu"]}
      >
        <CaretDown size={14} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

function ControlButton({
  label,
  panel,
  activePanel,
  onOpenPanel,
  badge,
  children,
  ...rest
}: {
  label: string;
  panel: Panel;
  activePanel: Panel | null;
  onOpenPanel: (panel: Panel) => void;
  badge?: string;
  children: React.ReactNode;
  "data-testid"?: string;
}) {
  const isActive = activePanel === panel;
  return (
    <button
      type="button"
      className={["ctl ctl--round", isActive ? "ctl--panel-active" : ""].join(" ")}
      onClick={() => onOpenPanel(panel)}
      aria-label={label}
      aria-expanded={isActive}
      title={label}
      {...rest}
    >
      {children}
      {badge && <span className="ctl__badge">{badge}</span>}
    </button>
  );
}

function MobileAction({
  label,
  active,
  danger,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={[
        "controlbar-mobile__action",
        active ? "controlbar-mobile__action--on" : "",
        danger && !active ? "controlbar-mobile__action--danger" : "",
      ].join(" ")}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
      <span className="controlbar-mobile__label">{label}</span>
    </button>
  );
}

function MobileTab({
  label,
  panel,
  activePanel,
  onOpenPanel,
  children,
}: {
  label: string;
  panel: Panel;
  activePanel: Panel | null;
  onOpenPanel: (panel: Panel) => void;
  children: React.ReactNode;
}) {
  const isActive = activePanel === panel;
  return (
    <button
      type="button"
      className={[
        "controlbar-mobile__action",
        isActive ? "controlbar-mobile__action--on" : "",
      ].join(" ")}
      onClick={() => onOpenPanel(panel)}
      aria-pressed={isActive}
    >
      {children}
      <span className="controlbar-mobile__label">{label}</span>
    </button>
  );
}

/* ===================== Anchored contextual menu ===================== */

function useMenuPosition(open: boolean, anchor: Element | null) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const el = ref.current;
    if (!el) return;
    const trigger = anchor.getBoundingClientRect();
    const menu = el.getBoundingClientRect();
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer opening upward (toolbar sits near the bottom); flip to below if blocked.
    const spaceAbove = trigger.top - pad;
    const spaceBelow = vh - trigger.bottom - pad;
    const openUp = menu.height <= spaceAbove || spaceAbove >= spaceBelow;

    let top = openUp ? trigger.top - menu.height - 8 : trigger.bottom + 8;
    // Clamp inside the viewport vertically.
    top = Math.max(pad, Math.min(top, vh - menu.height - pad));

    // Center horizontally on the trigger, then clamp to avoid horizontal overflow.
    let left = trigger.left + trigger.width / 2 - menu.width / 2;
    left = Math.max(pad, Math.min(left, vw - menu.width - pad));

    setPos({ top, left });
  }, [open, anchor, ref]);

  return { ref, pos };
}

function PositionedMenu({
  open,
  anchor,
  onClose,
  label,
  children,
}: {
  open: boolean;
  anchor: Element | null;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const { ref, pos } = useMenuPosition(open, anchor);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (ref.current && !ref.current.contains(t) && !(anchor && anchor.contains(t))) {
        onClose();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", key);
    };
  }, [open, anchor, onClose, ref]);

  if (!open || !anchor) return null;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="ctl-menu"
      style={{ top: pos.top, left: pos.left }}
    >
      <p className="ctl-menu__title">{label}</p>
      {children}
    </div>
  );
}

function DeviceMenu({
  title,
  devices,
  selectedId,
  placeholder,
  error,
  onSelect,
  onClose,
}: {
  title: string;
  devices: DeviceInfo[];
  selectedId: string | null | undefined;
  placeholder: string;
  error?: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const noExplicit = selectedId == null || !devices.some((d) => d.deviceId === selectedId);

  return (
    <div className="ctl-menu__body">
      {noExplicit && (
        <MenuRadioItem
          label={placeholder}
          checked={selectedId == null || !devices.some((d) => d.deviceId === selectedId)}
          onClick={onClose}
        />
      )}
      {devices.length === 0 ? (
        <p className="ctl-menu__empty">No {title.toLowerCase()} available</p>
      ) : (
        devices.map((d) => (
          <MenuRadioItem
            key={d.deviceId}
            label={d.label && d.label.trim() ? d.label : title}
            checked={selectedId === d.deviceId}
            onClick={() => {
              onSelect(d.deviceId);
              onClose();
            }}
          />
        ))
      )}
      {error && <p className="ctl-menu__error">{error}</p>}
    </div>
  );
}

function MenuRadioItem({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className={["ctl-menu__item ctl-menu__item--radio", checked ? "ctl-menu__item--on" : ""].join(" ")}
      onClick={onClick}
    >
      <span className="ctl-menu__radio" aria-hidden="true">
        {checked ? "●" : "○"}
      </span>
      <span className="ctl-menu__text">{label}</span>
    </button>
  );
}
