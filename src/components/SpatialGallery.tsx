"use client";

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { redgifsId } from '../lib/redgifs';
import { redditVideoId } from '../lib/reddit-audio';
import { fitVideo, galleryPositions, nextGalleryPage, VR_PAGE_SIZE } from '../lib/vr-layout';

export interface SpatialMedia { id: string; originalUrl: string; source: string }
interface Props { items: SpatialMedia[]; onClose: () => void }
type Screen = { video: HTMLVideoElement; audio?: HTMLAudioElement; dispose: () => void };

export default function SpatialGallery({ items, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
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
    scene.background = new THREE.Color('#0b0d13');
    scene.fog = new THREE.Fog('#0b0d13', 7, 22);
    const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 40);
    camera.position.set(0, 1.6, 0.25);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshBasicMaterial({ color: '#151922' }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const grid = new THREE.GridHelper(24, 48, '#35445b', '#212938');
    grid.position.y = 0.005;
    scene.add(grid);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.7, 4.73, 100), new THREE.MeshBasicMaterial({ color: '#ff4500', side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);

    const resources: { dispose: () => void }[] = [floor.geometry, floor.material, grid.geometry, ...(Array.isArray(grid.material) ? grid.material : [grid.material]), ring.geometry, ring.material];
    const interactables: THREE.Mesh[] = [];
    const pageGroup = new THREE.Group();
    scene.add(pageGroup);
    let screens: Screen[] = [];
    let pageResources: { dispose: () => void }[] = [];
    let pageController = new AbortController();
    let start = 0;
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
    const hint = label('Richt + trigger: geluid | Vorige / volgende: andere schermen', 4.8, 0.34);
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
      if (wasSelected) return;
      selected = screen;
      screen.video.muted = Boolean(screen.audio);
      screen.video.play().catch(() => report('Selecteer dit scherm opnieuw om af te spelen.'));
      if (screen.audio) {
        screen.audio.currentTime = screen.video.currentTime;
        screen.audio.muted = false;
        screen.audio.play().catch(() => report('Selecteer het scherm opnieuw voor geluid.'));
      }
      report('Geluid aan voor het geselecteerde scherm.');
    }

    function loadPage() {
      pageController.abort(); pageController = new AbortController();
      const signal = pageController.signal;
      muteAll(); screens.forEach(screen => screen.dispose()); screens = [];
      pageResources.forEach(resource => resource.dispose()); pageResources = [];
      pageGroup.clear();
      interactables.splice(0, interactables.length, ...interactables.filter(mesh => mesh.userData.persistent));
      const page = items.slice(start, start + VR_PAGE_SIZE);
      const positions = galleryPositions(page.length);
      page.forEach((item, index) => {
        const group = new THREE.Group();
        group.position.copy(new THREE.Vector3(positions[index].x, positions[index].y, positions[index].z));
        group.lookAt(0, 1.65, 0);
        pageGroup.add(group);
        const frameGeometry = new THREE.BoxGeometry(1.95, 1.65, 0.06);
        const frameMaterial = new THREE.MeshBasicMaterial({ color: '#303949' });
        const frame = new THREE.Mesh(frameGeometry, frameMaterial);
        group.add(frame); interactables.push(frame);
        pageResources.push(frameGeometry, frameMaterial);
        const caption = label(`Video ${start + index + 1} / ${items.length} - laden...`, 1.9, 0.26);
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
          caption.update(`Video ${start + index + 1} / ${items.length}`);
        });
        video.addEventListener('error', () => { if (!signal.aborted) caption.update('Deze bron kan niet in VR worden afgespeeld.'); });
        frame.userData.select = () => select(screen);
        frame.userData.hover = (value: boolean) => frameMaterial.color.set(value ? '#ff4500' : '#303949');
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
            await video.play();
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
                    if (selected === screen && audio) audio.play().catch(() => report('Selecteer het scherm opnieuw voor geluid.'));
                  });
                }
              }
            }
          } catch { if (!signal.aborted) caption.update('Bron niet beschikbaar in VR.'); }
        }
        void load();
      });
      report(`${start + 1}-${Math.min(start + VR_PAGE_SIZE, items.length)} van ${items.length} video's`);
    }

    function button(text: string, x: number, action: () => void) {
      const geometry = new THREE.BoxGeometry(0.95, 0.35, 0.06);
      const material = new THREE.MeshBasicMaterial({ color: '#303949' });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, 0.8, -2.4); mesh.lookAt(0, 1.4, 0);
      mesh.userData.persistent = true; mesh.userData.select = action;
      mesh.userData.hover = (value: boolean) => material.color.set(value ? '#ff4500' : '#303949');
      const textLabel = label(text, 0.88, 0.21); textLabel.mesh.position.z = 0.04; mesh.add(textLabel.mesh);
      scene.add(mesh); interactables.push(mesh); resources.push(geometry, material, ...textLabel.resources);
    }
    button('Vorige', -1.1, () => { start = nextGalleryPage(start, items.length, -1); loadPage(); });
    button('Afsluiten', 0, () => {
      const session = renderer.xr.getSession();
      if (session) void session.end(); else onClose();
    });
    button('Volgende', 1.1, () => { start = nextGalleryPage(start, items.length, 1); loadPage(); });
    const raycaster = new THREE.Raycaster();
    const rotation = new THREE.Matrix4();
    const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
    const hitForController = (controller: THREE.Group) => {
      rotation.identity().extractRotation(controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation);
      return raycaster.intersectObjects(interactables, false)[0]?.object;
    };
    controllers.forEach(controller => {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -5)]);
      const lineMaterial = new THREE.LineBasicMaterial({ color: '#ff8b61' });
      controller.add(new THREE.Line(lineGeometry, lineMaterial));
      controller.addEventListener('select', () => hitForController(controller)?.userData.select?.());
      scene.add(controller); resources.push(lineGeometry, lineMaterial);
    });
    let downX = 0, downY = 0, dragging = false, moved = false;
    const pointerDown = (event: PointerEvent) => { downX = event.clientX; downY = event.clientY; dragging = true; moved = false; renderer.domElement.setPointerCapture(event.pointerId); };
    const pointerMove = (event: PointerEvent) => {
      if (!dragging || renderer.xr.isPresenting) return;
      const dx = event.clientX - downX, dy = event.clientY - downY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      camera.rotation.order = 'YXZ'; camera.rotation.y -= dx * 0.004;
      camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - dy * 0.004, -0.65, 0.65);
      downX = event.clientX; downY = event.clientY;
    };
    const pointerUp = (event: PointerEvent) => {
      dragging = false;
      if (moved || renderer.xr.isPresenting) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), camera);
      raycaster.intersectObjects(interactables, false)[0]?.object.userData.select?.();
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight;
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    const onSessionEnd = () => { setInVR(false); muteAll(); camera.position.set(0, 1.6, 0.25); camera.rotation.set(0, 0, 0); };
    renderer.xr.addEventListener('sessionend', onSessionEnd);
    renderer.setAnimationLoop(() => {
      interactables.forEach(mesh => mesh.userData.hover?.(false));
      if (renderer.xr.isPresenting) controllers.forEach(controller => hitForController(controller)?.userData.hover?.(true));
      renderer.render(scene, camera);
    });
    loadPage(); queueMicrotask(() => { if (!disposed) setReady(true); });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => {
      disposed = true; pageController.abort();
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
    <div className="spatial-gallery-toolbar">
      <strong>Ruimtelijke galerij</strong>
      <button className="btn btn-outline" type="button" disabled={!supported || !ready || inVR} onClick={startVR}>{inVR ? 'VR actief' : 'Start VR'}</button>
      <button className="btn btn-outline" type="button" onClick={onClose}>Sluiten</button>
    </div>
    <div className="spatial-gallery-canvas" ref={hostRef} />
    <p className="spatial-gallery-status" role="status">{status}<br />{!supported && 'Voor VR: open deze site in de browser van je Meta Quest 3 en log in.'}</p>
  </div>;
}
