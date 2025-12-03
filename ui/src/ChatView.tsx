import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { connectSpider, parseRateLimitError, spiderChat, spiderMcpServers, spiderStatus } from './spider/api';
import RateLimitModal from './RateLimitModal';
import { useTodoStore } from './store/todo';
import { webSocketService } from './spider/websocket';
import {
  SpiderChatResult,
  SpiderConversationMetadata,
  SpiderMessage,
  SpiderMessageContent,
  WsServerMessage,
} from './types/spider';

interface ToolCall {
  id: string;
  tool_name: string;
  parameters: string;
}

interface ToolResult {
  tool_call_id: string;
  result: string;
}

interface ChatViewProps {
  resetToken: number;
}

const MODEL_ID = 'claude-sonnet-4-5-20250929';
const LLM_PROVIDER = 'anthropic';

const defaultMetadata = (fromStt = false): SpiderConversationMetadata => ({
  startTime: new Date().toISOString(),
  client: 'todo-app',
  fromStt: fromStt,
});

const normalizeContent = (incoming: any): SpiderMessageContent => {
  if (!incoming) return {};
  if (typeof incoming === 'string') return { text: incoming };
  if ('Text' in incoming) return { text: (incoming as any).Text };
  if ('BaseSixFourAudio' in incoming) return { base_six_four_audio: (incoming as any).BaseSixFourAudio };
  if ('Audio' in incoming) return { audio: (incoming as any).Audio };
  return incoming as SpiderMessageContent;
};

const normalizeMessage = (incoming: SpiderMessage): SpiderMessage => ({
  ...incoming,
  content: normalizeContent((incoming as any).content ?? (incoming as any)),
});

