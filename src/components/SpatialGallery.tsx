"use client";

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ChevronLeft, ChevronRight, Volume2, VolumeX, Play, Pause, LayoutGrid, Shuffle, RotateCcw, Glasses, X, Loader2 } from 'lucide-react';
import { shuffled } from '../lib/randomize-listing';
import { redgifsId } from '../lib/redgifs';
import { redditVideoId } from '../lib/reddit-audio';
import { fitVideo, galleryPositions, nextGalleryPage, VR_PAGE_SIZE } from '../lib/vr-layout';

export interface SpatialMedia { id: string; originalUrl: string; source: string }
interface Props { items: SpatialMedia[]; onClose: () => void; onShuffleAll?: () => Promise<SpatialMedia[]> }
interface GalleryActions {
  sound: () => void; playback: () => void; count: (value: number) => void;
  shuffle: () => void; shuffleAll: () => void; reset: () => void; move: (direction: number) => void;
}
type Screen = { video: HTMLVideoElement; audio?: HTMLAudioElement; dispose: () => void };

export default function SpatialGallery({ items, onClose, onShuffleAll }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const actionsRef = useRef<GalleryActions | null>(null);
  const shuffleAllRef = useRef(onShuffleAll);
  useEffect(() => { shuffleAllRef.current = onShuffleAll; }, [onShuffleAll]);
  const [windowCount, setWindowCount] = useState(3);
  const [soundOn, setSoundOn] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [allBusy, setAllBusy] = useState(false);
  const [showCountPicker, setShowCountPicker] = useState(false);
  const [supported, setSupported] = useState(false);
  const [inVR, setInVR] = useState(false);
  const [status, setStatus] = useState('Sleep om rond te kijken. Selecteer een scherm voor geluid.');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    navigator.xr?.isSessionSupported('immersive-vr').then(value => {
      if (mounted) setSupported(value);
    }).catch(() => { /* Desktop preview remains available without WebXR permission. */ });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
    catch { queueMicrotask(() => setStatus('Je browser kon de 3D-omgeving niet starten.')); return; }
    rendererRef.current = renderer;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFramebufferScaleFactor(0.85);
    host.appendChild(renderer.domElement);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const gridVideos = Array.from(document.querySelectorAll<HTMLVideoElement>('.masonry-grid video'));
    const previouslyPlaying = gridVideos.filter(video => !video.paused);
    gridVideos.forEach(video => { video.muted = true; video.pause(); });
    document.querySelectorAll<HTMLAudioElement>('.masonry-grid audio').forEach(audio => { audio.muted = true; audio.pause(); });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');
    const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 40);
    camera.position.set(0, 1.6, 0.25);
    const resources: { dispose: () => void }[] = [];
    const interactables: THREE.Mesh[] = [];
    const pageGroup = new THREE.Group();
    scene.add(pageGroup);
    let screens: Screen[] = [];
    let pageResources: { dispose: () => void }[] = [];
    let pageController = new AbortController();
    let start = 0;
    let count = VR_PAGE_SIZE;
    let pool = [...items];
    let soundEnabled = false;
    let paused = false;
    let loadingAll = false;
    let savedLayout: { position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];
    let releaseAllDrags = () => {};
    let selected: Screen | null = null;
    let disposed = false;

    function label(text: string, width: number, height: number, color = '#dddddf') {
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 160;
      const ctx = canvas.getContext('2d')!;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
      const geometry = new THREE.PlaneGeometry(width, height);
      const mesh = new THREE.Mesh(geometry, material);
      function update(value: string) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = color; ctx.font = '500 54px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(value.slice(0, 65), 512, 80, 980);
        texture.needsUpdate = true;
      }
      update(text);
      return { mesh, update, resources: [texture, material, geometry] };
    }
    const heading = label('Ruimtelijke galerij', 3.6, 0.48);
    heading.mesh.position.set(0, 3, -3.5); scene.add(heading.mesh); resources.push(...heading.resources);
    const hint = label('Trigger: geluid | Grip vasthouden: scherm slepen', 4.8, 0.34);
    hint.mesh.position.set(0, 0.45, -3.2); scene.add(hint.mesh); resources.push(...hint.resources);
    const message = label('', 4.4, 0.28, '#ffb18c');
    message.mesh.position.set(0, 0.15, -3.2); scene.add(message.mesh); resources.push(...message.resources);
    const report = (text: string) => { if (!disposed) { message.update(text); setStatus(text); } };

    const muteAll = () => {
      screens.forEach(screen => { screen.video.muted = true; if (screen.audio) { screen.audio.muted = true; screen.audio.pause(); } });
      selected = null;
    };
    function select(screen: Screen) {
      const wasSelected = selected === screen;
      muteAll();
      if (wasSelected) { soundEnabled = false; setSoundOn(false); return; }
      soundEnabled = true; setSoundOn(true);
      selected = screen;
      screen.video.muted = Boolean(screen.audio);
      if (!paused) screen.video.play().catch(() => report('Selecteer dit scherm opnieuw om af te spelen.'));
      if (screen.audio) {
        screen.audio.currentTime = screen.video.currentTime;
        screen.audio.muted = false;
        if (!paused) screen.audio.play().catch(() => report('Selecteer het scherm opnieuw voor geluid.'));
      }
      report('Geluid aan voor het geselecteerde scherm.');
    }

    function loadPage(resetLayout = false) {
      releaseAllDrags();
      if (resetLayout) savedLayout = [];
      else if (pageGroup.children.length) {
        for (const group of pageGroup.children) savedLayout[group.userData.slot] = { position: group.position.clone(), quaternion: group.quaternion.clone() };
      }
      pageController.abort(); pageController = new AbortController();
      const signal = pageController.signal;
      muteAll(); screens.forEach(screen => screen.dispose()); screens = [];
      pageResources.forEach(resource => resource.dispose()); pageResources = [];
      pageGroup.clear();
      interactables.splice(0, interactables.length, ...interactables.filter(mesh => mesh.userData.persistent));
      const page = pool.slice(start, start + count);
      const positions = galleryPositions(page.length);
      page.forEach((item, index) => {
        const group = new THREE.Group();
        group.userData.slot = index;
        group.position.copy(new THREE.Vector3(positions[index].x, positions[index].y, positions[index].z));
        group.lookAt(0, 1.65, 0);
        if (savedLayout[index]) { group.position.copy(savedLayout[index].position); group.quaternion.copy(savedLayout[index].quaternion); }
        pageGroup.add(group);
        const frameGeometry = new THREE.BoxGeometry(1.95, 1.65, 0.06);
        const frameMaterial = new THREE.MeshBasicMaterial({ color: '#1a1a1c' });
        const frame = new THREE.Mesh(frameGeometry, frameMaterial);
        group.add(frame); interactables.push(frame);
        pageResources.push(frameGeometry, frameMaterial);
        const caption = label(`Video ${start + index + 1} / ${pool.length} - laden...`, 1.9, 0.26);
        caption.mesh.position.set(0, -0.98, 0.04); group.add(caption.mesh); pageResources.push(...caption.resources);
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous'; video.loop = true; video.muted = true; video.playsInline = true; video.preload = 'auto';
        let audio: HTMLAudioElement | undefined;
        const screen: Screen = { video, dispose: () => {
          video.pause(); video.removeAttribute('src'); video.load();
          audio?.pause(); audio?.removeAttribute('src'); audio?.load();
        } };
        screens.push(screen);
        const texture = new THREE.VideoTexture(video); texture.colorSpace = THREE.SRGBColorSpace;
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
        const surface = new THREE.Mesh(geometry, material);
        surface.position.z = 0.04; surface.scale.set(1.8, 1.01, 1); group.add(surface);
        pageResources.push(texture, geometry, material);
        video.addEventListener('loadedmetadata', () => {
          const size = fitVideo(video.videoWidth, video.videoHeight); surface.scale.set(size.width, size.height, 1);
          caption.update(`Video ${start + index + 1} / ${pool.length}`);
        });
        video.addEventListener('error', () => { if (!signal.aborted) caption.update('Deze bron kan niet in VR worden afgespeeld.'); });
        frame.userData.select = () => select(screen);
        frame.userData.dragGroup = group;
        frame.userData.hover = (value: boolean) => frameMaterial.color.set(value ? '#ff4500' : '#1a1a1c');
        async function load() {
          try {
            const id = redgifsId(item.originalUrl);
            let source = item.source;
            if (id) {
              const response = await fetch(`/api/redgifs/${id}?quality=sd`, { signal });
              if (!response.ok) throw new Error('Video niet beschikbaar');
              const result = await response.json(); source = result.url;
            }
            if (signal.aborted) return;
            if (!source) throw new Error('Geen videobron');
            video.src = source;
            if (!paused) await video.play();
            if (paused) video.pause();
            const redditId = !id ? redditVideoId(source) : null;
            if (redditId) {
              const response = await fetch(`/api/reddit-audio/${redditId}`, { signal });
              if (response.ok) {
                const result = await response.json();
                if (result.url && !signal.aborted) {
                  audio = new Audio(result.url); audio.loop = true; audio.muted = true; screen.audio = audio;
                  const sync = () => { if (audio && Math.abs(audio.currentTime - video.currentTime) > 0.25) audio.currentTime = video.currentTime; };
                  video.addEventListener('timeupdate', sync);
                  video.addEventListener('pause', () => audio?.pause());
                  video.addEventListener('waiting', () => audio?.pause());
                  video.addEventListener('playing', () => {
                    if (selected === screen && audio && !paused) audio.play().catch(() => report('Selecteer het scherm opnieuw voor geluid.'));
                  });
                }
              }
            }
          } catch { if (!signal.aborted) caption.update('Bron niet beschikbaar in VR.'); }
        }
        void load();
      });
      report(`${start + 1}-${Math.min(start + count, pool.length)} van ${pool.length} video's`);
    }

    const movePage = (direction: number) => { start = nextGalleryPage(start, pool.length, direction, count); loadPage(); };
    const toggleSound = () => {
      if (soundEnabled) { soundEnabled = false; setSoundOn(false); muteAll(); }
      else if (screens.length) select(screens[Math.floor(screens.length / 2)]);
    };
    const togglePlayback = () => {
      paused = !paused; setPlaying(!paused);
      screens.forEach(screen => {
        if (paused) { screen.video.pause(); screen.audio?.pause(); }
        else { void screen.video.play().catch(() => report('Selecteer een scherm om af te spelen.'));
          if (selected === screen && screen.audio && soundEnabled) void screen.audio.play().catch(() => report('Selecteer opnieuw voor geluid.'));
        }
      });
    };
    const setCount = (value: number) => {
      count = Math.max(1, Math.min(6, Math.floor(value))); setWindowCount(count);
      start = 0; loadPage(true);
    };
    const shufflePool = () => { pool = shuffled(pool); start = 0; loadPage(); };
    const shuffleAll = async () => {
      if (loadingAll) return;
      const request = shuffleAllRef.current;
      if (!request) { shufflePool(); return; }
      loadingAll = true; setAllBusy(true); report('Alle bereikbare upvotes ophalen...');
      try {
        const result = await request();
        if (!disposed && result.length) { pool = shuffled(result); start = 0; loadPage(); }
      } catch { report('Ophalen mislukt. Probeer opnieuw of log opnieuw in.'); }
      finally { loadingAll = false; if (!disposed) setAllBusy(false); }
    };
    actionsRef.current = { sound: toggleSound, playback: togglePlayback, count: setCount,
      shuffle: shufflePool, shuffleAll: () => { void shuffleAll(); }, reset: () => loadPage(true), move: movePage };

    // Canvas versions of the site's circular, white-icon controls are also selectable inside VR.
    const iconPaths: Record<string, string[]> = {
      sound: ['M11 5 6 9H3v6h3l5 4Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
      play: ['M6 3 20 12 6 21Z'], pause: ['M7 4v16', 'M17 4v16'],
      count: ['M3 3h7v7H3Z','M14 3h7v7h-7Z','M3 14h7v7H3Z','M14 14h7v7h-7Z'],
      shuffle: ['M3 3 21 21','M18 21h3v-3','M3 21l7-7','M14 10l7-7','M18 3h3v3'],
      reset: ['M3 10a9 9 0 1 1 2.5 8','M3 4v6h6'],
      previous: ['M15 5 8 12l7 7'], next: ['M9 5 16 12l-7 7'], close: ['M6 6 18 18','M6 18 18 6'],
    };
    function button(icon: string, text: string, slot: number, action: () => void, active: () => boolean = () => false, badge?: () => string) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const geometry = new THREE.CircleGeometry(0.17, 48);
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0.65 + (slot % 3) * 0.42, 1.25 - Math.floor(slot / 3) * 0.42, -1.9);
      mesh.lookAt(0, 1.6, 0);
      let last = '';
      mesh.userData.persistent = true; mesh.userData.select = action;
      mesh.userData.hover = (hover: boolean) => {
        const isActive = active(); const currentIcon = icon === 'play' && paused ? 'play' : icon === 'play' ? 'pause' : icon;
        const badgeText = badge?.() || ''; const key = `${hover}-${isActive}-${badgeText}-${currentIcon}`;
        if (key === last) return; last = key;
        ctx.clearRect(0, 0, 256, 256); ctx.beginPath(); ctx.arc(128, 128, 123, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? '#ff4500' : hover ? '#232326' : '#1a1a1c'; ctx.fill();
        ctx.strokeStyle = hover || isActive ? '#ff4500' : '#333333'; ctx.lineWidth = 4; ctx.stroke();
        ctx.save(); ctx.translate(128, badgeText ? 114 : 128); ctx.scale(6.4, 6.4); ctx.translate(-12, -12);
        ctx.strokeStyle = hover && !isActive ? '#ff4500' : '#ededed'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const path of iconPaths[currentIcon]) ctx.stroke(new Path2D(path)); ctx.restore();
        if (badgeText) { ctx.fillStyle = '#ededed'; ctx.font = 'bold 35px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(badgeText, 128, 215); }
        texture.needsUpdate = true;
        if (hover) message.update(text);
      };
      mesh.userData.hover(false);
      scene.add(mesh); interactables.push(mesh); resources.push(geometry, material, texture);
    }
    button('sound', 'Geluid aan / uit', 0, toggleSound, () => soundEnabled);
    button('play', 'Video\'s pauzeren / afspelen', 1, togglePlayback, () => !paused);
    button('count', 'Aantal vensters: klik om 1-6 te kiezen', 2, () => setCount(count >= 6 ? 1 : count + 1), () => false, () => String(count));
    button('shuffle', 'Geladen lijst schudden', 3, shufflePool);
    button('shuffle', 'Alle bereikbare upvotes schudden', 4, () => { void shuffleAll(); }, () => loadingAll, () => 'ALL');
    button('reset', 'Vensters terugzetten', 5, () => loadPage(true));
    button('previous', 'Vorige vensters', 6, () => movePage(-1));
    button('next', 'Volgende vensters', 7, () => movePage(1));
    button('close', 'Galerij afsluiten', 8, onClose);
    const raycaster = new THREE.Raycaster();
    const rotation = new THREE.Matrix4();
    const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
    const hitForController = (controller: THREE.Group) => {
      rotation.identity().extractRotation(controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation);
      return raycaster.intersectObjects(interactables, false)[0]?.object;
    };
    const grabs = new Map<THREE.Group, THREE.Group>();
    function drop(controller: THREE.Group) {
      const group = grabs.get(controller); if (!group) return;
      pageGroup.attach(group);
      const head = new THREE.Vector3(); camera.getWorldPosition(head);
      group.lookAt(head.x, group.position.y, head.z); group.userData.grabbed = false;
      grabs.delete(controller);
    }
    releaseAllDrags = () => { for (const controller of [...grabs.keys()]) drop(controller); };
    controllers.forEach(controller => {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -5)]);
      const lineMaterial = new THREE.LineBasicMaterial({ color: '#ff8b61' });
      controller.add(new THREE.Line(lineGeometry, lineMaterial));
      controller.addEventListener('select', () => { if (!grabs.has(controller)) hitForController(controller)?.userData.select?.(); });
      controller.addEventListener('squeezestart', () => {
        const group = hitForController(controller)?.userData.dragGroup as THREE.Group | undefined;
        if (!group || group.userData.grabbed) return;
        group.userData.grabbed = true; controller.attach(group); grabs.set(controller, group);
        report('Grip loslaten om het venster hier neer te zetten.');
      });
      controller.addEventListener('squeezeend', () => drop(controller));
      controller.addEventListener('disconnected', () => drop(controller));
      scene.add(controller); resources.push(lineGeometry, lineMaterial);
    });
    let downX = 0, downY = 0, originX = 0, originY = 0, dragging = false, moved = false;
    let desktopDrag: THREE.Group | null = null;
    const dragPlane = new THREE.Plane(); const dragOffset = new THREE.Vector3(); const dragPoint = new THREE.Vector3();
    const pointerRay = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), camera);
    };
    const pointerDown = (event: PointerEvent) => {
      downX = originX = event.clientX; downY = originY = event.clientY; dragging = true; moved = false;
      renderer.domElement.setPointerCapture(event.pointerId); pointerRay(event);
      desktopDrag = raycaster.intersectObjects(interactables, false)[0]?.object.userData.dragGroup || null;
      if (desktopDrag) {
        dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), desktopDrag.position);
        if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) dragOffset.copy(desktopDrag.position).sub(dragPoint);
      }
    };
    const pointerMove = (event: PointerEvent) => {
      if (!dragging || renderer.xr.isPresenting) return;
      const dx = event.clientX - downX, dy = event.clientY - downY;
      if (Math.abs(event.clientX - originX) + Math.abs(event.clientY - originY) > 4) moved = true;
      if (desktopDrag) {
        pointerRay(event);
        if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) desktopDrag.position.copy(dragPoint).add(dragOffset);
      } else {
        camera.rotation.order = 'YXZ'; camera.rotation.y -= dx * 0.004;
        camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - dy * 0.004, -0.65, 0.65);
      }
      downX = event.clientX; downY = event.clientY;
    };
    const pointerUp = (event: PointerEvent) => {
      dragging = false; desktopDrag = null;
      if (moved || renderer.xr.isPresenting) return;
      pointerRay(event); raycaster.intersectObjects(interactables, false)[0]?.object.userData.select?.();
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight;
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    const onSessionEnd = () => { releaseAllDrags(); setInVR(false); muteAll(); camera.position.set(0, 1.6, 0.25); camera.rotation.set(0, 0, 0); };
    renderer.xr.addEventListener('sessionend', onSessionEnd);
    renderer.setAnimationLoop(() => {
      const hovered = new Set<THREE.Object3D>();
      if (renderer.xr.isPresenting) controllers.forEach(controller => { if (!grabs.has(controller)) { const hit = hitForController(controller); if (hit) hovered.add(hit); } });
      interactables.forEach(mesh => mesh.userData.hover?.(hovered.has(mesh)));
      renderer.render(scene, camera);
    });
    loadPage(); queueMicrotask(() => { if (!disposed) setReady(true); });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => {
      disposed = true; pageController.abort(); releaseAllDrags(); actionsRef.current = null;
      document.removeEventListener('keydown', escape);
      renderer.setAnimationLoop(null);
      renderer.xr.removeEventListener('sessionend', onSessionEnd);
      const session = renderer.xr.getSession(); if (session) void session.end().catch(() => {});
      observer.disconnect(); screens.forEach(screen => screen.dispose());
      [...pageResources, ...resources].forEach(resource => resource.dispose());
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); rendererRef.current = null;
      document.body.style.overflow = previousOverflow;
      previouslyPlaying.forEach(video => { video.muted = true; video.play().catch(() => {}); });
    };
  }, [items, onClose]);

  const startVR = () => {
    const renderer = rendererRef.current;
    if (!renderer || !navigator.xr) return;
    // Request directly in this click handler: browser user activation must be preserved.
    navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] })
      .then(async session => {
        if (rendererRef.current !== renderer) { await session.end(); return; }
        try { await renderer.xr.setSession(session); setInVR(true); }
        catch { await session.end(); setStatus('VR kon niet starten. Probeer opnieuw in de Quest Browser.'); }
      })
      .catch(() => setStatus('VR is niet gestart. Sta de VR-sessie toe in de Quest Browser en probeer opnieuw.'));
  };

  return <div className="spatial-gallery" role="dialog" aria-modal="true" aria-label="Ruimtelijke galerij">
    <strong className="spatial-gallery-heading">Ruimtelijke galerij</strong>
    <div className="spatial-gallery-canvas" ref={hostRef} />
    <div className="floating-controls spatial-gallery-controls">
      <button className={`floating-btn ${inVR ? 'active' : ''}`} type="button" disabled={!supported || !ready || inVR} aria-label="Start VR" title={supported ? 'Start VR op je Quest' : 'Open deze site op je Meta Quest om VR te starten'} onClick={startVR}><Glasses size={24} /></button>
      <button className={`floating-btn ${soundOn ? 'active' : ''}`} type="button" aria-label={soundOn ? 'Geluid uitschakelen' : 'Geluid inschakelen'} title="Geluid aan / uit" onClick={() => actionsRef.current?.sound()}>{soundOn ? <Volume2 size={24} /> : <VolumeX size={24} />}</button>
      <button className={`floating-btn ${playing ? 'active' : ''}`} type="button" aria-label={playing ? 'Video's pauzeren' : 'Video's afspelen'} title={playing ? 'Pauzeren' : 'Afspelen'} onClick={() => actionsRef.current?.playback()}>{playing ? <Pause size={24} /> : <Play size={24} />}</button>
      <div style={{ position: 'relative' }}>
        <button className="floating-btn floating-shuffle-all" type="button" aria-label="Aantal vensters" aria-expanded={showCountPicker} title={`Aantal vensters: ${windowCount}`} onClick={() => setShowCountPicker(value => !value)}><LayoutGrid size={24} /><span className="floating-btn-badge">{windowCount}</span></button>
        {showCountPicker && <div className="column-picker-container">{[1,2,3,4,5,6].map(value => <button className={`column-picker-btn ${windowCount === value ? 'active' : ''}`} type="button" key={value} aria-label={`${value} vensters`} onClick={() => { actionsRef.current?.count(value); setShowCountPicker(false); }}>{value}</button>)}</div>}
      </div>
      <button className="floating-btn" type="button" aria-label="Randomize geladen lijst" title="Geladen lijst schudden" disabled={allBusy} onClick={() => actionsRef.current?.shuffle()}><Shuffle size={24} /></button>
      <button className="floating-btn floating-shuffle-all" type="button" aria-label="Randomize hele lijst" title="Alle bereikbare upvotes schudden" disabled={allBusy} onClick={() => actionsRef.current?.shuffleAll()}>{allBusy ? <Loader2 className="animate-spin" size={24} /> : <Shuffle size={24} />}<span className="floating-btn-badge">ALL</span></button>
      <button className="floating-btn" type="button" aria-label="Vensters terugzetten" title="Vensters terugzetten" onClick={() => actionsRef.current?.reset()}><RotateCcw size={24} /></button>
      <button className="floating-btn" type="button" aria-label="Vorige vensters" title="Vorige vensters" onClick={() => actionsRef.current?.move(-1)}><ChevronLeft size={24} /></button>
      <button className="floating-btn" type="button" aria-label="Volgende vensters" title="Volgende vensters" onClick={() => actionsRef.current?.move(1)}><ChevronRight size={24} /></button>
      <button className="floating-btn" type="button" aria-label="Galerij sluiten" title="Galerij sluiten" onClick={onClose}><X size={24} /></button>
    </div>
    <p className="spatial-gallery-status" role="status">{status}<br />Sleep een scherm met de muis; sleep de achtergrond om rond te kijken. In VR: richt op een scherm en houd de gripknop vast.{!supported && <><br />Voor VR: open deze site in de browser van je Meta Quest 3 en log in.</>}</p>
  </div>;
}
