"use client";

import { useEffect, useRef, useState } from 'react';
import { redgifsId, type RedgifsMedia } from '../lib/redgifs';
import { redditVideoId } from '../lib/reddit-audio';

interface Props {
  source: string;
  originalUrl: string;
  audible: boolean;
  onBlocked: () => void;
}

export default function GridVideo({ source, originalUrl, audible, onBlocked }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const id = redgifsId(originalUrl);
  const redditId = !id ? redditVideoId(source) : null;
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [noRedditAudio, setNoRedditAudio] = useState(false);
  const [media, setMedia] = useState<RedgifsMedia | null>(null);
  const [failed, setFailed] = useState(false);

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
    if (!video || !audio || !audioUrl || !audible) {
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
  }, [audioUrl, audible, onBlocked]);

  useEffect(() => {
    if (!id || !videoRef.current) return;
    let cancelled = false;
    const controller = new AbortController();
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      fetch(`/api/redgifs/${id}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error('RedGIFs source unavailable');
          return response.json() as Promise<RedgifsMedia>;
        })
        .then(result => { if (!cancelled) setMedia(result); })
        .catch(error => {
          if (!cancelled) { console.warn('RedGIFs source could not be loaded', error); setFailed(true); }
        });
    }, { rootMargin: '300px' });
    observer.observe(videoRef.current);
    return () => { cancelled = true; observer.disconnect(); controller.abort(); };
  }, [id]);

  const resolvedSource = media?.url || source;
  // A failed resolver/preview must never masquerade as an audio-capable RedGIFs source.
  const muted = !audible || Boolean(redditId) || Boolean(id && (!media || !media.hasAudio));
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    video.muted = muted;
    video.volume = 1;
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
  }, [muted, resolvedSource, onBlocked]);

  return <>
    <video ref={videoRef} src={resolvedSource || undefined} autoPlay loop muted={muted} playsInline preload="metadata" />
    {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}
    {id && failed && <span role="status" style={statusStyle}>RedGIFs unavailable - preview only</span>}
    {media && !media.hasAudio && <span style={statusStyle}>No audio in this video</span>}
    {noRedditAudio && <span style={statusStyle}>No audio in this video</span>}
  </>;
}

const statusStyle = { position: 'absolute', left: 8, top: 8, background: '#111d', color: '#fff', padding: '4px 8px', fontSize: 12 } as const;