const buildPrimingMessages = (): SpiderMessage[] => {
  const now = Date.now();
  const toolCall = [
    {
      id: 'toolu_abc',
      tool_name: 'hyperware_get_api',
      parameters: { package_id: 'todo:ware.hypr' },
    },
  ];
  const toolResultPayload =
    '[{"definition":"String","documentation":"In types passed from kernel, node-id will be a valid Kimap entry.","name":"NodeId"},{"definition":{"properties":{"package_name":"String","process_name":"String","publisher_node":"NodeId"},"type":"object"},"documentation":null,"name":"ProcessId"},{"definition":{"properties":{"package_name":"String","publisher_node":"NodeId"},"type":"object"},"documentation":null,"name":"PackageId"},{"definition":{"properties":{"node":"NodeId","process":"ProcessId"},"type":"object"},"documentation":null,"name":"Address"},{"definition":"Address","documentation":null,"name":"Address","process_name":"todo"},{"definition":{"properties":{"accent":{"type":"option","value":"String"},"content":"String","id":{"type":"option","value":"u64"},"linked_entry_ids":{"items":"u64","type":"array"},"pinned":"bool","tags":{"items":"String","type":"array"},"title":"String"},"type":"object"},"documentation":null,"name":"NoteDraft","process_name":"todo"},{"definition":{"type":"enum","values":["Overdue","Today","ThisWeek","ThisMonth","Later","Someday","Completed"]},"documentation":null,"name":"EntryTimescale","process_name":"todo"},{"definition":{"properties":{"accent":"String","content":"String","id":"u64","last_edited_ts":"i64","linked_entry_ids":{"items":"u64","type":"array"},"pinned":"bool","summary":"String","tags":{"items":"String","type":"array"},"title":"String"},"type":"object"},"documentation":null,"name":"Note","process_name":"todo"},{"definition":{"type":"enum","values":["Backlog","UpNext","InProgress","Blocked","Review","Done"]},"documentation":null,"name":"EntryStatus","process_name":"todo"},{"definition":{"type":"enum","values":["Low","Medium","High"]},"documentation":null,"name":"EntryPriority","process_name":"todo"},{"definition":{"properties":{"assignees":{"items":"String","type":"array"},"dependencies":{"items":"u64","type":"array"},"description":"String","due_ts":{"type":"option","value":"i64"},"id":{"type":"option","value":"u64"},"note_ids":{"items":"u64","type":"array"},"priority":"EntryPriority","project":{"type":"option","value":"String"},"start_ts":{"type":"option","value":"i64"},"status":"EntryStatus","summary":"String","title":"String"},"type":"object"},"documentation":null,"name":"EntryDraft","process_name":"todo"},{"definition":{"properties":{"assignees":{"items":"String","type":"array"},"completed_at_ts":{"type":"option","value":"i64"},"dependencies":{"items":"u64","type":"array"},"description":"String","due_ts":{"type":"option","value":"i64"},"id":"u64","is_completed":"bool","note_ids":{"items":"u64","type":"array"},"priority":"EntryPriority","project":{"type":"option","value":"String"},"start_ts":{"type":"option","value":"i64"},"status":"EntryStatus","summary":"String","timescale":"EntryTimescale","title":"String"},"type":"object"},"documentation":null,"name":"Entry","process_name":"todo"},{"definition":{"properties":{"entries":{"items":"Entry","type":"array"},"notes":{"items":"Note","type":"array"}},"type":"object"},"documentation":null,"name":"AppBootstrap","process_name":"todo"},{"definition":{"properties":{"entries":{"items":"Entry","type":"array"},"notes":{"items":"Note","type":"array"}},"type":"object"},"documentation":null,"name":"SearchAllResult","process_name":"todo"},{"definition":{"properties":{"arg_types":{"items":["u64"],"type":"tuple"},"returning":{"err":"String","ok":"bool","type":"result"},"target":"Address"},"type":"object"},"documentation":"Function signature for: delete-entry (local)\nargs: (entry-id: u64)\njson fmt: {\"DeleteEntry\": entry_id}","name":"DeleteEntrySignatureLocal","process_name":"todo"},{"definition":{"properties":{"arg_types":{"items":["u64"],"type":"tuple"},"returning":{"err":"String","ok":"bool","type":"result"},"target":"Address"},"type":"object"},"documentation":"Function signature for: delete-note (local)\nargs: (note-id: u64)\njson fmt: {\"DeleteNote\": note_id}","name":"DeleteNoteSignatureLocal","process_name":"todo"},{"definition":{"properties":{"arg_types":{"items":["EntryDraft"],"type":"tuple"},"returning":{"err":"String","ok":"Entry","type":"result"},"target":"Address"},"type":"object"},"documentation":"Function signature for: save-entry (local)\nargs: (draft: entry-draft)\njson fmt: {\"SaveEntry\": draft}","name":"SaveEntrySignatureLocal","process_name":"todo"},{"definition":{"properties":{"arg_types":{"items":["NoteDraft"],"type":"tuple"},"returning":{"err":"String","ok":"Note","type":"result"},"target":"Address"},"type":"object"},"documentation":"Function signature for: save-note (local)\nargs: (draft: note-draft)\njson fmt: {\"SaveNote\": draft}","name":"SaveNoteSignatureLocal","process_name":"todo"},{"definition":{"properties":{"arg_types":{"items":[{"type":"option","value":"String"}],"type":"tuple"},"returning":{"err":"String","ok":"SearchAllResult","type":"result"},"target":"Address"},"type":"object"},"documentation":"Function signature for: search-all (local)\nargs: (query: option<string>)\njson fmt: {\"SearchAll\": query}","name":"SearchAllSignatureLocal","process_name":"todo"},{"definition":{"properties":{"arg_types":{"items":["u64","bool"],"type":"tuple"},"returning":{"err":"String","ok":"Entry","type":"result"},"target":"Address"},"type":"object"},"documentation":"Function signature for: toggle-entry-completion (local)\nargs: (entry-id: u64, completed: bool)\njson fmt: {\"ToggleEntryCompletion\": [entry_id, completed]}","name":"ToggleEntryCompletionSignatureLocal","process_name":"todo"}]';
  return [
    {
      role: 'user',
      content: {
        text: `You are an expert personal assistant, helping the user organize their life. You make use of the todo tool in particular, and the other tools in general, to carry out the user's requests. The todo tool has process_id: 'todo:todo:ware.hypr'. You create tasks, mark existing tasks as completed, write notes, link them, and so on. When creating tasks and notes, fill in metadata to the best of your ability. In summarizing the work you've done for the user, you respond in a terse, efficient, polite manner and use only one or two sentences, totaling twenty words or less. The current time is ${now}. Respond to this message only with 'Acknowleged.' and prepare for the user's request in the next message.`,
      },
      timestamp: now,
      hidden: true,
    },
    {
      role: 'assistant',
      content: { text: '.' },
      toolCallsJson: JSON.stringify(toolCall),
      timestamp: now + 1,
      hidden: true,
    },
    {
      role: 'user',
      content: { text: '.' },
      toolResultsJson: JSON.stringify([{ tool_call_id: 'toolu_abc', result: toolResultPayload }]),
      timestamp: now + 2,
      hidden: true,
    },
    {
      role: 'assistant',
      content: { text: 'Acknowledged.' },
      timestamp: now + 3,
      hidden: true,
    },
  ];
};

