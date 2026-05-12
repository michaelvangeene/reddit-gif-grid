"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, AlertCircle, Shuffle, Play, FastForward, Pause, Plus, LayoutGrid } from "lucide-react";

interface GifGridProps {
  accessToken: string;
}

interface RedditPost {
  id: string;
  title: string;
  url: string;
  permalink: string;
  subreddit: string;
  media?: any;
  preview?: any;
  is_video: boolean;
  domain: string;
}

export default function GifGrid({ accessToken }: GifGridProps) {
  const [posts, setPosts] = useState<RedditPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [scrollSpeed, setScrollSpeed] = useState<number>(0);
  const [lastSpeed, setLastSpeed] = useState<number>(2.0);
  const [showSpeedSlider, setShowSpeedSlider] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef<boolean>(false);
  const afterRef = useRef<string | null>(null);

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
        .map((child: any) => child.data)
        .filter((post: RedditPost) => {
          const u = post.url.toLowerCase();
          const isGif = u.endsWith(".gif") || u.endsWith(".gifv") || u.endsWith(".mp4");
          const isGfycat = post.domain?.includes("gfycat.com") || post.domain?.includes("redgifs.com");
          const isImgurGif = post.domain?.includes("imgur.com") && (u.endsWith(".gif") || u.endsWith(".gifv") || u.endsWith(".mp4"));
          const isRedditVideo = post.is_video || (post.media && post.media.reddit_video);
          
          return isGif || isGfycat || isImgurGif || isRedditVideo;
        });

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
    if (!username || !after || loadingMoreRef.current) return;
    
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
    setPosts(prev => {
      const shuffled = [...prev];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    });
  };

  const getMediaUrl = (post: RedditPost) => {
    if (post.is_video && post.media?.reddit_video?.fallback_url) {
      return post.media.reddit_video.fallback_url;
    }
    if (post.url.endsWith(".gifv")) {
      return post.url.replace(".gifv", ".mp4");
    }
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
        afterRef.current
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
        <p>We couldn't find any GIFs or videos in your recent upvotes.</p>
      </div>
    );
  }

  const columnData: RedditPost[][] = Array.from({ length: columns }, () => []);
  posts.forEach((post, i) => {
    columnData[i % columns].push(post);
  });

  return (
    <div>
      <div className="masonry-grid" ref={containerRef}>
        {columnData.map((col, colIndex) => (
          <div key={colIndex} className="masonry-grid_column" style={{ width: `${100 / columns}%` }}>
            {col.map(post => {
              const mediaUrl = getMediaUrl(post);
              const isVideo = mediaUrl.includes(".mp4") || post.is_video;

              return (
                <a 
                  key={post.id} 
                  href={`https://reddit.com${post.permalink}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="gif-card"
                  style={{ display: 'block' }}
                  onMouseEnter={(e) => {
                    const video = e.currentTarget.querySelector('video');
                    if (video) {
                      video.muted = false;
                      video.volume = 1.0;
                    }
                  }}
                  onMouseLeave={(e) => {
                    const video = e.currentTarget.querySelector('video');
                    if (video) {
                      video.muted = true;
                    }
                  }}
                >
                  {isVideo ? (
                    <video 
                      src={mediaUrl} 
                      autoPlay 
                      loop 
                      muted 
                      playsInline
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
              );
            })}
          </div>
        ))}
      </div>

      {after && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '3rem' }}>
          <button 
            className="btn btn-outline" 
            onClick={loadMore} 
            disabled={loadingMore}
            style={{ minWidth: '200px' }}
          >
            {loadingMore ? <Loader2 className="animate-spin" size={18} /> : "Load More"}
          </button>
        </div>
      )}

      {/* Floating Controls */}
      <div className="floating-controls">
        {after && (
          <button 
            className="floating-btn"
            onClick={loadMore}
            disabled={loadingMore}
            title="Load More Posts"
          >
            {loadingMore ? <Loader2 className="animate-spin" size={24} /> : <Plus size={24} />}
          </button>
        )}

        <div 
          style={{ position: 'relative' }}
          onMouseEnter={() => setShowSpeedSlider(true)}
          onMouseLeave={() => setShowSpeedSlider(false)}
        >
          <button 
            className={`floating-btn ${scrollSpeed > 0 ? 'active' : ''}`}
            onClick={togglePlayPause}
            title={scrollSpeed > 0 ? "Pause" : "Play"}
          >
            {scrollSpeed > 0 ? <Pause size={24} /> : <Play size={24} />}
          </button>
          
          {showSpeedSlider && (
            <div className="speed-slider-container">
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
                }}
                style={{ width: '120px', cursor: 'ew-resize' }}
              />
              <span style={{ fontSize: '0.8rem', width: '25px', textAlign: 'right' }}>
                {(scrollSpeed > 0 ? scrollSpeed : lastSpeed).toFixed(1)}
              </span>
            </div>
          )}
        </div>
        
        <button  
          className="floating-btn"
          onClick={() => setColumns(prev => prev >= 8 ? 1 : prev + 1)}
          title={`Columns: ${columns} (Click to change)`}
        >
          <LayoutGrid size={24} />
        </button>

        <button 
          className="floating-btn"
          onClick={shufflePosts}
          title="Randomize Grid"
        >
          <Shuffle size={24} />
        </button>
      </div>
    </div>
  );
}
