"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { SpatialMedia } from "./SpatialGallery";
import { Loader2, AlertCircle, Shuffle, Play, Pause, Plus, LayoutGrid, MoreHorizontal, Volume2, VolumeX, X, Glasses } from "lucide-react";

import GridVideo from "./GridVideo";
import { redgifsId } from "../lib/redgifs";
import { collectListing, shuffled } from "../lib/randomize-listing";

const SpatialGallery = dynamic(() => import("./SpatialGallery"), { ssr: false });

interface GifGridProps {
  accessToken: string;
}

interface RedditPost {
  id: string;
  title: string;
  url: string;
  permalink: string;
  subreddit: string;
  media?: { reddit_video?: { fallback_url?: string } };
  preview?: { reddit_video_preview?: { fallback_url?: string } };
  is_video: boolean;
  domain: string;
}

function isSupportedMedia(post: RedditPost): boolean {
  const u = post.url.toLowerCase();
  const isGif = u.endsWith(".gif") || u.endsWith(".gifv") || u.endsWith(".mp4");
  const isGfycat = post.domain?.includes("gfycat.com") || post.domain?.includes("redgifs.com");
  const isImgurGif = post.domain?.includes("imgur.com") && (u.endsWith(".gif") || u.endsWith(".gifv") || u.endsWith(".mp4"));
  const isRedditVideo = post.is_video || (post.media && post.media.reddit_video);
  
  return Boolean(isGif || isGfycat || isImgurGif || isRedditVideo);

}

