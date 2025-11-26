import { parseResponse } from '#caller-utils';

import {
  SpiderChatPayload,
  SpiderChatResult,
  SpiderConnectResult,
  SpiderMcpServersResult,
  SpiderStatusInfo,
} from '../types/spider';
import { SearchAllResult } from '../types/todo';

const BASE_URL = import.meta.env.BASE_URL || window.location.origin;

const buildUrl = (path: string) => (path.startsWith('/') ? `${BASE_URL}${path}` : `${BASE_URL}/${path}`);

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  const json = await response.json();
  return parseResponse<T>(json);
}

export const connectSpider = (forceNew = false) =>
  post<SpiderConnectResult>('/api/spider-connect', { SpiderConnect: forceNew });

export const spiderStatus = () => post<SpiderStatusInfo>('/api/spider-status', { SpiderStatus: null });

export const spiderMcpServers = (apiKey: string) =>
  post<SpiderMcpServersResult>('/api/spider-mcp-servers', { SpiderMcpServers: apiKey });

export const spiderChat = (payload: SpiderChatPayload) =>
  post<SpiderChatResult>('/api/spider-chat', { SpiderChat: payload });

export const searchAll = (query?: string) =>
  post<SearchAllResult>('/api/search-all', { SearchAll: query ?? null });
