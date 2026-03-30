# Department and Teams Chat Audit

Date: 2026-03-30

## Summary

The Department and Teams chat panels are not aligned with the OpenClaw integration design in `mission-control/docs/openclaw-chat-integration.md`.

## Problems Identified

1. The panels use `EmbeddedChat`, which sends messages through `POST /api/chat/messages` and loads history via `/api/chat/messages`, instead of using WebSocket `chat.send` and `chat.history`. This should only be implemented for OpenClaw Agents.
2. The client does not handle streaming `chat` events, so there is no delta/final streaming response flow in the panel chat UI.
3. There is no shared chat stream state such as `isStreaming`, `streamingText`, `runId`, or per-session streaming state.
4. There is no abort flow for active chat generation in the Department or Teams chat panels.
5. Department and Teams chats use synthetic conversation IDs like `dept:<id>` and `team:<id>`, but the documented integration is session-key based.
6. The backend forwards outbound chat by agent name and tries to infer a session, instead of having the panel send an explicit `sessionKey`.
7. I could not find a generic path that persists normal agent replies back into the same `dept:*` or `team:*` conversations. Coordinator-specific `coord:*` threads have custom reply persistence, but the normal Department and Teams threads do not.
8. `EmbeddedChat` keeps its own local `messages` state instead of reading from the shared chat store.
9. `EmbeddedChat` enables `pauseWhenSseConnected`, but because it does not bind to the SSE-fed store, the panel can become stale while polling is paused.
10. Local busy/offline/error status messages are injected only in component state and are not persisted, so they can disappear on reload and may not match actual gateway delivery outcome.
11. The backend `chat.send` payload shape diverges from the integration doc by sending a raw string message instead of the documented structured message object.

## Todo List

- Replace Department and Teams panel chat send flow with WebSocket `chat.send`.
- Add a request/response RPC helper to `mission-control/src/lib/websocket.ts`.
- Add `frame.event === "chat"` handling in `mission-control/src/lib/websocket.ts`.
- Add shared streaming chat state to `mission-control/src/store/index.ts`.
- Add a `useChatStream` hook or equivalent shared abstraction for send/abort/stream state.
- Render in-progress assistant output in the chat UI.
- Load panel chat history through `chat.history` instead of `/api/chat/messages` polling.
- Add `chat.abort` support and a visible abort control while generation is active.
- Resolve and pass explicit `sessionKey` values for Department and Teams chats.
- Define and implement how replies for `dept:*` and `team:*` chats are surfaced or persisted.
- Remove the local-only message source in `EmbeddedChat` and bind it to the shared store, or stop pausing polling on SSE.
- Persist or redesign the local status banners so they reflect actual delivery/runtime state.
