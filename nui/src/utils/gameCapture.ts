/**
 * Game screen capture pipeline using CfxTexture (FiveM WebGL extension).
 *
 * Mirrors the fivem-watch / screenshot-basic approach exactly:
 *  1. init() creates the WebGL pipeline once
 *  2. animate() runs via rAF ONLY while a capture is pending, renders CfxTexture → renderTarget
 *  3. Pixel reads happen INSIDE animate(), right after render (never in a separate callstack)
 *  4. For streaming: setInterval sets captureRequestPending, animate() processes it
 *  5. For screenshots: a pending callback is set, animate() resolves it after render
 */

// cfx-three.min.js does NOT export NearestFilter — hardcode the THREE.js constant.
const NEAREST_FILTER = 1003;

function getThree(): any {
    return (window as any).CFX_THREE ?? (window as any).THREE ?? null;
}

type CaptureConfig = {
    fps: number;
    quality: number;
    resolutionScale: number;
};

const DEFAULT_CONFIG: CaptureConfig = {
    fps: 5,
    quality: 0.4,
    resolutionScale: 0.5,
};

// ---- Three.js resources (persistent, never torn down) ----
let pipelineReady = false;
let renderer: any = null;
let renderTarget: any = null;
let scene: any = null;
let camera: any = null;
let material: any = null;
let outputCanvas: HTMLCanvasElement | null = null;
let outputCtx: CanvasRenderingContext2D | null = null;
let currentResolutionScale = 0.5;

// ---- Render loop state (only runs while there is a pending capture) ----
const WARMUP_FRAMES = 3;
let loopRunning = false;
let warmFrames = 0;

// ---- Streaming state ----
let captureActive = false;
let captureRequestPending = false;
let captureIntervalTimer: ReturnType<typeof setInterval> | null = null;
let streamOnFrame: ((sessionId: string, frameData: string) => void) | null = null;
let streamSessionId: string | null = null;
let streamQuality = 0.4;

// ---- Screenshot state ----
let screenshotPending: {
    quality: number;
    encoding: string;
    resolutionScale: number;
    resolve: (data: string | null) => void;
} | null = null;

function getRenderWidth() {
    return Math.max(1, Math.floor(window.innerWidth * currentResolutionScale));
}
function getRenderHeight() {
    return Math.max(1, Math.floor(window.innerHeight * currentResolutionScale));
}

