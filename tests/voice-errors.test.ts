import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceErrorMessage } from "../src/lib/voice-errors";

test("microphone denial gives browser permission guidance, including Scribe-wrapped errors", () => {
  for (const error of [
    new DOMException("Permission denied", "NotAllowedError"),
    new Error("Permission denied"),
    new Error("Permission dismissed"),
    new Error("The request is not allowed by the user agent"),
  ]) {
    const message = voiceErrorMessage(error);
    assert.match(message, /browser’s site settings/);
    assert.match(message, /keep typing/);
    assert.doesNotMatch(message, /key|credits/i);
  }
});

test("missing and unavailable microphones give distinct recovery instructions", () => {
  assert.match(voiceErrorMessage(new DOMException("", "NotFoundError")), /Connect a microphone/);
  assert.match(
    voiceErrorMessage(new DOMException("", "NotReadableError")),
    /system microphone permissions/,
  );
});

test("provider errors retain their actionable message", () => {
  assert.equal(
    voiceErrorMessage(new Error("Voice service is not configured.")),
    "Voice service is not configured.",
  );
  assert.match(voiceErrorMessage(undefined), /Could not start voice/);
});
