const defaultVideoUrl = "https://www.youtube.com/watch?v=MD2xgAvyhpo";

const elements = {
  canvas: document.querySelector("#gpu-canvas"),
  form: document.querySelector("#video-form"),
  input: document.querySelector("#youtube-url"),
  iframe: document.querySelector("#player"),
  title: document.querySelector("#video-title"),
  note: document.querySelector("#form-note"),
  status: document.querySelector("#gpu-status"),
  youtubeLink: document.querySelector("#youtube-link"),
};

const pointer = {
  x: window.innerWidth * 0.78,
  y: window.innerHeight * 0.24,
  targetX: window.innerWidth * 0.78,
  targetY: window.innerHeight * 0.24,
  energy: 0.4,
};

function setGpuStatus(text, tone = "neutral") {
  elements.status.textContent = text;
  elements.status.dataset.tone = tone;
}

function setFormNote(text, isError = false) {
  elements.note.textContent = text;
  elements.note.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function extractYouTubeId(rawValue) {
  const value = rawValue.trim();

  if (/^[\w-]{11}$/.test(value)) {
    return value;
  }

  try {
    const normalizedValue = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
    const parsed = new URL(normalizedValue);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v");
      }

      const parts = parsed.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0])) {
        return parts[1] ?? null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function buildEmbedUrl(videoId) {
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

function updateVideo(rawValue) {
  const videoId = extractYouTubeId(rawValue);

  if (!videoId) {
    elements.input.setCustomValidity("Please enter a valid YouTube URL.");
    elements.input.reportValidity();
    setFormNote("Invalid YouTube URL.", true);
    return false;
  }

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  elements.input.setCustomValidity("");
  elements.iframe.src = buildEmbedUrl(videoId);
  elements.title.textContent = `Video ID: ${videoId}`;
  elements.youtubeLink.href = watchUrl;
  elements.input.value = watchUrl;
  setFormNote("");
  return true;
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  updateVideo(elements.input.value);
});

window.addEventListener("pointermove", (event) => {
  pointer.targetX = event.clientX;
  pointer.targetY = event.clientY;
  pointer.energy = 1;
});

window.addEventListener("resize", () => {
  pointer.targetX = Math.min(pointer.targetX, window.innerWidth);
  pointer.targetY = Math.min(pointer.targetY, window.innerHeight);
});

updateVideo(defaultVideoUrl);

async function initWebGpuBackdrop() {
  if (!("gpu" in navigator)) {
    document.body.dataset.gpu = "fallback";
    setGpuStatus("WebGPU unavailable", "warn");
    return;
  }

  if (!window.isSecureContext) {
    document.body.dataset.gpu = "fallback";
    setGpuStatus("Use localhost or HTTPS", "warn");
    return;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No GPU adapter");
    }

    const device = await adapter.requestDevice();
    const context = elements.canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();

    const uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = device.createShaderModule({
      code: `
        struct Uniforms {
          resolution: vec2f,
          pointer: vec2f,
          time: f32,
          energy: f32,
          padding: vec2f,
        };

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;

        struct VertexOut {
          @builtin(position) position: vec4f,
        };

        @vertex
        fn vertex_main(@builtin(vertex_index) index: u32) -> VertexOut {
          var positions = array<vec2f, 3>(
            vec2f(-1.0, -3.0),
            vec2f(-1.0, 1.0),
            vec2f(3.0, 1.0)
          );

          var out: VertexOut;
          out.position = vec4f(positions[index], 0.0, 1.0);
          return out;
        }

        fn palette(t: f32) -> vec3f {
          let a = vec3f(0.03, 0.09, 0.12);
          let b = vec3f(0.14, 0.22, 0.24);
          let c = vec3f(0.91, 0.74, 0.32);
          let d = vec3f(0.07, 0.28, 0.48);
          return a + b * cos(6.28318 * (c * t + d));
        }

        @fragment
        fn fragment_main(@builtin(position) coord: vec4f) -> @location(0) vec4f {
          let resolution = max(uniforms.resolution, vec2f(1.0, 1.0));
          let uv = coord.xy / resolution;
          let aspect = resolution.x / resolution.y;

          var p = uv * 2.0 - 1.0;
          p.x *= aspect;

          var focus = uniforms.pointer / resolution;
          focus = focus * 2.0 - 1.0;
          focus.x *= aspect;

          let t = uniforms.time * 0.14;
          let waveA = sin((p.x * 3.2) + (t * 8.5));
          let waveB = cos((p.y * 4.4) - (t * 7.1));
          let waveC = sin((length(p - focus) * 8.5) - (t * 12.0));

          let glow = (0.22 + (uniforms.energy * 0.08)) / (0.22 + distance(p, focus));
          let beam = smoothstep(0.75, -0.1, abs(p.y + 0.22 * waveA));
          let orbit = 0.5 + 0.5 * sin((p.x + p.y) * 5.0 - (t * 10.0));

          var color = palette(orbit + (waveA * 0.18) + (waveB * 0.12));
          color += vec3f(0.06, 0.2, 0.28) * beam;
          color += vec3f(0.84, 0.58, 0.14) * glow * (0.62 + (0.38 * waveC));
          color += vec3f(0.0, 0.1, 0.13) * (1.0 - smoothstep(0.18, 1.45, length(p)));

          let vignette = smoothstep(1.4, 0.1, length(p * vec2f(0.95, 0.82)));
          let scan = 0.018 * sin((coord.y * 0.11) + (t * 18.0));
          color = color * vignette + scan;

          return vec4f(color, 1.0);
        }
      `,
    });

    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: shaderModule,
        entryPoint: "vertex_main",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragment_main",
        targets: [{ format }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: uniformBuffer },
        },
      ],
    });

    function resizeCanvas() {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(window.innerWidth * pixelRatio));
      const height = Math.max(1, Math.floor(window.innerHeight * pixelRatio));

      if (elements.canvas.width !== width || elements.canvas.height !== height) {
        elements.canvas.width = width;
        elements.canvas.height = height;
        context.configure({
          device,
          format,
          alphaMode: "premultiplied",
        });
      }
    }

    function frame(now) {
      resizeCanvas();

      pointer.x += (pointer.targetX - pointer.x) * 0.055;
      pointer.y += (pointer.targetY - pointer.y) * 0.055;
      pointer.energy += (0.35 - pointer.energy) * 0.05;

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const uniformData = new Float32Array([
        elements.canvas.width,
        elements.canvas.height,
        pointer.x * pixelRatio,
        pointer.y * pixelRatio,
        now * 0.001,
        pointer.energy,
        0,
        0,
      ]);

      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0.01, g: 0.03, b: 0.04, a: 1 },
          },
        ],
      });

      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3, 1, 0, 0);
      pass.end();

      device.queue.submit([encoder.finish()]);
      requestAnimationFrame(frame);
    }

    setGpuStatus("WebGPU active", "ok");
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    document.body.dataset.gpu = "fallback";
    setGpuStatus("WebGPU fallback", "warn");
  }
}

initWebGpuBackdrop();