function init() {
    if (pipelineReady) return;

    const T = getThree();
    if (!T) throw new Error('THREE.js not available');
    if (!T.CfxTexture) throw new Error('CfxTexture not available');

    const rw = getRenderWidth();
    const rh = getRenderHeight();

    // Camera
    camera = new T.OrthographicCamera(rw / -2, rw / 2, rh / 2, rh / -2, -10000, 10000);
    camera.position.z = 100;

    // Scene
    scene = new T.Scene();

    // Render Target
    renderTarget = new T.WebGLRenderTarget(rw, rh, {
        minFilter: T.LinearFilter,
        magFilter: NEAREST_FILTER,
        format: T.RGBAFormat,
        type: T.UnsignedByteType,
    });

    // Game Texture (CfxTexture)
    const gameTexture = new T.CfxTexture();
    gameTexture.needsUpdate = true;

    // Material & Shader
    material = new T.ShaderMaterial({
        uniforms: { tDiffuse: { value: gameTexture } },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = vec2(uv.x, 1.0 - uv.y);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            uniform sampler2D tDiffuse;
            void main() {
                gl_FragColor = texture2D(tDiffuse, vUv);
            }
        `,
    });

    // Mesh
    const plane = new T.PlaneGeometry(rw, rh);
    const quad = new T.Mesh(plane, material);
    quad.position.z = -100;
    scene.add(quad);

    // Renderer
    renderer = new T.WebGLRenderer();
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(rw, rh);
    renderer.autoClear = false;

    // Append to DOM hidden (like screenshot-basic / fivem-watch)
    renderer.domElement.style.display = 'none';
    document.body.appendChild(renderer.domElement);

    // Output 2D canvas
    outputCanvas = document.createElement('canvas');
    outputCtx = outputCanvas.getContext('2d');

    // Listen to window resizes
    window.addEventListener('resize', resize);

    pipelineReady = true;
}

/**
 * Starts the render loop if it isn't running. A few frames are rendered
 * before any pixel read so CfxTexture is warm after being idle.
 */
function ensureLoop() {
    if (loopRunning) return;
    loopRunning = true;
    warmFrames = 0;
    requestAnimationFrame(animate);
}

function resize() {
    if (!pipelineReady || !renderer) return;

    const T = getThree();
    const rw = getRenderWidth();
    const rh = getRenderHeight();

    camera = new T.OrthographicCamera(rw / -2, rw / 2, rh / 2, rh / -2, -10000, 10000);
    camera.position.z = 100;

    renderTarget?.dispose();
    renderTarget = new T.WebGLRenderTarget(rw, rh, {
        minFilter: T.LinearFilter,
        magFilter: NEAREST_FILTER,
        format: T.RGBAFormat,
        type: T.UnsignedByteType,
    });

    const plane = new T.PlaneGeometry(rw, rh);
    const quad = new T.Mesh(plane, material);
    quad.position.z = -100;

    scene?.children.forEach((child: any) => child.geometry?.dispose());
    scene = new T.Scene();
    scene.add(quad);

    renderer.setSize(rw, rh);
}

/**
 * Render loop, stops itself once there is nothing left to capture.
 * Pixel reads happen HERE, right after render — never in a separate callstack.
 */
function animate() {
    if (!renderer || !scene || !camera || !renderTarget || (!captureActive && !screenshotPending)) {
        loopRunning = false;
        return;
    }
    requestAnimationFrame(animate);

    renderer.clear();
    renderer.render(scene, camera, renderTarget, true);
    if (warmFrames < WARMUP_FRAMES) {
        warmFrames++;
        return;
    }

    // Process streaming capture (flag set by setInterval)
    if (captureRequestPending) {
        captureRequestPending = false;
        processStreamCapture();
    }

    // Process screenshot request (set by captureSingleFrame)
    if (screenshotPending) {
        const pending = screenshotPending;
        screenshotPending = null;
        processScreenshot(pending);
    }
}

/**
 * Read pixels right after render and send to stream callback.
 */
function processStreamCapture() {
    if (!captureActive || !streamOnFrame || !streamSessionId) return;
    if (!renderer || !renderTarget || !outputCanvas || !outputCtx) return;

    const rw = getRenderWidth();
    const rh = getRenderHeight();

    const read = new Uint8Array(rw * rh * 4);
    renderer.readRenderTargetPixels(renderTarget, 0, 0, rw, rh, read);

    if (outputCanvas.width !== rw || outputCanvas.height !== rh) {
        outputCanvas.width = rw;
        outputCanvas.height = rh;
    }

    const d = new Uint8ClampedArray(read.buffer);
    outputCtx.putImageData(new ImageData(d, rw, rh), 0, 0);

    const dataUrl = outputCanvas.toDataURL('image/webp', streamQuality);
    streamOnFrame(streamSessionId, dataUrl);
}

/**
 * Read pixels right after render and resolve the screenshot promise.
 */
function processScreenshot(pending: NonNullable<typeof screenshotPending>) {
    if (!renderer || !renderTarget || !outputCanvas || !outputCtx) {
        pending.resolve(null);
        return;
    }

    // If screenshot needs a different resolution, resize temporarily
    const prevScale = currentResolutionScale;
    const needsResize = currentResolutionScale !== pending.resolutionScale;
    if (needsResize) {
        currentResolutionScale = pending.resolutionScale;
        resize();
        // Do one more render at the new resolution
        renderer.clear();
        renderer.render(scene, camera, renderTarget, true);
    }

    try {
        const rw = getRenderWidth();
        const rh = getRenderHeight();

        const read = new Uint8Array(rw * rh * 4);
        renderer.readRenderTargetPixels(renderTarget, 0, 0, rw, rh, read);

        if (outputCanvas.width !== rw || outputCanvas.height !== rh) {
            outputCanvas.width = rw;
            outputCanvas.height = rh;
        }

        const d = new Uint8ClampedArray(read.buffer);
        outputCtx.putImageData(new ImageData(d, rw, rh), 0, 0);

        const mimeType = pending.encoding === 'jpg' || pending.encoding === 'jpeg' ? 'image/jpeg' : 'image/webp';
        const dataUrl = outputCanvas.toDataURL(mimeType, pending.quality);
        pending.resolve(dataUrl);
    } catch (e) {
        console.error('[gameCapture] Screenshot read error:', e);
        pending.resolve(null);
    }

    // Restore streaming resolution if needed
    if (needsResize && captureActive) {
        currentResolutionScale = prevScale;
        resize();
    }
}

/**
 * Start continuous capture and call `onFrame` for each encoded frame.
 */
export function startCapture(
    sessionId: string,
    onFrame: (sessionId: string, frameData: string) => void,
    config: Partial<CaptureConfig> = {},
) {
    if (captureActive) {
        console.warn('[gameCapture] Capture already active');
        return;
    }

    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    if (currentResolutionScale !== mergedConfig.resolutionScale) {
        currentResolutionScale = mergedConfig.resolutionScale;
        if (pipelineReady) resize();
    }

    try {
        init();
    } catch (e) {
        console.error('[gameCapture] Init failed:', e);
        return;
    }

    captureActive = true;
    streamOnFrame = onFrame;
    streamSessionId = sessionId;
    streamQuality = mergedConfig.quality;

    const intervalMs = Math.floor(1000 / mergedConfig.fps);
    captureIntervalTimer = setInterval(() => {
        captureRequestPending = true;
    }, intervalMs);
    ensureLoop();
}

/**
 * Stop an active capture session. Pipeline stays alive.
 */
export function stopCapture() {
    captureActive = false;
    streamOnFrame = null;
    streamSessionId = null;
    if (captureIntervalTimer) {
        clearInterval(captureIntervalTimer);
        captureIntervalTimer = null;
    }
}

/**
 * Capture a single frame (used by the screenshot feature).
 * Returns a promise that resolves with the data URL after the next render frame.
 */
export function captureSingleFrame(
    quality: number = 0.5,
    resolutionScale: number = 1.0,
    encoding: string = 'jpg',
): Promise<string | null> {
    try {
        init();
    } catch (e) {
        console.error('[gameCapture] Init failed:', e);
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        screenshotPending = { quality, encoding, resolutionScale, resolve };
        ensureLoop();
    });
}

/**
 * Pre-initialize the pipeline. The render loop only starts on the first capture request.
 */
export function warmupPipeline() {
    init();
}
