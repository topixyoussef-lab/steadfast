"use client";

import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";
import {
  formatDuration,
  normalizeRecordedAudio,
  pickRecorderMime,
} from "@/lib/media";
import type { RecordedClip } from "@/lib/media";

export const MAX_RECORD_SECONDS = 120;

/**
 * Voice notes.
 *
 * MediaRecorder is used directly rather than a library, because the app has no
 * dependencies and the surface needed here is small: record, stop, hand over a
 * Blob and its duration. Nothing leaves the device until the member sends it.
 *
 * Three things this has to get right, all of which are about not losing a
 * person's message:
 *
 *  - the stream is stopped on unmount and on every error path, or the browser's
 *    recording indicator stays on and the next recording captures silence;
 *  - permission denial and an insecure origin are separate messages, because
 *    "it did not work" sends somebody looking for a bug that is not there;
 *  - a recording still in progress when the member navigates away is not lost
 *    silently: the onbeforeunload guard turns it into a browser prompt.
 */
export function VoiceRecorder({
  disabled,
  onRecorded,
  onError,
}: {
  disabled?: boolean;
  onRecorded: (clip: RecordedClip) => void;
  onError: (message: string) => void;
}) {
  const { dict } = useI18n();

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function releaseStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function stopTimers() {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  // Cleanup on unmount. Without this the tracks keep running and the tab's
  // recording dot stays lit after the member has left the room.
  useEffect(
    () => () => {
      stopTimers();
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      recorderRef.current = null;
      releaseStream();
    },
    [],
  );

  // A recording in progress is unsent work. The browser's own prompt is the
  // right one here: a custom dialog would have to re-implement what every other
  // app already does well.
  useEffect(() => {
    if (!recording) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [recording]);

  function startTicking() {
    startedRef.current = Date.now();
    setElapsed(0);
    stopTimers();
    tickRef.current = setInterval(() => {
      const seconds = (Date.now() - startedRef.current) / 1000;
      setElapsed(seconds);
      // The ceiling is enforced here rather than by hoping the member stops:
      // a voice note nobody meant to leave running is worse than a cut one.
      if (seconds >= MAX_RECORD_SECONDS) stop();
    }, 200);
  }

  async function start() {
    if (disabled || busy || recording) return;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onError(dict.community.voiceUnavailable);
      return;
    }

    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const mimeType = pickRecorderMime();
      if (!mimeType) {
        releaseStream();
        onError(dict.community.voiceUnsupported);
        return;
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        stopTimers();
        releaseStream();
        setRecording(false);
        onError(dict.community.voiceFailed);
      };

      recorder.onstop = () => {
        stopTimers();
        releaseStream();
        setRecording(false);
        setElapsed(0);

        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        if (blob.size === 0) {
          onError(dict.community.voiceEmpty);
          return;
        }

        // Reduced to one of the accepted types or refused; the upload route
        // checks the same list again.
        const accepted = normalizeRecordedAudio(mimeType);
        if (!accepted) {
          onError(dict.community.voiceUnsupported);
          return;
        }

        onRecorded({
          blob: new Blob([blob], { type: accepted }),
          mimeType: accepted,
          durationSeconds: Math.min(
            MAX_RECORD_SECONDS,
            Math.max(0, (Date.now() - startedRef.current) / 1000),
          ),
        });
      };

      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
      startTicking();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        onError(dict.community.voicePermissionDenied);
      } else if (name === "NotFoundError") {
        onError(dict.community.voiceNoMicrophone);
      } else {
        onError(dict.community.voiceFailed);
      }
      releaseStream();
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    // onstop does the rest: it builds the Blob, releases the microphone and
    // clears the recording state, so there is one path out of a recording.
    recorder.stop();
  }

  function cancel() {
    const recorder = recorderRef.current;
    chunksRef.current = [];
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    stopTimers();
    releaseStream();
    setRecording(false);
    setElapsed(0);
  }

  return (
    <div className="flex items-center gap-2">
      {recording ? (
        <>
          <span className="flex items-center gap-2 rounded-full bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger">
            <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
            {formatDuration(elapsed)}
          </span>

          <button
            type="button"
            onClick={cancel}
            className="h-11 rounded-2xl px-3 text-xs font-medium text-muted transition hover:text-ink"
          >
            {dict.common.cancel}
          </button>

          <button
            type="button"
            onClick={stop}
            autoFocus
            className="flex h-11 items-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-contrast transition hover:bg-accent-strong"
          >
            <span className="h-2.5 w-2.5 rounded-[2px] bg-accent-contrast" />
            {dict.community.voiceStop}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          disabled={disabled || busy}
          aria-label={dict.community.voiceStart}
          title={dict.community.voiceStart}
          aria-busy={busy}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line text-muted transition",
            "hover:border-accent hover:text-accent",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <MicGlyph />
        </button>
      )}
    </div>
  );
}

function MicGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      className="h-5 w-5"
      aria-hidden
    >
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3.5" />
    </svg>
  );
}
