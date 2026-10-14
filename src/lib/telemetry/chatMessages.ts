import type {
  AssistantOutput,
  AssistantReply,
  AssistantToolCall,
  ObservationToolCall,
} from "../types/index.js";
import { stringify } from "./spanSerialization.js";

function chatToolCall(call: AssistantToolCall): ObservationToolCall {
  const args =
    call.args ?? call.input ?? call.arguments ?? call.function?.arguments;
  return {
    id: call.id ?? call.toolCallId,
    type: "function",
    function: {
      name: call.name ?? call.toolName ?? call.function?.name,
      arguments: typeof args === "string" ? args : stringify(args ?? {}),
    },
  };
}

function isChatMessages(output: object[]): boolean {
  return (
    output.length > 0 &&
    output.every((entry) => "role" in entry && typeof entry.role === "string")
  );
}

function isAssistantReply(output: AssistantOutput): output is AssistantReply {
  return (
    typeof output === "object" &&
    !Array.isArray(output) &&
    ("text" in output || "toolCalls" in output)
  );
}

/**
 * @description Reads the role of a chat message, treating anything without a string role as a user message.
 * @param message {T} - Message of any provider shape.
 * @returns {string} The message role, or `user` when it declares none.
 */
export function messageRole<T>(message: T): string {
  return typeof message === "object" &&
    message !== null &&
    "role" in message &&
    typeof message.role === "string"
    ? message.role
    : "user";
}

/**
 * @description Shapes a model response as an assistant message array that Langfuse renders as a conversation.
 * @param output {AssistantOutput | undefined} - A text string, a reply with `text`, `reasoning` and `toolCalls`, a message array, or provider content parts.
 * @returns {object[] | undefined} `[{ role: "assistant", content, tool_calls? }]`, the input untouched when it is already a message array, or `undefined` when there is no output.
 */
export function assistantMessages(
  output: AssistantOutput | undefined,
): object[] | undefined {
  if (output === undefined) {
    return undefined;
  }
  if (Array.isArray(output) && isChatMessages(output)) {
    return output;
  }
  if (!isAssistantReply(output)) {
    return [{ role: "assistant", content: output }];
  }
  const toolCalls = (output.toolCalls ?? []).map(chatToolCall);
  return [
    {
      role: "assistant",
      content: output.text ?? "",
      ...(output.reasoning ? { reasoning: output.reasoning } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
  ];
}
