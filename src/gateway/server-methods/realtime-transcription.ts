import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  getRealtimeTranscriptionSessionManager,
  __testing as managerTesting,
} from "../realtime-transcription-session-manager.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers } from "./types.js";

function parsePositiveNumber(value: unknown, name: string): number {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return number;
}

function parseSessionId(value: unknown): string {
  const sessionId = typeof value === "string" ? value.trim() : "";
  if (!sessionId) {
    throw new Error("sessionId is required.");
  }
  return sessionId;
}

function parseAudioBuffer(value: unknown): Buffer {
  const audio = typeof value === "string" ? value.trim() : "";
  if (!audio) {
    throw new Error("audio is required.");
  }
  try {
    return Buffer.from(audio, "base64");
  } catch {
    throw new Error("audio must be base64 encoded.");
  }
}

export const realtimeTranscriptionHandlers: GatewayRequestHandlers = {
  "realtimeTranscription.start": async ({ params, respond }) => {
    try {
      const format = managerTesting.normalizeAudioFormat(
        typeof params.format === "string" ? params.format : undefined,
      );
      if (!format) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "format is required and must be one of: s16le, pcm16, g711_ulaw",
          ),
        );
        return;
      }
      const result = await getRealtimeTranscriptionSessionManager().startSession({
        provider: typeof params.provider === "string" ? params.provider.trim() : undefined,
        providerConfig:
          params.providerConfig && typeof params.providerConfig === "object"
            ? (params.providerConfig as Record<string, unknown>)
            : undefined,
        format,
        sampleRate: parsePositiveNumber(params.sampleRate, "sampleRate"),
        channels: parsePositiveNumber(params.channels, "channels"),
      });
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatForLog(err)));
    }
  },
  "realtimeTranscription.pushAudio": async ({ params, respond }) => {
    try {
      const result = getRealtimeTranscriptionSessionManager().pushAudio({
        sessionId: parseSessionId(params.sessionId),
        audio: parseAudioBuffer(params.audio),
      });
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatForLog(err)));
    }
  },
  "realtimeTranscription.pull": async ({ params, respond }) => {
    try {
      const result = getRealtimeTranscriptionSessionManager().pullEvents({
        sessionId: parseSessionId(params.sessionId),
        limit: params.limit === undefined ? undefined : parsePositiveNumber(params.limit, "limit"),
      });
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatForLog(err)));
    }
  },
  "realtimeTranscription.finish": async ({ params, respond }) => {
    try {
      const result = getRealtimeTranscriptionSessionManager().finishSession({
        sessionId: parseSessionId(params.sessionId),
        reason: typeof params.reason === "string" ? params.reason : undefined,
      });
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatForLog(err)));
    }
  },
};
