import { balanceGains, isNeutral, lookMatrix } from "@/lib/cuts/color";
import type { VisualLayer } from "@/lib/cuts/frame";
import { drawText } from "@/lib/cuts/text";

// --------------------------------------------------
// NAAR CUTS: THE COMPOSITOR (WebGL2)
//
// Draws a frame's layers (lib/cuts/frame.ts) bottom to
// top: each a textured quad, placed, rotated and cropped,
// then graded in one shader (exposure, white balance,
// shadows/highlights, contrast, saturation, look,
// vignette), dipped to a colour, wiped and faded. The
// preview and the export both render through this, on a
// canvas or an OffscreenCanvas.
// --------------------------------------------------

export type FrameSource = TexImageSource;

export type RenderItem = {
  layer: VisualLayer;
  // The picture for video and image layers (titles and
  // solids are drawn here); null when not loaded yet
  source: FrameSource | null;
  sourceWidth: number;
  sourceHeight: number;
};

const VERTEX = `#version 300 es
uniform vec2 u_corners[4];
uniform vec4 u_uvRect;
out vec2 v_uv;
out vec2 v_local;
void main() {
  // Triangle strip: top left, top right, bottom left, bottom right
  vec2 local = vec2(float(gl_VertexID % 2), float(gl_VertexID / 2));
  v_local = local;
  v_uv = mix(u_uvRect.xy, u_uvRect.zw, local);
  gl_Position = vec4(u_corners[gl_VertexID], 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_local;
uniform sampler2D u_tex;
uniform float u_opacity;
uniform bool u_grade;
uniform float u_exposure;
uniform vec3 u_balance;
uniform float u_shadows;
uniform float u_highlights;
uniform float u_contrast;
uniform float u_saturation;
uniform mat3 u_look;
uniform vec3 u_lookOffset;
uniform float u_vignette;
uniform float u_dip;
uniform vec3 u_dipColor;
uniform float u_revealFrom;
uniform float u_width;
out vec4 outColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
void main() {
  if (gl_FragCoord.x / u_width < u_revealFrom) discard;
  vec4 color = texture(u_tex, v_uv);
  vec3 rgb = color.rgb;
  if (u_grade) {
    rgb *= exp2(u_exposure) * u_balance;
    float luma = dot(rgb, LUMA);
    rgb += u_shadows * 0.25 * max(0.0, 1.0 - luma * 2.0) + u_highlights * 0.25 * max(0.0, luma * 2.0 - 1.0);
    rgb = (rgb - 0.5) * (1.0 + u_contrast) + 0.5;
    float grey = dot(rgb, LUMA);
    rgb = grey + (rgb - grey) * u_saturation;
    rgb = u_look * rgb + u_lookOffset;
    vec2 d = v_local - 0.5;
    rgb *= 1.0 - u_vignette * smoothstep(0.35, 0.85, length(d) * 1.25);
    rgb = clamp(rgb, 0.0, 1.0);
  }
  rgb = mix(rgb, u_dipColor, u_dip);
  outColor = vec4(rgb, color.a * u_opacity);
}`;

type Texture = { texture: WebGLTexture; width: number; height: number; stamp: string };

function sizeOf(source: FrameSource): [number, number] {
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    return [source.videoWidth, source.videoHeight];
  }
  if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
    return [source.displayWidth, source.displayHeight];
  }
  const sized = source as { width: number; height: number };
  return [sized.width, sized.height];
}

