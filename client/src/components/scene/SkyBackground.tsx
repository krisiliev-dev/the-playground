import type { Vector3Tuple } from 'three';
import { BackSide, VideoTexture, SRGBColorSpace } from 'three';
import { useEffect, useState } from 'react';
import { listReadyVideos } from '@/api/videos';

interface SkyBackgroundProps {
  dimensions: Vector3Tuple;
}

// Local fallback — shipped with the client in /public/videos/ for dev and
// the case where the API is unreachable.
const FALLBACK_VIDEO_URL = '/videos/360_1_equirect.mp4';

export function SkyBackground({ dimensions }: SkyBackgroundProps): JSX.Element | null {
  const [w, h, d] = dimensions;
  const radius = (Math.sqrt(w * w + h * h + d * d) / 2) * 1.5;

  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [texture, setTexture] = useState<VideoTexture | null>(null);

  // Resolve which video URL to load: API first, fallback if that fails.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const jobs = await listReadyVideos();
        const ready = jobs.find((j) => j.status.state === 'ready');
        if (cancelled) return;
        if (ready && ready.status.state === 'ready') {
          setVideoSrc(ready.status.url);
          return;
        }
        setVideoSrc(FALLBACK_VIDEO_URL);
      } catch {
        if (!cancelled) setVideoSrc(FALLBACK_VIDEO_URL);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Create the video element + texture once we know the URL.
  useEffect(() => {
    if (!videoSrc) return;

    const video = document.createElement('video');
    video.src = videoSrc;
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = true;
    video.playsInline = true;

    let tex: VideoTexture | null = null;

    const onLoaded = () => {
      tex = new VideoTexture(video);
      tex.colorSpace = SRGBColorSpace;
      setTexture(tex);
      void video.play();
    };

    video.addEventListener('loadeddata', onLoaded);
    video.load();

    return () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.pause();
      tex?.dispose();
      setTexture(null);
    };
  }, [videoSrc]);

  if (!texture) return null;

  return (
    <mesh>
      <sphereGeometry args={[radius, 64, 64]} />
      <meshBasicMaterial side={BackSide} map={texture} />
    </mesh>
  );
}
