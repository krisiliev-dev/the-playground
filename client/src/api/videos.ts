/**
 * Video API client.
 * Talks to the Rust backend for the admin conversion pipeline and the
 * public "which videos are ready" list consumed by SkyBackground.
 */

export type JobState = 'queued' | 'downloading' | 'converting' | 'ready' | 'failed';

export type JobStatus =
  | { state: 'queued' }
  | { state: 'downloading' }
  | { state: 'converting' }
  | { state: 'ready'; url: string }
  | { state: 'failed'; error: string };

export interface VideoJob {
  id: string;
  youtube_url: string;
  name: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
}

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://krisiliev.dev';

export async function listReadyVideos(): Promise<VideoJob[]> {
  const res = await fetch(`${API_BASE}/api/video/list`);
  if (!res.ok) {
    throw new Error(`Failed to list videos: ${res.status}`);
  }
  return (await res.json()) as VideoJob[];
}

export async function listAllJobs(token: string): Promise<VideoJob[]> {
  const res = await fetch(`${API_BASE}/api/video/jobs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to list jobs: ${res.status}`);
  }
  return (await res.json()) as VideoJob[];
}

export async function getJob(id: string, token: string): Promise<VideoJob> {
  const res = await fetch(`${API_BASE}/api/video/jobs/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch job: ${res.status}`);
  }
  return (await res.json()) as VideoJob;
}

export async function convertVideo(token: string, url: string, name: string): Promise<VideoJob> {
  const res = await fetch(`${API_BASE}/api/video/convert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url, name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Convert failed (${res.status}): ${text}`);
  }
  return (await res.json()) as VideoJob;
}