export class Compositor {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private textures = new Map<string, Texture>();
  // Titles and solid colours are drawn on this first
  private scratch: OffscreenCanvas | HTMLCanvasElement;
  private width: number;
  private height: number;
  private lost = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, width: number, height: number, options: { preserve?: boolean } = {}) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      premultipliedAlpha: false,
      // The export reads the canvas after drawing
      preserveDrawingBuffer: Boolean(options.preserve),
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("This browser can't run the editor (WebGL2 is off or not supported).");
    this.gl = gl;
    this.program = this.link();

    this.scratch =
      typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });

    if ("addEventListener" in canvas) {
      (canvas as HTMLCanvasElement).addEventListener("webglcontextlost", () => {
        this.lost = true;
      });
    }
  }

  private link(): WebGLProgram {
    const { gl } = this;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Shader error: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link error: ${gl.getProgramInfoLog(program)}`);
    }

    gl.useProgram(program);
    // gl_VertexID needs a vertex array bound, even empty
    gl.bindVertexArray(gl.createVertexArray());
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    return program;
  }

  private uniform(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  get contextLost() {
    return this.lost || this.gl.isContextLost();
  }

  // Uploads a picture under `key`; `stamp` skips the
  // upload when it hasn't changed (images, titles)
  private upload(key: string, source: TexImageSource, stamp: string | null): Texture {
    const { gl } = this;
    let entry = this.textures.get(key);

    if (!entry) {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry = { texture, width: 0, height: 0, stamp: "" };
      this.textures.set(key, entry);
    }

    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    if (stamp === null || stamp !== entry.stamp) {
      const [width, height] = sizeOf(source);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      entry.width = width;
      entry.height = height;
      entry.stamp = stamp ?? "";
    }
    return entry;
  }

  // Forget textures of layers no longer on screen
  private sweep(keep: Set<string>) {
    for (const [key, entry] of this.textures) {
      if (keep.has(key)) continue;
      this.gl.deleteTexture(entry.texture);
      this.textures.delete(key);
    }
  }

  render(items: RenderItem[], background: string) {
    const { gl, width, height } = this;
    if (this.contextLost) return;

    gl.viewport(0, 0, width, height);
    const [r, g, b] = hexColor(background);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const used = new Set<string>();

    for (const item of items) {
      const { layer } = item;
      const key = `${layer.clip.id}:${layer.kind}`;
      let texture: Texture;
      // How big the picture is, before fitting the frame
      let sourceWidth = item.sourceWidth;
      let sourceHeight = item.sourceHeight;

      if (layer.kind === "text" || layer.kind === "solid") {
        const stamp = layer.kind === "text" ? JSON.stringify(layer.text) : String(layer.fill);
        const existing = this.textures.get(key);
        if (!existing || existing.stamp !== stamp) this.paintScratch(layer);
        texture = this.upload(key, this.scratch as TexImageSource, stamp);
        sourceWidth = width;
        sourceHeight = height;
      } else {
        if (!item.source || !sourceWidth || !sourceHeight) continue;
        texture = this.upload(key, item.source, layer.kind === "image" ? `${layer.clip.assetId}` : null);
      }

      used.add(key);
      this.drawLayer(layer, texture, sourceWidth, sourceHeight);
    }

    this.sweep(used);
  }

  private paintScratch(layer: VisualLayer) {
    const context = this.scratch.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    if (layer.kind === "solid") {
      context.fillStyle = layer.fill ?? "#000";
      context.fillRect(0, 0, this.width, this.height);
    } else if (layer.text) {
      drawText(context, this.width, this.height, layer.text);
    }
  }

  private drawLayer(layer: VisualLayer, texture: Texture, sourceWidth: number, sourceHeight: number) {
    const { gl, width, height } = this;

    // Fit inside the frame (like "contain"), then the
    // clip's own scale; cropping trims the edges in place
    const fit = Math.min(width / sourceWidth, height / sourceHeight) * layer.scale;
    const fullWidth = sourceWidth * fit;
    const fullHeight = sourceHeight * fit;
    const { left, right, top, bottom } = layer.crop;
    const x0 = (-0.5 + left) * fullWidth;
    const x1 = (0.5 - right) * fullWidth;
    const y0 = (-0.5 + top) * fullHeight;
    const y1 = (0.5 - bottom) * fullHeight;

    const angle = (layer.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const centreX = width / 2 + layer.x * width;
    const centreY = height / 2 + layer.y * height;

    const corners: number[] = [];
    for (const [px, py] of [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ]) {
      const sx = centreX + px * cos - py * sin;
      const sy = centreY + px * sin + py * cos;
      corners.push((sx / width) * 2 - 1, 1 - (sy / height) * 2);
    }

    gl.uniform2fv(this.uniform("u_corners"), corners);
    gl.uniform4f(this.uniform("u_uvRect"), left, top, 1 - right, 1 - bottom);
    gl.uniform1f(this.uniform("u_opacity"), Math.min(1, Math.max(0, layer.opacity)));
    gl.uniform1f(this.uniform("u_width"), width);
    gl.uniform1f(this.uniform("u_revealFrom"), layer.revealFrom);
    gl.uniform1f(this.uniform("u_dip"), layer.dip);
    gl.uniform3fv(this.uniform("u_dipColor"), layer.dipColor);

    const color = layer.color;
    const grade = layer.kind !== "text" && !isNeutral(color);
    gl.uniform1i(this.uniform("u_grade"), grade ? 1 : 0);
    if (grade) {
      const look = lookMatrix(color.look, color.lookAmount);
      gl.uniform1f(this.uniform("u_exposure"), color.exposure);
      gl.uniform3fv(this.uniform("u_balance"), balanceGains(color.temperature, color.tint));
      gl.uniform1f(this.uniform("u_shadows"), color.shadows);
      gl.uniform1f(this.uniform("u_highlights"), color.highlights);
      gl.uniform1f(this.uniform("u_contrast"), color.contrast);
      gl.uniform1f(this.uniform("u_saturation"), color.saturation);
      // Row-major, so transposed on the way in
      gl.uniformMatrix3fv(this.uniform("u_look"), true, look.matrix);
      gl.uniform3fv(this.uniform("u_lookOffset"), look.offset);
      gl.uniform1f(this.uniform("u_vignette"), color.vignette);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture.texture);
    gl.uniform1i(this.uniform("u_tex"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Frees what this compositor made. An on-page canvas
  // keeps its context: a lost one can never draw again,
  // and the preview reuses its canvas (a new frame size,
  // or React mounting it twice in development).
  dispose() {
    this.sweep(new Set());
    this.gl.deleteProgram(this.program);
    if (typeof OffscreenCanvas !== "undefined" && this.canvas instanceof OffscreenCanvas) {
      this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }
}

// "#rrggbb" → 0–1 RGB
export function hexColor(value: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return [0, 0, 0];
  const number = parseInt(match[1], 16);
  return [(number >> 16) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}
