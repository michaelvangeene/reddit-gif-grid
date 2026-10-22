"use client";

import { useEffect, useRef, useState } from 'react';
import { redgifsId, type RedgifsMedia } from '../lib/redgifs';
import { redditVideoId } from '../lib/reddit-audio';

interface Props {
  source: string;
  originalUrl: string;
  audible: boolean;
  suspended?: boolean;
  onBlocked: () => void;
}

export default function GridVideo({ source, originalUrl, audible, onBlocked, suspended = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const id = redgifsId(originalUrl);
  const redditId = !id ? redditVideoId(source) : null;
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [noRedditAudio, setNoRedditAudio] = useState(false);
  const [media, setMedia] = useState<RedgifsMedia | null>(null);
  const [failed, setFailed] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(1);
  const [nearViewport, setNearViewport] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(([entry]) => {
      setNearViewport(entry.isIntersecting);
    }, { rootMargin: '100px' });
    observer.observe(video);
    const onVisibility = () => setPageVisible(!document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const shouldLoad = nearViewport && pageVisible && !suspended;

  useEffect(() => {
    if (!redditId || !audible || audioUrl || noRedditAudio) return;
    const controller = new AbortController();
    fetch(`/api/reddit-audio/${redditId}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Reddit audio unavailable');
        return response.json() as Promise<{ url: string | null }>;
      })
      .then(result => { setAudioUrl(result.url); setNoRedditAudio(!result.url); })
      .catch(error => { if (!controller.signal.aborted) console.warn('Reddit audio could not be loaded', error); });
    return () => controller.abort();
  }, [redditId, audible, audioUrl, noRedditAudio]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || !audioUrl || !audible || !shouldLoad) {
      audio?.pause();
      return;
    }
    let cancelled = false;
    const sync = () => {
      if (Math.abs(audio.currentTime - video.currentTime) > 0.25) audio.currentTime = video.currentTime;
      audio.playbackRate = video.playbackRate;
    };
    const play = () => {
      sync();
      audio.muted = false;
      audio.play().catch(() => { if (!cancelled) { audio.muted = true; onBlocked(); } });
    };
    const pause = () => audio.pause();
    const seek = () => { sync(); };
    video.addEventListener('play', play);
    video.addEventListener('playing', play);
    video.addEventListener('pause', pause);
    video.addEventListener('waiting', pause);
    video.addEventListener('seeking', seek);
    video.addEventListener('timeupdate', seek);
    if (!video.paused) play();
    return () => {
      cancelled = true;
      audio.pause();
      audio.muted = true;
      video.removeEventListener('play', play);
      video.removeEventListener('playing', play);
      video.removeEventListener('pause', pause);
      video.removeEventListener('waiting', pause);
      video.removeEventListener('seeking', seek);
      video.removeEventListener('timeupdate', seek);
    };
  }, [audioUrl, audible, onBlocked, shouldLoad]);

  useEffect(() => {
    if (!id || !shouldLoad || media || failed) return;
    const controller = new AbortController();
    const quality = window.matchMedia('(max-width: 768px)').matches ? '?quality=sd' : '';
    fetch(`/api/redgifs/${id}${quality}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('RedGIFs source unavailable');
        return response.json() as Promise<RedgifsMedia>;
      })
      .then(result => { if (!controller.signal.aborted) setMedia(result); })
      .catch(error => {
        if (!controller.signal.aborted) {
          console.warn('RedGIFs source could not be loaded', error);
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [id, shouldLoad, media, failed]);

  const resolvedSource = media?.url || source;
  // A failed resolver/preview must never masquerade as an audio-capable RedGIFs source.
  const muted = !audible || Boolean(redditId) || Boolean(id && (!media || !media.hasAudio));
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    video.muted = muted;
    video.volume = 1;
    if (!shouldLoad) { video.pause(); video.load(); return; }
    video.play().catch(error => {
      if (cancelled) return;
      if (!muted) {
        video.muted = true;
        onBlocked();
        video.play().catch(() => { /* Browser may also defer muted playback off screen. */ });
      } else if (error.name !== 'AbortError') {
        console.warn('Video playback unavailable', error);
      }
    });
    return () => { cancelled = true; };
  }, [muted, resolvedSource, onBlocked, shouldLoad]);

  return <>
    <video ref={videoRef} src={shouldLoad ? resolvedSource || undefined : undefined} loop muted={muted} playsInline preload="none" style={{ aspectRatio }} onLoadedMetadata={event => {
      const video = event.currentTarget;
      if (video.videoWidth && video.videoHeight) setAspectRatio(video.videoWidth / video.videoHeight);
    }} />
    {audioUrl && shouldLoad && <audio ref={audioRef} src={audioUrl} loop preload="metadata" />}
    {id && failed && <span role="status" style={statusStyle}>RedGIFs unavailable - preview only</span>}
    {media && !media.hasAudio && <span style={statusStyle}>No audio in this video</span>}
    {noRedditAudio && <span style={statusStyle}>No audio in this video</span>}
  </>;
}

const statusStyle = { position: 'absolute', left: 8, top: 8, background: '#111d', color: '#fff', padding: '4px 8px', fontSize: 12 } as const;