const SUGGESTED_PROMPTS = [
  {
    label: 'What can you do?',
    value: 'How can you help me manage my todos and notes?',
  },
  {
    label: 'Make a task',
    value: 'Create a new task assigned to me to have lunch with Mr Anderson tomorrow at noon',
  },
  {
    label: 'Summarize upcoming tasks',
    value: 'What tasks do I have coming up this week?',
  },
  {
    label: 'Make a note',
    value: 'Create a new note: grocery list, chicken, carrots, celery, lemon, orzo, onion, garlic, broth, link https://pipingpotcurry.com/lemon-chicken-orzo-pressure-cooker#:~:text=Equipment',
  },
];

export default function ChatView({ resetToken }: ChatViewProps) {
  const isPublicMode = useTodoStore((state) => state.isPublicMode);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const apiKeyRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<SpiderMessage[]>([]);
  const messagesRef = useRef<SpiderMessage[]>([]);
  const visibleMessages = useMemo(
    () => messages.filter((msg) => !msg.hidden),
    [messages],
  );
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState('');
  const [connectedMcpServers, setConnectedMcpServers] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<SpiderConversationMetadata>(() => defaultMetadata());
  const metadataRef = useRef<SpiderConversationMetadata>(metadata);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useWebSocket, setUseWebSocket] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const messageHandlerRef = useRef<((message: WsServerMessage) => void) | null>(null);
  const wsCleanupRef = useRef<(() => void) | null>(null);
  const connectingRef = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const audioUrlCacheRef = useRef<Map<number, string>>(new Map());
  const autoPlayedAudioRef = useRef<Set<number>>(new Set());
  const audioPlayersRef = useRef<Map<number, HTMLAudioElement>>(new Map());
  const currentAudioRef = useRef<number | null>(null);
  const messageElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastMessageSourceRef = useRef<'user' | 'assistant' | null>(null);
  const [selectedToolCall, setSelectedToolCall] = useState<{ call: ToolCall; result?: ToolResult } | null>(null);
  const [rateLimitModal, setRateLimitModal] = useState<{ visible: boolean; retryAfterSeconds: number | null }>({
    visible: false,
    retryAfterSeconds: null,
  });

  const parseToolCalls = (raw?: string | null): ToolCall[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as ToolCall[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const parseToolResults = (raw?: string | null): ToolResult[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as ToolResult[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const ensureAudioUrl = (message: SpiderMessage): string | null => {
    const cached = audioUrlCacheRef.current.get(message.timestamp);
    if (cached) return cached;
    const content = message.content || {};
    if (content.base_six_four_audio) {
      const url = `data:audio/webm;base64,${content.base_six_four_audio}`;
      audioUrlCacheRef.current.set(message.timestamp, url);
      return url;
    }
    if (content.audio && Array.isArray(content.audio) && content.audio.length > 0) {
      const bytes = new Uint8Array(content.audio);
      const blob = new Blob([bytes.buffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      audioUrlCacheRef.current.set(message.timestamp, url);
      return url;
    }
    return null;
  };

  const playAudioForMessage = (message: SpiderMessage) => {
    const url = ensureAudioUrl(message);
    if (!url) return;
    let player = audioPlayersRef.current.get(message.timestamp);
    if (!player) {
      player = new Audio(url);
      player.addEventListener('ended', () => {
        if (currentAudioRef.current === message.timestamp) {
          currentAudioRef.current = null;
        }
      });
      audioPlayersRef.current.set(message.timestamp, player);
    } else if (player.src !== url) {
      player.src = url;
    }

    const isCurrentlyPlaying = currentAudioRef.current === message.timestamp && !player.paused;
    if (isCurrentlyPlaying) {
      player.pause();
      player.currentTime = 0;
      currentAudioRef.current = null;
      return;
    }

    if (currentAudioRef.current && currentAudioRef.current !== message.timestamp) {
      const current = audioPlayersRef.current.get(currentAudioRef.current);
      if (current) {
        current.pause();
        current.currentTime = 0;
      }
    }

    currentAudioRef.current = message.timestamp;
    void player.play().catch(() => {
      // Ignore playback errors (e.g. autoplay restrictions)
      currentAudioRef.current = null;
    });
  };

  const ensureSpiderConnection = useCallback(async (): Promise<string | null> => {
    if (connectingRef.current) {
      return apiKeyRef.current;
    }

    connectingRef.current = true;
    try {
      const currentStatus = await spiderStatus();
      if (!currentStatus.spider_available) {
        setError('Spider is not available on this node.');
        return null;
      }
      const response = await connectSpider(false);
      apiKeyRef.current = response.api_key;
      setApiKey(response.api_key);
      setError(null);
      return response.api_key;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach Spider.');
      return null;
    } finally {
      connectingRef.current = false;
    }
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages, visibleMessages.length]);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    const url = ensureAudioUrl(last);
    if (url && !autoPlayedAudioRef.current.has(last.timestamp)) {
      autoPlayedAudioRef.current.add(last.timestamp);
      playAudioForMessage(last);
    }
  }, [messages]);

  // Auto-scroll when new messages appear
  useLayoutEffect(() => {
    if (visibleMessages.length === 0) return;

    const lastMessage = visibleMessages[visibleMessages.length - 1];
    const messageKey = `${lastMessage.timestamp}-${visibleMessages.length - 1}`;
    const messageElement = messageElementsRef.current.get(messageKey);

    // Use requestAnimationFrame to ensure DOM has been updated
    requestAnimationFrame(() => {
      if (lastMessageSourceRef.current === 'user') {
        // For user messages: scroll so the entire message is visible
        if (messageElement) {
          messageElement.scrollIntoView({
            behavior: 'smooth',
            block: 'end',
          });
        } else if (logRef.current) {
          // Fallback to scrolling to bottom
          logRef.current.scrollTop = logRef.current.scrollHeight;
        }
      } else if (lastMessageSourceRef.current === 'assistant') {
        // For assistant messages: scroll so the top of the message is at the top of the screen
        if (messageElement) {
          messageElement.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }
      }
    });
  }, [messages]);

  useEffect(() => {
    apiKeyRef.current = apiKey;
  }, [apiKey]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (cancelled) return;
      await ensureSpiderConnection();
    };

    void bootstrap();

    const interval = window.setInterval(() => {
      if (!apiKeyRef.current) {
        void ensureSpiderConnection();
      }
    }, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (wsCleanupRef.current) {
        wsCleanupRef.current();
        wsCleanupRef.current = null;
      }
      if (messageHandlerRef.current) {
        webSocketService.removeMessageHandler(messageHandlerRef.current);
      }
      webSocketService.disconnect();
    };
  }, [ensureSpiderConnection]);

  useEffect(() => {
    setMessages([]);
    messagesRef.current = [];
    setConversationId(null);
    const freshMeta = defaultMetadata();
    setMetadata(freshMeta);
    metadataRef.current = freshMeta;
    setMessageDraft('');
    setError(null);
    setIsLoading(false);
    // Clear message element refs
    messageElementsRef.current.clear();
    lastMessageSourceRef.current = null;
  }, [resetToken]);

  useEffect(() => {
    if (!apiKey) return;

    void fetchMcpServers(apiKey);

    if (!useWebSocket) return;

    let cancelled = false;
    const connect = async () => {
      try {
        const cleanup = await openWebSocket(apiKey);
        if (cancelled && cleanup) {
          cleanup();
          return;
        }
        wsCleanupRef.current = cleanup;
      } catch (err) {
        setUseWebSocket(false);
        setError('Spider WebSocket unavailable, using HTTP instead.');
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (wsCleanupRef.current) {
        wsCleanupRef.current();
        wsCleanupRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, useWebSocket]);

  useEffect(
    () => () => {
      audioUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      audioUrlCacheRef.current.clear();
      audioPlayersRef.current.forEach((player) => {
        player.pause();
        player.currentTime = 0;
      });
      audioPlayersRef.current.clear();
      currentAudioRef.current = null;
      messageElementsRef.current.clear();
      lastMessageSourceRef.current = null;
    },
    [],
  );

  const fetchMcpServers = async (key: string) => {
    try {
      const result = await spiderMcpServers(key);
      const connectedIds = (result.servers || [])
        .map((server: any) => (server?.connected ? server.id || server.name : null))
        .filter(Boolean) as string[];
      setConnectedMcpServers(connectedIds);
    } catch {
      // Ignore MCP listing errors but keep UI responsive
    }
  };

  const openWebSocket = async (key: string) => {
    const handler = (message: WsServerMessage) => {
      switch (message.type) {
        case 'auth_success':
          setError(null);
          break;
        case 'auth_error':
          setUseWebSocket(false);
          setError(message.error || 'Spider authentication failed.');
          break;
        case 'message':
          setMessages((prev) => {
            const normalized = normalizeMessage(message.message);
            const next = [...prev, normalized];
            messagesRef.current = next;
            if (normalized.role === 'assistant') {
              lastMessageSourceRef.current = 'assistant';
            }
            return next;
          });
          break;
        case 'stream':
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            const streamContent: SpiderMessageContent | undefined = message.message
              ? normalizeContent(message.message)
              : undefined;
            if (!last || last.role !== 'assistant') {
              next.push({
                role: 'assistant',
                content: streamContent || { text: '' },
                toolCallsJson: message.tool_calls,
                timestamp: Date.now(),
              });
              lastMessageSourceRef.current = 'assistant';
            } else {
              const mergedContent: SpiderMessageContent = { ...last.content };
              let preservedText = last.preservedText;
              if (streamContent) {
                const incomingHasAudio =
                  !!streamContent.base_six_four_audio ||
                  (Array.isArray(streamContent.audio) && streamContent.audio.length > 0);
                if (incomingHasAudio && !streamContent.text && last.content?.text && !preservedText) {
                  preservedText = last.content.text;
                }
                if (streamContent.text !== undefined) mergedContent.text = streamContent.text;
                if (streamContent.base_six_four_audio !== undefined) {
                  mergedContent.base_six_four_audio = streamContent.base_six_four_audio;
                }
                if (streamContent.audio !== undefined) {
                  mergedContent.audio = streamContent.audio;
                }
              }
              next[next.length - 1] = {
                ...last,
                preservedText,
                content: streamContent ? mergedContent : last.content,
                toolCallsJson: message.tool_calls ?? last.toolCallsJson,
              };
            }
            messagesRef.current = next;
            return next;
          });
          break;
        case 'chat_complete':
          if (message.payload) {
            handleChatResponse(message.payload);
          }
          setIsLoading(false);
          setMetadata((prev) => ({ ...prev, fromStt: false }));
          break;
        case 'error': {
          const rateLimitErr = parseRateLimitError(message.error || '');
          if (rateLimitErr) {
            setRateLimitModal({ visible: true, retryAfterSeconds: rateLimitErr.retry_after_seconds });
          } else {
            setError(message.error || 'Spider error');
          }
          setIsLoading(false);
          break;
        }
        case 'status':
          if (message.status === 'cancelled') {
            setIsLoading(false);
          }
          break;
        default:
          break;
      }
    };

    messageHandlerRef.current = handler;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/spider:spider:sys/ws`;

    await webSocketService.connect(wsUrl);
    webSocketService.addMessageHandler(handler);
    await webSocketService.authenticate(key);
    setError(null);

    return () => {
      webSocketService.removeMessageHandler(handler);
      webSocketService.disconnect();
    };
  };

  const mergeAssistantMessages = (incoming: SpiderMessage[]) => {
    setMessages((prev) => {
      if (!incoming.length) return prev;
      const lastUserIndex = [...prev].map((msg, idx) => (msg.role === 'user' ? idx : -1)).reduce((acc, value) => Math.max(acc, value), -1);
      const trimmed = lastUserIndex >= 0 ? prev.slice(0, lastUserIndex + 1) : prev;
      const combined = [...trimmed, ...incoming];
      messagesRef.current = combined;
      if (incoming.some((msg) => msg.role === 'assistant')) {
        lastMessageSourceRef.current = 'assistant';
      }
      return combined;
    });
  };

  const handleChatResponse = (response: SpiderChatResult) => {
    setConversationId(response.conversationId || null);
    const normalizedAll = response.allMessages?.map((msg) => normalizeMessage(msg));
    const normalizedResponse = response.response ? normalizeMessage(response.response) : null;
    if (normalizedAll && normalizedAll.length > 0) {
      mergeAssistantMessages(normalizedAll);
    } else if (normalizedResponse) {
      setMessages((prev) => {
        const next = [...prev, normalizedResponse];
        messagesRef.current = next;
        if (normalizedResponse.role === 'assistant') {
          lastMessageSourceRef.current = 'assistant';
        }
        return next;
      });
    }
    if (response.refreshedApiKey) {
      setApiKey(response.refreshedApiKey);
    }
    setIsLoading(false);
    setMetadata((prev) => ({ ...prev, fromStt: false }));
  };

  const sendMessage = async (content: SpiderMessageContent, fromStt = false) => {
    let keyToUse = apiKeyRef.current;
    if (!keyToUse) {
      keyToUse = await ensureSpiderConnection();
      if (!keyToUse) {
        setError('Connect to Spider to chat.');
        return;
      }
    }

    const metaForSend = { ...metadataRef.current, fromStt };
    setMetadata(metaForSend);

    const userMessage: SpiderMessage = {
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    const priming =
      messagesRef.current.length === 0 ? buildPrimingMessages() : [];

    const nextMessages = [...messagesRef.current, ...priming, userMessage];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    lastMessageSourceRef.current = 'user';
    setIsLoading(true);
    setError(null);

    const payload = {
      apiKey: keyToUse,
      messages: nextMessages,
      llmProvider: LLM_PROVIDER,
      model: MODEL_ID,
      mcpServers: connectedMcpServers.length ? connectedMcpServers : undefined,
      metadata: metaForSend,
    };

    if (useWebSocket && webSocketService.isReady) {
      try {
        webSocketService.sendChatMessage(
          payload.messages,
          payload.llmProvider,
          payload.model,
          payload.mcpServers,
          payload.metadata,
          conversationId ?? undefined,
        );
        return;
      } catch (err) {
        setUseWebSocket(false);
      }
    }

    try {
      const response = await spiderChat(payload);
      handleChatResponse(response);
    } catch (err) {
      setIsLoading(false);
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message.';
      const rateLimitErr = parseRateLimitError(errorMessage);
      if (rateLimitErr) {
        setRateLimitModal({ visible: true, retryAfterSeconds: rateLimitErr.retry_after_seconds });
      } else {
        setError(errorMessage);
      }
    }
  };

  const handleSend = async () => {
    if (!messageDraft.trim() || isLoading) return;
    const text = messageDraft.trim();
    setMessageDraft('');
    await sendMessage({ text }, false);
    inputRef.current?.focus();
  };

  const handleCancel = () => {
    if (useWebSocket && webSocketService.isReady) {
      try {
        webSocketService.sendCancel();
      } catch {
        // ignore
      }
    }
    setIsLoading(false);
  };

  const startRecording = async () => {
    if (recording) return;
    setRecordingError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        const base64 = await blobToBase64(blob);
        setRecording(false);
        await sendMessage({ base_six_four_audio: base64 }, true);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setRecording(false);
      setRecordingError(
        err instanceof Error
          ? err.message
          : 'Microphone access failed. Check browser permissions.',
      );
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    setRecording(false);
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handleLogPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleLogPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointerStartRef.current) return;
    const dx = Math.abs(event.clientX - pointerStartRef.current.x);
    const dy = Math.abs(event.clientY - pointerStartRef.current.y);
    pointerStartRef.current = null;

    // Only treat as tap if minimal movement
    if (dx > 8 || dy > 8) return;

    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, button, a')) return;

    // Toggle recording on tap
    if (recording) {
      stopRecording();
    } else {
      void startRecording();
    }
  };

  const handleLogPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!holdTimerRef.current || !pointerStartRef.current) return;
    const dx = Math.abs(event.clientX - pointerStartRef.current.x);
    const dy = Math.abs(event.clientY - pointerStartRef.current.y);
    if (dx > 8 || dy > 8) {
      clearHoldTimer();
    }
  };

  const shouldShowProcessingSpinner = (message: SpiderMessage) => {
    const text = message.content?.text || '';
    return (
      message.role === 'assistant' &&
      typeof text === 'string' &&
      /^processing iteration/i.test(text)
    );
  };

  const shouldHideStatusText = (text?: string | null) => {
    if (!text) return false;
    const normalized = text.trim().toLowerCase();
    return (
      normalized.startsWith('processing iteration') ||
      normalized.startsWith('executing tool call') ||
      normalized.startsWith('tool execution results')
    );
  };
  const shouldHideDotOnly = (
    text: string | null | undefined,
    toolCalls: ToolCall[],
    toolResults: ToolResult[],
  ) => {
    if (!text) return false;
    const normalized = text.trim();
    return normalized === '.' && (toolCalls.length > 0 || toolResults.length > 0);
  };

  const shouldHideBubble = (
    message: SpiderMessage,
    toolCalls: ToolCall[],
    toolResults: ToolResult[],
    hasAudio: boolean,
  ) => {
    const text = message.content?.text?.trim().toLowerCase() || '';
    const isStatusOnly =
      !hasAudio &&
      toolCalls.length === 0 &&
      (text.startsWith('executing tool call') || text.startsWith('tool execution results'));
    const isEmptyDisplay = !hasAudio && !message.content?.text && toolCalls.length === 0 && toolResults.length === 0;
    return isStatusOnly || isEmptyDisplay;
  };

  const hasPendingAssistant = () => {
    const lastAssistant = [...messages]
      .slice()
      .reverse()
      .find((msg) => msg.role === 'assistant');
    if (!lastAssistant) return false;
    const toolCalls = parseToolCalls(lastAssistant.toolCallsJson);
    const toolResults = parseToolResults(lastAssistant.toolResultsJson);
    const waitingTools = toolCalls.length > 0 && toolResults.length < toolCalls.length;
    return shouldShowProcessingSpinner(lastAssistant) || waitingTools || !!lastAssistant.content?.text;
  };

  const toolPlacement = useMemo(() => {
    const placement = new Map<string, { index: number; hasResult: boolean }>();
    visibleMessages.forEach((msg, idx) => {
      const toolCalls = parseToolCalls(msg.toolCallsJson);
      if (toolCalls.length === 0) return;
      const inlineToolResults = parseToolResults(msg.toolResultsJson);
      const nextToolResults = parseToolResults(visibleMessages[idx + 1]?.toolResultsJson);
      const toolResults = [...inlineToolResults, ...nextToolResults];
      toolCalls.forEach((call) => {
        const hasResult = toolResults.some((r) => r.tool_call_id === call.id);
        const existing = placement.get(call.id);
        if (!existing) {
          placement.set(call.id, { index: idx, hasResult });
          return;
        }
        if (hasResult && !existing.hasResult) {
          placement.set(call.id, { index: idx, hasResult });
        }
      });
    });
    return placement;
  }, [visibleMessages]);

  return (
    <section className="chat-view">
      {error && <div className="alert inline-alert">{error}</div>}
      {recordingError && <div className="alert inline-alert">{recordingError}</div>}

      <div
        className="chat-log"
        ref={logRef}
        onPointerDown={handleLogPointerDown}
        onPointerUp={handleLogPointerUp}
        onPointerMove={handleLogPointerMove}
        onPointerCancel={handleLogPointerUp}
        onPointerLeave={handleLogPointerUp}
      >
        {visibleMessages.length === 0 ? (
          <>
            <div className={`voice-empty ${recording ? 'recording' : ''}`}>
              <div className="voice-help">
                {recording ? (
                  <>
                    <div className="recording-status">
                      <span className="mic-icon">🎤</span>
                      <span className="spinner" />
                    </div>
                    <h3>Recording..</h3>
                    <p>Tap to transcribe and send</p>
                  </>
                ) : (
                  <>
                    <h3>Tap anywhere to dictate</h3>
                    <p>Tap again to transcribe and send</p>
                  </>
                )}
              </div>
            </div>
            {isPublicMode && (
              <p className="public-warning">
                Public trial: don't input anything sensitive or personally identifying.{' '}
                <p>
                  <a href="https://hosted.hyperware.ai" target="_blank" rel="noopener noreferrer">
                    Sign Up
                  </a>
                </p>
              </p>
            )}
          </>
        ) : (
          visibleMessages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            const textContent =
              (typeof msg.content?.text === 'string' && msg.content.text) ||
              msg.preservedText ||
              '';
            const hasAudio =
              !!msg.content?.base_six_four_audio ||
              (Array.isArray(msg.content?.audio) && msg.content?.audio.length > 0);
            const audioUrl = hasAudio ? ensureAudioUrl(msg) : null;
            const toolCalls = parseToolCalls(msg.toolCallsJson);
            const inlineToolResults = parseToolResults(msg.toolResultsJson);
            const nextToolResults = parseToolResults(visibleMessages[idx + 1]?.toolResultsJson);
            const toolResults = [...inlineToolResults, ...nextToolResults];
            const visibleToolCalls = toolCalls.filter((call) => {
              const placementInfo = toolPlacement.get(call.id);
              if (placementInfo && placementInfo.index !== idx) {
                return false;
              }
              return true;
            });
            const showProcessing = shouldShowProcessingSpinner(msg);
            const hideText =
              shouldHideStatusText(msg.content?.text) ||
              shouldHideDotOnly(msg.content?.text, visibleToolCalls, toolResults);
            const bubbleHidden = shouldHideBubble(
              msg,
              visibleToolCalls,
              toolResults,
              hasAudio,
            );

            if (bubbleHidden) {
              return null;
            }

            return (
              <div
                key={`${msg.timestamp}-${idx}`}
                ref={(el) => {
                  const key = `${msg.timestamp}-${idx}`;
                  if (el) {
                    messageElementsRef.current.set(key, el);
                  } else {
                    messageElementsRef.current.delete(key);
                  }
                }}
                className={`chat-line ${isUser ? 'user' : 'assistant'}`}
                data-message-index={idx}
                data-role={isUser ? 'user' : 'assistant'}
              >
                <div className={`chat-bubble ${showProcessing ? 'typing' : ''}`}>
                  {showProcessing ? (
                    <div className="message-processing">
                      <span className="spinner tiny" />
                      <span>Processing…</span>
                    </div>
                  ) : (
                    <>
                      {hasAudio && audioUrl && (
                        <button
                          type="button"
                          className="voice-note"
                          onClick={() => playAudioForMessage(msg)}
                        >
                          <span className="voice-icon">{isUser ? '🎤' : '🎧'}</span>
                          <div className="voice-copy">
                            <span className="voice-title">{isUser ? 'Voice note' : 'Voice reply'}</span>
                            <span className="voice-subtitle">
                              {msg.content?.text
                                ? 'Tap to replay'
                                : isUser
                                  ? 'Transcribing…'
                              : 'Auto-played'}
                            </span>
                          </div>
                        </button>
                      )}
                      {!!textContent && !hideText && <p>{textContent}</p>}
                      {visibleToolCalls.length > 0 && (
                        <div className="tool-calls">
                          {visibleToolCalls.map((call) => {
                            const result = toolResults.find((r) => r.tool_call_id === call.id);
                            const waiting = !result && isLoading;
                            return (
                              <div key={call.id} className="tool-call-chip">
                                <span className="tool-emoji">🔧</span>
                                <button
                                  type="button"
                                  className="tool-link"
                                  onClick={() => setSelectedToolCall({ call, result })}
                                >
                                  {call.tool_name}
                                </button>
                                {waiting && <span className="spinner tool-spinner" />}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        {isLoading && !hasPendingAssistant() && (
          <div
            className="chat-line assistant"
            data-message-index={messages.length}
            data-role="assistant"
          >
            <div className="chat-bubble typing">
              <span className="spinner" />
            </div>
          </div>
        )}
      </div>

      {visibleMessages.length === 0 && (
        <div className="suggested-prompts">
          {SUGGESTED_PROMPTS.map((prompt, index) => (
            <button
              key={index}
              className="suggested-prompt"
              onClick={() => {
                void sendMessage({ text: prompt.value });
              }}
              disabled={isLoading}
            >
              {prompt.label}
            </button>
          ))}
        </div>
      )}

      <div className="chat-input-bar">
        <div className="input-row">
          <input
            ref={inputRef}
            value={messageDraft}
            onChange={(event) => setMessageDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder={recording ? 'Recording…' : 'Type a message'}
            disabled={isLoading}
          />
          {isLoading ? (
            <button className="ghost" onClick={handleCancel}>
              Cancel
            </button>
          ) : (
            <button className="send-button" onClick={() => void handleSend()} disabled={!messageDraft.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {selectedToolCall && (
        <div className="chat-modal-overlay" onClick={() => setSelectedToolCall(null)}>
          <div className="chat-modal" onClick={(event) => event.stopPropagation()}>
            <header className="chat-modal__header">
              <div>
                <p className="eyebrow">Tool call</p>
                <h3>{selectedToolCall.call.tool_name}</h3>
              </div>
              <button type="button" className="modal-close" onClick={() => setSelectedToolCall(null)}>
                ×
              </button>
            </header>
            <div className="chat-modal__body">
              <p className="eyebrow">Request</p>
              <pre className="json-block">{JSON.stringify(selectedToolCall.call, null, 2)}</pre>
              <p className="eyebrow">Result</p>
              {selectedToolCall.result ? (
                <pre className="json-block">{JSON.stringify(selectedToolCall.result, null, 2)}</pre>
              ) : (
                <p>Waiting for tool response…</p>
              )}
            </div>
          </div>
        </div>
      )}
      {rateLimitModal.visible && (
        <RateLimitModal
          retryAfterSeconds={rateLimitModal.retryAfterSeconds}
          onClose={() => setRateLimitModal({ visible: false, retryAfterSeconds: null })}
        />
      )}
    </section>
  );
}
