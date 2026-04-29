// frontend/src/api/urls.ts
import { apiClient } from './client';

export interface UrlResponse {
  id: number;
  shortCode: string;
  shortUrl: string;
  longUrl: string;
  title: string | null;
  createdAt: string;
  clickCount: number;
}

export const urlsApi = {
  list: async (cursor?: number): Promise<{ items: UrlResponse[]; nextCursor: number | null }> => {
    const { data } = await apiClient.get('/api/v1/urls', { params: { cursor } });
    return data;
  },

  create: async (longUrl: string): Promise<UrlResponse> => {
    const { data } = await apiClient.post('/api/v1/urls', { longUrl });
    return data;
  },

  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/api/v1/urls/${id}`);
  },
};
