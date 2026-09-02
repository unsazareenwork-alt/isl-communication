import { useEffect, useRef } from "react";

const FRAME_INTERVAL_MS = 200;
const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 480;
const JPEG_QUALITY = 0.65;
const AI_WS_URL = "ws://127.0.0.1:8765";

interface UseSignLanguageAIOptions {
  stream: MediaStream | null;
  meetingId: string;
  enabled: boolean;
}

export function useSignLanguageAI({
  stream,
  meetingId,
  enabled,
}: UseSignLanguageAIOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visibleRef = useRef(true);

  useEffect(() => {
    visibleRef.current = true;

    if (!enabled || !stream || !meetingId) return;

    const video = document.createElement("video");
    video.setAttribute("playsinline", "");
    video.muted = true;
    video.srcObject = stream;
    videoRef.current = video;
    console.log("[ISL AI] Hidden video created, stream assigned:", stream.id, "tracks:", stream.getTracks().length);

    const canvas = document.createElement("canvas");
    canvas.width = FRAME_WIDTH;
    canvas.height = FRAME_HEIGHT;
    canvasRef.current = canvas;

    let tickCount = 0;
    function sendFrame() {
      if (!visibleRef.current) return;
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (!ctx || !c || !videoRef.current || videoRef.current.readyState < 2) return;

      tickCount++;
      if (tickCount % 25 === 1) {
        console.log("[ISL AI] capture loop tick #" + tickCount + " (readyState:", videoRef.current.readyState + ")");
      }

      ctx.drawImage(videoRef.current, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      console.log("[ISL AI] canvas.toDataURL() called (tick #" + tickCount + ")");
      const dataUrl = c.toDataURL("image/jpeg", JPEG_QUALITY);
      const base64 = dataUrl.split(",")[1];
      console.log("[ISL AI] frame encoded, base64 length:", base64.length);

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("[ISL AI] Sending frame", base64.length, "readyState", ws.readyState);
        ws.send(JSON.stringify({ type: "frame", data: base64 }));
      } else {
        console.log("[ISL AI] frame dropped — ws:", !!ws, "readyState:", ws?.readyState);
      }
    }

    function startCapture() {
      if (frameLoopRef.current !== null) return;
      frameLoopRef.current = setInterval(sendFrame, FRAME_INTERVAL_MS);
    }

    function stopCapture() {
      if (frameLoopRef.current !== null) {
        clearInterval(frameLoopRef.current);
        frameLoopRef.current = null;
      }
    }

    function connectWs() {
      if (wsRef.current) return;

      const ws = new WebSocket(AI_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[ISL AI] WebSocket opened");
        ws.send(JSON.stringify({ type: "init", meetingId }));
        console.log("[ISL AI] capture interval starting (every", FRAME_INTERVAL_MS, "ms)");
        startCapture();
      };

      ws.onerror = (event) => {
        console.error("[ISL AI] WebSocket error:", event);
        stopCapture();
        wsRef.current = null;
      };

      ws.onclose = (event) => {
        console.log("[ISL AI] WebSocket closed, code:", event.code, "reason:", event.reason);
        stopCapture();
        wsRef.current = null;
      };
    }

    video.onloadeddata = () => {
      console.log("[ISL AI] video onloadeddata fired, readyState:", video.readyState);
      connectWs();
    };

    console.log("[ISL AI] video.play() started");
    void video.play().then(() => {
      console.log("[ISL AI] video.play() resolved successfully");
    }).catch((err) => {
      console.error("[ISL AI] video.play() rejected:", err);
    });

    return () => {
      visibleRef.current = false;
      stopCapture();

      const ws = wsRef.current;
      if (ws) {
        ws.onopen = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
        wsRef.current = null;
      }

      video.srcObject = null;
      videoRef.current = null;
      canvasRef.current = null;
    };
  }, [stream, meetingId, enabled]);
}