export default function GifGrid({ accessToken }: GifGridProps) {
  const [spatialItems, setSpatialItems] = useState<SpatialMedia[] | null>(null);
  const closeSpatial = useCallback(() => setSpatialItems(null), []);
  const [randomizingAll, setRandomizingAll] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [randomizeMessage, setRandomizeMessage] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const queuedPostsRef = useRef<RedditPost[]>([]);
  const randomizeControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => randomizeControllerRef.current?.abort(), []);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const reportBlocked = useCallback(() => setSoundBlocked(true), []);
  useEffect(() => {
    const silence = () => setActiveId(null);
    window.addEventListener("blur", silence);
    const onVisibility = () => { if (document.hidden) silence(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", silence);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  const [posts, setPosts] = useState<RedditPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [scrollSpeed, setScrollSpeed] = useState<number>(0);
  const [lastSpeed, setLastSpeed] = useState<number>(2.0);
  const [showSpeedSlider, setShowSpeedSlider] = useState<boolean>(false);
  const [showColumnPicker, setShowColumnPicker] = useState<boolean>(false);
  const [showButtons, setShowButtons] = useState<boolean>(true);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetHideTimer = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    hideTimeoutRef.current = setTimeout(() => {
      if (!randomizeControllerRef.current) setShowButtons(false);
    }, 4000);
  }, []);

  useEffect(() => {
    if (showButtons) {
      resetHideTimer();
    }
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [showButtons, resetHideTimer, randomizingAll]);

  const containerRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef<boolean>(false);
  const afterRef = useRef<string | null>(null);
  const sliderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync refs for Intersection Observer inside effect
  useEffect(() => {
    loadingMoreRef.current = loadingMore;
    afterRef.current = after;
  }, [loadingMore, after]);

  const fetchUsername = async () => {
    try {
      const res = await fetch("https://oauth.reddit.com/api/v1/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) throw new Error("Failed to fetch user info");
      const data = await res.json();
      setUsername(data.name);
      return data.name;
    } catch (err) {
      console.error(err);
      setError("Failed to connect to Reddit. Token might be expired.");
      return null;
    }
  };

  const fetchUpvoted = useCallback(async (user: string, afterParam: string | null = null) => {
    try {
      const url = `https://oauth.reddit.com/user/${user}/upvoted?limit=50${afterParam ? `&after=${afterParam}` : ''}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      
      if (!res.ok) throw new Error("Failed to fetch upvoted posts");
      const data = await res.json();
      
      setAfter(data.data.after);
      
      // Filter for GIFs and Videos
      const filteredPosts = data.data.children
        .map((child: { data: RedditPost }) => child.data)
        .filter(isSupportedMedia);

      return filteredPosts;
    } catch (err) {
      console.error(err);
      setError("Failed to fetch posts");
      return [];
    }
  }, [accessToken]);

  useEffect(() => {
    let mounted = true;
    
    const init = async () => {
      setLoading(true);
      const user = await fetchUsername();
      if (user && mounted) {
        const initialPosts = await fetchUpvoted(user);
        if (mounted) setPosts(initialPosts);
      }
      if (mounted) setLoading(false);
    };

    init();
    return () => { mounted = false; };
  }, [accessToken, fetchUpvoted]);

  const loadMore = async () => {
    if (loadingMoreRef.current || randomizeControllerRef.current) return;
    if (queuedPostsRef.current.length > 0) {
      const next = queuedPostsRef.current.splice(0, 50);
      setPosts(prev => [...prev, ...next]);
      setQueuedCount(queuedPostsRef.current.length);
      return;
    }
    if (!username || !after) return;
    
    // Update ref immediately to prevent race conditions during auto-scroll
    loadingMoreRef.current = true;
    setLoadingMore(true);
    
    const morePosts = await fetchUpvoted(username, after);
    
    setPosts(prev => {
      // Deduplicate posts just in case Reddit returns overlapping pages
      const existingIds = new Set(prev.map(p => p.id));
      const uniqueNewPosts = morePosts.filter((p: RedditPost) => !existingIds.has(p.id));
      return [...prev, ...uniqueNewPosts];
    });
    
    setLoadingMore(false);
    loadingMoreRef.current = false;
  };

  const shufflePosts = () => {
    setActiveId(null);
    setPosts(prev => shuffled(prev));
  };

  const randomizeAll = async () => {
    if (!username || loadingMoreRef.current || randomizeControllerRef.current) return;
    const controller = new AbortController();
    randomizeControllerRef.current = controller;
    setRandomizingAll(true);
    setShowButtons(true);
    setScannedCount(0);
    setRandomizeMessage(null);
    setActiveId(null);
    if (scrollSpeed > 0) setLastSpeed(scrollSpeed);
    setScrollSpeed(0);
    try {
      const allPosts = await collectListing<RedditPost>(async (cursor, signal) => {
        const query = new URLSearchParams({ limit: "100", raw_json: "1" });
        if (cursor) query.set("after", cursor);
        const response = await fetch(`https://oauth.reddit.com/user/${encodeURIComponent(username)}/upvoted?${query}`, {
          headers: { Authorization: `Bearer ${accessToken}` }, signal,
        });
        if (!response.ok) {
          throw new Error(response.status === 429
            ? "Reddit vraagt om even te wachten. Probeer het straks opnieuw."
            : "De upvotes konden niet worden opgehaald. Probeer opnieuw of log opnieuw in.");
        }
        const result = await response.json();
        if (!Array.isArray(result.data?.children)) throw new Error("Reddit gaf een ongeldige lijst terug.");
        return {
          items: result.data.children.map((child: { data: RedditPost }) => child.data),
          after: result.data.after || null,
        };
      }, controller.signal, setScannedCount);
      const pool = shuffled(allPosts.filter(isSupportedMedia));
      if (pool.length === 0) {
        setRandomizeMessage("Geen video's gevonden in de beschikbare upvotes.");
        return;
      }
      // Shuffle the full pool before slicing: old and middle pages have equal chances.
      queuedPostsRef.current = pool.slice(50);
      setQueuedCount(queuedPostsRef.current.length);
      setPosts(pool.slice(0, 50));
      setAfter(null);
      afterRef.current = null;
      setRandomizeMessage(`${pool.length} video's geschud uit ${allPosts.length} beschikbare upvotes. Oudere upvotes kunnen buiten Reddits bereik vallen.`);
      return pool;
    } catch (error) {
      if (!controller.signal.aborted) {
        setRandomizeMessage(error instanceof Error ? error.message : "Ophalen mislukt. Probeer opnieuw.");
      }
    } finally {
      if (randomizeControllerRef.current === controller) {
        randomizeControllerRef.current = null;
        if (!controller.signal.aborted) setRandomizingAll(false);
      }
    }
  };

  const getMediaUrl = (post: RedditPost) => {
    if (redgifsId(post.url)) {
      return post.preview?.reddit_video_preview?.fallback_url || "";
    }
    if (post.is_video && post.media?.reddit_video?.fallback_url) {
      return post.media.reddit_video.fallback_url;
    }
    if (post.url.endsWith(".gifv")) {
      return post.url.replace(".gifv", ".mp4");
    }
    if (/\.mp4(?:[?#]|$)/i.test(post.url)) return post.url;
    if (post.preview?.reddit_video_preview?.fallback_url) {
      return post.preview.reddit_video_preview.fallback_url;
    }
    return post.url;
  };

  const [columns, setColumns] = useState(3);

  // Auto Scroll Logic
  useEffect(() => {
    if (scrollSpeed === 0) return;
    
    let animationFrameId: number;
    let accumulatedScroll = 0;

    const getPixelsPerFrame = (val: number) => {
      if (val === 0) return 0;
      
      let pixelsPerSecond = 0;
      if (val <= 5) {
        if (val < 0.1) {
          pixelsPerSecond = (val / 0.1) * 10;
        } else {
          pixelsPerSecond = 10 + ((val - 0.1) / 4.9) * 50;
        }
      } else {
        pixelsPerSecond = 60 + ((val - 5) / 5) * 240;
      }
      
      return pixelsPerSecond / 60; // 60 FPS
    };

    const scrollLoop = () => {
      // Accumulate fractional pixels
      accumulatedScroll += getPixelsPerFrame(scrollSpeed);
      
      // Only trigger scroll when we have at least 1 full pixel
      // This prevents browsers from ignoring sub-pixel scrolls
      if (accumulatedScroll >= 1) {
        const scrollAmount = Math.floor(accumulatedScroll);
        window.scrollBy(0, scrollAmount);
        accumulatedScroll -= scrollAmount;
      }
      
      // Auto-load more when reaching bottom while scrolling
      if (
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 800 &&
        !loadingMoreRef.current && 
        (afterRef.current || queuedPostsRef.current.length > 0)
      ) {
        // Trigger load without blocking scroll
        loadMore();
      }

      animationFrameId = requestAnimationFrame(scrollLoop);
    };

    animationFrameId = requestAnimationFrame(scrollLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [scrollSpeed]);

  const togglePlayPause = () => {
    if (scrollSpeed > 0) {
      setLastSpeed(scrollSpeed);
      setScrollSpeed(0);
    } else {
      setScrollSpeed(lastSpeed);
    }
  };

  if (error) {
    return (
      <div className="empty-state">
        <AlertCircle className="empty-state-icon" />
        <h2>Authentication Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="masonry-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '1rem' }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="skeleton"></div>
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="empty-state">
        <h2>No GIFs found</h2>
        <p>We couldn&apos;t find any GIFs or videos in your recent upvotes.</p>
      </div>
    );
  }

  const columnData: RedditPost[][] = Array.from({ length: columns }, () => []);
  posts.forEach((post, i) => {
    columnData[i % columns].push(post);
  });

  return (
    <div>
      {spatialItems && <SpatialGallery items={spatialItems} onClose={closeSpatial} onShuffleAll={async () => {
        const pool = await randomizeAll();
        if (!pool) throw new Error("Ophalen mislukt");
        return pool.map(post => ({ id: post.id, originalUrl: post.url, source: getMediaUrl(post) }))
          .filter(item => redgifsId(item.originalUrl) || /\.mp4(?:[?#]|$)/i.test(item.source));
      }} />}
      <div className="masonry-grid" ref={containerRef}>
        {columnData.map((col, colIndex) => (
          <div key={colIndex} className="masonry-grid_column" style={{ width: `${100 / columns}%` }}>
            {col.map(post => {
              const mediaUrl = getMediaUrl(post);
              const isVideo = Boolean(redgifsId(post.url)) || mediaUrl.includes(".mp4") || post.is_video;

              return (
                <div
                  key={post.id}
                  className="gif-card"
                  style={{ display: 'block', position: 'relative' }}
                  onMouseEnter={() => setActiveId(post.id)}
                  onMouseLeave={() => setActiveId(current => current === post.id ? null : current)}
                  onFocus={() => setActiveId(post.id)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setActiveId(current => current === post.id ? null : current);
                    }
                  }}
                >
                  <a href={`https://reddit.com${post.permalink}`} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
                  {isVideo ? (
                    <GridVideo
                      source={mediaUrl}
                      originalUrl={post.url}
                      audible={soundEnabled && activeId === post.id}
                      suspended={spatialItems !== null}
                      onBlocked={reportBlocked}
                    />
                  ) : (
                    <img src={mediaUrl} alt={post.title} loading="lazy" />
                  )}
                  <div className="overlay">
                    <div className="gif-title">{post.title}</div>
                    <div className="gif-meta">
                      <span>r/{post.subreddit}</span>
                    </div>
                  </div>
                  </a>
                  {isVideo && (
                    <button
                      type="button"
                      aria-label={soundEnabled && activeId === post.id ? "Mute video" : "Play video with sound"}
                      title="Click to enable sound for this video"
                      style={{ position: 'absolute', right: 8, top: 8, zIndex: 2, cursor: 'pointer', background: 'transparent', color: 'white', border: 0, borderRadius: 6, padding: 8 }}
                      onClick={(e) => {
                        const enable = !(soundEnabled && activeId === post.id && !soundBlocked);
                        setSoundEnabled(enable);
                        setActiveId(post.id);
                        setSoundBlocked(false);
                        const video = e.currentTarget.parentElement?.querySelector('video');
                        const audio = e.currentTarget.parentElement?.querySelector('audio');
                        if (audio && video) {
                          audio.muted = !enable;
                          audio.currentTime = video.currentTime;
                          if (enable) audio.play().catch(() => reportBlocked());
                          else audio.pause();
                        }
                        // Call play synchronously inside the click for browsers requiring a gesture per element.
                        if (video) {
                          video.muted = !enable;
                          video.volume = 1;
                          video.play().catch(error => {
                            video.muted = true;
                            if (enable) reportBlocked();
                            console.warn('Sound playback was blocked', error);
                          });
                        }
                      }}
                    >
                      {soundEnabled && activeId === post.id ? <Volume2 size={18} /> : <VolumeX size={18} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {(after || queuedCount > 0) && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '3rem' }}>
          <button 
            className="btn btn-outline" 
            onClick={loadMore} 
            disabled={loadingMore || randomizingAll}
            style={{ minWidth: '200px' }}
          >
            {loadingMore ? <Loader2 className="animate-spin" size={18} /> : "Load More"}
          </button>
        </div>
      )}

      {/* Floating Controls */}
      <div 
        className="floating-controls"
        onMouseEnter={resetHideTimer}
        onMouseMove={resetHideTimer}
        onClick={resetHideTimer}
      >
        {(showButtons || randomizingAll) && (randomizingAll || randomizeMessage || soundBlocked) && (
          <div className="floating-feedback" role="status" aria-live="polite">
            {randomizingAll ? `Upvotes ophalen: ${scannedCount}` : randomizeMessage}
            {soundBlocked && <span>Je browser blokkeert geluid. Klik op de luidspreker bij de video.</span>}
          </div>
        )}
        <div className={`floating-expanded-controls ${showButtons ? "visible" : "hidden"}`}>
          <button className="floating-btn" type="button" aria-label="Open ruimtelijke galerij" title="Ruimtelijke galerij / Meta Quest VR" onClick={() => {
            const media = [...posts, ...queuedPostsRef.current].map(post => ({
              id: post.id, originalUrl: post.url, source: getMediaUrl(post),
            })).filter(item => redgifsId(item.originalUrl) || /\.mp4(?:[?#]|$)/i.test(item.source));
            if (!media.length) { setRandomizeMessage("Geen geschikte video's voor de ruimtelijke galerij."); return; }
            setActiveId(null); setScrollSpeed(0); setSpatialItems(media);
          }}><Glasses size={24} /></button>
          <button
            className={`floating-btn ${soundEnabled ? "active" : ""}`}
            type="button"
            aria-label={soundEnabled ? "Geluid uitschakelen" : "Geluid inschakelen"}
            title={soundEnabled ? "Geluid uitschakelen" : "Geluid inschakelen bij hover"}
            aria-pressed={soundEnabled}
            onClick={() => {
              setSoundEnabled(enabled => !enabled);
              setSoundBlocked(false);
            }}
          >
            {soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
          </button>
          <button
            className="floating-btn floating-shuffle-all"
            type="button"
            aria-label="Randomize hele lijst"
            title="Randomize alle bereikbare upvotes"
            onClick={randomizeAll}
            disabled={randomizingAll || loadingMore}
          >
            {randomizingAll ? <Loader2 className="animate-spin" size={24} /> : <Shuffle size={24} />}
            <span className="floating-btn-badge" aria-hidden="true">ALL</span>
          </button>
          {randomizingAll && (
            <button className="floating-btn" type="button" aria-label="Ophalen annuleren" title="Ophalen annuleren" onClick={() => {
              randomizeControllerRef.current?.abort();
              randomizeControllerRef.current = null;
              setRandomizingAll(false);
              setRandomizeMessage("Geannuleerd. Je huidige lijst is behouden.");
            }}><X size={24} /></button>
          )}
          {(after || queuedCount > 0) && (
            <button 
              className="floating-btn"
              onClick={loadMore}
              disabled={loadingMore || randomizingAll}
              title="Load More Posts"
            >
              {loadingMore ? <Loader2 className="animate-spin" size={24} /> : <Plus size={24} />}
            </button>
          )}

          <div 
            style={{ position: 'relative' }}
            onMouseEnter={() => {
              if (sliderTimeoutRef.current) clearTimeout(sliderTimeoutRef.current);
              setShowSpeedSlider(true);
            }}
            onMouseLeave={() => {
              sliderTimeoutRef.current = setTimeout(() => setShowSpeedSlider(false), 2000);
            }}
          >
            <button 
              className={`floating-btn ${scrollSpeed > 0 ? 'active' : ''}`}
              onClick={() => {
                togglePlayPause();
                setShowSpeedSlider(true);
                if (sliderTimeoutRef.current) clearTimeout(sliderTimeoutRef.current);
                sliderTimeoutRef.current = setTimeout(() => setShowSpeedSlider(false), 2000);
              }}
              title={scrollSpeed > 0 ? "Pause" : "Play"}
            >
              {scrollSpeed > 0 ? <Pause size={24} /> : <Play size={24} />}
            </button>
            
            {showSpeedSlider && (
              <div 
                className="speed-slider-container"
                onWheel={(e) => {
                  e.preventDefault();
                  const delta = (e.deltaX !== 0 ? e.deltaX : e.deltaY) * -0.01;
                  const currentVal = scrollSpeed > 0 ? scrollSpeed : lastSpeed;
                  const newVal = Math.max(0, Math.min(10, currentVal + delta));
                  setScrollSpeed(Number(newVal.toFixed(1)));
                  if (newVal > 0) setLastSpeed(Number(newVal.toFixed(1)));
                  if (sliderTimeoutRef.current) clearTimeout(sliderTimeoutRef.current);
                  sliderTimeoutRef.current = setTimeout(() => setShowSpeedSlider(false), 2000);
                }}
              >
                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Speed</span>
                <input 
                  type="range" 
                  min="0" 
                  max="10" 
                  step="0.1"
                  value={scrollSpeed > 0 ? scrollSpeed : lastSpeed}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setScrollSpeed(val);
                    if (val > 0) setLastSpeed(val);
                    if (sliderTimeoutRef.current) clearTimeout(sliderTimeoutRef.current);
                    sliderTimeoutRef.current = setTimeout(() => setShowSpeedSlider(false), 2000);
                  }}
                  style={{ width: '120px', cursor: 'ew-resize' }}
                />
                <span style={{ fontSize: '0.8rem', width: '25px', textAlign: 'right' }}>
                  {(scrollSpeed > 0 ? scrollSpeed : lastSpeed).toFixed(1)}
                </span>
              </div>
            )}
          </div>
          
          <div 
            style={{ position: 'relative' }}
            onMouseEnter={() => setShowColumnPicker(true)}
            onMouseLeave={() => setShowColumnPicker(false)}
          >
            <button  
              className="floating-btn"
              onClick={() => setColumns(prev => prev >= 6 ? 1 : prev + 1)}
              title={`Columns: ${columns} (Click to change)`}
            >
              <LayoutGrid size={24} />
            </button>
            
            {showColumnPicker && (
              <div className="column-picker-container">
                {[1, 2, 3, 4, 5, 6].map(num => (
                  <button
                    key={num}
                    className={`column-picker-btn ${columns === num ? 'active' : ''}`}
                    onClick={() => setColumns(num)}
                  >
                    {num}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button 
            className="floating-btn"
            onClick={shufflePosts}
            disabled={randomizingAll}
            title="Randomize loaded videos"
          >
            <Shuffle size={24} />
          </button>
        </div>

        <button 
          className={`floating-btn floating-toggle-btn ${!showButtons ? 'visible' : 'hidden'}`}
          onClick={() => setShowButtons(true)}
          title="Show Controls"
        >
          <MoreHorizontal size={24} />
        </button>
      </div>
    </div>
  );
}

