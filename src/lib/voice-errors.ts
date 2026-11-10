export function voiceErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const detail = `${name} ${message}`;

  // Scribe wraps DOMExceptions in Error, so also recognize the browser's message.
  if (
    /NotAllowedError|PermissionDeniedError|permission denied|permission dismissed|request is not allowed|denied permission/i.test(
      detail,
    )
  ) {
    return "Microphone access is blocked. Allow microphone access in your browser’s site settings, then try Voice again. You can keep typing.";
  }
  if (/NotFoundError|DevicesNotFoundError|requested device not found/i.test(detail)) {
    return "No microphone found. Connect a microphone, then try Voice again. You can keep typing.";
  }
  if (/NotReadableError|TrackStartError|could not start audio source/i.test(detail)) {
    return "Your microphone is unavailable. Check your system microphone permissions and close other apps using it, then try Voice again.";
  }
  return message || "Could not start voice. Please try again. You can keep typing.";
}
